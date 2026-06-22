import z from 'zod';
import { ConfluenceClient } from '../clients/confluence-client.js';

const MAX_RESULTS_CAP = 20;
const DEFAULT_MAX_RESULTS = 10;

export const searchConfluenceInputSchema = z.object({
  query: z.string().min(1).describe('Search text or full CQL query'),
  space_key: z.string().optional().describe('Optional Confluence space key to filter results'),
  max_results: z.number().int().min(1).max(MAX_RESULTS_CAP).optional(),
});

export const searchConfluenceTool = {
  name: 'search_confluence',
  description:
    'Search Confluence pages by text or CQL. Returns page id, title, space, excerpt, and URL. Use for discovery when you do not already have a page link.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text or full CQL query' },
      space_key: { type: 'string', description: 'Optional Confluence space key to filter results' },
      max_results: {
        type: 'number',
        description: `Maximum results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP})`,
      },
    },
    required: ['query'],
  },
};

export async function handleSearchConfluence(
  client: ConfluenceClient,
  args: unknown,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { query, space_key, max_results } = searchConfluenceInputSchema.parse(args);
  const limit = max_results ?? DEFAULT_MAX_RESULTS;
  const results = await client.searchPages(query, { spaceKey: space_key, maxResults: limit });

  if (results.length === 0) {
    return { content: [{ type: 'text', text: 'No pages found.' }] };
  }

  const lines = results.map(
    (r) => `ID: ${r.id} | ${r.title} | Space: ${r.spaceKey}\n  ${r.excerpt}\n  ${r.url}`,
  );

  const text = [`Found ${results.length} page(s):`, '', ...lines].join('\n\n');

  return { content: [{ type: 'text', text }] };
}
