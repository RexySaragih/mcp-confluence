import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { confluenceStorageToMarkdown, ConfluenceContext } from '../parsers/content-parser.js';

export const confluenceInputSchema = z
  .object({
    url: z.string().url().describe('Confluence page URL').optional(),
    page_id: z.string().describe('Confluence page ID').optional(),
    include_comments: z.boolean().optional().default(false),
  })
  .refine((val) => !!val.url || !!val.page_id, {
    message: 'Provide either url or page_id',
  });

export const readConfluencePageTool = {
  name: 'read_confluence_page',
  description:
    'Fetches Confluence page content and returns markdown. Optionally include page comments.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Confluence page URL' },
      page_id: { type: 'string', description: 'Confluence page ID' },
      include_comments: { type: 'boolean', description: 'Include page comments (default false)' },
    },
  },
};

export async function handleReadConfluencePage(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { url, page_id, include_comments } = confluenceInputSchema.parse(args);
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

  const lines = [
    `Title: ${page.title ?? 'Untitled'}`,
    page.url ? `URL: ${page.url}` : '',
    page.labels?.length ? `Labels: ${page.labels.join(', ')}` : '',
    '',
    markdown || 'No content available.',
  ].filter(Boolean);

  if (include_comments) {
    const comments = await client.fetchPageComments(id);
    lines.push('', '## Comments');
    if (comments.length === 0) {
      lines.push('No comments found on this page.');
    } else {
      const commentText = formatComments(comments);
      lines.push(commentText);
    }
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

export function extractConfluenceId(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/\/pages\/([0-9]+)/);
  if (match?.[1]) return match[1];
  const uuidMatch = url.match(/pageId=([0-9a-f-]+)/i);
  return uuidMatch?.[1];
}

function formatComments(
  comments: { author: string; created: string; body: string; replies: { author: string; created: string; body: string }[] }[],
): string {
  return comments
    .map((c, i) => {
      const body = c.body.replace(/<[^>]+>/g, '').trim();
      const replyLines = c.replies.map((r, j) => {
        const rb = r.body.replace(/<[^>]+>/g, '').trim();
        return `  [reply ${j + 1}] ${r.author} (${r.created})\n  ${rb}`;
      }).join('\n\n');
      return `[${i + 1}] ${c.author} (${c.created})\n${body}${replyLines ? '\n\n' + replyLines : ''}`;
    })
    .join('\n\n---\n\n');
}
