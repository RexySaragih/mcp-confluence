import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AtlassianHttp } from '../src/clients/atlassian-http.js';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { loadConfig } from '../src/config.js';
import { handleReadConfluenceImage } from '../src/tools/confluence-image.js';
import { CONFIRMATION_TTL_MS, ConfirmationStore } from '../src/tools/confirmation-store.js';
import { issueKeyFromUrl, pageIdFromUrl, resolvePageId } from '../src/validators/ids.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

afterEach(() => {
  restoreMockFetch();
});

describe('Configuration', () => {
  describe('when the base URL includes /wiki and read-only is set', () => {
    it('should normalise the site URL and enable read-only mode', () => {
      const config = loadConfig({
        ATLASSIAN_BASE_URL: 'https://example.atlassian.net/wiki/',
        ATLASSIAN_EMAIL: 'a@b.c',
        ATLASSIAN_API_TOKEN: 't',
        ATLASSIAN_READ_ONLY: 'true',
      });

      assert.equal(config.baseUrl, BASE_URL);
      assert.equal(config.readOnly, true);
      assert.deepEqual(config.contentDirs, []);
    });
  });

  describe('when a required variable is missing', () => {
    it('should name the variable', () => {
      assert.throws(() => loadConfig({ ATLASSIAN_BASE_URL: BASE_URL, ATLASSIAN_EMAIL: 'a@b.c' }), /ATLASSIAN_API_TOKEN/);
    });
  });
});

describe('Id and URL validation', () => {
  describe('when a Confluence URL is given', () => {
    it('should find the page id in view, edit, and query-string URLs', () => {
      assert.equal(pageIdFromUrl(`${BASE_URL}/wiki/spaces/PRODENG/pages/2066022402`, BASE_URL), '2066022402');
      assert.equal(pageIdFromUrl(`${BASE_URL}/wiki/spaces/PRODENG/pages/edit-v2/2066022402?draftShareId=x`, BASE_URL), '2066022402');
      assert.equal(pageIdFromUrl(`${BASE_URL}/wiki/pages/viewpage.action?pageId=42`, BASE_URL), '42');
    });

    it('should decode short links to the page id', () => {
      assert.equal(pageIdFromUrl(`${BASE_URL}/wiki/x/hwAEjQ`, BASE_URL), '2365849735');
    });

    it('should reject other sites', () => {
      assert.throws(() => pageIdFromUrl('https://other.atlassian.net/wiki/spaces/X/pages/1', BASE_URL), /does not match/);
    });
  });

  describe('when an id is not numeric', () => {
    it('should reject it before it reaches a URL path', () => {
      assert.throws(() => resolvePageId({ page_id: '../../rest/api/user' }, BASE_URL), /Confluence page ids are numeric/);
    });
  });

  describe('when a Jira URL is given', () => {
    it('should find browse and board keys', () => {
      assert.equal(issueKeyFromUrl(`${BASE_URL}/browse/eng-12`, BASE_URL), 'ENG-12');
      assert.equal(issueKeyFromUrl(`${BASE_URL}/jira/software/c/projects/ENG/boards/3?selectedIssue=ENG-9`, BASE_URL), 'ENG-9');
    });
  });
});

describe('Atlassian HTTP client', () => {
  describe('when Atlassian rate-limits a request', () => {
    it('should retry after the Retry-After delay', async () => {
      let attempts = 0;
      mockFetch([
        route('/rest/api/3/myself', () => {
          attempts += 1;
          if (attempts === 1) {
            return new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } });
          }
          return jsonResponse({ accountId: 'me' });
        }),
      ]);

      const result = await new AtlassianHttp(AUTH).json<{ accountId: string }>('/rest/api/3/myself', { errorContext: 'whoami' });

      assert.equal(result.accountId, 'me');
      assert.equal(attempts, 2);
    });
  });

  describe('when the error body is an HTML page', () => {
    it('should not copy the page into the error message', async () => {
      mockFetch([route('/rest/api/3/myself', () => new Response(`<html>${'x'.repeat(5000)}</html>`, { status: 502 }))]);

      await assert.rejects(
        () => new AtlassianHttp(AUTH).json('/rest/api/3/myself', { errorContext: 'whoami' }),
        (error: Error) => error.message === 'whoami: 502 - (HTML error page omitted)',
      );
    });
  });

  describe('when a caller passes an absolute URL', () => {
    it('should refuse to send credentials to it', async () => {
      await assert.rejects(
        () => new AtlassianHttp(AUTH).send('https://evil.example.com/steal', { errorContext: 'x' }),
        /non site-relative path/,
      );
    });
  });
});

describe('Confirmation store', () => {
  describe('when a token is older than the time limit', () => {
    it('should reject it', () => {
      let now = 0;
      const store = new ConfirmationStore(() => now);
      const token = store.issue('fingerprint');

      now = CONFIRMATION_TTL_MS + 1;

      assert.throws(() => store.consume(token, 'fingerprint'), /invalid or has expired/);
    });
  });
});

describe('Read Confluence Image', () => {
  const attachmentList = route('/child/attachment?filename=', () =>
    jsonResponse({ results: [{ id: 'att9', title: 'diagram.png', extensions: { mediaType: 'image/png', fileSize: 3 } }] }),
  );

  describe('when the download redirects to the media CDN', () => {
    it('should follow the redirect without credentials and return the image', async () => {
      let cdnAuthorization: string | null | undefined;
      mockFetch([
        attachmentList,
        route('/child/attachment/att9/download', () =>
          new Response(null, { status: 302, headers: { Location: 'https://api.media.atlassian.com/file/abc?token=x' } }),
        ),
        route('https://api.media.atlassian.com/', (_url, init) => {
          cdnAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
          return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/octet-stream' } });
        }),
      ]);

      const result = await handleReadConfluenceImage(new ConfluenceClient(AUTH), {
        url: `${BASE_URL}/wiki/download/attachments/123/diagram.png`,
      });

      assert.equal(cdnAuthorization, null);
      assert.deepEqual(result.content[1], { type: 'image', data: 'AQID', mimeType: 'image/png' });
    });
  });

  describe('when the attachment is not an image', () => {
    it('should refuse before downloading', async () => {
      let downloaded = false;
      mockFetch([
        route('/child/attachment?filename=', () =>
          jsonResponse({ results: [{ id: 'att1', title: 'spec.pdf', extensions: { mediaType: 'application/pdf' } }] }),
        ),
        route('/download', () => {
          downloaded = true;
          return new Response('x');
        }),
      ]);

      await assert.rejects(
        () => handleReadConfluenceImage(new ConfluenceClient(AUTH), { page_id: '123', filename: 'spec.pdf' }),
        /is application\/pdf, not an image/,
      );
      assert.equal(downloaded, false);
    });
  });
});
