import { ConfluenceClient } from '../clients/confluence-client.js';
import { MAX_LISTED_CHILDREN } from '../clients/confluence/pages-api.js';
import { ChildList, ContentSummary } from '../types/index.js';

const PATH_SEPARATOR = ' › ';

export function formatPath(ancestors: ContentSummary[], currentTitle?: string): string {
  const titles = ancestors.map((ancestor) => `${ancestor.title} (${ancestor.id})`);
  if (currentTitle) titles.push(currentTitle);
  return titles.join(PATH_SEPARATOR) || '(top level of the space)';
}

/** Breadcrumb for output after a write. A lookup failure must not hide that the write succeeded. */
export async function describePath(client: ConfluenceClient, pageId: string, title: string): Promise<string> {
  try {
    return formatPath(await client.pages.ancestors(pageId), title);
  } catch (error) {
    return `(unavailable: ${error instanceof Error ? error.message : String(error)})`;
  }
}

export function formatChildren(list: ChildList, client: ConfluenceClient, spaceKey: string | undefined): string[] {
  if (list.children.length === 0) return ['Child pages: None'];
  const lines = [
    `Child pages (${list.children.length}${list.truncated ? '+' : ''}):`,
    ...list.children.map((child) => {
      const type = child.type === 'page' ? '' : ` | ${child.type}`;
      return `- ${child.id} | ${child.title}${type} | ${client.pageUrl(spaceKey, child.id)}`;
    }),
  ];
  if (list.truncated) lines.push(`(More child pages exist. Showing the first ${MAX_LISTED_CHILDREN}.)`);
  return lines;
}
