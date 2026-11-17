import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { handleCreateConfluencePage } from '../src/tools/confluence-create.js';
import { jsonResponse, mockFetchRecording, RecordedRequest, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };
const PARENT_ID = '2066022402';
const SPACE_ID = '98304';

const parentPage = {
  id: PARENT_ID,
  title: '[WIP] - Workflow Phase 2',
  spaceId: SPACE_ID,
  version: { number: 12 },
  _links: { base: `${BASE_URL}/wiki`, webui: `/spaces/PRODENG/pages/${PARENT_ID}/WIP+-+Workflow+Phase+2` },
};

const createdPage = {
  id: '3000001',
  title: 'Workflow Execution Log',
  spaceId: SPACE_ID,
  parentId: PARENT_ID,
  version: { number: 1 },
  _links: { base: `${BASE_URL}/wiki`, webui: '/spaces/PRODENG/pages/3000001/Workflow+Execution+Log' },
};

const ancestors = {
  id: '3000001',
  ancestors: [
    { id: '1069121538', title: 'Workflow', type: 'page' },
    { id: PARENT_ID, title: '[WIP] - Workflow Phase 2', type: 'page' },
  ],
};

interface Scenario {
  existingTitle?: boolean;
}

function confluenceRoutes(scenario: Scenario = {}) {
  return [
    route(`/wiki/api/v2/pages/${PARENT_ID}`, () => jsonResponse(parentPage)),
    route('/wiki/api/v2/pages?', () =>
      jsonResponse({
        results: scenario.existingTitle
          ? [{ id: '555', title: 'Workflow Execution Log', _links: { webui: '/spaces/PRODENG/pages/555' } }]
          : [],
        _links: { base: `${BASE_URL}/wiki` },
      }),
    ),
    route('/wiki/api/v2/pages', (_url, init) => {
      assert.equal(init?.method, 'POST');
      return jsonResponse(createdPage);
    }),
    route('/wiki/api/v2/spaces?keys=', (url) =>
      jsonResponse({ results: [{ id: url.includes('OTHER') ? '777' : SPACE_ID, key: url.includes('OTHER') ? 'OTHER' : 'PRODENG', name: 'Product Engineering' }] }),
    ),
    route('/wiki/rest/api/content/3000001/label', () => jsonResponse({ results: [] })),
    route('/wiki/rest/api/content/3000001?expand=ancestors', () => jsonResponse(ancestors)),
  ];
}

function createRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.method === 'POST' && /\/wiki\/api\/v2\/pages(\?|$)/.test(request.url));
}

afterEach(() => {
  restoreMockFetch();
});

