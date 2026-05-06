import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';

export const confluenceImageInputSchema = z.object({
  url: z
    .string()
    .url()
    .describe(
      'Full URL to the Confluence attachment image (e.g., https://yourcompany.atlassian.net/wiki/download/attachments/123456/image.png)',
    )
    .optional(),
  page_id: z.string().describe('Confluence page ID').optional(),
  filename: z.string().describe('Attachment filename (e.g., image-20260415-222345.png)').optional(),
}).refine(
  (val) => !!val.url || (!!val.page_id && !!val.filename),
  { message: 'Provide either url, or both page_id and filename' },
);

export const readConfluenceImageTool = {
  name: 'read_confluence_image',
  description:
    'Downloads and returns an image attachment from a Confluence page. Returns the image as base64 so it can be viewed directly. Use this to inspect architecture diagrams, flowcharts, or any embedded images in Confluence pages.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'Full URL to the Confluence attachment image (e.g., https://yourcompany.atlassian.net/wiki/download/attachments/123456/image.png)',
      },
      page_id: {
        type: 'string',
        description: 'Confluence page ID',
      },
      filename: {
        type: 'string',
        description: 'Attachment filename (e.g., image-20260415-222345.png)',
      },
    },
  },
};

export async function handleReadConfluenceImage(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] }> {
  const input = confluenceImageInputSchema.parse(args);

  let pageId: string;
  let filename: string;

  if (input.url) {
    // Parse the URL to extract pageId and filename
    // Format: https://domain/wiki/download/attachments/{pageId}/{filename}
    const match = input.url.match(/\/attachments\/([^/]+)\/([^?#]+)/);
    if (!match) {
      throw new Error(
        'Unable to parse attachment URL. Expected format: https://domain/wiki/download/attachments/{pageId}/{filename}',
      );
    }
    pageId = match[1];
    filename = decodeURIComponent(match[2]);
  } else {
    pageId = input.page_id!;
    filename = input.filename!;
  }

  const { base64, mimeType } = await client.downloadAttachment(pageId, filename);

  return {
    content: [
      {
        type: 'text',
        text: `Image: ${filename} (page: ${pageId}, type: ${mimeType}, size: ${Math.round(base64.length * 0.75 / 1024)}KB)`,
      },
      {
        type: 'image',
        data: base64,
        mimeType,
      },
    ],
  };
}
