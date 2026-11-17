export interface StorageContext {
  doc: Document;
  baseUrl?: string;
  pageId?: string;
  spaceKey?: string;
  userNames: ReadonlyMap<string, string>;
  /** Page ids keyed by pageLinkKey(space, title), for links stored by title only. */
  pageIds: ReadonlyMap<string, string>;
  /** Converts the Confluence elements inside a node in place. */
  convertChildren(node: Node): void;
}

export function pageLinkKey(spaceKey: string, title: string): string {
  return `${spaceKey}\u0000${title}`;
}

export type ElementConverter = (element: Element, ctx: StorageContext) => Node[];

export function attachmentUrl(ctx: StorageContext, filename: string): string | undefined {
  if (!ctx.baseUrl || !ctx.pageId || !filename) return undefined;
  return `${ctx.baseUrl}/wiki/download/attachments/${ctx.pageId}/${encodeURIComponent(filename)}`;
}

export function convertedChildren(node: Element | undefined, ctx: StorageContext): Node[] {
  if (!node) return [];
  ctx.convertChildren(node);
  return Array.from(node.childNodes);
}
