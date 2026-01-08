import { JiraIssue } from '../types/index.js';

export interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class JiraClient {
  private readonly apiBase: string;

  constructor(private readonly config: JiraClientConfig) {
    if (!config.baseUrl) throw new Error('ATLASSIAN_BASE_URL is required');
    if (!config.email) throw new Error('ATLASSIAN_EMAIL is required');
    if (!config.apiToken) throw new Error('ATLASSIAN_API_TOKEN is required');
    this.apiBase = `${config.baseUrl.replace(/\/$/, '')}/rest/api/3`;
  }

  async fetchIssue(issueKey: string): Promise<JiraIssue> {
    const response = await fetch(`${this.apiBase}/issue/${issueKey}`, {
      headers: this.headers(),
    });

    await this.assertOk(response, `Failed to fetch issue ${issueKey}`);
    const data = (await response.json()) as any;

    return {
      key: data?.key,
      summary: data?.fields?.summary,
      description: data?.fields?.description,
      status: data?.fields?.status,
      assignee: data?.fields?.assignee,
      subtasks:
        data?.fields?.subtasks?.map((subtask: any) => ({
          key: subtask?.key,
          summary: subtask?.fields?.summary,
          status: subtask?.fields?.status,
        })) ?? [],
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

