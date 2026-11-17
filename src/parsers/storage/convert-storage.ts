import { childElements, isElement, replaceWithNodes } from './dom.js';
import {
  convertAdfExtension,
  convertEmoticon,
  convertImage,
  convertLink,
  convertTaskList,
  convertTime,
  dropElement,
  unwrapElement,
} from './storage-elements.js';
import { convertMacro } from './storage-macros.js';
import { ElementConverter, StorageContext } from './storage-context.js';

const ELEMENT_CONVERTERS: Record<string, ElementConverter> = {
  'ac:structured-macro': convertMacro,
  'ac:macro': convertMacro,
  'ac:link': convertLink,
  'ac:image': convertImage,
  'ac:task-list': convertTaskList,
  'ac:emoticon': convertEmoticon,
  'ac:adf-extension': convertAdfExtension,
  'ac:placeholder': dropElement,
  'ac:parameter': dropElement,
  colgroup: dropElement,
  time: convertTime,
};

const CONFLUENCE_NAMESPACES = ['ac:', 'ri:', 'at:'];

/** Replaces Confluence-specific elements under `parent` with plain HTML, depth first. */
export function convertStorageChildren(parent: Node, ctx: StorageContext): void {
  for (const child of childElements(parent)) {
    const converter = ELEMENT_CONVERTERS[child.localName] ?? (isConfluenceElement(child) ? unwrapElement : undefined);
    if (converter) {
      replaceWithNodes(child, converter(child, ctx));
    } else {
      convertStorageChildren(child, ctx);
    }
  }
}

/**
 * Confluence wraps list item text in <p>. Unwrapping the leading paragraph
 * keeps Markdown lists tight instead of one blank line per item.
 */
export function tidyListItems(root: Element): void {
  for (const item of Array.from(root.getElementsByTagName('li'))) {
    const first = Array.from(item.childNodes).find(
      (node) => isElement(node) || (node.textContent ?? '').trim() !== '',
    );
    if (first && isElement(first) && first.localName === 'p') {
      replaceWithNodes(first, Array.from(first.childNodes));
    }
  }
}

/**
 * Confluence templates store their grey hint text ("Type // to add a date",
 * "Type /Jira to add …") as ordinary text, not as <ac:placeholder>. These
 * hints are never page content, so text nodes that are only a hint are removed.
 */
const EDITOR_HINT = /^\s*Type \/\/?[\w-]* to (?:add|create|insert)\b[^\n]*$/i;
const TEXT_NODE = 3;

export function removeEditorPlaceholders(root: Node): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      if (EDITOR_HINT.test(child.textContent ?? '')) child.parentNode?.removeChild(child);
    } else if (isElement(child)) {
      removeEditorPlaceholders(child);
    }
  }
}

function isConfluenceElement(element: Element): boolean {
  return CONFLUENCE_NAMESPACES.some((prefix) => element.localName.startsWith(prefix));
}
