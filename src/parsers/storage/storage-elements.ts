import { childElements, createElement, firstChildNamed, textOf } from './dom.js';
import { attachmentUrl, convertedChildren, pageLinkKey, StorageContext } from './storage-context.js';

const EMOTICON_TEXT: Record<string, string> = {
  smile: '🙂',
  sad: '🙁',
  cheeky: '😛',
  laugh: '😀',
  wink: '😉',
  'thumbs-up': '👍',
  'thumbs-down': '👎',
  information: 'ℹ️',
  tick: '✅',
  cross: '❌',
  warning: '⚠️',
  plus: '➕',
  minus: '➖',
  question: '❓',
  'light-on': '💡',
  'yellow-star': '⭐',
  heart: '❤️',
};

const ADF_PANEL_LABELS: Record<string, string> = {
  info: 'Info',
  note: 'Note',
  warning: 'Warning',
  success: 'Tip',
  tip: 'Tip',
  error: 'Error',
};

interface LinkTarget {
  label: string;
  href?: string;
}

export function dropElement(): Node[] {
  return [];
}

export function unwrapElement(element: Element, ctx: StorageContext): Node[] {
  return convertedChildren(element, ctx);
}

export function convertTime(element: Element, ctx: StorageContext): Node[] {
  const text = textOf(element) || element.getAttribute('datetime') || '';
  return text ? [ctx.doc.createTextNode(text)] : [];
}

export function convertLink(link: Element, ctx: StorageContext): Node[] {
  const target = childElements(link).find((child) => child.localName.startsWith('ri:'));
  const resource = describeLinkTarget(target, link.getAttribute('ac:anchor') ?? '', ctx);
  const body = linkBody(link, ctx);
  const label = body.length ? body : [ctx.doc.createTextNode(resource.label)];
  if (!resource.href) return label;
  return [createElement(ctx.doc, 'a', { href: resource.href }, label)];
}

export function convertImage(image: Element, ctx: StorageContext): Node[] {
  const attachment = firstChildNamed(image, 'ri:attachment');
  const filename = attachment?.getAttribute('ri:filename') ?? '';
  const ownedByOtherPage = attachment ? firstChildNamed(attachment, 'ri:page') !== undefined : false;
  const externalUrl = firstChildNamed(image, 'ri:url')?.getAttribute('ri:value') ?? '';
  const caption = textOf(firstChildNamed(image, 'ac:caption'));
  const alt = image.getAttribute('ac:alt') || caption || filename;
  const src = externalUrl || (ownedByOtherPage ? '' : attachmentUrl(ctx, filename)) || filename;
  const img = createElement(ctx.doc, 'img', { src, alt });
  const captionText = caption || image.getAttribute('ac:title') || '';
  if (!captionText) return [img];
  return [createElement(ctx.doc, 'figure', {}, [img, createElement(ctx.doc, 'figcaption', {}, [captionText])])];
}

export function convertTaskList(taskList: Element, ctx: StorageContext): Node[] {
  const list = createElement(ctx.doc, 'ul');
  for (const task of childElements(taskList).filter((child) => child.localName === 'ac:task')) {
    const done = textOf(firstChildNamed(task, 'ac:task-status')) === 'complete';
    const item = createElement(ctx.doc, 'li', {}, [done ? '[x] ' : '[ ] ']);
    for (const node of convertedChildren(firstChildNamed(task, 'ac:task-body'), ctx)) item.appendChild(node);
    for (const nested of childElements(task).filter((child) => child.localName === 'ac:task-list')) {
      for (const node of convertTaskList(nested, ctx)) item.appendChild(node);
    }
    list.appendChild(item);
  }
  return [list];
}

export function convertEmoticon(emoticon: Element, ctx: StorageContext): Node[] {
  const name = emoticon.getAttribute('ac:name') ?? '';
  const text =
    emojiFromId(emoticon.getAttribute('ac:emoji-id') ?? '') ||
    decodeUnicodeEscapes(emoticon.getAttribute('ac:emoji-fallback') ?? '') ||
    EMOTICON_TEXT[name] ||
    (name ? `:${name}:` : '');
  return text ? [ctx.doc.createTextNode(text)] : [];
}

