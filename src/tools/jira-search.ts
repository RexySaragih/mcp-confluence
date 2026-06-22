import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';

const MAX_RESULTS_CAP = 25;
const DEFAULT_MAX_RESULTS = 15;

export const searchJiraInputSchema = z.object({
  jql: z.string().min(1).describe('JQL query string'),
  max_results: z.number().int().min(1).max(MAX_RESULTS_CAP).optional(),
  start_at: z.number().int().min(0).optional().describe('Result offset for pagination (default 0)'),
});

export const searchJiraTool = {
  name: 'search_jira',
  description:
    'Search Jira issues using JQL. Returns a compact list of matching tickets (key, summary, status, assignee, URL). Supports pagination via start_at when more results exist.',
  inputSchema: {
    type: 'object',
    properties: {
      jql: { type: 'string', description: 'JQL query string' },
      max_results: {
        type: 'number',
        description: `Maximum results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP})`,
      },
      start_at: {
        type: 'number',
        description: 'Result offset for pagination. Use the next_start_at value from a previous search to fetch the next page.',
      },
    },
    required: ['jql'],
  },
};

export async function handleSearchJira(
  client: JiraClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { jql, max_results, start_at } = searchJiraInputSchema.parse(args);
  const limit = max_results ?? DEFAULT_MAX_RESULTS;
  const page = await client.searchIssues(jql, { maxResults: limit, startAt: start_at });

  if (page.issues.length === 0) {
    if ((start_at ?? 0) > 0) {
      return {
        content: [{
          type: 'text',
          text: `No issues on this page (start_at=${start_at}, total=${page.total}).`,
        }],
      };
    }
    return { content: [{ type: 'text', text: 'No issues found.' }] };
  }

  const lines = page.issues.map(
    (r) =>
      `${r.key} | ${r.summary} | ${r.status} | ${r.assignee} | ${r.issueType} | ${r.priority} | ${r.url}`,
  );

  const rangeEnd = page.startAt + page.issues.length;
  const textLines = [
    `Showing ${page.startAt + 1}-${rangeEnd} of ${page.total} issue(s):`,
    '',
    'Key | Summary | Status | Assignee | Type | Priority | URL',
    ...lines,
  ];

  if (page.hasMore && page.nextStartAt !== null) {
    textLines.push(
      '',
      `More results available. To fetch the next page, call search_jira with the same jql and start_at=${page.nextStartAt}.`,
    );
  }

  return {
    content: [{ type: 'text', text: textLines.join('\n') }],
  };
}
