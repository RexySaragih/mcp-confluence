import { ConfluencePage, CreatePageParams, UpdatePageParams, CreatePageResult } from '../types/index.js';

export interface ConfluenceClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class ConfluenceClient {
  private readonly apiBase: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfluenceClientConfig) {
    if (!config.baseUrl) throw new Error('ATLASSIAN_BASE_URL is required');
    if (!config.email) throw new Error('ATLASSIAN_EMAIL is required');
    if (!config.apiToken) throw new Error('ATLASSIAN_API_TOKEN is required');
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiBase = `${this.baseUrl}/wiki/api/v2`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async fetchPage(pageId: string): Promise<ConfluencePage> {
    const response = await fetch(
      `${this.apiBase}/pages/${pageId}?body-format=storage&embedded-content-render=body`,
      { headers: this.headers() },
    );

    await this.assertOk(response, `Failed to fetch page ${pageId}`);
    const data = (await response.json()) as any;

    return {
      id: data?.id,
      title: data?.title,
      url: data?._links?.base
        ? `${data._links.base}${data._links.webui ?? ''}`
        : data?._links?.webui,
      storage: data?.body?.storage?.value,
      labels: data?.labels?.results?.map((label: any) => label?.name),
      children: data?._links?.webui
        ? (data?.children?.results ?? []).map((child: any) => ({
          id: child?.id,
          title: child?.title,
          url: `${data._links.base}${child?._links?.webui ?? ''}`,
        }))
        : undefined,
      raw: data,
    };
  }

  async createPage(params: CreatePageParams): Promise<CreatePageResult> {
    const resolvedSpaceId = await this.resolveSpaceId(params.spaceId);

    const body: Record<string, unknown> = {
      spaceId: resolvedSpaceId,
      status: 'current',
      title: params.title,
      body: {
        representation: 'storage',
        value: params.body,
      },
    };

    if (params.parentPageId) {
      body.parentId = params.parentPageId;
    }

    const response = await fetch(`${this.apiBase}/pages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    await this.assertOk(response, 'Failed to create page');
    const data = (await response.json()) as any;

    const result: CreatePageResult = {
      id: data.id,
      title: data.title,
      url: data._links?.base
        ? `${data._links.base}${data._links.webui ?? ''}`
        : `${this.baseUrl}/wiki${data._links?.webui ?? ''}`,
      version: data.version?.number ?? 1,
    };

    // Labels are not supported - silently ignore
    return result;
  }

  async updatePage(pageId: string, params: UpdatePageParams): Promise<CreatePageResult> {
    // First fetch current version
    const current = await this.fetchPage(pageId);
    const currentVersion = current.raw?.version as { number?: number } | undefined;

    const body: Record<string, unknown> = {
      id: pageId,
      status: 'current',
      title: params.title,
      body: {
        representation: 'storage',
        value: params.body,
      },
      version: {
        number: (currentVersion?.number ?? 0) + 1,
      },
    };

    const response = await fetch(`${this.apiBase}/pages/${pageId}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    await this.assertOk(response, `Failed to update page ${pageId}`);
    const data = (await response.json()) as any;

    const result: CreatePageResult = {
      id: data.id,
      title: data.title,
      url: data._links?.base
        ? `${data._links.base}${data._links.webui ?? ''}`
        : `${this.baseUrl}/wiki${data._links?.webui ?? ''}`,
      version: data.version?.number ?? 1,
    };

    return result;
  }

  async findPageByTitle(spaceId: string, title: string): Promise<ConfluencePage | null> {
    const resolvedSpaceId = await this.resolveSpaceId(spaceId);
    const encodedTitle = encodeURIComponent(title);
    const response = await fetch(
      `${this.apiBase}/spaces/${resolvedSpaceId}/pages?title=${encodedTitle}&body-format=storage`,
      { headers: this.headers() },
    );

    await this.assertOk(response, `Failed to search for page "${title}"`);
    const data = (await response.json()) as any;

    const pages = data?.results ?? [];
    if (pages.length === 0) return null;

    const page = pages[0];
    return {
      id: page.id,
      title: page.title,
      url: page._links?.webui
        ? `${this.baseUrl}/wiki${page._links.webui}`
        : undefined,
      storage: page.body?.storage?.value,
      raw: page,
    };
  }

  async fetchPageComments(pageId: string): Promise<{ id: string; author: string; created: string; body: string; replies: { id: string; author: string; created: string; body: string }[] }[]> {
    const v1ApiBase = `${this.baseUrl}/wiki/rest/api/content`;
    const allComments: any[] = await this.fetchAllPaged(
      `${v1ApiBase}/${pageId}/child/comment?expand=body.view,version&limit=50`,
    );

    return Promise.all(
      allComments.map(async (c: any) => {
        const replies = await this.fetchAllPaged(
          `${v1ApiBase}/${c.id}/child/comment?expand=body.view,version&limit=50`,
        );
        return {
          id: c.id,
          author: c.version?.by?.displayName ?? 'Unknown',
          created: c.version?.when ?? '',
          body: c.body?.view?.value ?? '',
          replies: replies.map((r: any) => ({
            id: r.id,
            author: r.version?.by?.displayName ?? 'Unknown',
            created: r.version?.when ?? '',
            body: r.body?.view?.value ?? '',
          })),
        };
      }),
    );
  }

  private async fetchAllPaged(initialUrl: string): Promise<any[]> {
    const results: any[] = [];
    let url: string | null = initialUrl;
    while (url) {
      const response = await fetch(url, { headers: this.headers() });
      await this.assertOk(response, `Failed to fetch ${url}`);
      const data = (await response.json()) as any;
      results.push(...(data?.results ?? []));
      // Confluence v1 paginates via _links.next (relative path)
      const next = data?._links?.next;
      url = next ? `${this.baseUrl}/wiki${next}` : null;
    }
    return results;
  }

  async uploadAttachment(
    pageId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string = 'image/svg+xml',
  ): Promise<{ id: string; downloadUrl: string }> {
    // Confluence v1 API for attachments (v2 doesn't support attachment upload yet)
    const v1ApiBase = `${this.baseUrl}/wiki/rest/api/content`;

    const boundary = `----FormBoundary${Date.now()}`;

    // Build multipart form data
    const formDataParts: (string | Buffer)[] = [];

    // Add file field
    formDataParts.push(`--${boundary}\r\n`);
    formDataParts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
    formDataParts.push(`Content-Type: ${mimeType}\r\n`);
    formDataParts.push(`\r\n`);
    formDataParts.push(buffer);
    formDataParts.push(`\r\n`);
    formDataParts.push(`--${boundary}--\r\n`);

    // Combine parts into a single buffer
    const bodyBuffer = Buffer.concat(
      formDataParts.map(part =>
        typeof part === 'string' ? Buffer.from(part, 'utf8') : part
      )
    );

    const response = await fetch(
      `${v1ApiBase}/${pageId}/child/attachment`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'X-Atlassian-Token': 'nocheck',
        },
        body: bodyBuffer,
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Failed to upload attachment to page ${pageId}: ${response.status} ${response.statusText} - ${responseText}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Failed to parse attachment response: ${responseText}`);
    }

    const attachment = data.results?.[0] ?? data;
    if (!attachment || !attachment.id) {
      throw new Error(`Invalid attachment response: ${JSON.stringify(data)}`);
    }

    return {
      id: attachment.id,
      downloadUrl: `${this.baseUrl}/wiki${attachment._links?.download ?? ''}`,
    };
  }

  private async addLabels(pageId: string, labels: string[]): Promise<void> {
    const labelPayload = labels.map((name) => ({ prefix: 'global', name }));

    const response = await fetch(`${this.apiBase}/pages/${pageId}/labels`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(labelPayload),
    });

    // Labels are optional, don't fail if this doesn't work
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`Warning: Failed to add labels to page ${pageId}: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  /**
   * Resolves either a numeric space ID or a space key (e.g. "ENG") to a numeric space ID.
   * Confluence v2 APIs expect a numeric spaceId, but many setups use keys, so we support both.
   */
  private async resolveSpaceId(spaceIdOrKey: string): Promise<string> {
    // If it's already numeric, use it directly
    if (/^[0-9]+$/.test(spaceIdOrKey)) {
      return spaceIdOrKey;
    }

    const response = await fetch(
      `${this.apiBase}/spaces?keys=${encodeURIComponent(spaceIdOrKey)}`,
      { headers: this.headers() },
    );

    await this.assertOk(response, `Failed to resolve space "${spaceIdOrKey}"`);
    const data = (await response.json()) as any;
    const space = data?.results?.[0];

    if (!space?.id) {
      throw new Error(
        `Failed to resolve space "${spaceIdOrKey}" to a numeric ID. ` +
        `Make sure the space key or ID is correct.`,
      );
    }

    return String(space.id);
  }

  private headers() {
    const token = Buffer.from(
      `${this.config.email}:${this.config.apiToken}`,
      'utf8',
    ).toString('base64');
    return {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Downloads an attachment image from a Confluence page and returns it as base64.
   * @param pageId - The page ID the attachment belongs to
   * @param filename - The attachment filename
   * @returns Base64-encoded image data and mime type
   */
  async downloadAttachment(
    pageId: string,
    filename: string,
  ): Promise<{ base64: string; mimeType: string }> {
    const url = `${this.baseUrl}/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}`;
    const token = Buffer.from(
      `${this.config.email}:${this.config.apiToken}`,
      'utf8',
    ).toString('base64');

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${token}`,
        Accept: '*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download attachment "${filename}" from page ${pageId}: ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      base64: buffer.toString('base64'),
      mimeType: contentType,
    };
  }

  private async assertOk(response: Response, context: string) {
    if (response.ok) return;
    const body = await response.text().catch(() => '');
    throw new Error(`${context}: ${response.status} ${response.statusText} ${body}`);
  }
}

