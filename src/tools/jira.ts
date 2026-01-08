import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { adfToMarkdown } from '../parsers/content-parser.js';

// Zod schema for runtime validation
export const jiraInputSchema = z
  .object({
    url: z.string().url().describe('Jira issue URL').optional(),
    ticket_key: z.string().describe('Jira issue key, e.g., PROJ-123').optional(),
  })
  .refine((val) => !!val.url || !!val.ticket_key, {
    message: 'Provide either url or ticket_key',
  });

export const readJiraTicketTool = {
  name: 'read_jira_ticket',
  description: 'Fetches Jira ticket details and returns markdown summary',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Jira issue URL' },
      ticket_key: { type: 'string', description: 'Jira issue key, e.g., PROJ-123' },
    },
  },
};

export async function handleReadJiraTicket(
  client: JiraClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { url, ticket_key } = jiraInputSchema.parse(args);
  const key = ticket_key ?? extractJiraKey(url);
  if (!key) {
    throw new Error('Unable to resolve issue key from url or ticket_key');
  }

  const issue = await client.fetchIssue(key);
  const description = adfToMarkdown(issue.description);
  const subtasks =
    issue.subtasks?.map((sub) => `- ${sub.key}: ${sub.summary ?? 'Untitled'} (${sub.status?.name ?? 'Unknown'})`) ?? [];

  const text = [
    `Key: ${issue.key}`,
    `Summary: ${issue.summary ?? 'N/A'}`,
    `Status: ${issue.status?.name ?? 'Unknown'}`,
    `Assignee: ${issue.assignee?.displayName ?? 'Unassigned'}`,
    subtasks.length ? `Subtasks:\n${subtasks.join('\n')}` : 'Subtasks: None',
    'Description:',
    description || 'No description provided.',
  ].join('\n');

  return {
    content: [{ type: 'text', text }],
  };
}

function extractJiraKey(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/browse\/([A-Z0-9_-]+)/i);
  return match?.[1];
}

