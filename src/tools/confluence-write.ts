import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { confluenceStorageToMarkdown, ConfluenceContext } from '../parsers/content-parser.js';
import { markdownToConfluenceStorage } from '../parsers/markdown-to-storage.js';
import { extractConfluenceId } from './confluence.js';

export const updateConfluencePageInputSchema = z
  .object({
    url: z.string().url().describe('Confluence page URL').optional(),
    page_id: z.string().describe('Confluence page ID').optional(),
    content: z.string().min(1).describe('Markdown content to publish'),
    title: z.string().optional().describe('New page title (only if changing title)'),
    mode: z.enum(['replace', 'append']).optional().default('replace'),
  })
  .refine((val) => !!val.url || !!val.page_id, {
    message: 'Provide either url or page_id',
  });

export const updateConfluencePageTool = {
  name: 'update_confluence_page',
  description:
    'Update a Confluence page body with Markdown content. Supports replace (default) or append mode. Does not create new pages.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Confluence page URL' },
      page_id: { type: 'string', description: 'Confluence page ID' },
      content: { type: 'string', description: 'Markdown content to publish' },
      title: { type: 'string', description: 'New page title (only if changing title)' },
      mode: {
        type: 'string',
        enum: ['replace', 'append'],
        description: 'replace (default) overwrites body; append adds content at the end',
      },
    },
    required: ['content'],
  },
};

export async function handleUpdateConfluencePage(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = updateConfluencePageInputSchema.parse(args);
  const pageId = input.page_id ?? extractConfluenceId(input.url);
  if (!pageId) {
    throw new Error('Unable to resolve page ID from url or page_id');
  }

  const page = await client.fetchPage(pageId);
  const context: ConfluenceContext = {
    baseUrl: client.getBaseUrl(),
    pageId,
  };

  let markdown = input.content;
  if (input.mode === 'append') {
    const existing = confluenceStorageToMarkdown(page.storage, context);
    markdown = `${existing}\n\n${input.content}`;
  }

  const storageBody = markdownToConfluenceStorage(markdown);
  const result = await client.updatePage(pageId, {
    title: input.title ?? page.title ?? 'Untitled',
    body: storageBody,
  });

  const text = [
    `Page updated successfully (${input.mode} mode).`,
    `Title: ${result.title}`,
    `URL: ${result.url}`,
    `Page ID: ${result.id}`,
    `Version: ${result.version}`,
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}
