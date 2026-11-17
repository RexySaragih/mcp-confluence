import { AtlassianAuth, AtlassianHttp } from './atlassian-http.js';
import { ConfluenceAttachmentsApi } from './confluence/attachments-api.js';
import { ConfluenceCommentsApi } from './confluence/comments-api.js';
import { ConfluenceDirectoryApi } from './confluence/directory-api.js';
import { pageUrl } from './confluence/mappers.js';
import { ConfluencePagesApi } from './confluence/pages-api.js';
import { ConfluenceSearchApi } from './confluence/search-api.js';

export type ConfluenceClientConfig = AtlassianAuth;

/** Entry point for Confluence Cloud, grouped by resource. */
export class ConfluenceClient {
  readonly pages: ConfluencePagesApi;
  readonly directory: ConfluenceDirectoryApi;
  readonly search: ConfluenceSearchApi;
  readonly comments: ConfluenceCommentsApi;
  readonly attachments: ConfluenceAttachmentsApi;
  private readonly baseUrl: string;

  constructor(config: ConfluenceClientConfig) {
    const http = new AtlassianHttp(config);
    this.baseUrl = http.baseUrl;
    this.pages = new ConfluencePagesApi(http);
    this.directory = new ConfluenceDirectoryApi(http);
    this.search = new ConfluenceSearchApi(http);
    this.comments = new ConfluenceCommentsApi(http);
    this.attachments = new ConfluenceAttachmentsApi(http);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  pageUrl(spaceKey: string | undefined, pageId: string): string {
    return pageUrl(this.baseUrl, spaceKey, pageId);
  }
}
