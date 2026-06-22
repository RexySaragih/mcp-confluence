import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleReadConfluencePage } from '../src/tools/confluence.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

const pagePayload = {
  id: '123456',
  title: 'Payment Design',
  body: { storage: { value: '<p>Overview of retry logic</p>' } },
  labels: { results: [{ name: 'design-doc' }] },
  _links: {
    base: `${BASE_URL}/wiki`,
    webui: '/spaces/ENG/pages/123456/Payment+Design',
  },
};

afterEach(() => {
  restoreMockFetch();
});

describe('Read Confluence Page', () => {
  describe('when the page exists', () => {
    it('should return page title and markdown body', async () => {
      mockFetch([
        route('/wiki/api/v2/pages/123456', () => jsonResponse(pagePayload)),
      ]);

      const client = new ConfluenceClient(AUTH);
      const result = await handleReadConfluencePage(client, { page_id: '123456' });
      const text = result.content[0].text;

      assert.match(text, /Title: Payment Design/);
      assert.match(text, /Labels: design-doc/);
      assert.match(text, /Overview of retry logic/);
    });
  });

  describe('when include_comments is enabled', () => {
    it('should append a comments section', async () => {
      mockFetch([
        route('/wiki/api/v2/pages/123456', () => jsonResponse(pagePayload)),
        route('/wiki/rest/api/content/123456/child/comment', () =>
          jsonResponse({
            results: [
              {
                id: 'c1',
                version: { by: { displayName: 'Alice' }, when: '2026-01-01T00:00:00.000Z' },
                body: { view: { value: '<p>Please review section 2</p>' } },
              },
            ],
          }),
        ),
        route('/wiki/rest/api/content/c1/child/comment', () => jsonResponse({ results: [] })),
      ]);

      const client = new ConfluenceClient(AUTH);
      const result = await handleReadConfluencePage(client, {
        page_id: '123456',
        include_comments: true,
      });

      assert.match(result.content[0].text, /## Comments/);
      assert.match(result.content[0].text, /Please review section 2/);
      assert.match(result.content[0].text, /Alice/);
    });
  });
});
