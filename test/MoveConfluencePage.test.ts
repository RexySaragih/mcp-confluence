import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleMoveConfluencePage } from '../src/tools/confluence-move.js';
import { jsonResponse, mockFetchRecording, RecordedRequest, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

const pages: Record<string, Record<string, unknown>> = {
  '2025291789': { id: '2025291789', title: 'Wokflow - FDS API Integration', spaceId: '1', parentId: '1069121538', parentType: 'page' },
  '2066022402': { id: '2066022402', title: '[WIP] - Workflow Phase 2', spaceId: '1', parentId: '1069121538', parentType: 'page' },
  '4000000': { id: '4000000', title: 'Other space page', spaceId: '2', parentId: '1', parentType: 'page' },
  '5000000': { id: '5000000', title: 'Child of FDS API', spaceId: '1', parentId: '2025291789', parentType: 'page' },
};

let moved = false;

function routes() {
  moved = false;
  return [
    route('/move/append/', (_url, init) => {
      assert.equal(init?.method, 'PUT');
      moved = true;
      return jsonResponse({ pageId: '2025291789' });
    }),
    route('?expand=ancestors', (url) => {
      const id = url.match(/content\/(\d+)\?/)?.[1] ?? '';
      return jsonResponse({ id, ancestors: ancestorsOf(id) });
    }),
    route('/wiki/api/v2/pages/', (url) => {
      const id = url.match(/pages\/(\d+)/)?.[1] ?? '';
      return jsonResponse(pages[id]);
    }),
  ];
}

function ancestorsOf(id: string) {
  const workflow = { id: '1069121538', title: 'Workflow', type: 'page' };
  if (id === '5000000') return [workflow, { id: '2025291789', title: 'Wokflow - FDS API Integration', type: 'page' }];
  if (id === '2025291789' && moved) return [workflow, { id: '2066022402', title: '[WIP] - Workflow Phase 2', type: 'page' }];
  return [workflow];
}

function moveRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.url.includes('/move/'));
}

afterEach(() => {
  restoreMockFetch();
});

describe('Move Confluence Page', () => {
  describe('when moving a page under another page in the same space', () => {
    it('should append it to the target and report both paths with an undo hint', async () => {
      const requests = mockFetchRecording(routes());

      const result = await handleMoveConfluencePage(new ConfluenceClient(AUTH), {
        page_id: '2025291789',
        target_parent_url: `${BASE_URL}/wiki/spaces/PRODENG/pages/2066022402`,
      });

      assert.equal(moveRequests(requests)[0].url, `${BASE_URL}/wiki/rest/api/content/2025291789/move/append/2066022402`);
      const text = result.content[0].text;
      assert.match(text, /Before: Workflow \(1069121538\) › Wokflow - FDS API Integration/);
      assert.match(text, /After: Workflow \(1069121538\) › \[WIP\] - Workflow Phase 2 \(2066022402\) › Wokflow - FDS API Integration/);
      assert.match(text, /To undo: call move_confluence_page with page_id="2025291789" and target_parent_id="1069121538"/);
    });
  });

  describe('when the target is in another space', () => {
    it('should refuse without moving', async () => {
      const requests = mockFetchRecording(routes());

      await assert.rejects(
        () => handleMoveConfluencePage(new ConfluenceClient(AUTH), { page_id: '2025291789', target_parent_id: '4000000' }),
        /Moving pages between spaces is not supported/,
      );
      assert.equal(moveRequests(requests).length, 0);
    });
  });

  describe('when the target is a descendant of the page', () => {
    it('should refuse without moving', async () => {
      const requests = mockFetchRecording(routes());

      await assert.rejects(
        () => handleMoveConfluencePage(new ConfluenceClient(AUTH), { page_id: '2025291789', target_parent_id: '5000000' }),
        /cannot be moved under its own descendant/,
      );
      assert.equal(moveRequests(requests).length, 0);
    });
  });

  describe('when the page is already under the target', () => {
    it('should report that nothing changed', async () => {
      const requests = mockFetchRecording(routes());

      const result = await handleMoveConfluencePage(new ConfluenceClient(AUTH), {
        page_id: '5000000',
        target_parent_id: '2025291789',
      });

      assert.match(result.content[0].text, /already a child of .* Nothing was changed/);
      assert.equal(moveRequests(requests).length, 0);
    });
  });
});
