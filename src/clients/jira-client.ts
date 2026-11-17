import { adfToMarkdown } from '../parsers/adf-to-markdown.js';
import { markdownToAdf } from '../parsers/markdown-to-adf.js';
import {
  JiraComment,
  JiraCommentList,
  JiraIssue,
  JiraIssueLink,
  JiraSearchPage,
  JiraTransition,
} from '../types/index.js';
import { AtlassianAuth, AtlassianHttp, buildQuery } from './atlassian-http.js';

export type JiraClientConfig = AtlassianAuth;

const ISSUE_FIELDS = [
  'summary', 'description', 'status', 'assignee', 'reporter', 'priority', 'issuetype', 'labels', 'parent', 'subtasks', 'issuelinks',
].join(',');
const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'priority', 'updated'];
const COMMENT_PAGE_SIZE = 100;
export const MAX_ISSUE_COMMENTS = 500;

interface RawNamed {
  name?: string;
  displayName?: string;
}

interface RawIssueRef {
  key: string;
  fields?: { summary?: string; status?: RawNamed };
}

interface RawIssueLink {
  type?: { name?: string; outward?: string };
  outwardIssue?: RawIssueRef;
  inwardIssue?: RawIssueRef;
}

interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: RawNamed;
    assignee?: RawNamed | null;
    reporter?: RawNamed | null;
    priority?: RawNamed | null;
    issuetype?: RawNamed;
    labels?: string[];
    parent?: RawIssueRef;
    subtasks?: RawIssueRef[];
    issuelinks?: RawIssueLink[];
    updated?: string;
  };
}

interface RawComment {
  id: string;
  author?: RawNamed;
  created?: string;
  body?: unknown;
}

export class JiraClient {
  private readonly http: AtlassianHttp;

  constructor(config: JiraClientConfig) {
    this.http = new AtlassianHttp(config);
  }

  getBaseUrl(): string {
    return this.http.baseUrl;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const raw = await this.http.json<RawIssue>(`${issuePath(issueKey)}?fields=${ISSUE_FIELDS}`, {
      errorContext: `Failed to fetch issue ${issueKey}`,
    });
    const fields = raw.fields ?? {};
    return {
      key: raw.key,
      summary: fields.summary,
      description: fields.description,
      status: fields.status?.name,
      assignee: fields.assignee?.displayName,
      reporter: fields.reporter?.displayName,
      priority: fields.priority?.name,
      issueType: fields.issuetype?.name,
      labels: fields.labels ?? [],
      parent: fields.parent ? { key: fields.parent.key, summary: fields.parent.fields?.summary } : undefined,
      issueLinks: mapIssueLinks(fields.issuelinks),
      subtasks: (fields.subtasks ?? []).map((subtask) => ({
        key: subtask.key,
        summary: subtask.fields?.summary,
        status: subtask.fields?.status?.name,
      })),
    };
  }

  async getComments(issueKey: string, max = MAX_ISSUE_COMMENTS): Promise<JiraCommentList> {
    const comments: JiraComment[] = [];
    let total = 0;
    for (let startAt = 0; comments.length < max; ) {
      const query = buildQuery({ startAt, maxResults: COMMENT_PAGE_SIZE, orderBy: 'created' });
      const raw = await this.http.json<{ comments?: RawComment[]; total?: number }>(
        `${issuePath(issueKey)}/comment?${query}`,
        { errorContext: `Failed to fetch comments for ${issueKey}` },
      );
      const page = raw.comments ?? [];
      total = raw.total ?? comments.length + page.length;
      comments.push(...page.map(toComment));
      startAt += page.length;
      if (page.length === 0 || startAt >= total) break;
    }
    return { comments: comments.slice(0, max), total };
  }

  async searchIssues(jql: string, options: { maxResults: number; nextPageToken?: string }): Promise<JiraSearchPage> {
    const body: Record<string, unknown> = { jql, maxResults: options.maxResults, fields: SEARCH_FIELDS };
    if (options.nextPageToken) body.nextPageToken = options.nextPageToken;

    const raw = await this.http.json<{ issues?: RawIssue[]; nextPageToken?: string }>('/rest/api/3/search/jql', {
      method: 'POST',
      body,
      errorContext: 'Failed to search Jira issues',
    });
    const nextPageToken = raw.nextPageToken ?? null;
    return {
      issues: (raw.issues ?? []).map((issue) => ({
        key: issue.key,
        summary: issue.fields?.summary ?? '',
        status: issue.fields?.status?.name ?? 'Unknown',
        assignee: issue.fields?.assignee?.displayName ?? 'Unassigned',
        issueType: issue.fields?.issuetype?.name ?? 'Unknown',
        priority: issue.fields?.priority?.name ?? 'None',
        updated: issue.fields?.updated ?? '',
        url: `${this.http.baseUrl}/browse/${issue.key}`,
      })),
      hasMore: nextPageToken !== null,
      nextPageToken,
    };
  }

  /** Adds a comment written in Markdown, converted to Atlassian Document Format. */
  async addComment(issueKey: string, markdown: string): Promise<void> {
    await this.http.send(`${issuePath(issueKey)}/comment`, {
      method: 'POST',
      body: { body: markdownToAdf(markdown) },
      errorContext: `Failed to add comment to ${issueKey}`,
    });
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const raw = await this.http.json<{ transitions?: JiraTransition[] }>(`${issuePath(issueKey)}/transitions`, {
      errorContext: `Failed to fetch transitions for ${issueKey}`,
    });
    return (raw.transitions ?? []).map((transition) => ({ id: transition.id, name: transition.name }));
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.http.send(`${issuePath(issueKey)}/transitions`, {
      method: 'POST',
      body: { transition: { id: transitionId } },
      errorContext: `Failed to transition ${issueKey}`,
    });
  }
}

function issuePath(issueKey: string): string {
  return `/rest/api/3/issue/${encodeURIComponent(issueKey)}`;
}

function toComment(raw: RawComment): JiraComment {
  return {
    id: raw.id,
    author: raw.author?.displayName ?? 'Unknown',
    created: raw.created ?? '',
    body: adfToMarkdown(raw.body),
  };
}

function mapIssueLinks(issueLinks: RawIssueLink[] | undefined): JiraIssueLink[] {
  return (issueLinks ?? []).flatMap((link) => {
    const type = link.type?.name ?? link.type?.outward ?? 'Related';
    const results: JiraIssueLink[] = [];
    if (link.outwardIssue) results.push(toLink(type, 'outward', link.outwardIssue));
    if (link.inwardIssue) results.push(toLink(type, 'inward', link.inwardIssue));
    return results;
  });
}

function toLink(type: string, direction: JiraIssueLink['direction'], issue: RawIssueRef): JiraIssueLink {
  return {
    type,
    direction,
    linkedKey: issue.key,
    linkedSummary: issue.fields?.summary,
    linkedStatus: issue.fields?.status?.name,
  };
}
