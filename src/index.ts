import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { readJiraTicketTool, handleReadJiraTicket } from './tools/jira.js';
import { readConfluencePageTool, handleReadConfluencePage } from './tools/confluence.js';
import { breakdownToPlanTool, handleBreakdownToPlan } from './tools/planner.js';
import { JiraClient } from './clients/jira-client.js';
import { ConfluenceClient } from './clients/confluence-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

type Content = { type: 'text'; text: string };
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
    const tools = [readJiraTicketTool, readConfluencePageTool, breakdownToPlanTool];
    const toolHandlers: Record<
      string,
      (args: unknown) => Promise<ToolResponse>
    > = {
      read_jira_ticket: (args) => handleReadJiraTicket(jiraClient, args),
      read_confluence_page: (args) => handleReadConfluencePage(confluenceClient, args),
      breakdown_to_plan: handleBreakdownToPlan,
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

