import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { ConfluencePage } from '../types/index.js';
import { resolvePageId } from '../validators/ids.js';
import { hasPageTarget, pageTargetFields } from './page-content.js';
import { describePath, formatPath } from './page-hierarchy.js';
import { additiveWriteTool, defineTool, textResult, TextToolResult } from './tool-definition.js';

export const moveConfluencePageInputSchema = z
  .object({
    ...pageTargetFields,
    target_parent_id: z.string().trim().min(1).optional().describe('ID of the page that becomes the new parent'),
    target_parent_url: z.string().url().optional().describe('URL of the page that becomes the new parent'),
  })
  .refine(hasPageTarget, { message: 'Provide the page to move with url or page_id' })
  .refine((input) => !!input.target_parent_id !== !!input.target_parent_url, {
    message: 'Provide exactly one of target_parent_id or target_parent_url',
  });

export const moveConfluencePageTool = defineTool({
  name: 'move_confluence_page',
  description:
    'Moves a Confluence page (with its children) to become the last child of another page in the same space. Use only when the user asks to move or re-parent a page. Page content is not changed; the response includes how to undo the move.',
  schema: moveConfluencePageInputSchema,
  annotations: { ...additiveWriteTool('Move Confluence page'), idempotentHint: true },
});

export async function handleMoveConfluencePage(client: ConfluenceClient, args: unknown): Promise<TextToolResult> {
  const input = moveConfluencePageInputSchema.parse(args);
  const baseUrl = client.getBaseUrl();
  const pageId = resolvePageId(input, baseUrl, 'page to move');
  const targetId = resolvePageId({ page_id: input.target_parent_id, url: input.target_parent_url }, baseUrl, 'target parent page');
  if (pageId === targetId) throw new Error('A page cannot be moved under itself.');

  const [page, target] = await Promise.all([client.pages.get(pageId), client.pages.get(targetId)]);
  if (page.spaceId !== target.spaceId) {
    throw new Error(
      `Page ${page.id} is in space ${page.spaceKey ?? page.spaceId} and the target is in ${target.spaceKey ?? target.spaceId}. Moving pages between spaces is not supported.`,
    );
  }
  if (page.parentId === target.id) {
    return textResult(`"${page.title}" (${page.id}) is already a child of "${target.title}" (${target.id}). Nothing was changed.`);
  }

  const [ancestorsBefore, targetAncestors] = await Promise.all([client.pages.ancestors(pageId), client.pages.ancestors(targetId)]);
  if (targetAncestors.some((ancestor) => ancestor.id === pageId)) {
    throw new Error(`"${target.title}" (${target.id}) is inside "${page.title}" (${page.id}). A page cannot be moved under its own descendant.`);
  }

  await client.pages.move(pageId, targetId);
  const pathAfter = await describePath(client, pageId, page.title);
  return textResult(
    [
      `Moved "${page.title}" (${page.id}) under "${target.title}" (${target.id}). Page content was not changed.`,
      `Before: ${formatPath(ancestorsBefore, page.title)}`,
      `After: ${pathAfter}`,
      undoHint(page),
    ].join('\n'),
  );
}

function undoHint(page: ConfluencePage): string {
  if (page.parentId && (page.parentType ?? 'page') === 'page') {
    return `To undo: call move_confluence_page with page_id="${page.id}" and target_parent_id="${page.parentId}".`;
  }
  const previous = page.parentId ? `a ${page.parentType} (${page.parentId})` : 'the top level of the space';
  return `The page was previously under ${previous}; this tool cannot move it back there. Use the Confluence UI to undo.`;
}
