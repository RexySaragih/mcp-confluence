# @rexymayderio/jira-confluence-mcp

A TypeScript MCP server for reading and updating Jira issues and Confluence pages, including creating and moving pages in a page tree.

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

| Variable                 | Required | Description                                                                                                                                       |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLASSIAN_EMAIL`        | yes      | Atlassian account email                                                                                                                           |
| `ATLASSIAN_API_TOKEN`    | yes      | API token from [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)                                                |
| `ATLASSIAN_BASE_URL`     | yes      | Site URL, e.g. `https://yourcompany.atlassian.net` (a trailing `/wiki` is removed)                                                                |
| `ATLASSIAN_READ_ONLY`    | no       | `true` hides every tool that writes to Jira or Confluence                                                                                         |
| `ATLASSIAN_CONTENT_DIRS` | no       | Directories `content_file` may read from, separated by `:` (`;` on Windows). When unset, any absolute path with an allowed extension can be read. |

## Tools

| Tool                            | Writes | Description                                                    |
| ------------------------------- | ------ | -------------------------------------------------------------- |
| `search_jira`                   |        | Search Jira issues with JQL; returns compact results           |
| `search_confluence`             |        | Search Confluence by text or CQL, with cursor pagination       |
| `read_jira_ticket`              |        | Fetch an issue; optional comments and linked issues            |
| `read_confluence_page`          |        | Fetch a page as Markdown; optional comments and page hierarchy |
| `read_confluence_image`         |        | Download an image attachment (up to 5 MB)                      |
| `add_jira_comment`              | yes    | Add a Markdown comment without changing issue fields or status |
| `add_confluence_comment`        | yes    | Add a general page comment without changing page content       |
| `add_confluence_inline_comment` | yes    | Comment on exact visible text without changing page content    |
| `update_jira_issue`             | yes    | Add a comment and/or transition the issue status               |
| `create_confluence_page`        | yes    | Create one page under a parent page                            |
| `update_confluence_page`        | yes    | Replace or append page content                                 |
| `move_confluence_page`          | yes    | Move a page under another page in the same space               |

Each tool reports MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Failures are returned as tool results with `isError: true`, so the agent can read the message and correct its arguments.

## Working with page trees

Pages are created one per call, always under a parent page. To build a parent with children:

1. Create the parent with `create_confluence_page` and note the returned page id.
2. Create each child with `parent_id` set to that id.
3. If the parent should link to its children, add the links last with `update_confluence_page` (`mode: "append"`), using the children's returned URLs.

`read_confluence_page` with `include_hierarchy: true` shows where a page sits (its ancestor path) and lists its direct children. `search_confluence` accepts CQL such as `parent = 2066022402` or `ancestor = 1069121538`.

## Tool Usage

### search_jira

```json
{
  "jql": "project = ENG AND text ~ \"payment retry\" ORDER BY updated DESC",
  "max_results": 15
}
```

When more results exist, the response includes a `next_page_token` to pass on the next call with the same `jql`.

### search_confluence

```json
{ "query": "payment retry design", "space_key": "ENG", "max_results": 10 }
```

```json
{ "query": "parent = 2066022402 ORDER BY title" }
```

Plain text searches page content. A query containing a CQL condition (`parent =`, `ancestor =`, `title ~`, `label =`, `lastmodified >`, ...) is sent as CQL; `ORDER BY` is supported. Results are limited to pages unless the query sets `type`. When more results exist, the response includes a `cursor` for the next call.

### read_jira_ticket

```json
{ "ticket_key": "PROJ-123", "include_comments": true, "include_links": true }
```

`url` accepts `…/browse/PROJ-123` and board URLs with `selectedIssue=PROJ-123`. The description and comments are converted from Atlassian Document Format to Markdown, including tables, mentions, links, and panels.

### read_confluence_page

```json
{
  "url": "https://yourcompany.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title",
  "include_comments": true,
  "include_hierarchy": true
}
```

The header lists title, page id, space, version, URL, parent id and labels. Storage format is converted to Markdown:

- Tables become Markdown tables (merged cells are repeated in each row they span)
- Code blocks keep their language and title
- Expand macros become `<details>`, and info/note/warning/tip/panel macros become blockquotes starting with the panel label
- Links to other pages, user mentions, status lozenges, Jira issue macros, dates, task lists and emoticons are kept
- Images link to their attachment download URL with captions
- Macros with no Markdown equivalent (draw.io, children, include, ...) leave a marker such as `[Confluence macro: drawio "Architecture"]`

### read_confluence_image

```json
{
  "url": "https://yourcompany.atlassian.net/wiki/download/attachments/123456/image.png"
}
```

```json
{ "page_id": "123456", "filename": "image-20260415-222345.png" }
```

### add_jira_comment

```json
{
  "ticket_key": "PROJ-123",
  "comment": "Please verify the **retry** behaviour."
}
```

