import {
  JiraComment,
  JiraIssue,
  JiraIssueLink,
  JiraSearchPage,
} from '../types/index.js';

export interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

const ISSUE_FIELDS = [
  'summary',
  'description',
  'status',
  'assignee',
  'reporter',
  'priority',
  'issuetype',
  'labels',
  'parent',
  'subtasks',
  'issuelinks',
  'comment',
].join(',');

const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'priority', 'updated'];

export class JiraClient {
  private readonly apiBase: string;
  private readonly baseUrl: string;

  constructor(private readonly config: JiraClientConfig) {
    if (!config.baseUrl) throw new Error('ATLASSIAN_BASE_URL is required');
    if (!config.email) throw new Error('ATLASSIAN_EMAIL is required');
    if (!config.apiToken) throw new Error('ATLASSIAN_API_TOKEN is required');
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiBase = `${this.baseUrl}/rest/api/3`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async fetchIssue(issueKey: string, options?: { includeComments?: boolean }): Promise<JiraIssue> {
    const response = await fetch(
      `${this.apiBase}/issue/${issueKey}?fields=${ISSUE_FIELDS}`,
      { headers: this.headers() },
    );

    await this.assertOk(response, `Failed to fetch issue ${issueKey}`);
    const data = (await response.json()) as any;

    const issue: JiraIssue = {
      key: data?.key,
      summary: data?.fields?.summary,
      description: data?.fields?.description,
      status: data?.fields?.status,
      assignee: data?.fields?.assignee,
      reporter: data?.fields?.reporter,
      priority: data?.fields?.priority,
      issueType: data?.fields?.issuetype,
      labels: data?.fields?.labels ?? [],
      parent: data?.fields?.parent
        ? { key: data.fields.parent.key, summary: data.fields.parent.fields?.summary }
        : undefined,
      issueLinks: mapIssueLinks(data?.fields?.issuelinks),
      subtasks:
        data?.fields?.subtasks?.map((subtask: any) => ({
          key: subtask?.key,
          summary: subtask?.fields?.summary,
          status: subtask?.fields?.status,
        })) ?? [],
      raw: data,
    };

    if (options?.includeComments) {
      issue.comments = await this.fetchComments(issueKey);
    }

    return issue;
  }

  async searchIssues(
    jql: string,
    options: { maxResults: number; nextPageToken?: string },
  ): Promise<JiraSearchPage> {
    const body: Record<string, unknown> = {
      jql,
      maxResults: options.maxResults,
      fields: SEARCH_FIELDS,
    };

    if (options.nextPageToken) {
      body.nextPageToken = options.nextPageToken;
    }

    const response = await fetch(`${this.apiBase}/search/jql`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    await this.assertOk(response, 'Failed to search Jira issues');
    const data = (await response.json()) as any;

    const issues = (data?.issues ?? []).map((issue: any) => ({
      key: issue.key,
      summary: issue.fields?.summary ?? '',
      status: issue.fields?.status?.name ?? 'Unknown',
      assignee: issue.fields?.assignee?.displayName ?? 'Unassigned',
      issueType: issue.fields?.issuetype?.name ?? 'Unknown',
      priority: issue.fields?.priority?.name ?? 'None',
      updated: issue.fields?.updated ?? '',
      url: `${this.baseUrl}/browse/${issue.key}`,
    }));

    const nextPageToken = data?.nextPageToken ?? null;

    return {
      issues,
      maxResults: options.maxResults,
      total: data?.total ?? issues.length,
      hasMore: Boolean(nextPageToken),
      nextPageToken,
    };
  }

  async fetchComments(issueKey: string): Promise<JiraComment[]> {
    const response = await fetch(`${this.apiBase}/issue/${issueKey}/comment`, {
      headers: this.headers(),
    });

    await this.assertOk(response, `Failed to fetch comments for ${issueKey}`);
    const data = (await response.json()) as any;

    return (data?.comments ?? []).map((comment: any) => ({
      id: comment.id,
      author: comment.author?.displayName ?? 'Unknown',
      created: comment.created ?? '',
      body: extractCommentBody(comment.body),
    }));
  }

  async addComment(issueKey: string, body: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: body }],
            },
          ],
        },
      }),
    });

    await this.assertOk(response, `Failed to add comment to ${issueKey}`);
  }

  async getTransitions(issueKey: string): Promise<{ id: string; name: string }[]> {
    const response = await fetch(`${this.apiBase}/issue/${issueKey}/transitions`, {
      headers: this.headers(),
    });

    await this.assertOk(response, `Failed to fetch transitions for ${issueKey}`);
    const data = (await response.json()) as any;

    return (data?.transitions ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
    }));
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/issue/${issueKey}/transitions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ transition: { id: transitionId } }),
    });

    await this.assertOk(response, `Failed to transition ${issueKey}`);
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

function mapIssueLinks(issueLinks: any[] | undefined): JiraIssueLink[] {
  if (!issueLinks?.length) return [];

  return issueLinks.flatMap((link) => {
    const typeName = link.type?.name ?? link.type?.outward ?? 'Related';
    const results: JiraIssueLink[] = [];

    if (link.outwardIssue) {
      results.push({
        type: typeName,
        direction: 'outward',
        linkedKey: link.outwardIssue.key,
        linkedSummary: link.outwardIssue.fields?.summary,
        linkedStatus: link.outwardIssue.fields?.status?.name,
      });
    }

    if (link.inwardIssue) {
      results.push({
        type: typeName,
        direction: 'inward',
        linkedKey: link.inwardIssue.key,
        linkedSummary: link.inwardIssue.fields?.summary,
        linkedStatus: link.inwardIssue.fields?.status?.name,
      });
    }

    return results;
  });
}

function extractCommentBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';

  const doc = body as { content?: { type?: string; text?: string; content?: unknown[] }[] };
  return (doc.content ?? [])
    .flatMap((block) => extractAdfText(block))
    .join('\n')
    .trim();
}

function extractAdfText(node: { type?: string; text?: string; content?: unknown[] }): string[] {
  if (node.type === 'text' && node.text) return [node.text];
  if (!node.content?.length) return [];
  return node.content.flatMap((child) =>
    extractAdfText(child as { type?: string; text?: string; content?: unknown[] }),
  );
}
