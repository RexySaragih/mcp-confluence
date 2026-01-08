# Jira & Confluence MCP Server

A TypeScript MCP server that enables Cursor to read Jira tickets and Confluence pages, converting them to markdown and breaking them into actionable plans.

## Features

| Tool | Description |
|------|-------------|
| `read_jira_ticket` | Fetches Jira issue details (summary, status, assignee, subtasks, description) and returns markdown |
| `read_confluence_page` | Fetches Confluence page content and returns markdown |
| `breakdown_to_plan` | Transforms Jira/Confluence content into structured actionable tasks |

## Prerequisites

- Node.js 18+ (uses built-in `fetch`)
- Atlassian Cloud account with:
  - Email address
  - [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
  - Base URL (e.g., `https://yourcompany.atlassian.net`)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
ATLASSIAN_EMAIL=your-email@company.com
ATLASSIAN_API_TOKEN=your-api-token
ATLASSIAN_BASE_URL=https://yourcompany.atlassian.net
```

### 3. Build

```bash
npm run build
```

### 4. Run (stdio MCP)

```bash
npm start
```

You should see: `MCP server ready (stdio)`.

## Cursor Configuration

Add the following to `~/.cursor/mcp.json`:

### Option 1: Inline environment variables

```json
{
  "mcpServers": {
    "jira-confluence": {
      "command": "node",
      "args": ["/path/to/confluence-mcp-server/dist/index.js"],
      "env": {
        "ATLASSIAN_EMAIL": "your-email@company.com",
        "ATLASSIAN_API_TOKEN": "your-api-token",
        "ATLASSIAN_BASE_URL": "https://yourcompany.atlassian.net"
      }
    }
  }
}
```

### Option 2: Using `.env` file

If you prefer to keep credentials in a `.env` file (created during setup), you can omit the `env` block. The server automatically loads `.env` from the project root:

```json
{
  "mcpServers": {
    "jira-confluence": {
      "command": "node",
      "args": ["/path/to/confluence-mcp-server/dist/index.js"]
    }
  }
}
```

Make sure your `.env` file exists in the project root with:

```env
ATLASSIAN_EMAIL=your-email@company.com
ATLASSIAN_API_TOKEN=your-api-token
ATLASSIAN_BASE_URL=https://yourcompany.atlassian.net
```

> **Note:** Replace `/path/to/confluence-mcp-server` with the actual path to this project. Environment variables in `mcp.json` take precedence over `.env` if both are provided.

## Tool Usage

### read_jira_ticket

Accepts either a URL or issue key:

```
url: "https://yourcompany.atlassian.net/browse/PROJ-123"
```

or

```
ticket_key: "PROJ-123"
```

### read_confluence_page

Accepts either a URL or page ID:

```
url: "https://yourcompany.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title"
```

or

```
page_id: "123456"
```

### breakdown_to_plan

Pass fetched content to generate a structured plan:

```
content: "<content from Jira or Confluence>"
format: "text" | "markdown"
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled MCP server |
| `npm run dev` | Run directly with ts-node (development) |
| `npm run test:connections` | Test Atlassian API connectivity |

## Notes

- All three environment variables are required; missing values will fail startup.
- Server uses stdio transport only; no HTTP port is opened.
- Content is converted from Atlassian storage format to markdown using [Turndown](https://github.com/mixmark-io/turndown).
