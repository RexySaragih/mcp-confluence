import { childElements, createElement, descendantNamed, firstChildNamed, textOf } from './dom.js';
import { dropElement, panelBlockquote } from './storage-elements.js';
import { convertedChildren, StorageContext } from './storage-context.js';

type MacroConverter = (macro: Element, ctx: StorageContext) => Node[];

const PANEL_LABELS: Record<string, string> = {
  info: 'Info',
  note: 'Note',
  warning: 'Warning',
  tip: 'Tip',
  panel: 'Panel',
};

const DESCRIPTIVE_PARAMETERS = ['diagramName', 'title', 'name', 'url'];
const DEFAULT_EXPAND_TITLE = 'Click here to expand...';

const MACRO_CONVERTERS: Record<string, MacroConverter> = {
  code: convertCodeMacro,
  noformat: convertCodeMacro,
  expand: convertExpandMacro,
  'ui-expand': convertExpandMacro,
  info: convertPanelMacro,
  note: convertPanelMacro,
  warning: convertPanelMacro,
  tip: convertPanelMacro,
  panel: convertPanelMacro,
  status: convertStatusMacro,
  jira: convertJiraMacro,
  toc: dropElement,
  anchor: dropElement,
};

export function convertMacro(macro: Element, ctx: StorageContext): Node[] {
  const name = (macro.getAttribute('ac:name') ?? '').toLowerCase();
  const converter = MACRO_CONVERTERS[name];
  return converter ? converter(macro, ctx) : convertUnknownMacro(name, macro, ctx);
}

function macroParameter(macro: Element, name: string): string {
  const parameter = childElements(macro).find(
    (child) => child.localName === 'ac:parameter' && child.getAttribute('ac:name') === name,
  );
  return textOf(parameter);
}

function richBody(macro: Element, ctx: StorageContext): Node[] {
  return convertedChildren(firstChildNamed(macro, 'ac:rich-text-body'), ctx);
}

function convertCodeMacro(macro: Element, ctx: StorageContext): Node[] {
  const code = firstChildNamed(macro, 'ac:plain-text-body')?.textContent ?? '';
  const pre = createElement(ctx.doc, 'pre', { 'data-language': macroParameter(macro, 'language') }, [code]);
  const title = macroParameter(macro, 'title');
  if (!title) return [pre];
  return [createElement(ctx.doc, 'p', {}, [createElement(ctx.doc, 'strong', {}, [title])]), pre];
}

function convertExpandMacro(macro: Element, ctx: StorageContext): Node[] {
  const title = macroParameter(macro, 'title') || DEFAULT_EXPAND_TITLE;
  const summary = createElement(ctx.doc, 'summary', {}, [title]);
  return [createElement(ctx.doc, 'details', {}, [summary, ...richBody(macro, ctx)])];
}

function convertPanelMacro(macro: Element, ctx: StorageContext): Node[] {
  const name = (macro.getAttribute('ac:name') ?? 'panel').toLowerCase();
  const label = PANEL_LABELS[name] ?? 'Panel';
  return [panelBlockquote(ctx, label, macroParameter(macro, 'title'), richBody(macro, ctx))];
}

function convertStatusMacro(macro: Element, ctx: StorageContext): Node[] {
  // Confluence displays status lozenges in upper case whatever case is stored.
  const text = (macroParameter(macro, 'title') || macroParameter(macro, 'colour')).toUpperCase();
  return text ? [ctx.doc.createTextNode(`[${text}]`)] : [];
}

function convertJiraMacro(macro: Element, ctx: StorageContext): Node[] {
  const key = macroParameter(macro, 'key');
  if (key) {
    if (!ctx.baseUrl) return [ctx.doc.createTextNode(key)];
    return [createElement(ctx.doc, 'a', { href: `${ctx.baseUrl}/browse/${encodeURIComponent(key)}` }, [key])];
  }
  const jql = macroParameter(macro, 'jqlQuery');
  return jql ? [ctx.doc.createTextNode(`[Jira issues: ${jql}]`)] : [];
}

/**
 * Macros without a converter keep their rich body. Body-less macros (draw.io,
 * children, include, ...) leave a visible marker so the reader knows content
 * exists that Markdown cannot show.
 */
function convertUnknownMacro(name: string, macro: Element, ctx: StorageContext): Node[] {
  const body = firstChildNamed(macro, 'ac:rich-text-body');
  if (body) return convertedChildren(body, ctx);
  const plainBody = firstChildNamed(macro, 'ac:plain-text-body');
  if (plainBody?.textContent?.trim()) {
    return [createElement(ctx.doc, 'pre', { 'data-language': name }, [plainBody.textContent])];
  }
  const detail = describeMacro(macro);
  const label = `[Confluence macro: ${name || 'unknown'}${detail ? ` "${detail}"` : ''}]`;
  return [createElement(ctx.doc, 'em', {}, [label])];
}

function describeMacro(macro: Element): string {
  for (const parameter of DESCRIPTIVE_PARAMETERS) {
    const value = macroParameter(macro, parameter);
    if (value) return value;
  }
  const page = descendantNamed(macro, 'ri:page');
  if (page) return page.getAttribute('ri:content-title') ?? '';
  return descendantNamed(macro, 'ri:attachment')?.getAttribute('ri:filename') ?? '';
}
