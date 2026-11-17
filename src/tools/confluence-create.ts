import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { ConfluencePage, PageStatus } from '../types/index.js';
import { assertSpaceKey, resolvePageId } from '../validators/ids.js';
import { CONFIRMATION_TTL_MS, ConfirmationStore, fingerprintOf } from './confirmation-store.js';
import {
  DEFAULT_PAGE_WRITE_OPTIONS,
  hasOneContentSource,
  ONE_CONTENT_SOURCE_MESSAGE,
  pageContentFields,
  PageWriteOptions,
  resolveStorageBody,
} from './page-content.js';
import { describePath } from './page-hierarchy.js';
import { additiveWriteTool, defineTool, textResult, TextToolResult } from './tool-definition.js';

const MAX_TITLE_LENGTH = 255;
const MAX_LABELS = 20;
const MS_PER_MINUTE = 60_000;
const LABEL_PATTERN = /^[^\s,]+$/;

export const PARENT_REQUIRED_MESSAGE =
  'Provide parent_id or parent_url. New pages are created under a parent page. A top-level page is only created when the user explicitly asks for one: pass space_key with root_level=true and complete the confirmation step.';

export const createConfluencePageInputSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).describe('Page title. Titles must be unique within a space.'),
    ...pageContentFields,
    parent_id: z.string().trim().min(1).optional().describe('ID of the parent page. Required unless root_level is true.'),
    parent_url: z.string().url().optional().describe('URL of the parent page, instead of parent_id'),
    space_key: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Space key. Optional with a parent (checked against the parent's space); required with root_level."),
    root_level: z
      .boolean()
      .optional()
      .default(false)
      .describe('Create at the top level of the space, outside any parent. Only when the user explicitly asks; needs confirmation.'),
    confirmation_token: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Token from the top-level confirmation step. Pass it only after the user has explicitly approved.'),
    status: z
      .enum(['current', 'draft'])
      .optional()
      .default('current')
      .describe('current publishes the page (default); draft keeps it visible only to you'),
    labels: z
      .array(z.string().trim().regex(LABEL_PATTERN, 'Labels cannot contain spaces or commas'))
      .max(MAX_LABELS)
      .optional()
      .describe('Labels to add to the new page'),
  })
  .superRefine((input, ctx) => {
    for (const message of placementIssues(input)) ctx.addIssue({ code: 'custom', message });
  });

type CreatePageInput = z.output<typeof createConfluencePageInputSchema>;

export const createConfluencePageTool = defineTool({
  name: 'create_confluence_page',
  description: [
    'Creates one Confluence page under a parent page (parent_id or parent_url); the space comes from the parent.',
    "To build a page tree, create the parent first, then call this tool once per child with the parent's returned page id. Create children before adding links to them on the parent.",
    'Fails without writing anything if a page with the same title already exists in the space.',
    'A top-level page (root_level=true with space_key) is only for explicit user requests: the first call returns a confirmation_token and creates nothing; call again with the token only after the user approves.',
  ].join(' '),
  schema: createConfluencePageInputSchema,
  annotations: additiveWriteTool('Create Confluence page'),
});

interface SpaceRef {
  id: string;
  key?: string;
  name?: string;
}

type Placement = { kind: 'child'; space: SpaceRef; parent: ConfluencePage } | { kind: 'root'; space: SpaceRef };

const rootLevelConfirmations = new ConfirmationStore();

export async function handleCreateConfluencePage(
  client: ConfluenceClient,
  args: unknown,
  options: PageWriteOptions = DEFAULT_PAGE_WRITE_OPTIONS,
): Promise<TextToolResult> {
  const input = createConfluencePageInputSchema.parse(args);
  // Local content problems are reported before any request reaches Confluence.
  const storage = await resolveStorageBody(input, { baseUrl: client.getBaseUrl() }, options);
  const placement = await resolvePlacement(client, input);
  await assertTitleAvailable(client, placement.space, input.title);

  if (placement.kind === 'root') {
    const confirmationRequest = checkRootLevelConfirmation(input, placement.space);
    if (confirmationRequest) return confirmationRequest;
  }

  const page = await client.pages.create({
    spaceId: placement.space.id,
    title: input.title,
    parentId: placement.kind === 'child' ? placement.parent.id : undefined,
    storage,
    status: input.status,
    rootLevel: placement.kind === 'root',
  });
  const labelLine = await applyLabels(client, page.id, input.labels);
  const path = await describePath(client, page.id, page.title);
  return textResult(createdSummary(page, placement, input.status, path, labelLine));
}

