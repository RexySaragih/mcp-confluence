export interface MarkdownTableCell {
  text: string;
  rowspan?: number;
  colspan?: number;
}

const MAX_SPAN = 50;
const MIN_FENCE_LENGTH = 3;

/** Fenced code block whose fence is longer than any backtick run inside the code. */
export function fencedCode(language: string, code: string): string {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
  return `${fence}${language.trim()}\n${code.replace(/\n+$/, '')}\n${fence}`;
}

/**
 * Renders rows as a GFM pipe table. Row-merged cells are repeated in each
 * row they cover; column-merged cells appear once, in their first column.
 */
export function renderMarkdownTable(rows: MarkdownTableCell[][]): string {
  const grid = buildGrid(rows);
  if (grid.length === 0) return '';
  const width = Math.max(...grid.map((row) => row.length));
  const lines = grid.map((row) => formatRow(row, width));
  const separator = formatRow(Array.from({ length: width }, () => '---'), width);
  return [lines[0], separator, ...lines.slice(1)].join('\n');
}

export function normalizeCellText(text: string): string {
  return text
    .trim()
    .replace(/\n+/g, '<br>')
    .replace(/\|/g, '\\|');
}

function buildGrid(rows: MarkdownTableCell[][]): string[][] {
  const grid: string[][] = [];
  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let column = 0;
    for (const cell of row) {
      while (grid[rowIndex][column] !== undefined) column += 1;
      const rowspan = clampSpan(cell.rowspan);
      const colspan = clampSpan(cell.colspan);
      for (let dr = 0; dr < rowspan; dr += 1) {
        const target = (grid[rowIndex + dr] ??= []);
        // Row spans repeat the value so each row reads alone; column spans fill only the first column.
        for (let dc = 0; dc < colspan; dc += 1) {
          target[column + dc] = dc === 0 ? cell.text : '';
        }
      }
      column += colspan;
    }
  });
  return grid.filter((row) => row.length > 0);
}

function formatRow(row: string[], width: number): string {
  const cells = Array.from({ length: width }, (_, index) => row[index] || ' ');
  return `| ${cells.join(' | ')} |`;
}

function clampSpan(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), MAX_SPAN);
}
