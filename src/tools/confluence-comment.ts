import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { markdownToConfluenceStorage } from '../parsers/markdown-to-storage.js';
import { resolvePageId } from '../validators/ids.js';
import { hasPageTarget, pageTargetFields } from './page-content.js';
import { additiveWriteTool, defineTool, textResult, TextToolResult } from './tool-definition.js';

export const addConfluenceCommentInputSchema = z
  .object({
    ...pageTargetFields,
    comment: z.string().trim().min(1).describe('Markdown comment to add'),
  })
  .refine(hasPageTarget, { message: 'Provide either url or page_id' });

export const addConfluenceInlineCommentInputSchema = z
  .object({
    ...pageTargetFields,
    comment: z.string().trim().min(1).describe('Markdown comment to add'),
    text_selection: z.string().trim().min(1).describe('Exact visible page text to highlight'),
    match_index: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe('Zero-based occurrence when the selected text appears more than once (default 0)'),
  })
  .refine(hasPageTarget, { message: 'Provide either url or page_id' });

export const addConfluenceCommentTool = defineTool({
  name: 'add_confluence_comment',
  description: 'Adds a general footer comment to a Confluence page without updating page content.',
  schema: addConfluenceCommentInputSchema,
  annotations: additiveWriteTool('Add Confluence comment'),
});

export const addConfluenceInlineCommentTool = defineTool({
  name: 'add_confluence_inline_comment',
  description:
    'Adds a Confluence inline comment anchored to exact visible text without updating page content.',
  schema: addConfluenceInlineCommentInputSchema,
  annotations: additiveWriteTool('Add Confluence inline comment'),
});

export async function handleAddConfluenceComment(client: ConfluenceClient, args: unknown): Promise<TextToolResult> {
  const input = addConfluenceCommentInputSchema.parse(args);
  const pageId = resolvePageId(input, client.getBaseUrl());
  const result = await client.comments.addFooterComment(pageId, markdownToConfluenceStorage(input.comment));
  return commentResponse('General', pageId, result.id);
}

export async function handleAddConfluenceInlineComment(client: ConfluenceClient, args: unknown): Promise<TextToolResult> {
  const input = addConfluenceInlineCommentInputSchema.parse(args);
  const pageId = resolvePageId(input, client.getBaseUrl());
  const textSelection = normalizeVisibleText(input.text_selection);
  const renderedText = await client.pages.renderedText(pageId);
  const matchCount = countOccurrences(renderedText, textSelection);

  validateMatch(textSelection, input.match_index, matchCount);
  const result = await client.comments.addInlineComment({
    pageId,
    body: markdownToConfluenceStorage(input.comment),
    textSelection,
    textSelectionMatchCount: matchCount,
    textSelectionMatchIndex: input.match_index,
  });
  return commentResponse('Inline', pageId, result.id);
}

function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function countOccurrences(value: string, selection: string): number {
  let count = 0;
  for (let offset = value.indexOf(selection); offset !== -1; offset = value.indexOf(selection, offset + selection.length)) {
    count += 1;
  }
  return count;
}

function validateMatch(textSelection: string, matchIndex: number, matchCount: number): void {
  if (matchCount === 0) {
    throw new Error(`Selected text was not found on the page: "${textSelection}"`);
  }
  if (matchIndex >= matchCount) {
    throw new Error(
      `match_index ${matchIndex} is out of range for ${matchCount} occurrence(s) of "${textSelection}"`,
    );
  }
}

function commentResponse(kind: 'General' | 'Inline', pageId: string, commentId: string): TextToolResult {
  return textResult(`${kind} comment ${commentId} added to Confluence page ${pageId}. Page content was not changed.`);
}
