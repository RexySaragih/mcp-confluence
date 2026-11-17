import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { JiraClient } from '../src/clients/jira-client.js';
import { handleUpdateJiraIssue } from '../src/tools/jira-write.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const AUTH = {
  baseUrl: 'https://example.atlassian.net',
  email: 'user@example.com',
  apiToken: 'token',
};

afterEach(() => {
  restoreMockFetch();
});

describe('Update Jira Issue', () => {
  describe('when a comment is provided', () => {
    it('should add the comment and report success', async () => {
      const requests: { url: string; method?: string }[] = [];

      mockFetch([
        route('/issue/ENG-42/comment', (url, init) => {
          requests.push({ url, method: init?.method });
          return jsonResponse({ id: '200' }, 201);
        }),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleUpdateJiraIssue(client, {
        ticket_key: 'ENG-42',
        comment: 'Shipped the fix.',
      });

      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'POST');
      assert.equal(result.content[0].text, 'Added comment to ENG-42');
    });
  });

  describe('when a valid transition is provided', () => {
    it('should transition the issue and report success', async () => {
      const requests: { url: string; method?: string; body?: string }[] = [];

      mockFetch([
        route('/issue/ENG-42/transitions', (url, init) => {
          requests.push({
            url,
            method: init?.method,
            body: init?.body as string | undefined,
          });

          if (init?.method === 'POST') {
            return jsonResponse({});
          }

          return jsonResponse({
            transitions: [
              { id: '31', name: 'In Progress' },
              { id: '41', name: 'Done' },
            ],
          });
        }),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleUpdateJiraIssue(client, {
        ticket_key: 'ENG-42',
        transition: 'done',
      });

      assert.ok(requests.some((r) => r.method === 'POST'));
      assert.equal(result.content[0].text, 'Transitioned ENG-42 to "Done"');
    });
  });

  describe('when a comment and an unavailable transition are provided', () => {
    it('should fail before posting the comment', async () => {
      let commentPosted = false;
      mockFetch([
        route('/issue/ENG-42/comment', () => {
          commentPosted = true;
          return jsonResponse({ id: '200' }, 201);
        }),
        route('/issue/ENG-42/transitions', () => jsonResponse({ transitions: [{ id: '31', name: 'In Progress' }] })),
      ]);

      await assert.rejects(
        () => handleUpdateJiraIssue(new JiraClient(AUTH), { ticket_key: 'ENG-42', comment: 'Done', transition: 'Closed' }),
        /Transition "Closed" not available for ENG-42/,
      );
      assert.equal(commentPosted, false);
    });
  });

  describe('when the transition is not available', () => {
    it('should return an error listing available transitions', async () => {
      mockFetch([
        route('/issue/ENG-42/transitions', () =>
          jsonResponse({
            transitions: [{ id: '31', name: 'In Progress' }],
          }),
        ),
      ]);

      const client = new JiraClient(AUTH);

      await assert.rejects(
        () => handleUpdateJiraIssue(client, {
          ticket_key: 'ENG-42',
          transition: 'Done',
        }),
        /Transition "Done" not available for ENG-42\. Available: In Progress/,
      );
    });
  });
});
