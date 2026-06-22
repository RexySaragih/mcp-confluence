import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { JiraClient } from '../src/clients/jira-client.js';
import { handleSearchJira } from '../src/tools/jira-search.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

afterEach(() => {
  restoreMockFetch();
});

describe('Search Jira', () => {
  describe('when issues match the JQL query', () => {
    it('should return a compact list of matching tickets', async () => {
      mockFetch([
        route('/search/jql', (_url, init) => {
          const body = JSON.parse(init?.body as string);
          assert.equal(body.jql, 'project = ENG');
          assert.equal(body.startAt, undefined);
          return jsonResponse({
            issues: [
              {
                key: 'ENG-1',
                fields: {
                  summary: 'Payment retry',
                  status: { name: 'Open' },
                  assignee: { displayName: 'Alice' },
                  issuetype: { name: 'Story' },
                  priority: { name: 'High' },
                  updated: '2026-01-01T00:00:00.000Z',
                },
              },
            ],
          });
        }),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleSearchJira(client, { jql: 'project = ENG' });

      assert.match(result.content[0].text, /Found 1 issue\(s\)/);
      assert.match(result.content[0].text, /ENG-1 \| Payment retry \| Open \| Alice/);
      assert.match(result.content[0].text, new RegExp(`${BASE_URL}/browse/ENG-1`));
    });
  });

  describe('when more results are available', () => {
    it('should include pagination instructions for the next page', async () => {
      mockFetch([
        route('/search/jql', () =>
          jsonResponse({
            issues: Array.from({ length: 15 }, (_, i) => ({
              key: `ENG-${i + 1}`,
              fields: {
                summary: `Issue ${i + 1}`,
                status: { name: 'Open' },
                assignee: { displayName: 'Alice' },
                issuetype: { name: 'Story' },
                priority: { name: 'High' },
                updated: '2026-01-01T00:00:00.000Z',
              },
            })),
            nextPageToken: 'token-page-2',
          }),
        ),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleSearchJira(client, { jql: 'project = ENG', max_results: 15 });

      assert.match(result.content[0].text, /Found 15 issue\(s\)/);
      assert.match(result.content[0].text, /next_page_token="token-page-2"/);
    });
  });

  describe('when fetching a subsequent page', () => {
    it('should send the next page token to Jira', async () => {
      mockFetch([
        route('/search/jql', (_url, init) => {
          const body = JSON.parse(init?.body as string);
          assert.equal(body.nextPageToken, 'token-page-2');
          return jsonResponse({
            issues: [
              {
                key: 'ENG-16',
                fields: {
                  summary: 'Issue 16',
                  status: { name: 'Open' },
                  assignee: { displayName: 'Alice' },
                  issuetype: { name: 'Story' },
                  priority: { name: 'High' },
                  updated: '2026-01-01T00:00:00.000Z',
                },
              },
            ],
          });
        }),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleSearchJira(client, {
        jql: 'project = ENG',
        next_page_token: 'token-page-2',
        max_results: 15,
      });

      assert.match(result.content[0].text, /ENG-16/);
    });
  });

  describe('when no issues match', () => {
    it('should return a no-results message', async () => {
      mockFetch([
        route('/search/jql', () => jsonResponse({ issues: [] })),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleSearchJira(client, { jql: 'project = MISSING' });

      assert.equal(result.content[0].text, 'No issues found.');
    });
  });
});
