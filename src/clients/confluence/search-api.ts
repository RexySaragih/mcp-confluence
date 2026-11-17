import { htmlToVisibleText } from '../../parsers/html-text.js';
import { ConfluenceSearchPage, ConfluenceSearchResult } from '../../types/index.js';
import { AtlassianHttp, buildQuery } from '../atlassian-http.js';
import { spaceKeyFromPath } from './mappers.js';
import { RawList, RawSearchResult } from './raw-types.js';

const EXCERPT_LENGTH = 200;
const HIGHLIGHT_MARKERS = /@@@(?:end)?hl@@@/g;

export class ConfluenceSearchApi {
  constructor(private readonly http: AtlassianHttp) {}

  async search(cql: string, options: { limit: number; cursor?: string }): Promise<ConfluenceSearchPage> {
    const query = buildQuery({ cql, limit: options.limit, cursor: options.cursor, expand: 'content.space' });
    const raw = await this.http.json<RawList<RawSearchResult>>(`/wiki/rest/api/search?${query}`, {
      errorContext: 'Failed to search Confluence',
    });
    return {
      results: (raw.results ?? []).map((result) => this.toResult(result)),
      nextCursor: cursorFrom(raw._links?.next),
    };
  }

  private toResult(raw: RawSearchResult): ConfluenceSearchResult {
    const content = raw.content;
    const path = content?._links?.webui ?? raw.url ?? '';
    return {
      id: content?.id ?? '',
      type: content?.type ?? raw.entityType ?? 'content',
      title: stripHighlights(content?.title ?? raw.title ?? 'Untitled'),
      spaceKey: content?.space?.key ?? spaceKeyFromPath(raw.resultGlobalContainer?.displayUrl) ?? '',
      excerpt: cleanExcerpt(raw.excerpt),
      url: /^https?:\/\//.test(path) ? path : path ? `${this.http.baseUrl}/wiki${path}` : '',
    };
  }
}

function cursorFrom(next: string | undefined): string | undefined {
  if (!next) return undefined;
  return new URL(next, 'https://placeholder.invalid').searchParams.get('cursor') ?? undefined;
}

function stripHighlights(value: string): string {
  return value.replace(HIGHLIGHT_MARKERS, '');
}

function cleanExcerpt(excerpt: string | undefined): string {
  const text = htmlToVisibleText(stripHighlights(excerpt ?? ''));
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;
}
