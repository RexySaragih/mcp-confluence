import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { buildCql, handleSearchConfluence } from '../src/tools/confluence-search.js';
import { jsonResponse, mockFetch, mockFetchRecording, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

afterEach(() => {
  restoreMockFetch();
});

describe('Search Confluence', () => {
  describe('when pages match the query', () => {
    it('should return page id, title, space, excerpt, and URL', async () => {
      const requests = mockFetchRecording([
        route('/wiki/rest/api/search', () =>
          jsonResponse({
            results: [
              {
                content: {
                  id: '123456',
                  type: 'page',
                  title: 'Payment Design',
                  space: { key: 'ENG' },
                  _links: { webui: '/spaces/ENG/pages/123456/Payment+Design' },
                },
                excerpt: '<style>[data-colorid=x]{color:#97a0af}</style>@@@hl@@@Retry@@@endhl@@@ logic overview',
              },
            ],
            _links: { next: '/rest/api/search?next=true&cursor=abc123&limit=10' },
          }),
        ),
      ]);

      const result = await handleSearchConfluence(new ConfluenceClient(AUTH), {
        query: 'payment design',
        space_key: 'ENG',
      });
      const text = result.content[0].text;

      const cql = new URL(requests[0].url).searchParams.get('cql');
      assert.equal(cql, 'space = "ENG" AND (text ~ "payment design") AND type = page');
      assert.match(text, /Found 1 result\(s\)/);
      assert.match(text, /ID: 123456 \| Payment Design \| Space: ENG/);
      assert.match(text, /Retry logic overview/);
      assert.doesNotMatch(text, /data-colorid|@@@/);
      assert.match(text, new RegExp(`${BASE_URL}/wiki/spaces/ENG/pages/123456`));
      assert.match(text, /cursor="abc123"/);
    });
  });

  describe('when a cursor is passed', () => {
    it('should send it to the search API', async () => {
      const requests = mockFetchRecording([route('/wiki/rest/api/search', () => jsonResponse({ results: [] }))]);

      const result = await handleSearchConfluence(new ConfluenceClient(AUTH), { query: 'x', cursor: 'abc123' });

      assert.equal(new URL(requests[0].url).searchParams.get('cursor'), 'abc123');
      assert.equal(result.content[0].text, 'No more results.');
    });
  });

  describe('when no pages match', () => {
    it('should return a no-results message', async () => {
      mockFetch([route('/wiki/rest/api/search', () => jsonResponse({ results: [] }))]);

      const result = await handleSearchConfluence(new ConfluenceClient(AUTH), { query: 'missing topic' });

      assert.equal(result.content[0].text, 'No pages found.');
    });
  });
});

describe('buildCql', () => {
  describe('when the query is plain text', () => {
    it('should search page text and escape quotes', () => {
      assert.equal(buildCql('say "hi"'), '(text ~ "say \\"hi\\"") AND type = page');
    });
  });

  describe('when the query uses hierarchy fields', () => {
    it('should treat parent and ancestor conditions as CQL', () => {
      assert.equal(buildCql('parent = 2066022402'), '(parent = 2066022402) AND type = page');
      assert.equal(buildCql('ancestor = 1069121538', 'PRODENG'), 'space = "PRODENG" AND (ancestor = 1069121538) AND type = page');
    });
  });

  describe('when the query has ORDER BY', () => {
    it('should keep ORDER BY outside the wrapped condition', () => {
      assert.equal(
        buildCql('parent = 123 ORDER BY title'),
        '(parent = 123) AND type = page ORDER BY title',
      );
    });
  });

  describe('when the query sets its own type', () => {
    it('should not force type = page', () => {
      assert.equal(buildCql('type = blogpost AND label = news'), '(type = blogpost AND label = news)');
    });
  });
});
