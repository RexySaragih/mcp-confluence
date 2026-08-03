import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import {
  handleAddConfluenceComment,
  handleAddConfluenceInlineComment,
} from '../src/tools/confluence-comment.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };
const PAGE_ID = '123456';

afterEach(() => {
  restoreMockFetch();
});

describe('Comment Confluence Page', () => {
  describe('when a general comment is provided', () => {
    it('should create a footer comment without updating the page', async () => {
      let requestBody: Record<string, unknown> | undefined;

      mockFetch([
        route('/wiki/api/v2/footer-comments', (_url, init) => {
          assert.equal(init?.method, 'POST');
          requestBody = JSON.parse(init?.body as string);
          return jsonResponse({ id: '500', pageId: PAGE_ID }, 201);
        }),
      ]);

      const result = await handleAddConfluenceComment(
        new ConfluenceClient(AUTH),
        {
          page_id: PAGE_ID,
          comment: '**Review complete.**',
        },
      );

      const body = requestBody?.body as { representation: string; value: string };
      assert.equal(requestBody?.pageId, PAGE_ID);
      assert.equal(body.representation, 'storage');
      assert.match(body.value, /<strong>Review complete\.<\/strong>/);
      assert.match(result.content[0].text, /Page content was not changed/);
    });
  });

  describe('when selected text occurs once', () => {
    it('should create an inline comment anchored to that text', async () => {
      let requestBody: Record<string, unknown> | undefined;

      mockFetch([
        renderedPageRoute('<p>The timeout is thirty seconds.</p>'),
        route('/wiki/api/v2/inline-comments', (_url, init) => {
          assert.equal(init?.method, 'POST');
          requestBody = JSON.parse(init?.body as string);
          return jsonResponse({ id: '501', pageId: PAGE_ID }, 201);
        }),
      ]);

      const result = await handleAddConfluenceInlineComment(
        new ConfluenceClient(AUTH),
        {
          page_id: PAGE_ID,
          comment: 'This should be configurable.',
          text_selection: 'The timeout is thirty seconds.',
        },
      );

      const properties = requestBody?.inlineCommentProperties as {
        textSelection: string;
        textSelectionMatchCount: number;
        textSelectionMatchIndex: number;
      };
      assert.deepEqual(properties, {
        textSelection: 'The timeout is thirty seconds.',
        textSelectionMatchCount: 1,
        textSelectionMatchIndex: 0,
      });
      assert.match(result.content[0].text, /Inline comment 501/);
    });
  });

  describe('when selected text occurs more than once', () => {
    it('should anchor to the requested occurrence', async () => {
      let requestBody: Record<string, unknown> | undefined;

      mockFetch([
        renderedPageRoute('<p>Retry request.</p><p>Retry request.</p>'),
        route('/wiki/api/v2/inline-comments', (_url, init) => {
          requestBody = JSON.parse(init?.body as string);
          return jsonResponse({ id: '502', pageId: PAGE_ID }, 201);
        }),
      ]);

      await handleAddConfluenceInlineComment(new ConfluenceClient(AUTH), {
        page_id: PAGE_ID,
        comment: 'Only retry idempotent requests.',
        text_selection: 'Retry request.',
        match_index: 1,
      });

      const properties = requestBody?.inlineCommentProperties as {
        textSelectionMatchCount: number;
        textSelectionMatchIndex: number;
      };
      assert.equal(properties.textSelectionMatchCount, 2);
      assert.equal(properties.textSelectionMatchIndex, 1);
    });
  });

  describe('when selected text is absent', () => {
    it('should reject without creating a comment', async () => {
      let commentPosted = false;
      mockFetch([
        renderedPageRoute('<p>Current architecture.</p>'),
        route('/wiki/api/v2/inline-comments', () => {
          commentPosted = true;
          return jsonResponse({ id: '503' }, 201);
        }),
      ]);

      await assert.rejects(
        () => handleAddConfluenceInlineComment(new ConfluenceClient(AUTH), {
          page_id: PAGE_ID,
          comment: 'Please revise this.',
          text_selection: 'Old architecture.',
        }),
        /Selected text was not found/,
      );
      assert.equal(commentPosted, false);
    });
  });

  describe('when occurrence index is out of range', () => {
    it('should reject without creating a comment', async () => {
      let commentPosted = false;
      mockFetch([
        renderedPageRoute('<p>Unique sentence.</p>'),
        route('/wiki/api/v2/inline-comments', () => {
          commentPosted = true;
          return jsonResponse({ id: '504' }, 201);
        }),
      ]);

      await assert.rejects(
        () => handleAddConfluenceInlineComment(new ConfluenceClient(AUTH), {
          page_id: PAGE_ID,
          comment: 'Comment',
          text_selection: 'Unique sentence.',
          match_index: 1,
        }),
        /match_index 1 is out of range for 1 occurrence/,
      );
      assert.equal(commentPosted, false);
    });
  });

  describe('when Atlassian rejects the comment', () => {
    it('should return an actionable API error', async () => {
      mockFetch([
        route('/wiki/api/v2/footer-comments', () =>
          jsonResponse({ message: 'Comment permission required' }, 403)),
      ]);

      await assert.rejects(
        () => handleAddConfluenceComment(new ConfluenceClient(AUTH), {
          url: `${BASE_URL}/wiki/spaces/ENG/pages/${PAGE_ID}/Design`,
          comment: 'Review note',
        }),
        /Failed to add footer comment to page 123456: 403/,
      );
    });
  });
});

function renderedPageRoute(html: string): ReturnType<typeof route> {
  return route(`/wiki/api/v2/pages/${PAGE_ID}?body-format=view`, (_url, init) => {
    assert.notEqual(init?.method, 'PUT');
    return jsonResponse({
      id: PAGE_ID,
      body: { view: { value: html } },
    });
  });
}
