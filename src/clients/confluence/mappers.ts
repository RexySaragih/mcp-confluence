import { ConfluencePage, ContentSummary } from '../../types/index.js';
import { RawLinks, RawV1Content, RawV2Page } from './raw-types.js';

const SPACE_IN_PATH = /\/spaces\/([^/?#]+)/;

export function toPage(raw: RawV2Page, siteUrl: string): ConfluencePage {
  return {
    id: raw.id,
    title: raw.title ?? 'Untitled',
    status: raw.status ?? 'current',
    spaceId: raw.spaceId ?? '',
    spaceKey: spaceKeyFromPath(raw._links?.webui),
    parentId: raw.parentId ?? undefined,
    parentType: raw.parentType ?? undefined,
    version: raw.version?.number ?? 1,
    webUrl: webUrl(raw._links, siteUrl) ?? viewPageUrl(siteUrl, raw.id),
    storage: raw.body?.storage?.value,
    labels: (raw.labels?.results ?? []).map((label) => label.name ?? '').filter(Boolean),
  };
}

export function toContentSummary(raw: RawV1Content, siteUrl: string): ContentSummary {
  return {
    id: raw.id,
    title: raw.title ?? 'Untitled',
    type: raw.type ?? 'page',
    webUrl: raw._links?.webui ? `${siteUrl}/wiki${raw._links.webui}` : undefined,
  };
}

export function spaceKeyFromPath(path: string | undefined): string | undefined {
  const match = path?.match(SPACE_IN_PATH);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function pageUrl(siteUrl: string, spaceKey: string | undefined, pageId: string): string {
  if (!spaceKey) return viewPageUrl(siteUrl, pageId);
  return `${siteUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${pageId}`;
}

/**
 * v2 "next" links include the /wiki prefix while v1 links are relative to it.
 */
export function nextPagePath(next: string | undefined): string | undefined {
  if (!next) return undefined;
  return next.startsWith('/wiki/') ? next : `/wiki${next}`;
}

function webUrl(links: RawLinks | undefined, siteUrl: string): string | undefined {
  if (!links?.webui) return undefined;
  return `${links.base ?? `${siteUrl}/wiki`}${links.webui}`;
}

function viewPageUrl(siteUrl: string, pageId: string): string {
  return `${siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}
