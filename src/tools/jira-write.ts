import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { extractJiraKey } from './jira.js';

export const updateJiraIssueInputSchema = z
  .object({
    url: z.string().url().describe('Jira issue URL').optional(),
    ticket_key: z.string().describe('Jira issue key, e.g., PROJ-123').optional(),
    comment: z.string().optional().describe('Comment to add to the issue'),
    transition: z.string().optional().describe('Status transition name, e.g. "In Progress" or "Done"'),
  })
  .refine((val) => !!val.url || !!val.ticket_key, {
    message: 'Provide either url or ticket_key',
  })
  .refine((val) => !!val.comment || !!val.transition, {
    message: 'Provide at least one of comment or transition',
  });

export const updateJiraIssueTool = {
  name: 'update_jira_issue',
  description:
    'Add a comment and/or transition the status of a Jira issue. Provide at least one of comment or transition.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Jira issue URL' },
      ticket_key: { type: 'string', description: 'Jira issue key, e.g., PROJ-123' },
      comment: { type: 'string', description: 'Comment to add to the issue' },
      transition: { type: 'string', description: 'Status transition name, e.g. "In Progress" or "Done"' },
    },
  },
};

export async function handleUpdateJiraIssue(
  client: JiraClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = updateJiraIssueInputSchema.parse(args);
  const key = input.ticket_key ?? extractJiraKey(input.url);
  if (!key) {
    throw new Error('Unable to resolve issue key from url or ticket_key');
  }

  const changes: string[] = [];

  if (input.comment) {
    await client.addComment(key, input.comment);
    changes.push(`Added comment to ${key}`);
  }

  if (input.transition) {
    const transitions = await client.getTransitions(key);
    const match = transitions.find(
      (t) => t.name.toLowerCase() === input.transition!.toLowerCase(),
    );

    if (!match) {
      const available = transitions.map((t) => t.name).join(', ') || 'none';
      throw new Error(
        `Transition "${input.transition}" not available for ${key}. Available: ${available}`,
      );
    }

    await client.transitionIssue(key, match.id);
    changes.push(`Transitioned ${key} to "${match.name}"`);
  }

  return {
    content: [{ type: 'text', text: changes.join('\n') }],
  };
}
