import { ConfluencePage } from '../types/index.js';

export interface ConfluenceClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class ConfluenceClient {
  private readonly apiBase: string;

  constructor(private readonly config: ConfluenceClientConfig) {
    if (!config.baseUrl) throw new Error('ATLASSIAN_BASE_URL is required');
    if (!config.email) throw new Error('ATLASSIAN_EMAIL is required');
    if (!config.apiToken) throw new Error('ATLASSIAN_API_TOKEN is required');
    this.apiBase = `${config.baseUrl.replace(/\/$/, '')}/wiki/api/v2`;
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

  private async assertOk(response: Response, context: string) {
    if (response.ok) return;
    const body = await response.text().catch(() => '');
    throw new Error(`${context}: ${response.status} ${response.statusText} ${body}`);
  }
}

