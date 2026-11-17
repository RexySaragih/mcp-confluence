import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfluenceClient } from '../src/clients/confluence-client.js';
import { JiraClient } from '../src/clients/jira-client.js';
import { buildToolRegistrations, ToolRegistry } from '../src/server.js';
import { jsonResponse, mockFetch, mockFetchRecording, restoreMockFetch, route } from './helpers/mock-fetch.js';

const AUTH = { baseUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'token' };

function registry(readOnly: boolean): ToolRegistry {
  const registrations = buildToolRegistrations({
    jira: new JiraClient(AUTH),
    confluence: new ConfluenceClient(AUTH),
    contentDirs: [],
  });
  return new ToolRegistry(registrations, { readOnly });
}

afterEach(() => {
  restoreMockFetch();
});

describe('Tool registry', () => {
  describe('when listing tools', () => {
    it('should expose every tool with an object schema and annotations', () => {
      const tools = registry(false).list();

      assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        [
          'add_confluence_comment',
          'add_confluence_inline_comment',
          'add_jira_comment',
          'create_confluence_page',
          'move_confluence_page',
          'read_confluence_image',
          'read_confluence_page',
          'read_jira_ticket',
          'search_confluence',
          'search_jira',
          'update_confluence_page',
          'update_jira_issue',
        ],
      );
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object', tool.name);
        assert.equal('$schema' in tool.inputSchema, false, tool.name);
        assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
      }
      const create = tools.find((tool) => tool.name === 'create_confluence_page');
      assert.deepEqual(create?.inputSchema.required, ['title']);
      assert.ok((create?.inputSchema.properties as Record<string, unknown>).parent_id);
    });
  });

  describe('when read-only mode is enabled', () => {
    it('should list only read tools and refuse write tools without calling Atlassian', async () => {
      const readOnly = registry(true);
      const requests = mockFetchRecording([]);

      assert.deepEqual(
        readOnly.list().map((tool) => tool.name).sort(),
        ['read_confluence_image', 'read_confluence_page', 'read_jira_ticket', 'search_confluence', 'search_jira'],
      );
      const result = await readOnly.call('create_confluence_page', { parent_id: '1', title: 'x', content: 'y' });
      assert.equal(result.isError, true);
      assert.match((result.content[0] as { text: string }).text, /disabled because ATLASSIAN_READ_ONLY/);
      assert.equal(requests.length, 0);
    });
  });

  describe('when a tool receives invalid arguments', () => {
    it('should return a readable error result', async () => {
      const result = await registry(false).call('read_jira_ticket', {});

      assert.equal(result.isError, true);
      assert.equal((result.content[0] as { text: string }).text, 'Invalid arguments. input: Provide either url or ticket_key');
    });
  });

  describe('when the Atlassian API fails', () => {
    it('should return the API error as a tool error result', async () => {
      mockFetch([route('/issue/ENG-1', () => jsonResponse({ errorMessages: ['Issue does not exist'] }, 404))]);

      const result = await registry(false).call('read_jira_ticket', { ticket_key: 'ENG-1' });

      assert.equal(result.isError, true);
      assert.match((result.content[0] as { text: string }).text, /Failed to fetch issue ENG-1: 404 .*Issue does not exist/);
    });
  });

  describe('when the tool name is unknown', () => {
    it('should throw a protocol error', async () => {
      await assert.rejects(() => registry(false).call('drop_database', {}), /Unknown tool: drop_database/);
    });
  });
});
