import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { JiraTransition } from '../types/index.js';
import { resolveIssueKey } from '../validators/ids.js';
import { issueTargetFields } from './jira.js';
import { defineTool, destructiveWriteTool, textResult, TextToolResult } from './tool-definition.js';

export const updateJiraIssueInputSchema = z
  .object({
    ...issueTargetFields,
    comment: z.string().trim().min(1).optional().describe('Comment to add. Markdown is converted to Jira formatting.'),
    transition: z.string().trim().min(1).optional().describe('Status transition name, e.g. "In Progress" or "Done"'),
  })
  .refine((input) => !!input.url || !!input.ticket_key, { message: 'Provide either url or ticket_key' })
  .refine((input) => !!input.comment || !!input.transition, {
    message: 'Provide at least one of comment or transition',
  });

export const updateJiraIssueTool = defineTool({
  name: 'update_jira_issue',
  description:
    'Adds a comment and/or transitions the status of a Jira issue. The transition is checked before anything is written.',
  schema: updateJiraIssueInputSchema,
  annotations: destructiveWriteTool('Update Jira issue'),
});

export async function handleUpdateJiraIssue(client: JiraClient, args: unknown): Promise<TextToolResult> {
  const input = updateJiraIssueInputSchema.parse(args);
  const key = resolveIssueKey(input, client.getBaseUrl());
  // Resolve the transition first so an invalid name fails before the comment is posted.
  const transition = input.transition ? await findTransition(client, key, input.transition) : undefined;
  const changes: string[] = [];

  if (input.comment) {
    await client.addComment(key, input.comment);
    changes.push(`Added comment to ${key}`);
  }
  if (transition) {
    await transitionAfterComment(client, key, transition, changes.length > 0);
    changes.push(`Transitioned ${key} to "${transition.name}"`);
  }
  return textResult(changes.join('\n'));
}

async function findTransition(client: JiraClient, key: string, name: string): Promise<JiraTransition> {
  const transitions = await client.getTransitions(key);
  const match = transitions.find((transition) => transition.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const available = transitions.map((transition) => transition.name).join(', ') || 'none';
    throw new Error(`Transition "${name}" not available for ${key}. Available: ${available}`);
  }
  return match;
}

async function transitionAfterComment(
  client: JiraClient,
  key: string,
  transition: JiraTransition,
  commentAdded: boolean,
): Promise<void> {
  try {
    await client.transitionIssue(key, transition.id);
  } catch (error) {
    if (!commentAdded) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The comment was added to ${key}, but the transition to "${transition.name}" failed: ${reason}`);
  }
}
