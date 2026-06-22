# @rexymayderio/jira-confluence-mcp

A TypeScript MCP server for reading and updating Jira tickets and Confluence pages.

Source: [github.com/RexySaragih/mcp-confluence](https://github.com/RexySaragih/mcp-confluence)

## Quick Start

```bash
npx -y @rexymayderio/jira-confluence-mcp
```

No clone or install needed. Just add it to your MCP client config.

## MCP Client Configuration

Add to your MCP settings (Kiro, Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "jira-confluence": {
      "command": "npx",
      "args": ["-y", "@rexymayderio/jira-confluence-mcp"],
      "env": {
        "ATLASSIAN_EMAIL": "your-email@company.com",
        "ATLASSIAN_API_TOKEN": "your-api-token",
        "ATLASSIAN_BASE_URL": "https://yourcompany.atlassian.net"
      }
    }
  }
}
```

All three environment variables are required. Get your API token from [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

## Tools

| Tool | Description |
| ---- | ----------- |
| `search_jira` | Search Jira issues with JQL; returns compact results |
| `search_confluence` | Search Confluence pages by text or CQL |
| `read_jira_ticket` | Fetch ticket details; optional comments and linked issues |
| `read_confluence_page` | Fetch page content as markdown; optional comments |
| `read_confluence_image` | Download an image attachment as base64 |
| `update_jira_issue` | Add a comment and/or transition issue status |
| `update_confluence_page` | Replace or append markdown content on a page |

## Tool Usage

### search_jira

```json
{
  "jql": "project = ENG AND text ~ \"payment retry\" ORDER BY updated DESC",
  "max_results": 15
}
```

```json
{
  "jql": "project = ENG ORDER BY updated DESC",
  "start_at": 15,
  "max_results": 15
}
```

When more results exist, the response includes a `start_at` value to pass on the next call.

### search_confluence

```json
{
  "query": "payment retry design",
  "space_key": "ENG",
  "max_results": 10
}
```

Pass a full CQL query in `query` when you need advanced filters (e.g. `label = "design-doc" AND text ~ "auth"`).

### read_jira_ticket

```json
{ "ticket_key": "PROJ-123" }
```

```json
{
  "url": "https://yourcompany.atlassian.net/browse/PROJ-123",
  "include_comments": true,
  "include_links": true
}
```

Returns type, priority, labels, reporter, parent/epic, and optionally comments and linked issues.

### read_confluence_page

```json
{ "page_id": "123456" }
```

```json
{
  "url": "https://yourcompany.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title",
  "include_comments": true
}
```

**Confluence Macro Support:**

- **Code blocks** — Fenced code blocks with language syntax highlighting
- **Expand/collapse** — Converted to `<details>/<summary>` HTML
- **Info/Note/Warning/Tip panels** — Blockquotes with labels
- **Image attachments** — Full download URLs with captions
- **Internal links** — Preserved as clickable links

### read_confluence_image

```json
{
  "url": "https://yourcompany.atlassian.net/wiki/download/attachments/123456/image.png"
}
```

```json
{ "page_id": "123456", "filename": "image-20260415-222345.png" }
```

### update_jira_issue

```json
{
  "ticket_key": "PROJ-123",
  "comment": "Implemented the retry logic and added tests."
}
```

```json
{
  "ticket_key": "PROJ-123",
  "transition": "In Progress"
}
```

Provide at least one of `comment` or `transition`.

### update_confluence_page

```json
{
  "page_id": "123456",
  "content": "# Updated Section\n\nNew content here.",
  "mode": "replace"
}
```

```json
{
  "page_id": "123456",
  "content": "\n## Changelog\n\n- Added retry logic",
  "mode": "append"
}
```

`mode` defaults to `replace`. Does not create new pages.

## Development

```bash
git clone https://github.com/RexySaragih/mcp-confluence.git
cd mcp-confluence
npm install
npm run build
npm start
```

| Command | Description |
| ------- | ----------- |
| `npm run build` | Compile TypeScript to `dist/` + chmod +x |
| `npm start` | Run the compiled MCP server |
| `npm run dev` | Watch mode (tsc --watch) |
| `npm test` | Compile and run unit tests (dev only; uses Node built-in test runner) |
| `npm run test:watch` | Watch-compile tests |

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- Atlassian Cloud account with API token

## Notes

- Server uses stdio transport — no HTTP port is opened.
- Content is converted from Atlassian storage format to markdown using [Turndown](https://github.com/mixmark-io/turndown) with custom Confluence macro handling.
- Confluence page updates convert markdown to storage format using [marked](https://marked.js.org/).
