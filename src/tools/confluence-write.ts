import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { resolvePageId } from '../validators/ids.js';
import {
  DEFAULT_PAGE_WRITE_OPTIONS,
  hasOneContentSource,
  hasPageTarget,
  ONE_CONTENT_SOURCE_MESSAGE,
  pageContentFields,
  pageTargetFields,
  PageWriteOptions,
  resolveStorageBody,
} from './page-content.js';
import { defineTool, destructiveWriteTool, textResult, TextToolResult } from './tool-definition.js';

export const updateConfluencePageInputSchema = z
  .object({
    ...pageTargetFields,
    ...pageContentFields,
    title: z.string().trim().min(1).max(255).optional().describe('New page title (only when renaming)'),
    mode: z
      .enum(['replace', 'append'])
      .optional()
      .default('replace')
      .describe('replace (default) overwrites the whole body; append adds the content after the existing body unchanged'),
    expected_version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Version you last read. The update is refused if the page has changed since.'),
  })
  .refine(hasPageTarget, { message: 'Provide either url or page_id' })
  .refine(hasOneContentSource, { message: ONE_CONTENT_SOURCE_MESSAGE });

export const updateConfluencePageTool = defineTool({
  name: 'update_confluence_page',
  description:
    'Updates an existing Confluence page body. replace mode overwrites the body; append mode adds content after the existing body without converting it, so macros and formatting are kept. Pass expected_version from read_confluence_page to avoid overwriting someone else\'s edit. Does not create pages.',
  schema: updateConfluencePageInputSchema,
  annotations: destructiveWriteTool('Update Confluence page'),
});

export async function handleUpdateConfluencePage(
  client: ConfluenceClient,
  args: unknown,
  options: PageWriteOptions = DEFAULT_PAGE_WRITE_OPTIONS,
): Promise<TextToolResult> {
  const input = updateConfluencePageInputSchema.parse(args);
  const pageId = resolvePageId(input, client.getBaseUrl());
  const page = await client.pages.get(pageId, { body: true });
  if (input.expected_version !== undefined && input.expected_version !== page.version) {
    throw new Error(
      `Page ${pageId} is at version ${page.version}, not ${input.expected_version}. Someone changed it after you read it. Read it again before updating.`,
    );
  }

  const newContent = await resolveStorageBody(input, { baseUrl: client.getBaseUrl(), pageId }, options);
  const storage = input.mode === 'append' ? `${page.storage ?? ''}${newContent}` : newContent;
  const result = await client.pages.update(pageId, {
    title: input.title ?? page.title,
    storage,
    version: page.version + 1,
  });

  return textResult(
    [
      `Page updated successfully (${input.mode} mode).`,
      `Title: ${result.title}`,
      `URL: ${result.webUrl}`,
      `Page ID: ${result.id}`,
      `Version: ${result.version} (was ${page.version})`,
    ].join('\n'),
  );
}