describe('Create Confluence Page', () => {
  describe('when a parent page id is given', () => {
    it('should create the page under the parent in the parent space and report its path', async () => {
      const requests = mockFetchRecording(confluenceRoutes());

      const result = await handleCreateConfluencePage(new ConfluenceClient(AUTH), {
        parent_id: PARENT_ID,
        title: 'Workflow Execution Log',
        content: '# Overview\n\nDetails',
        labels: ['PRD', 'prd', 'fds'],
      });

      const [create] = createRequests(requests);
      assert.equal(create.url, `${BASE_URL}/wiki/api/v2/pages`);
      assert.deepEqual(
        { spaceId: SPACE_ID, parentId: PARENT_ID, status: 'current', title: 'Workflow Execution Log' },
        pick(create.body, ['spaceId', 'parentId', 'status', 'title']),
      );
      assert.match((create.body as { body: { value: string } }).body.value, /<h1>Overview<\/h1>/);

      const labels = requests.find((request) => request.url.endsWith('/label'));
      assert.deepEqual(labels?.body, [{ prefix: 'global', name: 'prd' }, { prefix: 'global', name: 'fds' }]);

      const text = result.content[0].text;
      assert.match(text, /Created page "Workflow Execution Log" \(id 3000001\) in space PRODENG/);
      assert.match(text, /Location: under "\[WIP\] - Workflow Phase 2" \(2066022402\)/);
      assert.match(text, /Path: Workflow \(1069121538\) › \[WIP\] - Workflow Phase 2 \(2066022402\) › Workflow Execution Log/);
      assert.match(text, /Labels: prd, fds/);
    });
  });

  describe('when the parent is given as a URL', () => {
    it('should resolve the parent page id from the URL', async () => {
      const requests = mockFetchRecording(confluenceRoutes());

      await handleCreateConfluencePage(new ConfluenceClient(AUTH), {
        parent_url: `${BASE_URL}/wiki/spaces/PRODENG/pages/${PARENT_ID}`,
        title: 'Workflow Execution Log',
        content: 'Body',
      });

      assert.equal((createRequests(requests)[0].body as { parentId: string }).parentId, PARENT_ID);
    });
  });

  describe('when no parent is given', () => {
    it('should reject before calling Confluence and explain the top-level option', async () => {
      const requests = mockFetchRecording([]);

      await assert.rejects(
        () => handleCreateConfluencePage(new ConfluenceClient(AUTH), { title: 'Loose page', content: 'Body', space_key: 'PRODENG' }),
        /Provide parent_id or parent_url[\s\S]*root_level=true/,
      );
      assert.equal(requests.length, 0);
    });
  });

  describe('when a page with the same title exists in the space', () => {
    it('should fail without creating and point to the existing page', async () => {
      const requests = mockFetchRecording(confluenceRoutes({ existingTitle: true }));

      await assert.rejects(
        () => handleCreateConfluencePage(new ConfluenceClient(AUTH), {
          parent_id: PARENT_ID,
          title: 'Workflow Execution Log',
          content: 'Body',
        }),
        /already exists in space PRODENG \(id 555, .*\/pages\/555\)\. No page was created/,
      );
      assert.equal(createRequests(requests).length, 0);
    });
  });

  describe('when space_key does not match the parent space', () => {
    it('should fail without creating', async () => {
      const requests = mockFetchRecording(confluenceRoutes());

      await assert.rejects(
        () => handleCreateConfluencePage(new ConfluenceClient(AUTH), {
          parent_id: PARENT_ID,
          space_key: 'OTHER',
          title: 'Workflow Execution Log',
          content: 'Body',
        }),
        /is in space PRODENG, not OTHER/,
      );
      assert.equal(createRequests(requests).length, 0);
    });
  });

  describe('when a top-level page is requested', () => {
    it('should require a confirmation token before creating it at the root of the space', async () => {
      const requests = mockFetchRecording(confluenceRoutes());
      const client = new ConfluenceClient(AUTH);
      const args = { space_key: 'PRODENG', root_level: true, title: 'Workflow Execution Log', content: 'Body' };

      const first = await handleCreateConfluencePage(client, args);
      const token = first.content[0].text.match(/confirmation_token="([a-f0-9]+)"/)?.[1];

      assert.match(first.content[0].text, /^Confirmation required\. No page was created\./);
      assert.match(first.content[0].text, /top level of space PRODENG \(Product Engineering\)/);
      assert.ok(token);
      assert.equal(createRequests(requests).length, 0);

      const second = await handleCreateConfluencePage(client, { ...args, confirmation_token: token });

      const [create] = createRequests(requests);
      assert.equal(create.url, `${BASE_URL}/wiki/api/v2/pages?root-level=true`);
      assert.equal((create.body as { parentId?: string }).parentId, undefined);
      assert.match(second.content[0].text, /Location: top level of space PRODENG/);

      await assert.rejects(
        () => handleCreateConfluencePage(client, { ...args, confirmation_token: token }),
        /invalid or has expired/,
      );
    });

    it('should reject a token issued for a different title', async () => {
      mockFetchRecording(confluenceRoutes());
      const client = new ConfluenceClient(AUTH);
      const args = { space_key: 'PRODENG', root_level: true, title: 'Workflow Execution Log', content: 'Body' };
      const first = await handleCreateConfluencePage(client, args);
      const token = first.content[0].text.match(/confirmation_token="([a-f0-9]+)"/)?.[1];

      await assert.rejects(
        () => handleCreateConfluencePage(client, { ...args, title: 'Another title', confirmation_token: token }),
        /issued for a different space, title or status/,
      );
    });

    it('should reject root_level combined with a parent', async () => {
      await assert.rejects(
        () => handleCreateConfluencePage(new ConfluenceClient(AUTH), {
          parent_id: PARENT_ID,
          root_level: true,
          space_key: 'PRODENG',
          title: 'X',
          content: 'Body',
        }),
        /root_level cannot be combined with parent_id or parent_url/,
      );
    });
  });

  describe('when the content comes from a local file', () => {
    it('should read the file inside an allowed directory', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'mcp-content-'));
      const file = path.join(dir, 'tech-sol.md');
      await writeFile(file, '## From file');
      const requests = mockFetchRecording(confluenceRoutes());

      try {
        await handleCreateConfluencePage(
          new ConfluenceClient(AUTH),
          { parent_id: PARENT_ID, title: 'Workflow Execution Log', content_file: file },
          { contentDirs: [dir] },
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }

      assert.match((createRequests(requests)[0].body as { body: { value: string } }).body.value, /<h2>From file<\/h2>/);
    });

    it('should refuse files outside the allowed directories', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'mcp-content-'));
      const file = path.join(dir, 'secret.md');
      await writeFile(file, 'secret');
      const requests = mockFetchRecording(confluenceRoutes());

      try {
        await assert.rejects(
          () => handleCreateConfluencePage(
            new ConfluenceClient(AUTH),
            { parent_id: PARENT_ID, title: 'Workflow Execution Log', content_file: file },
            { contentDirs: [path.join(dir, 'allowed')] },
          ),
          /must be inside one of the directories in ATLASSIAN_CONTENT_DIRS/,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      assert.equal(createRequests(requests).length, 0);
    });

    it('should refuse files with other extensions before calling Confluence', async () => {
      const requests = mockFetchRecording([]);

      await assert.rejects(
        () => handleCreateConfluencePage(new ConfluenceClient(AUTH), {
          parent_id: PARENT_ID,
          title: 'X',
          content_file: '/Users/someone/.ssh/id_rsa',
        }),
        /content_file must end in one of/,
      );
      assert.equal(requests.length, 0);
    });
  });

  describe('when the content is storage format', () => {
    it('should send the body unchanged', async () => {
      const storage = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Kept</p></ac:rich-text-body></ac:structured-macro>';
      const requests = mockFetchRecording(confluenceRoutes());

      await handleCreateConfluencePage(new ConfluenceClient(AUTH), {
        parent_id: PARENT_ID,
        title: 'Workflow Execution Log',
        content: storage,
        content_format: 'storage',
      });

      assert.equal((createRequests(requests)[0].body as { body: { value: string } }).body.value, storage);
    });
  });
});

function pick(value: unknown, keys: string[]): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}
