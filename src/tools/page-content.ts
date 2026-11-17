import z from 'zod';
import { markdownToConfluenceStorage, StorageConversionContext } from '../parsers/markdown-to-storage.js';
import { readContentFile } from './content-file.js';

export interface PageWriteOptions {
  /** Directories content_file may read from. Empty means any directory. */
  contentDirs: string[];
}

export const DEFAULT_PAGE_WRITE_OPTIONS: PageWriteOptions = { contentDirs: [] };

export const pageTargetFields = {
  url: z.string().url().optional().describe('Confluence page URL'),
  page_id: z.string().trim().min(1).optional().describe('Confluence page ID (numeric)'),
};

export const pageContentFields = {
  content: z.string().min(1).optional().describe('Page body. Provide exactly one of content or content_file.'),
  content_file: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute path to a local .md/.markdown/.txt (or .html/.xhtml/.xml for storage format) file to use as the page body, instead of sending the body inline.',
    ),
  content_format: z
    .enum(['markdown', 'storage'])
    .optional()
    .default('markdown')
    .describe(
      'markdown (default) is converted to Confluence storage format. storage sends Confluence XHTML as-is, for macros Markdown cannot express.',
    ),
};

export interface PageContentInput {
  content?: string;
  content_file?: string;
  content_format: 'markdown' | 'storage';
}

export function hasPageTarget(input: { url?: string; page_id?: string }): boolean {
  return !!input.url || !!input.page_id;
}

export function hasOneContentSource(input: { content?: string; content_file?: string }): boolean {
  return (input.content !== undefined) !== (input.content_file !== undefined);
}

export const ONE_CONTENT_SOURCE_MESSAGE = 'Provide exactly one of content or content_file';

export async function resolveStorageBody(
  input: PageContentInput,
  context: StorageConversionContext,
  options: PageWriteOptions,
): Promise<string> {
  const source = input.content ?? (await readContentFile(input.content_file ?? '', options.contentDirs));
  if (!source.trim()) throw new Error('The page content is empty.');
  return input.content_format === 'storage' ? source : markdownToConfluenceStorage(source, context);
}
