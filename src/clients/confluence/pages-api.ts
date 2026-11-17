import { htmlToVisibleText } from '../../parsers/html-text.js';
import {
  ChildList,
  ConfluencePage,
  ContentSummary,
  CreatePageParams,
  UpdatePageParams,
  UpdatePageResult,
} from '../../types/index.js';
import { AtlassianApiError, AtlassianHttp, buildQuery } from '../atlassian-http.js';
import { nextPagePath, pageUrl, toContentSummary, toPage } from './mappers.js';
import { RawChild, RawList, RawV1Content, RawV2Page } from './raw-types.js';

const CHILDREN_PAGE_SIZE = 250;
export const MAX_LISTED_CHILDREN = 250;
const HTTP_CONFLICT = 409;

export class ConfluencePagesApi {
  constructor(private readonly http: AtlassianHttp) {}

  async get(pageId: string, options: { body?: boolean; labels?: boolean } = {}): Promise<ConfluencePage> {
    const query = buildQuery({
      'body-format': options.body ? 'storage' : undefined,
      'include-labels': options.labels ? 'true' : undefined,
    });
    const raw = await this.http.json<RawV2Page>(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}${query ? `?${query}` : ''}`,
      { errorContext: `Failed to fetch page ${pageId}` },
    );
    return toPage(raw, this.http.baseUrl);
  }

  async findByTitle(spaceId: string, title: string): Promise<ContentSummary | undefined> {
    const query = buildQuery({ 'space-id': spaceId, title, status: 'current', limit: 1 });
    const raw = await this.http.json<RawList<RawV2Page>>(`/wiki/api/v2/pages?${query}`, {
      errorContext: `Failed to look up page "${title}"`,
    });
    const page = raw.results?.find((result) => result.title === title) ?? raw.results?.[0];
    if (!page) return undefined;
    const base = raw._links?.base ?? `${this.http.baseUrl}/wiki`;
    return {
      id: page.id,
      title: page.title ?? title,
      type: 'page',
      webUrl: page._links?.webui ? `${base}${page._links.webui}` : pageUrl(this.http.baseUrl, undefined, page.id),
    };
  }

  async create(params: CreatePageParams): Promise<ConfluencePage> {
    const body = {
      spaceId: params.spaceId,
      status: params.status,
      title: params.title,
      ...(params.parentId ? { parentId: params.parentId } : {}),
      body: { representation: 'storage', value: params.storage },
    };
    const raw = await this.http.json<RawV2Page>(`/wiki/api/v2/pages${params.rootLevel ? '?root-level=true' : ''}`, {
      method: 'POST',
      body,
      errorContext: `Failed to create page "${params.title}"`,
    });
    return toPage(raw, this.http.baseUrl);
  }

  async update(pageId: string, params: UpdatePageParams): Promise<UpdatePageResult> {
    const body = {
      id: pageId,
      status: 'current',
      title: params.title,
      body: { representation: 'storage', value: params.storage },
      version: { number: params.version },
    };
    let raw: RawV2Page;
    try {
      raw = await this.http.json<RawV2Page>(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, {
        method: 'PUT',
        body,
        errorContext: `Failed to update page ${pageId}`,
      });
    } catch (error) {
      if (error instanceof AtlassianApiError && error.status === HTTP_CONFLICT) {
        throw new Error(
          `Page ${pageId} was changed by someone else during the update (version conflict). Read the page again and retry.`,
        );
      }
      throw error;
    }
    const page = toPage(raw, this.http.baseUrl);
    return { id: page.id, title: page.title, webUrl: page.webUrl, version: page.version };
  }

  async move(pageId: string, targetParentId: string): Promise<void> {
    await this.http.send(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/move/append/${encodeURIComponent(targetParentId)}`,
      { method: 'PUT', errorContext: `Failed to move page ${pageId} under page ${targetParentId}` },
    );
  }

  /** Ancestors from the top of the space down to the direct parent. */
  async ancestors(pageId: string): Promise<ContentSummary[]> {
    const raw = await this.http.json<RawV1Content>(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=ancestors`,
      { errorContext: `Failed to fetch ancestors of page ${pageId}` },
    );
    return (raw.ancestors ?? []).map((ancestor) => toContentSummary(ancestor, this.http.baseUrl));
  }

  async directChildren(pageId: string, max = MAX_LISTED_CHILDREN): Promise<ChildList> {
    const children: ContentSummary[] = [];
    let path: string | undefined =
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/direct-children?limit=${CHILDREN_PAGE_SIZE}`;
    while (path && children.length < max) {
      const raw: RawList<RawChild> = await this.http.json<RawList<RawChild>>(path, {
        errorContext: `Failed to fetch child pages of page ${pageId}`,
      });
      for (const child of raw.results ?? []) {
        children.push({ id: child.id, title: child.title ?? 'Untitled', type: child.type ?? 'page' });
      }
      path = nextPagePath(raw._links?.next);
    }
    return { children: children.slice(0, max), truncated: children.length > max || path !== undefined };
  }

  async addLabels(pageId: string, labels: string[]): Promise<void> {
    await this.http.send(`/wiki/rest/api/content/${encodeURIComponent(pageId)}/label`, {
      method: 'POST',
      body: labels.map((name) => ({ prefix: 'global', name })),
      errorContext: `Failed to add labels to page ${pageId}`,
    });
  }

  async renderedText(pageId: string): Promise<string> {
    const raw = await this.http.json<RawV2Page>(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=view`,
      { errorContext: `Failed to fetch rendered page ${pageId}` },
    );
    const view = raw.body?.view?.value;
    if (typeof view !== 'string') {
      throw new Error(`Rendered body is unavailable for page ${pageId}`);
    }
    return htmlToVisibleText(view);
  }
}
