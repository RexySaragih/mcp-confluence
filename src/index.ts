#!/usr/bin/env node
import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfluenceClient } from './clients/confluence-client.js';
import { JiraClient } from './clients/jira-client.js';
import { loadConfig } from './config.js';
import { buildToolRegistrations, createMcpServer, ToolRegistry } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const auth = { baseUrl: config.baseUrl, email: config.email, apiToken: config.apiToken };
  const registrations = buildToolRegistrations({
    jira: new JiraClient(auth),
    confluence: new ConfluenceClient(auth),
    contentDirs: config.contentDirs,
  });
  const registry = new ToolRegistry(registrations, { readOnly: config.readOnly });
  const version = packageVersion();
  const server = createMcpServer(registry, version);

  await server.connect(new StdioServerTransport());
  console.error(`jira-confluence-mcp ${version} ready (stdio${config.readOnly ? ', read-only' : ''})`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../package.json') as { version: string }).version;
}

main().catch((error: unknown) => {
  console.error('Failed to start MCP server:', error instanceof Error ? error.message : error);
  process.exit(1);
});
