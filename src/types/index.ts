export interface JiraIssueLink {
  type: string;
  direction: 'outward' | 'inward';
  linkedKey: string;
  linkedSummary?: string;
  linkedStatus?: string;
}

export interface JiraSubtask {
  key: string;
  summary?: string;
  status?: string;
}

export interface JiraIssue {
  key: string;
  summary?: string;
  description?: unknown;
  status?: string;
  assignee?: string;
  reporter?: string;
  priority?: string;
  issueType?: string;
  labels: string[];
  parent?: { key: string; summary?: string };
  issueLinks: JiraIssueLink[];
  subtasks: JiraSubtask[];
}

export interface JiraComment {
  id: string;
  author: string;
  created: string;
  /** Comment body converted to Markdown. */
  body: string;
}

export interface JiraCommentList {
  comments: JiraComment[];
  total: number;
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
  hasMore: boolean;
  nextPageToken: string | null;
}

export interface JiraTransition {
  id: string;
  name: string;
}

export type PageStatus = 'current' | 'draft';

export interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  spaceKey?: string;
  parentId?: string;
  parentType?: string;
  version: number;
  webUrl: string;
  storage?: string;
  labels: string[];
}

export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  homepageId?: string;
}

export interface ContentSummary {
  id: string;
  title: string;
  type: string;
  webUrl?: string;
}

export interface ChildList {
  children: ContentSummary[];
  truncated: boolean;
}

export interface ConfluenceSearchResult {
  id: string;
  type: string;
  title: string;
  spaceKey: string;
  excerpt: string;
  url: string;
}

export interface ConfluenceSearchPage {
  results: ConfluenceSearchResult[];
  nextCursor?: string;
}

export interface ConfluenceComment {
  id: string;
  author: string;
  created: string;
  /** Rendered (view format) HTML. */
  bodyHtml: string;
  /** "inline" or "footer" when Confluence reports it. */
  location?: string;
  /** Page text an inline comment is anchored to. */
  selection?: string;
}

export interface ConfluenceCommentThread extends ConfluenceComment {
  replies: ConfluenceComment[];
}

export interface ConfluenceCommentResult {
  id: string;
  pageId?: string;
}

export interface AddInlineCommentParams {
  pageId: string;
  body: string;
  textSelection: string;
  textSelectionMatchCount: number;
  textSelectionMatchIndex: number;
}

export interface CreatePageParams {
  spaceId: string;
  title: string;
  parentId?: string;
  storage: string;
  status: PageStatus;
  rootLevel: boolean;
}

export interface UpdatePageParams {
  title: string;
  storage: string;
  /** The new version number (current version + 1). */
  version: number;
}

export interface UpdatePageResult {
  id: string;
  title: string;
  webUrl: string;
  version: number;
}

export interface ImageAttachment {
  base64: string;
  mimeType: string;
  bytes: number;
}
