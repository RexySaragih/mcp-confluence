import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { confluenceStorageToMarkdown, ConfluenceContext } from '../parsers/content-parser.js';

export const confluenceInputSchema = z
  .object({
    url: z.string().url().describe('Confluence page URL').optional(),
    page_id: z.string().describe('Confluence page ID').optional(),
  })
  .refine((val) => !!val.url || !!val.page_id, {
    message: 'Provide either url or page_id',
  });

export const readConfluencePageTool = {
  name: 'read_confluence_page',
  description: 'Fetches Confluence page content and returns markdown',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Confluence page URL' },
      page_id: { type: 'string', description: 'Confluence page ID' },
    },
  },
};

export async function handleReadConfluencePage(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { url, page_id } = confluenceInputSchema.parse(args);
  const id = page_id ?? extractConfluenceId(url);
  if (!id) {
    throw new Error('Unable to resolve page ID from url or page_id');
  }

  const page = await client.fetchPage(id);
  const context: ConfluenceContext = {
    baseUrl: client.getBaseUrl(),
    pageId: id,
  };
  const markdown = confluenceStorageToMarkdown(page.storage, context);

  const text = [
    `Title: ${page.title ?? 'Untitled'}`,
    page.url ? `URL: ${page.url}` : '',
    page.labels?.length ? `Labels: ${page.labels.join(', ')}` : '',
    '',
    markdown || 'No content available.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    content: [{ type: 'text', text }],
  };
}

export const readConfluencePageCommentsTool = {
  name: 'read_confluence_page_comments',
  description: 'Fetches all comments (footer/inline) from a Confluence page',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Confluence page URL' },
      page_id: { type: 'string', description: 'Confluence page ID' },
    },
  },
};

export async function handleReadConfluencePageComments(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { url, page_id } = confluenceInputSchema.parse(args);
  const id = page_id ?? extractConfluenceId(url);
  if (!id) throw new Error('Unable to resolve page ID from url or page_id');

  const comments = await client.fetchPageComments(id);

  if (comments.length === 0) {
    return { content: [{ type: 'text', text: 'No comments found on this page.' }] };
  }

  const text = comments
    .map((c, i) => {
      const body = c.body.replace(/<[^>]+>/g, '').trim();
      const replyLines = c.replies.map((r, j) => {
        const rb = r.body.replace(/<[^>]+>/g, '').trim();
        return `  [reply ${j + 1}] ${r.author} (${r.created})\n  ${rb}`;
      }).join('\n\n');
      return `[${i + 1}] ${c.author} (${c.created})\n${body}${replyLines ? '\n\n' + replyLines : ''}`;
    })
    .join('\n\n---\n\n');

  return { content: [{ type: 'text', text }] };
}

function extractConfluenceId(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/\/pages\/([0-9]+)/);
  if (match?.[1]) return match[1];
  const uuidMatch = url.match(/pageId=([0-9a-f-]+)/i);
  return uuidMatch?.[1];
}

