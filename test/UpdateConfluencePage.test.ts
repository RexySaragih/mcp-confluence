import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleUpdateConfluencePage } from '../src/tools/confluence-write.js';
import { jsonResponse, mockFetchRecording, RecordedRequest, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };
const EXISTING_STORAGE =
  '<p>Existing content</p><ac:structured-macro ac:name="toc" /><ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">Flow</ac:parameter></ac:structured-macro>';

const existingPage = {
  id: '123456',
  title: 'Payment Design',
  version: { number: 3 },
  body: { storage: { value: EXISTING_STORAGE } },
  _links: {
    base: `${BASE_URL}/wiki`,
    webui: '/spaces/ENG/pages/123456/Payment+Design',
  },
};

function pageRoute(updateStatus = 200) {
  return route('/wiki/api/v2/pages/123456', (_url, init) => {
    if (init?.method === 'PUT') {
      if (updateStatus !== 200) return jsonResponse({ errors: [{ title: 'Version conflict' }] }, updateStatus);
      return jsonResponse({ ...existingPage, version: { number: 4 } });
    }
    return jsonResponse(existingPage);
  });
}

function putBody(requests: RecordedRequest[]): { body: { representation: string; value: string }; version: { number: number } } {
  const put = requests.find((request) => request.method === 'PUT');
  assert.ok(put, 'expected a PUT request');
  return put.body as { body: { representation: string; value: string }; version: { number: number } };
}

afterEach(() => {
  restoreMockFetch();
});

describe('Update Confluence Page', () => {
  describe('when mode is replace', () => {
    it('should overwrite the page body with new markdown using one read', async () => {
      const requests = mockFetchRecording([pageRoute()]);

      const result = await handleUpdateConfluencePage(new ConfluenceClient(AUTH), {
        page_id: '123456',
        content: '# New Section\n\nUpdated details.',
        mode: 'replace',
      });

      const body = putBody(requests);
      assert.equal(requests.filter((request) => request.method === 'GET').length, 1);
      assert.equal(body.body.representation, 'storage');
      assert.match(body.body.value, /<h1>New Section<\/h1>/);
      assert.equal(body.version.number, 4);
      assert.match(result.content[0].text, /Page updated successfully \(replace mode\)/);
      assert.match(result.content[0].text, /Version: 4 \(was 3\)/);
    });
  });

  describe('when mode is append', () => {
    it('should keep the existing storage unchanged, including macros, and add the new content after it', async () => {
      const requests = mockFetchRecording([pageRoute()]);

      await handleUpdateConfluencePage(new ConfluenceClient(AUTH), {
        page_id: '123456',
        content: '## Changelog\n\n- Added retries',
        mode: 'append',
      });

      const value = putBody(requests).body.value;
      assert.ok(value.startsWith(EXISTING_STORAGE), value);
      assert.match(value.slice(EXISTING_STORAGE.length), /^<h2>Changelog<\/h2>/);
    });
  });

  describe('when expected_version does not match', () => {
    it('should refuse to update', async () => {
      const requests = mockFetchRecording([pageRoute()]);

      await assert.rejects(
        () => handleUpdateConfluencePage(new ConfluenceClient(AUTH), {
          page_id: '123456',
          content: 'x',
          expected_version: 2,
        }),
        /is at version 3, not 2/,
      );
      assert.equal(requests.some((request) => request.method === 'PUT'), false);
    });
  });

  describe('when Confluence reports a version conflict', () => {
    it('should explain that the page changed during the update', async () => {
      mockFetchRecording([pageRoute(409)]);

      await assert.rejects(
        () => handleUpdateConfluencePage(new ConfluenceClient(AUTH), { page_id: '123456', content: 'x' }),
        /changed by someone else during the update/,
      );
    });
  });

  describe('when the content is storage format', () => {
    it('should send it without Markdown conversion', async () => {
      const requests = mockFetchRecording([pageRoute()]);
      const storage = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>';

      await handleUpdateConfluencePage(new ConfluenceClient(AUTH), {
        page_id: '123456',
        content: storage,
        content_format: 'storage',
      });

      assert.equal(putBody(requests).body.value, storage);
    });
  });

  describe('when neither content nor content_file is given', () => {
    it('should reject the arguments', async () => {
      await assert.rejects(
        () => handleUpdateConfluencePage(new ConfluenceClient(AUTH), { page_id: '123456' }),
        /Provide exactly one of content or content_file/,
      );
    });
  });
});
