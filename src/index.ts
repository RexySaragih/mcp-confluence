#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { readJiraTicketTool, handleReadJiraTicket } from './tools/jira.js';
import { readConfluencePageTool, handleReadConfluencePage } from './tools/confluence.js';
import { readConfluenceImageTool, handleReadConfluenceImage } from './tools/confluence-image.js';
import { searchJiraTool, handleSearchJira } from './tools/jira-search.js';
import { searchConfluenceTool, handleSearchConfluence } from './tools/confluence-search.js';
import { updateJiraIssueTool, handleUpdateJiraIssue } from './tools/jira-write.js';
import { updateConfluencePageTool, handleUpdateConfluencePage } from './tools/confluence-write.js';
import { addJiraCommentTool, handleAddJiraComment } from './tools/jira-comment.js';
import {
  addConfluenceCommentTool,
  addConfluenceInlineCommentTool,
  handleAddConfluenceComment,
  handleAddConfluenceInlineComment,
} from './tools/confluence-comment.js';
import { JiraClient } from './clients/jira-client.js';
import { ConfluenceClient } from './clients/confluence-client.js';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type ToolResponse = { content: Content[] };

const server = new Server(
  {
    name: 'jira-confluence-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

function buildClients() {
  const email = requireEnv('ATLASSIAN_EMAIL');
  const apiToken = requireEnv('ATLASSIAN_API_TOKEN');
  const baseUrl = requireEnv('ATLASSIAN_BASE_URL');

  const jiraClient = new JiraClient({ baseUrl, email, apiToken });
  const confluenceClient = new ConfluenceClient({ baseUrl, email, apiToken });

  return { jiraClient, confluenceClient };
}

async function start() {
  try {
    const { jiraClient, confluenceClient } = buildClients();
    const tools = [
      searchJiraTool,
      searchConfluenceTool,
      readJiraTicketTool,
      readConfluencePageTool,
      readConfluenceImageTool,
      addJiraCommentTool,
      addConfluenceCommentTool,
      addConfluenceInlineCommentTool,
      updateJiraIssueTool,
      updateConfluencePageTool,
    ];
    const toolHandlers: Record<
      string,
      (args: unknown) => Promise<ToolResponse>
    > = {
      search_jira: (args) => handleSearchJira(jiraClient, args),
      search_confluence: (args) => handleSearchConfluence(confluenceClient, args),
      read_jira_ticket: (args) => handleReadJiraTicket(jiraClient, args),
      read_confluence_page: (args) => handleReadConfluencePage(confluenceClient, args),
      read_confluence_image: (args) => handleReadConfluenceImage(confluenceClient, args),
      add_jira_comment: (args) => handleAddJiraComment(jiraClient, args),
      add_confluence_comment: (args) => handleAddConfluenceComment(confluenceClient, args),
      add_confluence_inline_comment: (args) =>
        handleAddConfluenceInlineComment(confluenceClient, args),
      update_jira_issue: (args) => handleUpdateJiraIssue(jiraClient, args),
      update_confluence_page: (args) => handleUpdateConfluencePage(confluenceClient, args),
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = toolHandlers[name];
      if (!handler) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
      try {
        return await handler(args);
      } catch (error: any) {
        if (error instanceof McpError) throw error;
        throw new McpError(ErrorCode.InternalError, error?.message ?? 'Unknown tool error');
      }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP server ready (stdio)');
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

start();

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
