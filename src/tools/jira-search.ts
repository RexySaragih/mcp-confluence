import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { defineTool, readOnlyTool, textResult, TextToolResult } from './tool-definition.js';

const MAX_RESULTS_CAP = 25;
const DEFAULT_MAX_RESULTS = 15;

export const searchJiraInputSchema = z.object({
  jql: z.string().trim().min(1).describe('JQL query string'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESULTS_CAP)
    .optional()
    .describe(`Maximum results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP})`),
  next_page_token: z
    .string()
    .optional()
    .describe('Pagination token from a previous search_jira response. Use it with the same jql.'),
});

export const searchJiraTool = defineTool({
  name: 'search_jira',
  description:
    'Search Jira issues using JQL. Returns a compact list of matching tickets (key, summary, status, assignee, URL). Supports pagination via next_page_token when more results exist.',
  schema: searchJiraInputSchema,
  annotations: readOnlyTool('Search Jira'),
});

export async function handleSearchJira(client: JiraClient, args: unknown): Promise<TextToolResult> {
  const { jql, max_results, next_page_token } = searchJiraInputSchema.parse(args);
  const page = await client.searchIssues(jql, {
    maxResults: max_results ?? DEFAULT_MAX_RESULTS,
    nextPageToken: next_page_token,
  });

  if (page.issues.length === 0) {
    return textResult(next_page_token ? 'No issues on this page.' : 'No issues found.');
  }

  const lines = [
    `Found ${page.issues.length} issue(s):`,
    '',
    'Key | Summary | Status | Assignee | Type | Priority | URL',
    ...page.issues.map(
      (issue) =>
        `${issue.key} | ${issue.summary} | ${issue.status} | ${issue.assignee} | ${issue.issueType} | ${issue.priority} | ${issue.url}`,
    ),
  ];
  if (page.hasMore && page.nextPageToken) {
    lines.push(
      '',
      `More results available. To fetch the next page, call search_jira with the same jql and next_page_token="${page.nextPageToken}".`,
    );
  }
  return textResult(lines.join('\n'));
}
