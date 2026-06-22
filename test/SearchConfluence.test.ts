import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleSearchConfluence } from '../src/tools/confluence-search.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

afterEach(() => {
  restoreMockFetch();
});

describe('Search Confluence', () => {
  describe('when pages match the query', () => {
    it('should return page id, title, space, excerpt, and URL', async () => {
      mockFetch([
        route('/wiki/rest/api/content/search', () =>
          jsonResponse({
            results: [
              {
                id: '123456',
                title: 'Payment Design',
                space: { key: 'ENG' },
                body: { view: { value: '<p>Retry logic overview</p>' } },
                _links: { webui: '/spaces/ENG/pages/123456/Payment+Design' },
              },
            ],
          }),
        ),
      ]);

      const client = new ConfluenceClient(AUTH);
      const result = await handleSearchConfluence(client, {
        query: 'payment design',
        space_key: 'ENG',
      });

      assert.match(result.content[0].text, /Found 1 page\(s\)/);
      assert.match(result.content[0].text, /ID: 123456 \| Payment Design \| Space: ENG/);
      assert.match(result.content[0].text, new RegExp(`${BASE_URL}/wiki/spaces/ENG/pages/123456`));
    });
  });

  describe('when no pages match', () => {
    it('should return a no-results message', async () => {
      mockFetch([
        route('/wiki/rest/api/content/search', () => jsonResponse({ results: [] })),
      ]);

      const client = new ConfluenceClient(AUTH);
      const result = await handleSearchConfluence(client, { query: 'missing topic' });

      assert.equal(result.content[0].text, 'No pages found.');
    });
  });
});