function placementIssues(input: {
  content?: string;
  content_file?: string;
  parent_id?: string;
  parent_url?: string;
  space_key?: string;
  root_level: boolean;
  confirmation_token?: string;
}): string[] {
  const issues: string[] = [];
  const hasParent = !!input.parent_id || !!input.parent_url;
  if (!hasOneContentSource(input)) issues.push(ONE_CONTENT_SOURCE_MESSAGE);
  if (input.parent_id && input.parent_url) issues.push('Provide only one of parent_id or parent_url');
  if (input.root_level && hasParent) issues.push('root_level cannot be combined with parent_id or parent_url');
  if (input.root_level && !input.space_key) issues.push('space_key is required when root_level is true');
  if (!input.root_level && !hasParent) issues.push(PARENT_REQUIRED_MESSAGE);
  if (input.confirmation_token && !input.root_level) issues.push('confirmation_token is only used with root_level=true');
  return issues;
}

async function resolvePlacement(client: ConfluenceClient, input: CreatePageInput): Promise<Placement> {
  if (input.root_level) {
    return { kind: 'root', space: await client.directory.spaceByKey(assertSpaceKey(input.space_key ?? '')) };
  }
  const parentId = resolvePageId({ page_id: input.parent_id, url: input.parent_url }, client.getBaseUrl(), 'parent page');
  const parent = await client.pages.get(parentId);
  if (!input.space_key) {
    return { kind: 'child', space: { id: parent.spaceId, key: parent.spaceKey }, parent };
  }
  const space = await client.directory.spaceByKey(assertSpaceKey(input.space_key));
  if (space.id !== parent.spaceId) {
    throw new Error(
      `Parent page ${parent.id} ("${parent.title}") is in space ${parent.spaceKey ?? parent.spaceId}, not ${space.key}. Remove space_key or choose a parent page in ${space.key}.`,
    );
  }
  return { kind: 'child', space, parent };
}

async function assertTitleAvailable(client: ConfluenceClient, space: SpaceRef, title: string): Promise<void> {
  const existing = await client.pages.findByTitle(space.id, title);
  if (!existing) return;
  throw new Error(
    `A page titled "${title}" already exists in space ${spaceLabel(space)} (id ${existing.id}, ${existing.webUrl}). No page was created. Use update_confluence_page to change that page, or choose a different title.`,
  );
}

/** Returns a confirmation request, or undefined once a valid token is consumed. */
function checkRootLevelConfirmation(input: CreatePageInput, space: SpaceRef): TextToolResult | undefined {
  const fingerprint = fingerprintOf([space.id, input.title, input.status]);
  if (input.confirmation_token) {
    rootLevelConfirmations.consume(input.confirmation_token, fingerprint);
    return undefined;
  }
  const token = rootLevelConfirmations.issue(fingerprint);
  return textResult(
    [
      'Confirmation required. No page was created.',
      `This would create "${input.title}" at the top level of space ${spaceLabel(space)}${space.name ? ` (${space.name})` : ''}, outside any parent page.`,
      'Ask the user to confirm this exact action. Only if they explicitly agree, call create_confluence_page again with the same arguments plus:',
      `confirmation_token="${token}"`,
      `The token works once and expires in ${CONFIRMATION_TTL_MS / MS_PER_MINUTE} minutes.`,
    ].join('\n'),
  );
}

/** Labels are added after creation; a failure is reported without hiding that the page exists. */
async function applyLabels(client: ConfluenceClient, pageId: string, labels: string[] | undefined): Promise<string | undefined> {
  const names = [...new Set((labels ?? []).map((label) => label.toLowerCase()))];
  if (names.length === 0) return undefined;
  try {
    await client.pages.addLabels(pageId, names);
    return `Labels: ${names.join(', ')}`;
  } catch (error) {
    return `Warning: the page was created, but adding labels failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function createdSummary(
  page: ConfluencePage,
  placement: Placement,
  status: PageStatus,
  path: string,
  labelLine: string | undefined,
): string {
  const location =
    placement.kind === 'child'
      ? `under "${placement.parent.title}" (${placement.parent.id})`
      : `top level of space ${spaceLabel(placement.space)}`;
  const statusText = status === 'draft' ? 'draft (visible only to you until published)' : 'current (published)';
  return [
    `Created page "${page.title}" (id ${page.id}) in space ${spaceLabel(placement.space)}.`,
    `URL: ${page.webUrl}`,
    `Location: ${location}`,
    `Path: ${path}`,
    `Status: ${statusText}`,
    `Version: ${page.version}`,
    ...(labelLine ? [labelLine] : []),
    'No existing page was changed.',
  ].join('\n');
}

function spaceLabel(space: SpaceRef): string {
  return space.key ?? space.id;
}