/** Standard emoji ids are code points in hex, joined by "-" (e.g. "1f4ca", "1f1ee-1f1e9"). */
function emojiFromId(id: string): string {
  if (!/^[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*$/i.test(id)) return '';
  try {
    return String.fromCodePoint(...id.split('-').map((part) => Number.parseInt(part, 16)));
  } catch {
    return '';
  }
}

/** Some pages store the fallback as literal "\uD83D\uDCCA" text instead of the character. */
function decodeUnicodeEscapes(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function convertAdfExtension(extension: Element, ctx: StorageContext): Node[] {
  const node = firstChildNamed(extension, 'ac:adf-node');
  if (node?.getAttribute('type') === 'panel') {
    const panelType = adfAttribute(node, 'panel-type') || 'info';
    const body = convertedChildren(firstChildNamed(node, 'ac:adf-content'), ctx);
    return [panelBlockquote(ctx, ADF_PANEL_LABELS[panelType] ?? 'Panel', '', body)];
  }
  const fallback = firstChildNamed(extension, 'ac:adf-fallback');
  return convertedChildren(fallback ?? (node && firstChildNamed(node, 'ac:adf-content')), ctx);
}

/** Panels become a blockquote whose first line is the bold panel label. */
export function panelBlockquote(ctx: StorageContext, label: string, title: string, body: Node[]): Node {
  const heading = createElement(ctx.doc, 'p', {}, [
    createElement(ctx.doc, 'strong', {}, [title ? `${label}: ${title}` : label]),
  ]);
  return createElement(ctx.doc, 'blockquote', {}, [heading, ...body]);
}

function linkBody(link: Element, ctx: StorageContext): Node[] {
  const rich = firstChildNamed(link, 'ac:link-body');
  if (rich) return convertedChildren(rich, ctx);
  const plain = textOf(firstChildNamed(link, 'ac:plain-text-link-body'));
  return plain ? [ctx.doc.createTextNode(plain)] : [];
}

function describeLinkTarget(target: Element | undefined, anchor: string, ctx: StorageContext): LinkTarget {
  const fragment = anchor ? `#${encodeURIComponent(anchor)}` : '';
  switch (target?.localName) {
    case 'ri:page':
      return pageLinkTarget(target, fragment, ctx);
    case 'ri:blog-post':
      return { label: target.getAttribute('ri:content-title') ?? 'blog post' };
    case 'ri:user':
      return { label: mentionLabel(target, ctx) };
    case 'ri:attachment': {
      const filename = target.getAttribute('ri:filename') ?? '';
      return { label: filename, href: attachmentUrl(ctx, filename) };
    }
    case 'ri:space': {
      const key = target.getAttribute('ri:space-key') ?? '';
      return { label: key, href: ctx.baseUrl && key ? `${ctx.baseUrl}/wiki/spaces/${encodeURIComponent(key)}` : undefined };
    }
    case 'ri:url': {
      const value = target.getAttribute('ri:value') ?? '';
      return { label: value, href: value || undefined };
    }
    case 'ri:content-entity': {
      const id = target.getAttribute('ri:content-id') ?? '';
      return { label: id, href: viewPageUrl(ctx, id) };
    }
    default:
      return anchor ? { label: anchor, href: fragment } : { label: '' };
  }
}

function pageLinkTarget(page: Element, fragment: string, ctx: StorageContext): LinkTarget {
  const title = page.getAttribute('ri:content-title') ?? '';
  const contentId = page.getAttribute('ri:content-id') ?? '';
  const spaceKey = page.getAttribute('ri:space-key') || ctx.spaceKey;
  const label = title || 'page';
  if (contentId) return { label, href: appendFragment(viewPageUrl(ctx, contentId), fragment) };
  if (!ctx.baseUrl || !title || !spaceKey) return { label };
  const resolvedId = ctx.pageIds.get(pageLinkKey(spaceKey, title));
  if (resolvedId) {
    return { label, href: `${ctx.baseUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${resolvedId}${fragment}` };
  }
  // Confluence Cloud resolves /display/{space}/{title} links to the page by title.
  const titlePath = encodeURIComponent(title).replace(/%20/g, '+');
  return { label, href: `${ctx.baseUrl}/wiki/display/${encodeURIComponent(spaceKey)}/${titlePath}${fragment}` };
}

function viewPageUrl(ctx: StorageContext, pageId: string): string | undefined {
  if (!ctx.baseUrl || !pageId) return undefined;
  return `${ctx.baseUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}

function appendFragment(url: string | undefined, fragment: string): string | undefined {
  return url ? `${url}${fragment}` : undefined;
}

function mentionLabel(user: Element, ctx: StorageContext): string {
  const accountId = user.getAttribute('ri:account-id') ?? '';
  const name = ctx.userNames.get(accountId);
  if (name) return `@${name}`;
  return accountId ? `@user:${accountId}` : '@user';
}

function adfAttribute(node: Element, key: string): string {
  const attribute = childElements(node).find(
    (child) => child.localName === 'ac:adf-attribute' && child.getAttribute('key') === key,
  );
  return textOf(attribute);
}
