/** Subsets of Confluence REST responses that this server reads. */

export interface RawLinks {
  webui?: string;
  base?: string;
  next?: string;
}

export interface RawList<T> {
  results?: T[];
  _links?: RawLinks;
}

export interface RawV2Page {
  id: string;
  title?: string;
  status?: string;
  spaceId?: string;
  parentId?: string | null;
  parentType?: string | null;
  version?: { number?: number };
  body?: { storage?: { value?: string }; view?: { value?: string } };
  labels?: { results?: Array<{ name?: string }> };
  _links?: RawLinks;
}

export interface RawSpace {
  id: string;
  key: string;
  name?: string;
  homepageId?: string;
}

export interface RawChild {
  id: string;
  title?: string;
  type?: string;
}

export interface RawV1Content {
  id: string;
  type?: string;
  title?: string;
  space?: { key?: string };
  ancestors?: RawV1Content[];
  version?: { by?: { displayName?: string }; when?: string };
  body?: { view?: { value?: string } };
  extensions?: {
    mediaType?: string;
    fileSize?: number;
    location?: string;
    inlineProperties?: { originalSelection?: string };
  };
  _links?: RawLinks;
}

export interface RawSearchResult {
  content?: RawV1Content;
  title?: string;
  excerpt?: string;
  url?: string;
  entityType?: string;
  resultGlobalContainer?: { displayUrl?: string };
}

export interface RawUser {
  accountId?: string;
  displayName?: string;
  publicName?: string;
}

export interface RawCommentResult {
  id: string;
  pageId?: string;
}
