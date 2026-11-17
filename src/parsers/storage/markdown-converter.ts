import TurndownService from 'turndown';
import { fencedCode, MarkdownTableCell, normalizeCellText, renderMarkdownTable } from '../markdown-format.js';
import { childElements } from './dom.js';

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as TurndownService.Filter;
const TABLE_SECTIONS = new Set(['THEAD', 'TBODY', 'TFOOT']);
const TABLE_CELLS = new Set(['TD', 'TH']);

export function createMarkdownConverter(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---',
  });
  service.escape = escapeLineStartMarkdown;
  service.remove(['style', 'script']);

  service.addRule('heading', {
    filter: HEADINGS,
    replacement: (content, node) => {
      const level = Number(node.nodeName.charAt(1));
      const text = content.replace(/\s+/g, ' ').trim();
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '';
    },
  });

  // Turndown pads list markers to four columns ("-   item"); one space reads better and is still CommonMark.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const prefix = listItemPrefix(node, options.bulletListMarker ?? '-');
      const indent = ' '.repeat(prefix.length);
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, `\n${indent}`);
      return `${prefix}${body}${node.nextSibling && !body.endsWith('\n') ? '\n' : ''}`;
    },
  });

  service.addRule('confluenceCode', {
    filter: (node) => node.nodeName === 'PRE' && node.hasAttribute('data-language'),
    replacement: (_content, node) =>
      `\n\n${fencedCode(codeLanguage((node as HTMLElement).getAttribute('data-language')), node.textContent ?? '')}\n\n`,
  });

  // Turndown escapes parentheses in URLs as "\(", which many readers keep literally; percent-encoding is unambiguous.
  service.addRule('link', {
    filter: (node) => node.nodeName === 'A' && !!(node as HTMLElement).getAttribute('href'),
    replacement: (content, node) => {
      const href = ((node as HTMLElement).getAttribute('href') ?? '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
      const title = (node as HTMLElement).getAttribute('title');
      return `[${content}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    },
  });

  service.addRule('strikethrough', {
    filter: ['del', 's', 'strike'] as TurndownService.Filter,
    replacement: (content) => (content.trim() ? `~~${content}~~` : content),
  });

  service.addRule('summary', { filter: 'summary', replacement: () => '' });

  service.addRule('details', {
    filter: 'details',
    replacement: (content, node) => {
      const summary = childElements(node).find((child) => child.nodeName === 'SUMMARY');
      const title = summary?.textContent?.replace(/\s+/g, ' ').trim() || 'Details';
      return `\n\n<details>\n<summary>${title}</summary>\n\n${content.trim()}\n\n</details>\n\n`;
    },
  });

  service.addRule('figure', {
    filter: 'figure',
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const img = element.querySelector('img');
      const caption = element.querySelector('figcaption')?.textContent?.trim() ?? '';
      const src = img?.getAttribute('src') ?? '';
      const alt = img?.getAttribute('alt') || caption;
      return `\n\n![${alt}](${src})${caption ? `\n_${caption}_` : ''}\n\n`;
    },
  });

  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => `\n\n${tableToMarkdown(node as HTMLElement, service)}\n\n`,
  });

  return service;
}

/** Collapses the converter output into tidy Markdown. */
export function finalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, ' ')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Escapes only text that would start a Markdown block. Turndown's default
 * also escapes characters such as "_" and "[", which corrupts identifiers
 * like user_id when an agent copies them.
 */
function escapeLineStartMarkdown(text: string): string {
  return text
    // Literal asterisks (e.g. "Phase 3**") would otherwise merge with real bold markers.
    .replace(/\*/g, '\\*')
    .replace(/^(\s*)(#{1,6}\s)/gm, '$1\\$2')
    .replace(/^(\s*)>/gm, '$1\\>')
    .replace(/^(\s*)([+-])(\s)/gm, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s)/gm, '$1$2\\$3$4')
    .replace(/^(\s*)(```|~~~)/gm, '$1\\$2');
}

function listItemPrefix(item: Node, bulletMarker: string): string {
  const parent = item.parentNode as Element | null;
  if (parent?.nodeName !== 'OL') return `${bulletMarker} `;
  const start = Number(parent.getAttribute('start')) || 1;
  const index = childElements(parent).filter((child) => child.nodeName === 'LI').indexOf(item as Element);
  return `${start + index}. `;
}

/**
 * A pipe table cell holds one line, so a table nested in a cell is replaced
 * by a reference and rendered as its own table after the outer one.
 */
function tableToMarkdown(table: HTMLElement, service: TurndownService): string {
  const nested: string[] = [];
  const rows = tableRows(table).map((row) =>
    childElements(row)
      .filter((cell) => TABLE_CELLS.has(cell.nodeName))
      .map((cell): MarkdownTableCell => {
        for (const inner of outermostNestedTables(cell)) {
          nested.push(tableToMarkdown(inner as HTMLElement, service));
          const caption = inner.ownerDocument.createTextNode(` (see table ${tableReference(nested.length)} below) `);
          inner.parentNode?.replaceChild(caption, inner);
        }
        return {
          text: normalizeCellText(unescapeLineStarts(finalizeMarkdown(service.turndown(cell.innerHTML)))),
          rowspan: Number(cell.getAttribute('rowspan')),
          colspan: Number(cell.getAttribute('colspan')),
        };
      }),
  );
  const outer = renderMarkdownTable(rows);
  const appendix = nested.map((markdown, index) => `Table ${tableReference(index + 1)}:\n\n${markdown}`);
  return [outer, ...appendix].join('\n\n');
}

function tableReference(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + ((index - 1) % 26));
}

function outermostNestedTables(cell: Element): Element[] {
  return Array.from(cell.getElementsByTagName('table')).filter((inner) => {
    for (let parent = inner.parentNode; parent && parent !== cell; parent = parent.parentNode) {
      if (parent.nodeName === 'TABLE') return false;
    }
    return true;
  });
}

/** Cell lines are joined with <br>, so line-start escapes are not needed there. */
function unescapeLineStarts(markdown: string): string {
  return markdown
    .replace(/(^|\n)(\s*)\\([+#>-])/g, '$1$2$3')
    .replace(/(^|\n)(\s*\d+)\\([.)])/g, '$1$2$3');
}

function codeLanguage(value: string | null): string {
  const language = (value ?? '').trim();
  return language.toLowerCase() === 'none' ? '' : language;
}

function tableRows(table: Element): Element[] {
  return childElements(table).flatMap((child) => {
    if (TABLE_SECTIONS.has(child.nodeName)) {
      return childElements(child).filter((row) => row.nodeName === 'TR');
    }
    return child.nodeName === 'TR' ? [child] : [];
  });
}
