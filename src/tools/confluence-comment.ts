import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { markdownToConfluenceStorage } from '../parsers/markdown-to-storage.js';
import { extractConfluenceId } from './confluence.js';

const pageTargetFields = {
  url: z.string().url().describe('Confluence page URL').optional(),
  page_id: z.string().trim().min(1).describe('Confluence page ID').optional(),
};

export const addConfluenceCommentInputSchema = z
  .object({
    ...pageTargetFields,
    comment: z.string().trim().min(1).describe('Markdown comment to add'),
  })
  .refine((input) => !!input.url || !!input.page_id, {
    message: 'Provide either url or page_id',
  });

export const addConfluenceInlineCommentInputSchema = z
  .object({
    ...pageTargetFields,
    comment: z.string().trim().min(1).describe('Markdown comment to add'),
    text_selection: z.string().trim().min(1).describe('Exact visible text to highlight'),
    match_index: z.number().int().nonnegative().optional().default(0),
  })
  .refine((input) => !!input.url || !!input.page_id, {
    message: 'Provide either url or page_id',
  });

export const addConfluenceCommentTool = {
  name: 'add_confluence_comment',
  description:
    'Adds a general footer comment to a Confluence page without updating page content.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Confluence page URL' },
      page_id: { type: 'string', description: 'Confluence page ID' },
      comment: { type: 'string', minLength: 1, description: 'Markdown comment to add' },
    },
    required: ['comment'],
  },
};

export const addConfluenceInlineCommentTool = {
  name: 'add_confluence_inline_comment',
  description:
    'Adds a Confluence inline comment anchored to exact visible text without updating page content.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Confluence page URL' },
      page_id: { type: 'string', description: 'Confluence page ID' },
      comment: { type: 'string', minLength: 1, description: 'Markdown comment to add' },
      text_selection: {
        type: 'string',
        minLength: 1,
        description: 'Exact visible page text to highlight',
      },
      match_index: {
        type: 'integer',
        minimum: 0,
        description: 'Zero-based occurrence when selected text repeats (default 0)',
      },
    },
    required: ['comment', 'text_selection'],
  },
};

export async function handleAddConfluenceComment(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = addConfluenceCommentInputSchema.parse(args);
  const pageId = resolvePageId(input.page_id, input.url);
  const result = await client.addFooterComment(
    pageId,
    markdownToConfluenceStorage(input.comment),
  );

  return commentResponse('General', pageId, result.id);
}

export async function handleAddConfluenceInlineComment(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = addConfluenceInlineCommentInputSchema.parse(args);
  const pageId = resolvePageId(input.page_id, input.url);
  const textSelection = normalizeVisibleText(input.text_selection);
  const renderedText = await client.fetchRenderedPageText(pageId);
  const matchCount = countOccurrences(renderedText, textSelection);

  validateMatch(textSelection, input.match_index, matchCount);
  const result = await client.addInlineComment({
    pageId,
    body: markdownToConfluenceStorage(input.comment),
    textSelection,
    textSelectionMatchCount: matchCount,
    textSelectionMatchIndex: input.match_index,
  });

  return commentResponse('Inline', pageId, result.id);
}

function resolvePageId(pageId?: string, url?: string): string {
  const resolved = pageId ?? extractConfluenceId(url);
  if (!resolved) {
    throw new Error('Unable to resolve page ID from url or page_id');
  }
  return resolved;
}

function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function countOccurrences(value: string, selection: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(selection, offset)) !== -1) {
    count += 1;
    offset += selection.length;
  }
  return count;
}

function validateMatch(
  textSelection: string,
  matchIndex: number,
  matchCount: number,
): void {
  if (matchCount === 0) {
    throw new Error(`Selected text was not found on the page: "${textSelection}"`);
  }
  if (matchIndex >= matchCount) {
    throw new Error(
      `match_index ${matchIndex} is out of range for ${matchCount} occurrence(s) of "${textSelection}"`,
    );
  }
}

function commentResponse(
  kind: 'General' | 'Inline',
  pageId: string,
  commentId: string,
): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{
      type: 'text',
      text: `${kind} comment ${commentId} added to Confluence page ${pageId}. Page content was not changed.`,
    }],
  };
}
