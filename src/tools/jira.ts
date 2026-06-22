import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { adfToMarkdown } from '../parsers/content-parser.js';

export const jiraInputSchema = z
  .object({
    url: z.string().url().describe('Jira issue URL').optional(),
    ticket_key: z.string().describe('Jira issue key, e.g., PROJ-123').optional(),
    include_comments: z.boolean().optional().default(false),
    include_links: z.boolean().optional().default(false),
  })
  .refine((val) => !!val.url || !!val.ticket_key, {
    message: 'Provide either url or ticket_key',
  });

export const readJiraTicketTool = {
  name: 'read_jira_ticket',
  description:
    'Fetches Jira ticket details and returns markdown summary. Optionally include comments and linked issues.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Jira issue URL' },
      ticket_key: { type: 'string', description: 'Jira issue key, e.g., PROJ-123' },
      include_comments: { type: 'boolean', description: 'Include issue comments (default false)' },
      include_links: { type: 'boolean', description: 'Include linked issues and parent/epic (default false)' },
    },
  },
};

export async function handleReadJiraTicket(
  client: JiraClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { url, ticket_key, include_comments, include_links } = jiraInputSchema.parse(args);
  const key = ticket_key ?? extractJiraKey(url);
  if (!key) {
    throw new Error('Unable to resolve issue key from url or ticket_key');
  }

  const issue = await client.fetchIssue(key, { includeComments: include_comments });
  const description = adfToMarkdown(issue.description);
  const subtasks =
    issue.subtasks?.map((sub) => `- ${sub.key}: ${sub.summary ?? 'Untitled'} (${sub.status?.name ?? 'Unknown'})`) ?? [];

  const lines = [
    `Key: ${issue.key}`,
    `Summary: ${issue.summary ?? 'N/A'}`,
    `Type: ${issue.issueType?.name ?? 'Unknown'}`,
    `Status: ${issue.status?.name ?? 'Unknown'}`,
    `Priority: ${issue.priority?.name ?? 'None'}`,
    `Assignee: ${issue.assignee?.displayName ?? 'Unassigned'}`,
    `Reporter: ${issue.reporter?.displayName ?? 'Unknown'}`,
    issue.labels?.length ? `Labels: ${issue.labels.join(', ')}` : 'Labels: None',
    issue.parent ? `Parent: ${issue.parent.key} — ${issue.parent.summary ?? ''}` : undefined,
    subtasks.length ? `Subtasks:\n${subtasks.join('\n')}` : 'Subtasks: None',
    'Description:',
    description || 'No description provided.',
  ];

  if (include_links) {
    if (issue.issueLinks?.length) {
      const linkLines = issue.issueLinks.map((link) => {
        const dir = link.direction === 'outward' ? '→' : '←';
        return `- ${dir} ${link.type}: ${link.linkedKey} — ${link.linkedSummary ?? ''} (${link.linkedStatus ?? 'Unknown'})`;
      });
      lines.push('', 'Linked Issues:', ...linkLines);
    } else {
      lines.push('', 'Linked Issues: None');
    }
  }

  if (include_comments) {
    if (issue.comments?.length) {
      const commentLines = issue.comments.map((c, i) => {
        const body = c.body || '(empty)';
        return `[${i + 1}] ${c.author} (${c.created})\n${body}`;
      });
      lines.push('', 'Comments:', ...commentLines);
    } else {
      lines.push('', 'Comments: None');
    }
  }

  return {
    content: [{ type: 'text', text: lines.filter((line) => line !== undefined).join('\n') }],
  };
}

export function extractJiraKey(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/browse\/([A-Z0-9_-]+)/i);
  return match?.[1];
}
