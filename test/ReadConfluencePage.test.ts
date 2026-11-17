import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleReadConfluencePage } from '../src/tools/confluence.js';
import { jsonResponse, mockFetch, mockFetchRecording, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

const pagePayload = {
  id: '123456',
  title: 'Payment Design',
  spaceId: '98304',
  parentId: '100',
  version: { number: 7 },
  body: {
    storage: {
      value: '<p>Overview of retry logic by <ac:link><ri:user ri:account-id="acc-1" /></ac:link></p>',
    },
  },
  labels: { results: [{ name: 'design-doc' }] },
  _links: {
    base: `${BASE_URL}/wiki`,
    webui: '/spaces/ENG/pages/123456/Payment+Design',
  },
};

const usersRoute = route('/wiki/api/v2/users-bulk', () =>
  jsonResponse({ results: [{ accountId: 'acc-1', displayName: 'Alice' }] }),
);

afterEach(() => {
  restoreMockFetch();
});

describe('Read Confluence Page', () => {
  describe('when the page exists', () => {
    it('should return the page header, labels, and Markdown body with resolved mentions', async () => {
      const requests = mockFetchRecording([
        usersRoute,
        route('/wiki/api/v2/pages/123456', () => jsonResponse(pagePayload)),
      ]);

      const result = await handleReadConfluencePage(new ConfluenceClient(AUTH), { page_id: '123456' });
      const text = result.content[0].text;

      assert.match(requests[0].url, /body-format=storage&include-labels=true/);
      assert.match(text, /Title: Payment Design/);
      assert.match(text, /Page ID: 123456\nSpace: ENG\nVersion: 7/);
      assert.match(text, /Parent ID: 100/);
      assert.match(text, /Labels: design-doc/);
      assert.match(text, /Overview of retry logic by @Alice/);
    });
  });

  describe('when the user name lookup fails', () => {
    it('should still return the page with account ids in mentions', async () => {
      mockFetch([
        route('/wiki/api/v2/users-bulk', () => jsonResponse({ message: 'nope' }, 403)),
        route('/wiki/api/v2/pages/123456', () => jsonResponse(pagePayload)),
      ]);

      const result = await handleReadConfluencePage(new ConfluenceClient(AUTH), { page_id: '123456' });

      assert.match(result.content[0].text, /by @user:acc-1/);
    });
  });

  describe('when include_hierarchy is enabled', () => {
    it('should list the ancestor path and direct children', async () => {
      mockFetch([
        usersRoute,
        route('/wiki/api/v2/pages/123456/direct-children', () =>
          jsonResponse({
            results: [
              { id: '200', title: 'Retry API', type: 'page' },
              { id: '201', title: 'Assets', type: 'folder' },
            ],
          }),
        ),
        route('/wiki/rest/api/content/123456?expand=ancestors', () =>
          jsonResponse({ id: '123456', ancestors: [{ id: '1', title: 'Engineering', type: 'page' }, { id: '100', title: 'Payments', type: 'page' }] }),
        ),
        route('/wiki/api/v2/pages/123456', () => jsonResponse(pagePayload)),
      ]);

      const result = await handleReadConfluencePage(new ConfluenceClient(AUTH), {
        url: `${BASE_URL}/wiki/spaces/ENG/pages/123456/Payment+Design`,
        include_hierarchy: true,
      });
      const text = result.content[0].text;

      assert.match(text, /Path: Engineering \(1\) › Payments \(100\) › Payment Design/);
      assert.match(text, /Child pages \(2\):/);
      assert.match(text, new RegExp(`- 200 \\| Retry API \\| ${BASE_URL}/wiki/spaces/ENG/pages/200`));
      assert.match(text, /- 201 \| Assets \| folder \|/);
    });
  });

  describe('when include_comments is enabled', () => {
    it('should append a comments section', async () => {
      mockFetch([
        usersRoute,
        route('/wiki/api/v2/pages/123456', () => jsonResponse(pagePayload)),
        route('/wiki/rest/api/content/123456/child/comment', () =>
          jsonResponse({
            results: [
              {
                id: 'c1',
                version: { by: { displayName: 'Alice' }, when: '2026-01-01T00:00:00.000Z' },
                body: { view: { value: '<p>Please review <strong>section 2</strong></p>' } },
              },
            ],
          }),
        ),
        route('/wiki/rest/api/content/c1/child/comment', () =>
          jsonResponse({
            results: [
              {
                id: 'c2',
                version: { by: { displayName: 'Bob' }, when: '2026-01-02T00:00:00.000Z' },
                body: { view: { value: '<p>Done</p>' } },
                extensions: { location: 'inline', inlineProperties: { originalSelection: 'retry logic' } },
              },
            ],
          }),
        ),
      ]);

      const result = await handleReadConfluencePage(new ConfluenceClient(AUTH), {
        page_id: '123456',
        include_comments: true,
      });
      const text = result.content[0].text;

      assert.match(text, /## Comments/);
      assert.match(text, /\[1\] Alice \(2026-01-01T00:00:00.000Z\)\nPlease review \*\*section 2\*\*/);
      assert.match(text, /\[reply 1\] Bob \(2026-01-02T00:00:00.000Z\) \[inline on "retry logic"\]\n  Done/);
    });
  });

  describe('when the URL belongs to another site', () => {
    it('should refuse before calling Confluence', async () => {
      const requests = mockFetchRecording([]);

      await assert.rejects(
        () => handleReadConfluencePage(new ConfluenceClient(AUTH), { url: 'https://evil.example.com/wiki/spaces/ENG/pages/123456' }),
        /does not match the configured Atlassian site/,
      );
      assert.equal(requests.length, 0);
    });
  });
});
