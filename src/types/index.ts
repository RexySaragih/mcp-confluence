export interface JiraUser {
  displayName?: string;
}

export interface JiraStatus {
  name?: string;
}

export interface JiraSubtask {
  key: string;
  summary?: string;
  status?: JiraStatus;
}

export interface JiraIssueLink {
  type: string;
  direction: 'outward' | 'inward';
  linkedKey: string;
  linkedSummary?: string;
  linkedStatus?: string;
}

export interface JiraComment {
  id: string;
  author: string;
  created: string;
  body: string;
}

export interface JiraIssue {
  key: string;
  summary?: string;
  description?: unknown;
  status?: JiraStatus;
  assignee?: JiraUser;
  reporter?: JiraUser;
  priority?: { name?: string };
  issueType?: { name?: string };
  labels?: string[];
  parent?: { key: string; summary?: string };
  issueLinks?: JiraIssueLink[];
  subtasks?: JiraSubtask[];
  comments?: JiraComment[];
  raw?: Record<string, unknown>;
}

export interface JiraSearchResult {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  issueType: string;
  priority: string;
  updated: string;
  url: string;
}

export interface JiraSearchPage {
  issues: JiraSearchResult[];
  maxResults: number;
  total: number;
  hasMore: boolean;
  nextPageToken: string | null;
}

export interface ConfluencePage {
  id: string;
  title?: string;
  url?: string;
  storage?: string;
  labels?: string[];
  children?: {
    id: string;
    title?: string;
    url?: string;
  }[];
  raw?: Record<string, unknown>;
}

export interface ConfluenceSearchResult {
  id: string;
  title: string;
  spaceKey: string;
  excerpt: string;
  url: string;
}

export interface UpdatePageParams {
  title: string;
  body: string;
}

export interface UpdatePageResult {
  id: string;
  title: string;
  url: string;
  version: number;
}
