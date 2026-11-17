import z from 'zod';
import { JiraClient } from '../clients/jira-client.js';
import { adfToMarkdown } from '../parsers/adf-to-markdown.js';
import { JiraCommentList, JiraIssue } from '../types/index.js';
import { resolveIssueKey } from '../validators/ids.js';
import { defineTool, readOnlyTool, textResult, TextToolResult } from './tool-definition.js';

export const issueTargetFields = {
  url: z.string().url().optional().describe('Jira issue URL (…/browse/KEY or a board URL with selectedIssue=KEY)'),
  ticket_key: z.string().trim().min(1).optional().describe('Jira issue key, e.g. PROJ-123'),
};

export const readJiraTicketInputSchema = z
  .object({
    ...issueTargetFields,
    include_comments: z.boolean().optional().default(false).describe('Include issue comments'),
    include_links: z.boolean().optional().default(false).describe('Include linked issues'),
  })
  .refine((input) => !!input.url || !!input.ticket_key, { message: 'Provide either url or ticket_key' });

export const readJiraTicketTool = defineTool({
  name: 'read_jira_ticket',
  description:
    'Fetches a Jira issue and returns its fields and description as Markdown. Optionally includes comments and linked issues.',
  schema: readJiraTicketInputSchema,
  annotations: readOnlyTool('Read Jira issue'),
});

export async function handleReadJiraTicket(client: JiraClient, args: unknown): Promise<TextToolResult> {
  const input = readJiraTicketInputSchema.parse(args);
  const key = resolveIssueKey(input, client.getBaseUrl());
  const [issue, comments] = await Promise.all([
    client.getIssue(key),
    input.include_comments ? client.getComments(key) : Promise.resolve(undefined),
  ]);

  const lines = [...issueSummaryLines(issue), 'Description:', adfToMarkdown(issue.description) || 'No description provided.'];
  if (input.include_links) lines.push('', ...linkLines(issue));
  if (comments) lines.push('', ...commentLines(comments));
  return textResult(lines.join('\n'));
}

function issueSummaryLines(issue: JiraIssue): string[] {
  const subtasks = issue.subtasks.map(
    (subtask) => `- ${subtask.key}: ${subtask.summary ?? 'Untitled'} (${subtask.status ?? 'Unknown'})`,
  );
  return [
    `Key: ${issue.key}`,
    `Summary: ${issue.summary ?? 'N/A'}`,
    `Type: ${issue.issueType ?? 'Unknown'}`,
    `Status: ${issue.status ?? 'Unknown'}`,
    `Priority: ${issue.priority ?? 'None'}`,
    `Assignee: ${issue.assignee ?? 'Unassigned'}`,
    `Reporter: ${issue.reporter ?? 'Unknown'}`,
    `Labels: ${issue.labels.length ? issue.labels.join(', ') : 'None'}`,
    ...(issue.parent ? [`Parent: ${issue.parent.key} — ${issue.parent.summary ?? ''}`] : []),
    subtasks.length ? `Subtasks:\n${subtasks.join('\n')}` : 'Subtasks: None',
  ];
}

function linkLines(issue: JiraIssue): string[] {
  if (!issue.issueLinks.length) return ['Linked Issues: None'];
  return [
    'Linked Issues:',
    ...issue.issueLinks.map((link) => {
      const arrow = link.direction === 'outward' ? '→' : '←';
      return `- ${arrow} ${link.type}: ${link.linkedKey} — ${link.linkedSummary ?? ''} (${link.linkedStatus ?? 'Unknown'})`;
    }),
  ];
}

function commentLines(list: JiraCommentList): string[] {
  if (!list.comments.length) return ['Comments: None'];
  const lines = [
    'Comments:',
    ...list.comments.map((comment, index) => `[${index + 1}] ${comment.author} (${comment.created})\n${comment.body || '(empty)'}`),
  ];
  if (list.total > list.comments.length) {
    lines.push(`(Showing ${list.comments.length} of ${list.total} comments.)`);
  }
  return lines;
}
