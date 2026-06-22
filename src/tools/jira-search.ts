import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';

const MAX_RESULTS_CAP = 25;
const DEFAULT_MAX_RESULTS = 15;

export const searchJiraInputSchema = z.object({
  jql: z.string().min(1).describe('JQL query string'),
  max_results: z.number().int().min(1).max(MAX_RESULTS_CAP).optional(),
  next_page_token: z.string().optional().describe('Pagination token from a previous search_jira response'),
});

export const searchJiraTool = {
  name: 'search_jira',
  description:
    'Search Jira issues using JQL. Returns a compact list of matching tickets (key, summary, status, assignee, URL). Supports pagination via next_page_token when more results exist.',
  inputSchema: {
    type: 'object',
    properties: {
      jql: { type: 'string', description: 'JQL query string' },
      max_results: {
        type: 'number',
        description: `Maximum results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP})`,
      },
      next_page_token: {
        type: 'string',
        description: 'Pagination token from a previous search. Use the next_page_token value returned when more results exist.',
      },
    },
    required: ['jql'],
  },
};

export async function handleSearchJira(
  client: JiraClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { jql, max_results, next_page_token } = searchJiraInputSchema.parse(args);
  const limit = max_results ?? DEFAULT_MAX_RESULTS;
  const page = await client.searchIssues(jql, {
    maxResults: limit,
    nextPageToken: next_page_token,
  });

  if (page.issues.length === 0) {
    if (next_page_token) {
      return {
        content: [{
          type: 'text',
          text: 'No issues on this page.',
        }],
      };
    }
    return { content: [{ type: 'text', text: 'No issues found.' }] };
  }

  const lines = page.issues.map(
    (r) =>
      `${r.key} | ${r.summary} | ${r.status} | ${r.assignee} | ${r.issueType} | ${r.priority} | ${r.url}`,
  );

  const textLines = [
    `Found ${page.issues.length} issue(s):`,
    '',
    'Key | Summary | Status | Assignee | Type | Priority | URL',
    ...lines,
  ];

  if (page.hasMore && page.nextPageToken) {
    textLines.push(
      '',
      `More results available. To fetch the next page, call search_jira with the same jql and next_page_token="${page.nextPageToken}".`,
    );
  }

  return {
    content: [{ type: 'text', text: textLines.join('\n') }],
  };
}
