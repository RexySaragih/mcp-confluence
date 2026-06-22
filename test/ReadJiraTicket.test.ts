import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { JiraClient } from '../src/clients/jira-client.js';
import { handleReadJiraTicket } from '../src/tools/jira.js';
import { jsonResponse, mockFetch, restoreMockFetch, route } from './helpers/mock-fetch.js';

const BASE_URL = 'https://example.atlassian.net';
const AUTH = { baseUrl: BASE_URL, email: 'user@example.com', apiToken: 'token' };

const issuePayload = {
  key: 'ENG-42',
  fields: {
    summary: 'Implement retries',
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Add exponential backoff.' }],
        },
      ],
    },
    status: { name: 'In Progress' },
    assignee: { displayName: 'Alice' },
    reporter: { displayName: 'Bob' },
    priority: { name: 'High' },
    issuetype: { name: 'Story' },
    labels: ['backend'],
    parent: { key: 'ENG-1', fields: { summary: 'Payments epic' } },
    subtasks: [],
    issuelinks: [
      {
        type: { name: 'Blocks' },
        outwardIssue: {
          key: 'ENG-43',
          fields: { summary: 'Deploy config', status: { name: 'Open' } },
        },
      },
    ],
  },
};

afterEach(() => {
  restoreMockFetch();
});

describe('Read Jira Ticket', () => {
  describe('when the ticket exists', () => {
    it('should return ticket metadata and description', async () => {
      mockFetch([
        route('/issue/ENG-42?', () => jsonResponse(issuePayload)),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleReadJiraTicket(client, { ticket_key: 'ENG-42' });
      const text = result.content[0].text;

      assert.match(text, /Key: ENG-42/);
      assert.match(text, /Summary: Implement retries/);
      assert.match(text, /Type: Story/);
      assert.match(text, /Priority: High/);
      assert.match(text, /Assignee: Alice/);
      assert.match(text, /Reporter: Bob/);
      assert.match(text, /Labels: backend/);
      assert.match(text, /Parent: ENG-1 — Payments epic/);
      assert.match(text, /Add exponential backoff\./);
    });
  });

  describe('when include_comments is enabled', () => {
    it('should include the comments section', async () => {
      mockFetch([
        route('/issue/ENG-42?', () => jsonResponse(issuePayload)),
        route('/issue/ENG-42/comment', () =>
          jsonResponse({
            comments: [
              {
                id: '100',
                author: { displayName: 'Alice' },
                created: '2026-01-02T00:00:00.000Z',
                body: {
                  type: 'doc',
                  version: 1,
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Looks good to me.' }],
                    },
                  ],
                },
              },
            ],
          }),
        ),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleReadJiraTicket(client, {
        ticket_key: 'ENG-42',
        include_comments: true,
      });

      assert.match(result.content[0].text, /Comments:/);
      assert.match(result.content[0].text, /Looks good to me\./);
    });
  });

  describe('when include_links is enabled', () => {
    it('should include linked issues', async () => {
      mockFetch([
        route('/issue/ENG-42?', () => jsonResponse(issuePayload)),
      ]);

      const client = new JiraClient(AUTH);
      const result = await handleReadJiraTicket(client, {
        ticket_key: 'ENG-42',
        include_links: true,
      });

      assert.match(result.content[0].text, /Linked Issues:/);
      assert.match(result.content[0].text, /ENG-43/);
      assert.match(result.content[0].text, /Deploy config/);
    });
  });
});
