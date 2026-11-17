import { Marked, type RendererObject, type RendererThis, type Token, type Tokens } from 'marked';
import { decodeHtmlEntities, escapeXml } from './html-text.js';

export interface StorageConversionContext {
  baseUrl?: string;
  /** Page being written. Its attachment URLs become <ri:attachment> references. */
  pageId?: string;
}

type Lexer = (markdown: string) => Token[];

interface ExpandToken {
  type: typeof EXPAND_TOKEN;
  raw: string;
  title: string;
  tokens: Token[];
}

interface PanelMatch {
  macro: string;
  title: string;
  tokens: Token[];
}

const EXPAND_TOKEN = 'confluenceExpand';
const DEFAULT_CODE_LANGUAGE = 'none';
const DETAILS_OPEN = /^\s*<details\b[^>]*>\s*(?:<summary\b[^>]*>([\s\S]*?)<\/summary>)?\s*$/i;
const DETAILS_CLOSE = /^\s*<\/details>\s*$/i;
const DETAILS_WHOLE = /^\s*<details\b[^>]*>\s*(?:<summary\b[^>]*>([\s\S]*?)<\/summary>)?([\s\S]*?)<\/details>\s*$/i;
const GITHUB_ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const PANEL_LABEL = /^(info|note|warning|tip|success|error|panel)(?:\s*:\s*(.*?))?\s*:?$/i;
const ATTACHMENT_PATH = /\/wiki\/download\/(?:attachments|thumbnails)\/(\d+)\/([^?#]+)/;
const HTML_TAG = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const HTML_ATTRIBUTE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const BARE_AMPERSAND = /&(?!(?:[a-z][a-z0-9]*|#\d+|#x[\da-f]+);)/gi;

const GITHUB_ALERT_MACROS: Record<string, string> = {
  NOTE: 'info',
  TIP: 'tip',
  IMPORTANT: 'note',
  WARNING: 'note',
  CAUTION: 'warning',
};

const PANEL_MACROS: Record<string, string> = {
  info: 'info',
  note: 'note',
  warning: 'warning',
  tip: 'tip',
  success: 'tip',
  error: 'warning',
  panel: 'panel',
};

const ALLOWED_HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const VOID_HTML_TAGS = new Set(['br', 'hr']);

/**
 * Converts Markdown to Confluence storage format. The output is well-formed
 * XHTML: void elements are self-closed, attribute values are escaped, and
 * unknown raw HTML is escaped as text.
 */
export function markdownToConfluenceStorage(markdown: string, context: StorageConversionContext = {}): string {
  const marked = new Marked({ gfm: true, breaks: true });
  const lexer: Lexer = (source) => marked.lexer(source);
  let lastTaskId = 0;
  marked.use({
    renderer: createRenderer(context, lexer, () => ++lastTaskId),
    extensions: [{ name: EXPAND_TOKEN, renderer: renderExpand }],
    hooks: { processAllTokens: (tokens) => groupDetailsBlocks(tokens, lexer) },
  });
  return marked.parse(markdown, { async: false }) as string;
}

function createRenderer(context: StorageConversionContext, lexer: Lexer, nextTaskId: () => number): RendererObject {
  return {
    code: ({ text, lang }) => codeMacro(text, lang),
    br: () => '<br />',
    hr: () => '<hr />\n',
    checkbox: ({ checked }) => (checked ? '[x]' : '[ ]'),
    html: ({ text }) => sanitizeHtml(text),
    image: ({ href, title, text }) => imageMarkup(href, title, text, context),
    link(token) {
      return linkMarkup(token, this.parser.parseInline(token.tokens));
    },
    table(token) {
      const cells = (row: Tokens.TableCell[], tag: 'th' | 'td') =>
        row.map((cell) => `<${tag}>${this.parser.parseInline(cell.tokens)}</${tag}>`).join('');
      const rows = token.rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('');
      return `<table><tbody><tr>${cells(token.header, 'th')}</tr>${rows}</tbody></table>\n`;
    },
    list(token) {
      if (!token.items.length || !token.items.every((item) => item.task)) return false;
      const tasks = token.items.map((item) => {
        const body = this.parser.parse(item.tokens, !!item.loose).trim();
        const status = item.checked ? 'complete' : 'incomplete';
        return `<ac:task><ac:task-id>${nextTaskId()}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body>${body}</ac:task-body></ac:task>`;
      });
      return `<ac:task-list>${tasks.join('')}</ac:task-list>\n`;
    },
    blockquote(token) {
      const panel = detectPanel(token, lexer);
      if (!panel) return false;
      return structuredMacro(panel.macro, panel.title, this.parser.parse(panel.tokens));
    },
  };
}

function renderExpand(this: RendererThis, token: Tokens.Generic): string {
  const expand = token as unknown as ExpandToken;
  return structuredMacro('expand', expand.title, this.parser.parse(expand.tokens));
}

function structuredMacro(name: string, title: string, body: string): string {
  const titleParameter = title ? `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>` : '';
  return `<ac:structured-macro ac:name="${name}" ac:schema-version="1">${titleParameter}<ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>\n`;
}

function codeMacro(code: string, lang: string | undefined): string {
  const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() || DEFAULT_CODE_LANGUAGE;
  return `<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter><ac:plain-text-body>${cdata(code)}</ac:plain-text-body></ac:structured-macro>\n`;
}

/** CDATA cannot contain "]]>", so the sequence is split across two sections. */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

function linkMarkup(token: Tokens.Link, text: string): string {
  let href: string;
  try {
    href = encodeURI(token.href).replace(/%25/g, '%');
  } catch {
    return text;
  }
  const title = token.title ? ` title="${escapeXml(token.title)}"` : '';
  return `<a href="${escapeXml(href)}"${title}>${text}</a>`;
}

function imageMarkup(href: string, title: string | null, alt: string, context: StorageConversionContext): string {
  const attributes = `ac:alt="${escapeXml(alt)}"${title ? ` ac:title="${escapeXml(title)}"` : ''}`;
  const filename = ownAttachmentFilename(href, context);
  if (filename) {
    return `<ac:image ${attributes}><ri:attachment ri:filename="${escapeXml(filename)}" /></ac:image>`;
  }
  if (/^https?:\/\//i.test(href)) {
    return `<ac:image ${attributes}><ri:url ri:value="${escapeXml(href)}" /></ac:image>`;
  }
  return escapeXml(`[Image not uploaded: ${alt || href}]`);
}

function ownAttachmentFilename(href: string, context: StorageConversionContext): string | undefined {
  if (!context.baseUrl || !context.pageId || !href.startsWith(context.baseUrl)) return undefined;
  const match = href.match(ATTACHMENT_PATH);
  if (!match || match[1] !== context.pageId) return undefined;
  try {
    return decodeURIComponent(match[2]);
  } catch {
    return undefined;
  }
}

function detectPanel(token: Tokens.Blockquote, lexer: Lexer): PanelMatch | undefined {
  const [first, ...rest] = token.tokens;
  if (first?.type !== 'paragraph') return undefined;
  const paragraph = first as Tokens.Paragraph;
  return githubAlert(paragraph, rest, lexer) ?? labelledPanel(paragraph, rest, lexer);
}

function githubAlert(paragraph: Tokens.Paragraph, rest: Token[], lexer: Lexer): PanelMatch | undefined {
  const match = GITHUB_ALERT.exec(paragraph.raw);
  if (!match) return undefined;
  const remainder = paragraph.raw.slice(match[0].length).trim();
  const macro = GITHUB_ALERT_MACROS[match[1].toUpperCase()];
  return { macro, title: '', tokens: [...(remainder ? lexer(remainder) : []), ...rest] };
}

function labelledPanel(paragraph: Tokens.Paragraph, rest: Token[], lexer: Lexer): PanelMatch | undefined {
  const label = paragraph.tokens[0];
  if (label?.type !== 'strong') return undefined;
  const match = PANEL_LABEL.exec((label as Tokens.Strong).text.trim());
  if (!match) return undefined;
  const remainder = paragraph.raw.slice(label.raw.length).replace(/^:?\s*/, '').trim();
  return {
    macro: PANEL_MACROS[match[1].toLowerCase()],
    title: match[2]?.trim() ?? '',
    tokens: [...(remainder ? lexer(remainder) : []), ...rest],
  };
}

/** Turns <details><summary>…</summary> … </details> blocks into expand macros. */
function groupDetailsBlocks(tokens: Token[], lexer: Lexer): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'html') {
      result.push(token);
      continue;
    }
    const whole = DETAILS_WHOLE.exec(token.raw);
    if (whole) {
      result.push(expandToken(token.raw, whole[1], groupDetailsBlocks(lexer(whole[2]), lexer)));
      continue;
    }
    const open = DETAILS_OPEN.exec(token.raw);
    const close = open ? findDetailsClose(tokens, index + 1) : -1;
    if (!open || close === -1) {
      result.push(token);
      continue;
    }
    const inner = groupDetailsBlocks(tokens.slice(index + 1, close), lexer);
    const raw = tokens.slice(index, close + 1).map((item) => item.raw).join('');
    result.push(expandToken(raw, open[1], inner));
    index = close;
  }
  return result;
}

function findDetailsClose(tokens: Token[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'html') continue;
    if (DETAILS_OPEN.test(token.raw)) depth += 1;
    else if (DETAILS_CLOSE.test(token.raw)) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function expandToken(raw: string, summary: string | undefined, tokens: Token[]): Token {
  const title = decodeHtmlEntities((summary ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const token: ExpandToken = { type: EXPAND_TOKEN, raw, title, tokens };
  return token as unknown as Token;
}

function sanitizeHtml(html: string): string {
  // exec() is used instead of matchAll() because older TypeScript libs type a matchAll index as optional.
  const tagPattern = new RegExp(HTML_TAG.source, 'g');
  let output = '';
  let lastIndex = 0;
  for (let match = tagPattern.exec(html); match !== null; match = tagPattern.exec(html)) {
    output += escapeTextSegment(html.slice(lastIndex, match.index));
    output += convertHtmlTag(match[0], match[1], match[2] ?? '');
    lastIndex = match.index + match[0].length;
  }
  return output + escapeTextSegment(html.slice(lastIndex));
}

function convertHtmlTag(raw: string, name: string | undefined, attributes: string): string {
  if (!name) return '';
  const tag = name.toLowerCase();
  if (!ALLOWED_HTML_TAGS.has(tag)) return escapeXml(raw);
  if (raw.startsWith('</')) return VOID_HTML_TAGS.has(tag) ? '' : `</${tag}>`;
  const normalized = normalizeAttributes(attributes);
  return VOID_HTML_TAGS.has(tag) ? `<${tag}${normalized} />` : `<${tag}${normalized}>`;
}

function normalizeAttributes(attributes: string): string {
  let output = '';
  for (const match of attributes.matchAll(HTML_ATTRIBUTE)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    output += ` ${match[1].toLowerCase()}="${escapeXml(decodeHtmlEntities(value))}"`;
  }
  return output;
}

function escapeTextSegment(text: string): string {
  return text.replace(BARE_AMPERSAND, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
