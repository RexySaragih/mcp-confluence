import { fencedCode, MarkdownTableCell, normalizeCellText, renderMarkdownTable } from './markdown-format.js';

interface AdfMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
}

const PANEL_LABELS: Record<string, string> = {
  info: 'Info',
  note: 'Note',
  warning: 'Warning',
  success: 'Tip',
  tip: 'Tip',
  error: 'Error',
};

const INLINE_TYPES = new Set([
  'text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status', 'date', 'mediaInline', 'placeholder', 'inlineExtension',
]);

const MARK_ORDER: Record<string, number> = { code: 0, em: 1, strong: 1, strike: 1, link: 2 };

type BlockRenderer = (node: AdfNode) => string;

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  paragraph: (node) => renderInline(node.content),
  heading: renderHeading,
  bulletList: (node) => renderList(node, () => '-'),
  orderedList: (node) => renderList(node, (index) => `${orderedStart(node) + index}.`),
  taskList: (node) => renderList(node, (_index, item) => (item.attrs?.state === 'DONE' ? '- [x]' : '- [ ]')),
  decisionList: (node) => renderList(node, () => '- Decision:'),
  blockquote: (node) => prefixLines(renderBlocks(node.content), '> '),
  codeBlock: (node) => fencedCode(stringAttr(node, 'language'), plainText(node)),
  rule: () => '---',
  panel: renderPanel,
  table: renderTable,
  expand: renderExpand,
  nestedExpand: renderExpand,
  mediaSingle: (node) => renderBlocks(node.content),
  mediaGroup: (node) => renderBlocks(node.content),
  media: renderMedia,
  blockCard: (node) => stringAttr(node, 'url'),
  embedCard: (node) => stringAttr(node, 'url'),
  extension: (node) => `_[Jira extension: ${stringAttr(node, 'extensionKey') || 'unknown'}]_`,
  bodiedExtension: (node) => renderBlocks(node.content),
};

/** Converts an Atlassian Document Format value (Jira descriptions and comments) to Markdown. */
export function adfToMarkdown(adf: unknown): string {
  if (typeof adf === 'string') return adf.trim();
  if (!adf || typeof adf !== 'object') return '';
  const node = adf as AdfNode;
  const blocks = node.type === 'doc' ? node.content : [node];
  return renderBlocks(blocks).trim();
}

function renderBlocks(nodes: AdfNode[] = []): string {
  return nodes
    .map(renderBlock)
    .filter((block) => block.trim() !== '')
    .join('\n\n');
}

function renderBlock(node: AdfNode): string {
  const renderer = node.type ? BLOCK_RENDERERS[node.type] : undefined;
  if (renderer) return renderer(node);
  if (node.type && INLINE_TYPES.has(node.type)) return renderInlineNode(node);
  return renderBlocks(node.content);
}

function renderHeading(node: AdfNode): string {
  const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
  return `${'#'.repeat(level)} ${renderInline(node.content)}`;
}

function renderList(node: AdfNode, marker: (index: number, item: AdfNode) => string): string {
  return (node.content ?? []).map((item, index) => renderListItem(item, marker(index, item))).join('\n');
}

function renderListItem(item: AdfNode, marker: string): string {
  const content = item.content ?? [];
  const body = content.every(isInline)
    ? renderInline(content)
    : content.map(renderBlock).filter((block) => block.trim() !== '').join('\n');
  const indent = ' '.repeat(marker.length + 1);
  const [first = '', ...rest] = body.split('\n');
  return [`${marker} ${first}`, ...rest.map((line) => (line ? `${indent}${line}` : line))].join('\n');
}

function renderPanel(node: AdfNode): string {
  const label = PANEL_LABELS[stringAttr(node, 'panelType')] ?? 'Panel';
  return prefixLines(`**${label}**\n\n${renderBlocks(node.content)}`, '> ');
}

function renderExpand(node: AdfNode): string {
  const title = stringAttr(node, 'title') || 'Details';
  return `<details>\n<summary>${title}</summary>\n\n${renderBlocks(node.content)}\n\n</details>`;
}

function renderMedia(node: AdfNode): string {
  const alt = stringAttr(node, 'alt');
  const url = stringAttr(node, 'url');
  if (url) return `![${alt}](${url})`;
  return `[Attachment: ${alt || stringAttr(node, 'id') || 'file'}]`;
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell): MarkdownTableCell => ({
      text: normalizeCellText(renderBlocks(cell.content)),
      rowspan: Number(cell.attrs?.rowspan),
      colspan: Number(cell.attrs?.colspan),
    })),
  );
  return renderMarkdownTable(rows);
}

function renderInline(nodes: AdfNode[] = []): string {
  return nodes.map(renderInlineNode).join('');
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'mention': {
      const text = stringAttr(node, 'text');
      if (!text) return '@user';
      return text.startsWith('@') ? text : `@${text}`;
    }
    case 'emoji':
      return stringAttr(node, 'text') || stringAttr(node, 'shortName');
    case 'inlineCard':
      return stringAttr(node, 'url');
    case 'status':
      return `[${stringAttr(node, 'text')}]`;
    case 'date':
      return formatTimestamp(node.attrs?.timestamp);
    case 'mediaInline':
      return renderMedia(node);
    case 'placeholder':
      return '';
    default:
      return renderInline(node.content);
  }
}

function applyMarks(text: string, marks: AdfMark[] = []): string {
  const [, leading, core, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? ['', '', text, ''];
  if (!core) return text;
  const ordered = marks
    .filter((mark) => mark.type && mark.type in MARK_ORDER)
    .sort((a, b) => MARK_ORDER[a.type!] - MARK_ORDER[b.type!]);
  const marked = ordered.reduce((value, mark) => wrapMark(value, mark), core);
  return `${leading}${marked}${trailing}`;
}

function wrapMark(value: string, mark: AdfMark): string {
  switch (mark.type) {
    case 'code':
      return value.includes('`') ? `\`\` ${value} \`\`` : `\`${value}\``;
    case 'strong':
      return `**${value}**`;
    case 'em':
      return `_${value}_`;
    case 'strike':
      return `~~${value}~~`;
    case 'link': {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
      return href ? `[${value}](${href})` : value;
    }
    default:
      return value;
  }
}

function isInline(node: AdfNode): boolean {
  return !!node.type && INLINE_TYPES.has(node.type);
}

function plainText(node: AdfNode): string {
  return (node.content ?? []).map((child) => child.text ?? plainText(child)).join('');
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');
}

function orderedStart(node: AdfNode): number {
  const order = Number(node.attrs?.order);
  return Number.isInteger(order) && order > 0 ? order : 1;
}

function stringAttr(node: AdfNode, name: string): string {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value : '';
}

function formatTimestamp(value: unknown): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
}
