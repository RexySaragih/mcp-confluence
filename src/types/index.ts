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

export interface JiraIssue {
  key: string;
  summary?: string;
  description?: unknown;
  status?: JiraStatus;
  assignee?: JiraUser;
  subtasks?: JiraSubtask[];
  raw?: Record<string, unknown>;
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

export interface PlanSection {
  title: string;
  items: string[];
}

export interface PlanOutput {
  overview?: string;
  requirements?: string[];
  tasks?: string[];
  acceptanceCriteria?: string[];
}

