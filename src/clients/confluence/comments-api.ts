import {
  AddInlineCommentParams,
  ConfluenceComment,
  ConfluenceCommentResult,
  ConfluenceCommentThread,
} from '../../types/index.js';
import { mapWithConcurrency } from '../../utils/concurrency.js';
import { AtlassianHttp } from '../atlassian-http.js';
import { nextPagePath } from './mappers.js';
import { RawCommentResult, RawList, RawV1Content } from './raw-types.js';

const COMMENT_PAGE_SIZE = 50;
const MAX_CONCURRENT_REPLY_REQUESTS = 5;

export class ConfluenceCommentsApi {
  constructor(private readonly http: AtlassianHttp) {}

  async listThreads(pageId: string): Promise<ConfluenceCommentThread[]> {
    const comments = await this.fetchChildComments(pageId);
    return mapWithConcurrency(comments, MAX_CONCURRENT_REPLY_REQUESTS, async (comment) => ({
      ...toComment(comment),
      replies: (await this.fetchChildComments(comment.id)).map(toComment),
    }));
  }

  addFooterComment(pageId: string, storage: string): Promise<ConfluenceCommentResult> {
    return this.post(
      'footer-comments',
      { pageId, body: storageBody(storage) },
      `Failed to add footer comment to page ${pageId}`,
    );
  }

  addInlineComment(params: AddInlineCommentParams): Promise<ConfluenceCommentResult> {
    return this.post(
      'inline-comments',
      {
        pageId: params.pageId,
        body: storageBody(params.body),
        inlineCommentProperties: {
          textSelection: params.textSelection,
          textSelectionMatchCount: params.textSelectionMatchCount,
          textSelectionMatchIndex: params.textSelectionMatchIndex,
        },
      },
      `Failed to add inline comment to page ${params.pageId}`,
    );
  }

  private async fetchChildComments(contentId: string): Promise<RawV1Content[]> {
    const results: RawV1Content[] = [];
    let path: string | undefined =
      `/wiki/rest/api/content/${encodeURIComponent(contentId)}/child/comment?expand=body.view,version,extensions.inlineProperties&limit=${COMMENT_PAGE_SIZE}`;
    while (path) {
      const raw: RawList<RawV1Content> = await this.http.json<RawList<RawV1Content>>(path, {
        errorContext: `Failed to fetch comments of ${contentId}`,
      });
      results.push(...(raw.results ?? []));
      path = nextPagePath(raw._links?.next);
    }
    return results;
  }

  private async post(
    endpoint: 'footer-comments' | 'inline-comments',
    body: Record<string, unknown>,
    errorContext: string,
  ): Promise<ConfluenceCommentResult> {
    const raw = await this.http.json<RawCommentResult>(`/wiki/api/v2/${endpoint}`, {
      method: 'POST',
      body,
      errorContext,
    });
    return { id: raw.id, pageId: raw.pageId };
  }
}

function toComment(raw: RawV1Content): ConfluenceComment {
  return {
    id: raw.id,
    author: raw.version?.by?.displayName ?? 'Unknown',
    created: raw.version?.when ?? '',
    bodyHtml: raw.body?.view?.value ?? '',
    location: raw.extensions?.location,
    selection: raw.extensions?.inlineProperties?.originalSelection,
  };
}

function storageBody(value: string): { representation: 'storage'; value: string } {
  return { representation: 'storage', value };
}
