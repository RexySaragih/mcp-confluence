import { Marked, type Token, type Tokens } from 'marked';
import { decodeHtmlEntities } from './html-text.js';

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

const BREAK_TAG = /^<br\s*\/?>$/i;

/** Converts Markdown to an Atlassian Document Format document for Jira comments. */
export function markdownToAdf(markdown: string): AdfDocument {
  const tokens = new Marked({ gfm: true, breaks: true }).lexer(markdown);
  const content = blocks(tokens);
  return { type: 'doc', version: 1, content: content.length ? content : [paragraph([])] };
}

function blocks(tokens: Token[] = []): AdfNode[] {
  return tokens.flatMap(block);
}

function block(token: Token): AdfNode[] {
  switch (token.type) {
    case 'paragraph':
      return [paragraph(inline((token as Tokens.Paragraph).tokens))];
    case 'text': {
      const text = token as Tokens.Text;
      return [paragraph(text.tokens ? inline(text.tokens) : textNodes(decodeHtmlEntities(text.text)))];
    }
    case 'heading': {
      const heading = token as Tokens.Heading;
      return [{ type: 'heading', attrs: { level: heading.depth }, content: inline(heading.tokens) }];
    }
    case 'code':
      return [codeBlock(token as Tokens.Code)];
    case 'blockquote':
      return [{ type: 'blockquote', content: blocks((token as Tokens.Blockquote).tokens) }];
    case 'list':
      return [list(token as Tokens.List)];
    case 'hr':
      return [{ type: 'rule' }];
    case 'table':
      return [table(token as Tokens.Table)];
    case 'space':
    case 'def':
      return [];
    default:
      return token.raw.trim() ? [paragraph(textNodes(token.raw.trim()))] : [];
  }
}

function paragraph(content: AdfNode[]): AdfNode {
  return { type: 'paragraph', content };
}

function codeBlock(token: Tokens.Code): AdfNode {
  const language = (token.lang ?? '').trim().split(/\s+/)[0];
  return {
    type: 'codeBlock',
    ...(language ? { attrs: { language } } : {}),
    content: token.text ? [{ type: 'text', text: token.text }] : [],
  };
}

function list(token: Tokens.List): AdfNode {
  const ordered = token.ordered;
  const start = typeof token.start === 'number' ? token.start : 1;
  return {
    type: ordered ? 'orderedList' : 'bulletList',
    ...(ordered ? { attrs: { order: start } } : {}),
    content: token.items.map(listItem),
  };
}

function listItem(item: Tokens.ListItem): AdfNode {
  const content = blocks(item.tokens);
  if (content[0]?.type !== 'paragraph') content.unshift(paragraph([]));
  if (item.task) {
    content[0].content = [{ type: 'text', text: item.checked ? '[x] ' : '[ ] ' }, ...(content[0].content ?? [])];
  }
  return { type: 'listItem', content };
}

function table(token: Tokens.Table): AdfNode {
  const row = (cells: Tokens.TableCell[], type: 'tableHeader' | 'tableCell'): AdfNode => ({
    type: 'tableRow',
    content: cells.map((cell) => ({ type, attrs: {}, content: [paragraph(inline(cell.tokens))] })),
  });
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [row(token.header, 'tableHeader'), ...token.rows.map((cells) => row(cells, 'tableCell'))],
  };
}

function inline(tokens: Token[] = [], marks: AdfMark[] = []): AdfNode[] {
  return tokens.flatMap((token) => inlineToken(token, marks));
}

function inlineToken(token: Token, marks: AdfMark[]): AdfNode[] {
  switch (token.type) {
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens ? inline(text.tokens, marks) : textNodes(decodeHtmlEntities(text.text), marks);
    }
    case 'escape':
      return textNodes((token as Tokens.Escape).text, marks);
    case 'strong':
      return inline((token as Tokens.Strong).tokens, [...marks, { type: 'strong' }]);
    case 'em':
      return inline((token as Tokens.Em).tokens, [...marks, { type: 'em' }]);
    case 'del':
      return inline((token as Tokens.Del).tokens, [...marks, { type: 'strike' }]);
    case 'codespan': {
      // ADF only allows the code mark together with a link mark.
      const linkMarks = marks.filter((mark) => mark.type === 'link');
      return textNodes(decodeHtmlEntities((token as Tokens.Codespan).text), [...linkMarks, { type: 'code' }]);
    }
    case 'link': {
      const link = token as Tokens.Link;
      return inline(link.tokens, [...marks, linkMark(link.href)]);
    }
    case 'image': {
      const image = token as Tokens.Image;
      return textNodes(image.text || image.href, [...marks, linkMark(image.href)]);
    }
    case 'br':
      return [{ type: 'hardBreak' }];
    case 'html':
      return BREAK_TAG.test(token.raw.trim()) ? [{ type: 'hardBreak' }] : textNodes(token.raw, marks);
    default:
      return token.raw ? textNodes(token.raw, marks) : [];
  }
}

function linkMark(href: string): AdfMark {
  return { type: 'link', attrs: { href } };
}

function textNodes(text: string, marks: AdfMark[] = []): AdfNode[] {
  if (!text) return [];
  return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }];
}
