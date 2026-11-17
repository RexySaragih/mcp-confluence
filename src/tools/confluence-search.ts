import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';
import { ConfluenceSearchResult } from '../types/index.js';
import { assertSpaceKey } from '../validators/ids.js';
import { defineTool, readOnlyTool, textResult, TextToolResult } from './tool-definition.js';

const MAX_RESULTS_CAP = 20;
const DEFAULT_MAX_RESULTS = 10;
const CQL_CONDITION =
  /\b(?:ancestor|content|created|creator|contributor|favou?rite|id|label|lastmodified|macro|mention|parent|space(?:\.(?:key|title|type))?|text|title|type|watcher)\s*(?:!=|!~|>=|<=|=|~|>|<|\bnot\s+in\b|\bin\b)/i;
const ORDER_BY = /\border\s+by\b/i;
const TYPE_CONDITION = /\btype\s*(?:!=|=|\bnot\s+in\b|\bin\b)/i;

export const searchConfluenceInputSchema = z.object({
  query: z.string().trim().min(1).describe('Search text, or a CQL query such as: parent = 123 ORDER BY title'),
  space_key: z.string().trim().min(1).optional().describe('Limit results to this space key'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESULTS_CAP)
    .optional()
    .describe(`Maximum results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP})`),
  cursor: z.string().min(1).optional().describe('Pagination cursor from a previous search_confluence response'),
});

export const searchConfluenceTool = defineTool({
  name: 'search_confluence',
  description:
    'Search Confluence by text or CQL. Returns id, title, space, excerpt, and URL. Plain text searches page content; CQL supports fields such as parent, ancestor, title, label, space, lastmodified and ORDER BY. Results are pages unless the CQL sets type.',
  schema: searchConfluenceInputSchema,
  annotations: readOnlyTool('Search Confluence'),
});

export async function handleSearchConfluence(client: ConfluenceClient, args: unknown): Promise<TextToolResult> {
  const input = searchConfluenceInputSchema.parse(args);
  const spaceKey = input.space_key ? assertSpaceKey(input.space_key) : undefined;
  const page = await client.search.search(buildCql(input.query, spaceKey), {
    limit: input.max_results ?? DEFAULT_MAX_RESULTS,
    cursor: input.cursor,
  });

  if (page.results.length === 0) {
    return textResult(input.cursor ? 'No more results.' : 'No pages found.');
  }
  const lines = [`Found ${page.results.length} result(s):`, '', ...page.results.map(formatResult)];
  if (page.nextCursor) {
    lines.push(
      `More results available. To fetch the next page, call search_confluence with the same query and cursor="${page.nextCursor}".`,
    );
  }
  return textResult(lines.join('\n\n'));
}

/**
 * Wraps the query in space and type filters. A query is treated as CQL when
 * it contains a field condition; ORDER BY must stay outside the parentheses.
 */
export function buildCql(query: string, spaceKey?: string): string {
  const trimmed = query.trim();
  const isCql = CQL_CONDITION.test(trimmed) || /^order\s+by\b/i.test(trimmed);
  const [where, orderBy] = isCql ? splitOrderBy(trimmed) : [`text ~ "${escapeCql(trimmed)}"`, ''];
  const clauses: string[] = [];
  if (spaceKey) clauses.push(`space = "${escapeCql(spaceKey)}"`);
  if (where) clauses.push(`(${where})`);
  if (!TYPE_CONDITION.test(where)) clauses.push('type = page');
  return `${clauses.join(' AND ')}${orderBy ? ` ${orderBy}` : ''}`;
}

function splitOrderBy(cql: string): [string, string] {
  const match = ORDER_BY.exec(cql);
  if (!match) return [cql, ''];
  return [cql.slice(0, match.index).trim(), cql.slice(match.index).trim()];
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatResult(result: ConfluenceSearchResult): string {
  const type = result.type === 'page' ? '' : ` | Type: ${result.type}`;
  return `ID: ${result.id} | ${result.title} | Space: ${result.spaceKey}${type}\n  ${result.excerpt}\n  ${result.url}`;
}
