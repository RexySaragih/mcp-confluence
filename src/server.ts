import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { ConfluenceClient } from './clients/confluence-client.js';
import { JiraClient } from './clients/jira-client.js';
import { addConfluenceCommentTool, addConfluenceInlineCommentTool, handleAddConfluenceComment, handleAddConfluenceInlineComment } from './tools/confluence-comment.js';
import { createConfluencePageTool, handleCreateConfluencePage } from './tools/confluence-create.js';
import { handleReadConfluenceImage, readConfluenceImageTool } from './tools/confluence-image.js';
import { handleMoveConfluencePage, moveConfluencePageTool } from './tools/confluence-move.js';
import { handleSearchConfluence, searchConfluenceTool } from './tools/confluence-search.js';
import { handleUpdateConfluencePage, updateConfluencePageTool } from './tools/confluence-write.js';
import { handleReadConfluencePage, readConfluencePageTool } from './tools/confluence.js';
import { addJiraCommentTool, handleAddJiraComment } from './tools/jira-comment.js';
import { handleSearchJira, searchJiraTool } from './tools/jira-search.js';
import { handleUpdateJiraIssue, updateJiraIssueTool } from './tools/jira-write.js';
import { handleReadJiraTicket, readJiraTicketTool } from './tools/jira.js';
import { PageWriteOptions } from './tools/page-content.js';
import { errorResult, ToolDefinition, ToolResult } from './tools/tool-definition.js';

export interface ToolRegistration {
  definition: ToolDefinition;
  handle(args: unknown): Promise<ToolResult>;
}

export interface ToolDependencies extends PageWriteOptions {
  jira: JiraClient;
  confluence: ConfluenceClient;
}

export function buildToolRegistrations(deps: ToolDependencies): ToolRegistration[] {
  const { jira, confluence } = deps;
  const writeOptions: PageWriteOptions = { contentDirs: deps.contentDirs };
  return [
    { definition: searchJiraTool, handle: (args) => handleSearchJira(jira, args) },
    { definition: searchConfluenceTool, handle: (args) => handleSearchConfluence(confluence, args) },
    { definition: readJiraTicketTool, handle: (args) => handleReadJiraTicket(jira, args) },
    { definition: readConfluencePageTool, handle: (args) => handleReadConfluencePage(confluence, args) },
    { definition: readConfluenceImageTool, handle: (args) => handleReadConfluenceImage(confluence, args) },
    { definition: addJiraCommentTool, handle: (args) => handleAddJiraComment(jira, args) },
    { definition: addConfluenceCommentTool, handle: (args) => handleAddConfluenceComment(confluence, args) },
    { definition: addConfluenceInlineCommentTool, handle: (args) => handleAddConfluenceInlineComment(confluence, args) },
    { definition: updateJiraIssueTool, handle: (args) => handleUpdateJiraIssue(jira, args) },
    { definition: createConfluencePageTool, handle: (args) => handleCreateConfluencePage(confluence, args, writeOptions) },
    { definition: updateConfluencePageTool, handle: (args) => handleUpdateConfluencePage(confluence, args, writeOptions) },
    { definition: moveConfluencePageTool, handle: (args) => handleMoveConfluencePage(confluence, args) },
  ];
}

export class ToolRegistry {
  private readonly enabled = new Map<string, ToolRegistration>();
  private readonly disabled = new Set<string>();

  constructor(registrations: ToolRegistration[], options: { readOnly: boolean }) {
    for (const registration of registrations) {
      const { name, annotations } = registration.definition;
      if (this.enabled.has(name) || this.disabled.has(name)) {
        throw new Error(`Duplicate tool name: ${name}`);
      }
      if (options.readOnly && !annotations.readOnlyHint) {
        this.disabled.add(name);
      } else {
        this.enabled.set(name, registration);
      }
    }
  }

  list(): ToolDefinition[] {
    return [...this.enabled.values()].map((registration) => registration.definition);
  }

  async call(name: string, args: unknown): Promise<ToolResult> {
    const registration = this.enabled.get(name);
    if (!registration) {
      if (this.disabled.has(name)) {
        return errorResult(`Tool ${name} is disabled because ATLASSIAN_READ_ONLY is enabled.`);
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    try {
      return await registration.handle(args ?? {});
    } catch (error) {
      const message = formatToolError(error);
      console.error(`Tool ${name} failed: ${message}`);
      return errorResult(message);
    }
  }
}

export function formatToolError(error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'input';
      return `${path}: ${issue.message}`;
    });
    return `Invalid arguments. ${issues.join('; ')}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createMcpServer(registry: ToolRegistry, version: string): Server {
  const server = new Server(
    { name: 'jira-confluence-mcp', version },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.list() }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => (await registry.call(request.params.name, request.params.arguments)) as CallToolResult,
  );
  return server;
}
