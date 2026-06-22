import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleUpdateConfluencePage } from '../src/tools/confluence-write.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

const existingPage = {
  id: '123456',
  title: 'Payment Design',
  version: { number: 3 },
  body: { storage: { value: '<p>Existing content</p>' } },
  _links: {
    base: `${BASE_URL}/wiki`,
    webui: '/spaces/ENG/pages/123456/Payment+Design',
  },
};

afterEach(() => {
  restoreMockFetch();
});

describe('Update Confluence Page', () => {
  describe('when mode is replace', () => {
    it('should overwrite the page body with new markdown', async () => {
      let updateBody: Record<string, unknown> | undefined;

      mockFetch([
        route('/wiki/api/v2/pages/123456', (url, init) => {
          if (init?.method === 'PUT') {
            updateBody = JSON.parse(init.body as string);
            return jsonResponse({
              id: '123456',
              title: 'Payment Design',
              version: { number: 4 },
              _links: {
                base: `${BASE_URL}/wiki`,
                webui: '/spaces/ENG/pages/123456/Payment+Design',
              },
            });
          }
          return jsonResponse(existingPage);
        }),
      ]);

      const client = new ConfluenceClient(AUTH);
      const result = await handleUpdateConfluencePage(client, {
        page_id: '123456',
        content: '# New Section\n\nUpdated details.',
        mode: 'replace',
      });

      const body = updateBody?.body as { representation: string; value: string };
      assert.equal(body.representation, 'storage');
      assert.match(body.value, /New Section/);
      assert.match(result.content[0].text, /Page updated successfully \(replace mode\)/);
      assert.match(result.content[0].text, /Version: 4/);
    });
  });

  describe('when mode is append', () => {
    it('should keep existing content and append new markdown', async () => {
      let updateBody: Record<string, unknown> | undefined;

      mockFetch([
        route('/wiki/api/v2/pages/123456', (url, init) => {
          if (init?.method === 'PUT') {
            updateBody = JSON.parse(init.body as string);
            return jsonResponse({
              id: '123456',
              title: 'Payment Design',
              version: { number: 4 },
              _links: {
                base: `${BASE_URL}/wiki`,
                webui: '/spaces/ENG/pages/123456/Payment+Design',
              },
            });
          }
          return jsonResponse(existingPage);
        }),
      ]);

      const client = new ConfluenceClient(AUTH);
      await handleUpdateConfluencePage(client, {
        page_id: '123456',
        content: '## Changelog\n\n- Added retries',
        mode: 'append',
      });

      const body = (updateBody?.body as { value: string }).value;
      assert.match(body, /Existing content/);
      assert.match(body, /Changelog/);
    });
  });
});
