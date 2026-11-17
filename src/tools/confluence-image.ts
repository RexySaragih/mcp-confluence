import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { assertPageId, assertSameSite } from '../validators/ids.js';
import { defineTool, readOnlyTool, ToolResult } from './tool-definition.js';

const ATTACHMENT_PATH = /\/download\/(?:attachments|thumbnails)\/(\d+)\/([^?#]+)/;
const BYTES_PER_KILOBYTE = 1024;

export const readConfluenceImageInputSchema = z
  .object({
    url: z
      .string()
      .url()
      .optional()
      .describe('Attachment URL, e.g. https://yourcompany.atlassian.net/wiki/download/attachments/123456/image.png'),
    page_id: z.string().trim().min(1).optional().describe('Confluence page ID'),
    filename: z.string().min(1).optional().describe('Attachment filename, e.g. image-20260415-222345.png'),
  })
  .refine((input) => !!input.url || (!!input.page_id && !!input.filename), {
    message: 'Provide either url, or both page_id and filename',
  });

export const readConfluenceImageTool = defineTool({
  name: 'read_confluence_image',
  description:
    'Downloads an image attachment from a Confluence page and returns it as an image (up to 5 MB). Use it to inspect diagrams and screenshots embedded in pages.',
  schema: readConfluenceImageInputSchema,
  annotations: readOnlyTool('Read Confluence image'),
});

export async function handleReadConfluenceImage(client: ConfluenceClient, args: unknown): Promise<ToolResult> {
  const input = readConfluenceImageInputSchema.parse(args);
  const { pageId, filename } = input.url
    ? parseAttachmentUrl(input.url, client.getBaseUrl())
    : { pageId: assertPageId(input.page_id ?? ''), filename: input.filename ?? '' };

  const image = await client.attachments.downloadImage(pageId, filename);
  const kilobytes = Math.round(image.bytes / BYTES_PER_KILOBYTE);
  return {
    content: [
      { type: 'text', text: `Image: ${filename} (page: ${pageId}, type: ${image.mimeType}, size: ${kilobytes}KB)` },
      { type: 'image', data: image.base64, mimeType: image.mimeType },
    ],
  };
}

function parseAttachmentUrl(url: string, baseUrl: string): { pageId: string; filename: string } {
  const parsed = assertSameSite(url, baseUrl);
  const match = parsed.pathname.match(ATTACHMENT_PATH);
  if (!match) {
    throw new Error(
      'Unable to parse attachment URL. Expected format: https://domain/wiki/download/attachments/{pageId}/{filename}',
    );
  }
  return { pageId: match[1], filename: decodeURIComponent(match[2]) };
}
