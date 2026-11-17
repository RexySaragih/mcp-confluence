import domino from '@mixmark-io/domino';

const CDATA_SECTION = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const SELF_CLOSING_TAG = /<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/>/g;
const ACCOUNT_ID_ATTRIBUTE = /ri:account-id\s*=\s*"([^"]+)"/g;
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Parses Confluence storage format with an HTML parser. Two XML features are
 * rewritten first because an HTML parser mishandles them: CDATA sections
 * (parsed as comments that end at the first ">") and self-closing non-void
 * tags such as <ri:page/> or <time/> (left open, so they swallow every
 * following sibling).
 */
export function parseStorageDocument(storage: string): Document {
  const html = storage
    .replace(CDATA_SECTION, (_match, text: string) => escapeText(text))
    .replace(SELF_CLOSING_TAG, (match, tagName: string, attributes: string) =>
      VOID_ELEMENTS.has(tagName.toLowerCase()) ? match : `<${tagName}${attributes}></${tagName}>`,
    );
  return domino.createDocument(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
}

export function collectMentionedAccountIds(storage: string | undefined): string[] {
  if (!storage) return [];
  const ids = new Set<string>();
  for (const match of storage.matchAll(ACCOUNT_ID_ATTRIBUTE)) ids.add(match[1]);
  return [...ids];
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
