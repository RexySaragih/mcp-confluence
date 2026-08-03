import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { JiraClient } from '../src/clients/jira-client.js';
import { handleAddJiraComment } from '../src/tools/jira-comment.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const AUTH = {
  baseUrl: 'https://example.atlassian.net',
  email: 'user@example.com',
  apiToken: 'token',
};

afterEach(() => {
  restoreMockFetch();
});

describe('Comment Jira Ticket', () => {
  describe('when a ticket key and comment are provided', () => {
    it('should add only the comment and report success', async () => {
      let requestBody: {
        body: {
          content: { content: { text: string }[] }[];
        };
      } | undefined;

      mockFetch([
        route('/rest/api/3/issue/ENG-42/comment', (_url, init) => {
          assert.equal(init?.method, 'POST');
          requestBody = JSON.parse(init?.body as string) as typeof requestBody;
          return jsonResponse({ id: '200' }, 201);
        }),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleAddJiraComment(client, {
        ticket_key: 'ENG-42',
        comment: 'Please verify the retry behavior.',
      });

      assert.equal(
        requestBody?.body.content[0].content[0].text,
        'Please verify the retry behavior.',
      );
      assert.equal(
        result.content[0].text,
        'Comment added to ENG-42. Issue fields and status were not changed.',
      );
    });
  });

  describe('when a Jira URL is provided', () => {
    it('should resolve the ticket key before adding the comment', async () => {
      mockFetch([
        route('/rest/api/3/issue/OPS-7/comment', () =>
          jsonResponse({ id: '201' }, 201)),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleAddJiraComment(client, {
        url: 'https://example.atlassian.net/browse/OPS-7',
        comment: 'Investigating.',
      });

      assert.match(result.content[0].text, /Comment added to OPS-7/);
    });
  });
});
