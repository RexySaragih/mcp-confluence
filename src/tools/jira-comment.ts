import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { extractJiraKey } from './jira.js';

export const addJiraCommentInputSchema = z
  .object({
    url: z.string().url().describe('Jira issue URL').optional(),
    ticket_key: z.string().trim().min(1).describe('Jira issue key, e.g., PROJ-123').optional(),
    comment: z.string().trim().min(1).describe('Comment to add to the issue'),
  })
  .refine((input) => !!input.url || !!input.ticket_key, {
    message: 'Provide either url or ticket_key',
  });

export const addJiraCommentTool = {
  name: 'add_jira_comment',
  description:
    'Adds a comment to a Jira issue without changing issue fields or status.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Jira issue URL' },
      ticket_key: { type: 'string', description: 'Jira issue key, e.g., PROJ-123' },
      comment: { type: 'string', minLength: 1, description: 'Comment to add' },
    },
    required: ['comment'],
  },
};

export async function handleAddJiraComment(
  client: JiraClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = addJiraCommentInputSchema.parse(args);
  const issueKey = input.ticket_key ?? extractJiraKey(input.url);
  if (!issueKey) {
    throw new Error('Unable to resolve issue key from url or ticket_key');
  }

  await client.addComment(issueKey, input.comment);

  return {
    content: [{
      type: 'text',
      text: `Comment added to ${issueKey}. Issue fields and status were not changed.`,
    }],
  };
}
