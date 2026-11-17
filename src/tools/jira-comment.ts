import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { resolveIssueKey } from '../validators/ids.js';
import { issueTargetFields } from './jira.js';
import { additiveWriteTool, defineTool, textResult, TextToolResult } from './tool-definition.js';

export const addJiraCommentInputSchema = z
  .object({
    ...issueTargetFields,
    comment: z.string().trim().min(1).describe('Comment text. Markdown is converted to Jira formatting.'),
  })
  .refine((input) => !!input.url || !!input.ticket_key, { message: 'Provide either url or ticket_key' });

export const addJiraCommentTool = defineTool({
  name: 'add_jira_comment',
  description: 'Adds a Markdown comment to a Jira issue without changing issue fields or status.',
  schema: addJiraCommentInputSchema,
  annotations: additiveWriteTool('Add Jira comment'),
});

export async function handleAddJiraComment(client: JiraClient, args: unknown): Promise<TextToolResult> {
  const input = addJiraCommentInputSchema.parse(args);
  const issueKey = resolveIssueKey(input, client.getBaseUrl());
  await client.addComment(issueKey, input.comment);
  return textResult(`Comment added to ${issueKey}. Issue fields and status were not changed.`);
}
