import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import {
  collectMentionedAccountIds,
  collectTitleOnlyPageLinks,
  confluenceStorageToMarkdown,
  pageLinkKey,
  renderedHtmlToMarkdown,
} from '../parsers/storage-to-markdown.js';
import { ChildList, ConfluenceComment, ConfluenceCommentThread, ConfluencePage, ContentSummary } from '../types/index.js';
import { resolvePageId } from '../validators/ids.js';
import { hasPageTarget, pageTargetFields } from './page-content.js';
import { formatChildren, formatPath } from './page-hierarchy.js';
import { defineTool, readOnlyTool, textResult, TextToolResult } from './tool-definition.js';

export const readConfluencePageInputSchema = z
  .object({
    ...pageTargetFields,
    include_comments: z.boolean().optional().default(false).describe('Include page comments and replies'),
    include_hierarchy: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include the ancestor path and the direct child pages'),
  })
  .refine(hasPageTarget, { message: 'Provide either url or page_id' });

export const readConfluencePageTool = defineTool({
  name: 'read_confluence_page',
  description:
    'Fetches a Confluence page as Markdown with its id, space, version, parent id and labels. Optionally includes comments, and the ancestor path plus direct child pages (include_hierarchy).',
  schema: readConfluencePageInputSchema,
  annotations: readOnlyTool('Read Confluence page'),
});

interface Hierarchy {
  ancestors: ContentSummary[];
  children: ChildList;
}

export async function handleReadConfluencePage(client: ConfluenceClient, args: unknown): Promise<TextToolResult> {
  const input = readConfluencePageInputSchema.parse(args);
  const pageId = resolvePageId(input, client.getBaseUrl());
  const page = await client.pages.get(pageId, { body: true, labels: true });

  const [userNames, pageIds, hierarchy, comments] = await Promise.all([
    lookupUserNames(client, page.storage),
    lookupLinkedPageIds(client, page.storage, page.spaceKey),
    input.include_hierarchy ? loadHierarchy(client, pageId) : Promise.resolve(undefined),
    input.include_comments ? client.comments.listThreads(pageId) : Promise.resolve(undefined),
  ]);
  const markdown = confluenceStorageToMarkdown(page.storage, {
    baseUrl: client.getBaseUrl(),
    pageId,
    spaceKey: page.spaceKey,
    userNames,
    pageIds,
  });

  const lines = [...pageHeader(page)];
  if (hierarchy) {
    lines.push(`Path: ${formatPath(hierarchy.ancestors, page.title)}`, ...formatChildren(hierarchy.children, client, page.spaceKey));
  }
  lines.push('', markdown || 'No content available.');
  if (comments) lines.push('', '## Comments', formatComments(comments));
  return textResult(lines.join('\n'));
}

function pageHeader(page: ConfluencePage): string[] {
  return [
    `Title: ${page.title}`,
    `Page ID: ${page.id}`,
    ...(page.spaceKey ? [`Space: ${page.spaceKey}`] : []),
    ...(page.status !== 'current' ? [`Status: ${page.status}`] : []),
    `Version: ${page.version}`,
    `URL: ${page.webUrl}`,
    ...(page.parentId ? [`Parent ID: ${page.parentId}`] : []),
    ...(page.labels.length ? [`Labels: ${page.labels.join(', ')}`] : []),
  ];
}

async function loadHierarchy(client: ConfluenceClient, pageId: string): Promise<Hierarchy> {
  const [ancestors, children] = await Promise.all([client.pages.ancestors(pageId), client.pages.directChildren(pageId)]);
  return { ancestors, children };
}

/** Names make mentions readable; a failed lookup only degrades them to account ids. */
async function lookupUserNames(client: ConfluenceClient, storage: string | undefined): Promise<Map<string, string>> {
  const accountIds = collectMentionedAccountIds(storage);
  if (accountIds.length === 0) return new Map();
  try {
    return await client.directory.userDisplayNames(accountIds);
  } catch (error) {
    console.error('User name lookup failed:', error instanceof Error ? error.message : error);
    return new Map();
  }
}

const MAX_LINK_LOOKUPS = 50;

/**
 * Links stored by title only are resolved to page ids with one CQL search per
 * space, so links keep working after a rename. A failed lookup only falls
 * back to title-based links.
 */
async function lookupLinkedPageIds(
  client: ConfluenceClient,
  storage: string | undefined,
  spaceKey: string | undefined,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const targets = collectTitleOnlyPageLinks(storage, spaceKey).slice(0, MAX_LINK_LOOKUPS);
  const bySpace = new Map<string, string[]>();
  for (const target of targets) bySpace.set(target.spaceKey, [...(bySpace.get(target.spaceKey) ?? []), target.title]);
  try {
    for (const [space, titles] of bySpace) {
      const quoted = titles.map((title) => `"${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ');
      const page = await client.search.search(`space = "${space}" AND type = page AND title in (${quoted})`, {
        limit: titles.length,
      });
      for (const result of page.results) {
        if (result.id && titles.includes(result.title)) ids.set(pageLinkKey(space, result.title), result.id);
      }
    }
  } catch (error) {
    console.error('Page link lookup failed:', error instanceof Error ? error.message : error);
  }
  return ids;
}

function commentLabel(comment: ConfluenceComment): string {
  if (comment.location !== 'inline') return '';
  return comment.selection ? ` [inline on "${comment.selection.replace(/\s+/g, ' ').trim()}"]` : ' [inline]';
}

function formatComments(threads: ConfluenceCommentThread[]): string {
  if (threads.length === 0) return 'No comments found on this page.';
  return threads
    .map((thread, index) => {
      const replies = thread.replies
        .map((reply, replyIndex) => {
          const body = renderedHtmlToMarkdown(reply.bodyHtml).replace(/\n/g, '\n  ');
          return `  [reply ${replyIndex + 1}] ${reply.author} (${reply.created})${commentLabel(reply)}\n  ${body}`;
        })
        .join('\n\n');
      const body = renderedHtmlToMarkdown(thread.bodyHtml);
      return `[${index + 1}] ${thread.author} (${thread.created})${commentLabel(thread)}\n${body}${replies ? `\n\n${replies}` : ''}`;
    })
    .join('\n\n---\n\n');
}
