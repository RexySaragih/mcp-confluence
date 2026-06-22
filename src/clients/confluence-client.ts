import {
  ConfluencePage,
  ConfluenceSearchResult,
  UpdatePageParams,
  UpdatePageResult,
} from '../types/index.js';

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

  async searchPages(
    query: string,
    options?: { spaceKey?: string; maxResults?: number },
  ): Promise<ConfluenceSearchResult[]> {
    const maxResults = options?.maxResults ?? 10;
    const cql = buildCql(query, options?.spaceKey);
    const v1ApiBase = `${this.baseUrl}/wiki/rest/api/content/search`;

    const response = await fetch(
      `${v1ApiBase}?cql=${encodeURIComponent(cql)}&limit=${maxResults}&expand=space,body.view`,
      { headers: this.headers() },
    );

    await this.assertOk(response, 'Failed to search Confluence pages');
    const data = (await response.json()) as any;

    return (data?.results ?? []).map((page: any) => ({
      id: page.id,
      title: page.title ?? 'Untitled',
      spaceKey: page.space?.key ?? page.space?.name ?? '',
      excerpt: stripHtml(page.body?.view?.value ?? page.excerpt ?? '').slice(0, 200),
      url: page._links?.webui
        ? `${this.baseUrl}/wiki${page._links.webui}`
        : `${this.baseUrl}/wiki/spaces/${page.space?.key}/pages/${page.id}`,
    }));
  }

  async updatePage(pageId: string, params: UpdatePageParams): Promise<UpdatePageResult> {
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

    return {
      id: data.id,
      title: data.title,
      url: data._links?.base
        ? `${data._links.base}${data._links.webui ?? ''}`
        : `${this.baseUrl}/wiki${data._links?.webui ?? ''}`,
      version: data.version?.number ?? 1,
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
      const next = data?._links?.next;
      url = next ? `${this.baseUrl}/wiki${next}` : null;
    }
    return results;
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

  async downloadAttachment(
    pageId: string,
    filename: string,
  ): Promise<{ base64: string; mimeType: string }> {
    const token = Buffer.from(
      `${this.config.email}:${this.config.apiToken}`,
      'utf8',
    ).toString('base64');
    const authHeaders: Record<string, string> = {
      Authorization: `Basic ${token}`,
      Accept: '*/*',
      'X-Atlassian-Token': 'no-check',
    };

    const v1Url = `${this.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(filename)}&limit=50`;
    const v1Response = await fetch(v1Url, {
      headers: { ...authHeaders, Accept: 'application/json' },
    });

    if (!v1Response.ok) {
      const body = await v1Response.text().catch(() => '');
      throw new Error(
        `Failed to find attachment "${filename}" on page ${pageId}: ${v1Response.status} ${v1Response.statusText}. Body: ${body.substring(0, 200)}`,
      );
    }

    const v1Data = (await v1Response.json()) as any;
    const attachment = v1Data?.results?.[0];

    if (!attachment) {
      throw new Error(
        `Attachment "${filename}" not found on page ${pageId}. Available: ${(v1Data?.results ?? []).map((a: any) => a?.title).join(', ') || 'none'}`,
      );
    }

    const attachmentId = attachment.id;
    if (!attachmentId) {
      throw new Error(`Attachment "${filename}" found but has no ID.`);
    }

    const downloadApiUrl = `${this.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}/download`;

    const downloadResponse = await fetch(downloadApiUrl, {
      headers: authHeaders,
      redirect: 'manual',
    });

    if (downloadResponse.status === 302 || downloadResponse.status === 301 || downloadResponse.status === 303) {
      const cdnUrl = downloadResponse.headers.get('location');
      if (!cdnUrl) {
        throw new Error(`Download endpoint returned redirect but no Location header for "${filename}"`);
      }

      const cdnResponse = await fetch(cdnUrl, {
        headers: { Accept: '*/*' },
        redirect: 'follow',
      });

      if (!cdnResponse.ok) {
        throw new Error(
          `Failed to download from CDN for "${filename}": ${cdnResponse.status} ${cdnResponse.statusText}`,
        );
      }

      const contentType = cdnResponse.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await cdnResponse.arrayBuffer());
      return { base64: buffer.toString('base64'), mimeType: contentType };
    }

    if (downloadResponse.ok) {
      const contentType = downloadResponse.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await downloadResponse.arrayBuffer());
      return { base64: buffer.toString('base64'), mimeType: contentType };
    }

    const responseBody = await downloadResponse.text().catch(() => '');
    throw new Error(
      `Failed to download attachment "${filename}" (attachmentId: ${attachmentId}) from page ${pageId}: ` +
        `${downloadResponse.status} ${downloadResponse.statusText}. Body: ${responseBody.substring(0, 300)}`,
    );
  }

  private async assertOk(response: Response, context: string) {
    if (response.ok) return;
    const body = await response.text().catch(() => '');
    throw new Error(`${context}: ${response.status} ${response.statusText} ${body}`);
  }
}

function buildCql(query: string, spaceKey?: string): string {
  const trimmed = query.trim();
  const isCql = /\b(type|space|text|title|label)\s*[=~]/i.test(trimmed);
  const textClause = isCql ? trimmed : `text ~ "${escapeCql(trimmed)}"`;
  if (spaceKey) {
    return `space = "${escapeCql(spaceKey)}" AND (${textClause}) AND type = page`;
  }
  return `(${textClause}) AND type = page`;
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
