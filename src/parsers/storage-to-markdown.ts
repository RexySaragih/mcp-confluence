import { convertStorageChildren, removeEditorPlaceholders, tidyListItems } from './storage/convert-storage.js';
import { createMarkdownConverter, finalizeMarkdown } from './storage/markdown-converter.js';
import { parseStorageDocument } from './storage/parse-storage.js';
import { pageLinkKey, StorageContext } from './storage/storage-context.js';

export { collectMentionedAccountIds } from './storage/parse-storage.js';
export { pageLinkKey } from './storage/storage-context.js';

export interface StorageToMarkdownContext {
  baseUrl?: string;
  pageId?: string;
  spaceKey?: string;
  userNames?: ReadonlyMap<string, string>;
  pageIds?: ReadonlyMap<string, string>;
}

export interface PageLinkTarget {
  spaceKey: string;
  title: string;
}

const PAGE_LINK = /<ri:page\b([^>]*)>/g;
const ATTRIBUTE = (name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`);

const markdownConverter = createMarkdownConverter();

/** Converts Confluence storage format (XHTML with ac:/ri: elements) to Markdown. */
export function confluenceStorageToMarkdown(
  storage: string | undefined,
  context: StorageToMarkdownContext = {},
): string {
  if (!storage?.trim()) return '';
  const doc = parseStorageDocument(storage);
  const ctx: StorageContext = {
    doc,
    baseUrl: context.baseUrl,
    pageId: context.pageId,
    spaceKey: context.spaceKey,
    userNames: context.userNames ?? new Map(),
    pageIds: context.pageIds ?? new Map(),
    convertChildren: (node) => convertStorageChildren(node, ctx),
  };
  removeEditorPlaceholders(doc.body);
  convertStorageChildren(doc.body, ctx);
  tidyListItems(doc.body);
  return finalizeMarkdown(markdownConverter.turndown(doc.body.innerHTML));
}

/** Page links stored by title only (no content id), which need an id lookup to link by id. */
export function collectTitleOnlyPageLinks(storage: string | undefined, defaultSpaceKey?: string): PageLinkTarget[] {
  if (!storage) return [];
  const targets = new Map<string, PageLinkTarget>();
  for (const match of storage.matchAll(PAGE_LINK)) {
    const attributes = match[1];
    if (ATTRIBUTE('ri:content-id').test(attributes)) continue;
    const title = decodeAttribute(attributes.match(ATTRIBUTE('ri:content-title'))?.[1]);
    const spaceKey = decodeAttribute(attributes.match(ATTRIBUTE('ri:space-key'))?.[1]) || defaultSpaceKey;
    if (title && spaceKey) targets.set(pageLinkKey(spaceKey, title), { spaceKey, title });
  }
  return [...targets.values()];
}

/** Converts rendered (view format) HTML, such as comment bodies, to Markdown. */
export function renderedHtmlToMarkdown(html: string | undefined): string {
  if (!html?.trim()) return '';
  return finalizeMarkdown(markdownConverter.turndown(html));
}

function decodeAttribute(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
