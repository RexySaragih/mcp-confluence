const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const NON_CONTENT_BLOCKS = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_BOUNDARIES = /<(br|\/p|\/div|\/li|\/h[1-6]|\/td|\/th|\/tr)\b[^>]*>/gi;
const TAGS = /<[^>]+>/g;

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return safeCodePoint(Number.parseInt(code.slice(2), 16), entity);
    }
    if (code.startsWith('#')) return safeCodePoint(Number.parseInt(code.slice(1), 10), entity);
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/** Text a reader sees in rendered HTML, with whitespace collapsed to single spaces. */
export function htmlToVisibleText(html: string): string {
  const withoutMarkup = html
    .replace(NON_CONTENT_BLOCKS, ' ')
    .replace(BLOCK_BOUNDARIES, ' ')
    .replace(TAGS, '');
  return decodeHtmlEntities(withoutMarkup).replace(/\s+/g, ' ').trim();
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
