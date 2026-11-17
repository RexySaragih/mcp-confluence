import { ImageAttachment } from '../../types/index.js';
import { AtlassianHttp, fetchWithTimeout, isRedirect } from '../atlassian-http.js';
import { RawList, RawV1Content } from './raw-types.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;

export class ConfluenceAttachmentsApi {
  constructor(private readonly http: AtlassianHttp) {}

  async downloadImage(pageId: string, filename: string): Promise<ImageAttachment> {
    const attachment = await this.find(pageId, filename);
    const declaredType = normalizeMimeType(attachment.extensions?.mediaType);
    assertImageMetadata(filename, declaredType, attachment.extensions?.fileSize);

    const errorContext = `Failed to download attachment "${filename}" from page ${pageId}`;
    const response = await this.http.send(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachment.id)}/download`,
      { manualRedirect: true, headers: { Accept: '*/*', 'X-Atlassian-Token': 'no-check' }, errorContext },
    );
    const content = isRedirect(response.status) ? await followMediaRedirect(response, errorContext) : response;
    return readImage(content, filename, declaredType);
  }

  private async find(pageId: string, filename: string): Promise<RawV1Content> {
    const raw = await this.http.json<RawList<RawV1Content>>(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?filename=${encodeURIComponent(filename)}&limit=50`,
      { errorContext: `Failed to find attachment "${filename}" on page ${pageId}` },
    );
    const attachment = raw.results?.find((result) => result.title === filename) ?? raw.results?.[0];
    if (!attachment?.id) {
      throw new Error(`Attachment "${filename}" was not found on page ${pageId}.`);
    }
    return attachment;
  }
}

/**
 * Atlassian redirects downloads to its media CDN with a signed URL, so the
 * follow-up request needs no credentials.
 */
async function followMediaRedirect(response: Response, errorContext: string): Promise<Response> {
  const location = response.headers.get('location');
  if (!location || !location.startsWith('https://')) {
    throw new Error(`${errorContext}: the download redirect has no https location.`);
  }
  const target = await fetchWithTimeout(location, { headers: { Accept: '*/*' }, redirect: 'follow' }, errorContext);
  if (!target.ok) {
    throw new Error(`${errorContext}: media download returned ${target.status} ${target.statusText}`.trim());
  }
  return target;
}

async function readImage(response: Response, filename: string, declaredType: string): Promise<ImageAttachment> {
  const mimeType = declaredType || normalizeMimeType(response.headers.get('content-type'));
  assertImageMetadata(filename, mimeType, Number(response.headers.get('content-length')) || undefined);
  const buffer = Buffer.from(await response.arrayBuffer());
  assertImageMetadata(filename, mimeType, buffer.length);
  return { base64: buffer.toString('base64'), mimeType, bytes: buffer.length };
}

function assertImageMetadata(filename: string, mimeType: string, size: number | undefined): void {
  if (mimeType && !mimeType.startsWith('image/')) {
    throw new Error(`Attachment "${filename}" is ${mimeType}, not an image.`);
  }
  if (size !== undefined && size > MAX_IMAGE_BYTES) {
    const megabytes = (size / BYTES_PER_MEGABYTE).toFixed(1);
    throw new Error(
      `Attachment "${filename}" is ${megabytes} MB, above the ${MAX_IMAGE_BYTES / BYTES_PER_MEGABYTE} MB image limit.`,
    );
  }
}

function normalizeMimeType(value: string | null | undefined): string {
  return (value ?? '').split(';')[0].trim().toLowerCase();
}