Markdown (paragraphs, lists, code, links, tables) is converted to Jira formatting. Issue fields and status are not changed.

### add_confluence_comment

```json
{
  "page_id": "123456",
  "comment": "**Review complete.** Please address the open question."
}
```

### add_confluence_inline_comment

```json
{
  "page_id": "123456",
  "comment": "This timeout should be configurable.",
  "text_selection": "The timeout is thirty seconds.",
  "match_index": 0
}
```

Inline comments anchor to exact visible text, not line numbers. `match_index` is zero-based; use it when the selected text occurs more than once.

### update_jira_issue

```json
{
  "ticket_key": "PROJ-123",
  "comment": "Implemented the retry logic.",
  "transition": "In Review"
}
```

Provide at least one of `comment` or `transition`. The transition name is checked before the comment is posted, so a wrong name fails without writing anything.

### create_confluence_page

```json
{
  "parent_url": "https://yourcompany.atlassian.net/wiki/spaces/ENG/pages/2066022402",
  "title": "Workflow Execution Log",
  "content": "# Overview\n\n...",
  "labels": ["prd"]
}
```

- A parent (`parent_id` or `parent_url`) is required. The space is taken from the parent; if `space_key` is also given it must match.
- If a page with the same title already exists in the space, the call fails without writing and returns that page's id and URL.
- `status: "draft"` creates a draft visible only to the API token's user.
- The response shows the new page's URL and its path, e.g. `Workflow (1069121538) › [WIP] - Workflow Phase 2 (2066022402) › Workflow Execution Log`.

**Top-level pages** are allowed only when the user explicitly asks for one, and need confirmation:

1. Call with `root_level: true` and `space_key` (no parent). Nothing is created; the response contains a `confirmation_token`.
2. After the user approves, call again with the same arguments plus `confirmation_token`. The token works once, expires after 10 minutes, and only matches the same space, title and status.

### update_confluence_page

```json
{
  "page_id": "123456",
  "content": "# Updated Section\n\nNew content here.",
  "mode": "replace",
  "expected_version": 7
}
```

```json
{
  "page_id": "123456",
  "content": "## Changelog\n\n- Added retry logic",
  "mode": "append"
}
```

- `replace` (default) overwrites the body. `append` adds the new content after the existing body without converting it, so existing macros and formatting are kept.
- `expected_version` (from `read_confluence_page`) makes the update fail if someone changed the page after you read it.
- Images whose URL points at the page's own attachments are written back as attachment references, so reading a page, editing the Markdown, and replacing it keeps its images.
- Does not create pages.

### move_confluence_page

```json
{ "page_id": "2025291789", "target_parent_id": "2066022402" }
```

Moves the page (and its children) to be the last child of the target page. Both pages must be in the same space, and a page cannot be moved under its own descendant. The response shows the path before and after, and the call that undoes the move.

### Page content options (create and update)

| Field            | Description                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `content`        | Page body inline                                                                                                       |
| `content_file`   | Absolute path to a local `.md`, `.markdown`, `.txt`, `.html`, `.xhtml` or `.xml` file (max 1 MB), instead of `content` |
| `content_format` | `markdown` (default) or `storage`                                                                                      |

Markdown supports GitHub-flavoured syntax. Extras:

- `<details><summary>Title</summary> … </details>` becomes an expand macro
- `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!CAUTION]` and blockquotes starting with `**Info**`, `**Note**`, `**Warning**`, `**Tip**` become panel macros
- `- [ ]` / `- [x]` lists become Confluence task lists
- Images need an `http(s)` URL; local image files are not uploaded

Use `content_format: "storage"` to send Confluence storage XHTML directly when you need macros Markdown cannot express.

## Development

```bash
git clone https://github.com/RexySaragih/mcp-confluence.git
cd mcp-confluence
npm install
npm run build
npm start
```

| Command                    | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `npm run build`            | Clean, compile TypeScript to `dist/`, and chmod +x                      |
| `npm start`                | Run the compiled MCP server                                             |
| `npm run dev`              | Watch mode (`tsc --watch`)                                              |
| `npm test`                 | Compile and run unit tests (Node built-in test runner)                  |
| `npm run check:connection` | Check credentials against Jira and Confluence (reads `.env` if present) |

## Requirements

- Node.js 20+
- Atlassian Cloud account with an API token

## Notes

- The server uses stdio transport; no HTTP port is opened.
- Requests time out after 30 seconds. Rate-limited requests (HTTP 429) are retried twice, honouring `Retry-After`.
- Page and issue ids from tool input are validated, and URLs must belong to the configured site.
- Storage format is parsed with an HTML parser ([domino](https://github.com/mixmark-io/domino)) and converted with [Turndown](https://github.com/mixmark-io/turndown). Markdown is converted with [marked](https://marked.js.org/).
