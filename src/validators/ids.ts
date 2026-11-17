const PAGE_ID_PATTERN = /^\d+$/;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const SPACE_KEY_PATTERN = /^~?[A-Za-z0-9][A-Za-z0-9_:.-]*$/;
const PAGE_URL_PATTERNS = [/\/pages\/(?:edit-v2\/|edit\/)?(\d+)(?:[/?#]|$)/, /[?&]pageId=(\d+)/];
const ISSUE_URL_PATTERNS = [/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/, /[?&]selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)/];
const SHORT_LINK_PATTERN = /\/wiki\/x\/([^/?#]+)/;

export function assertPageId(value: string, label = 'page_id'): string {
  const trimmed = value.trim();
  if (!PAGE_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${label} "${value}": Confluence page ids are numeric.`);
  }
  return trimmed;
}

export function normalizeIssueKey(value: string): string {
  const key = value.trim().toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid Jira issue key "${value}". Expected a key such as PROJ-123.`);
  }
  return key;
}

export function assertSpaceKey(value: string): string {
  const trimmed = value.trim();
  if (!SPACE_KEY_PATTERN.test(trimmed)) {
    throw new Error(`Invalid space_key "${value}".`);
  }
  return trimmed;
}

export function assertSameSite(url: string, baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  const expectedHost = new URL(baseUrl).host.toLowerCase();
  if (parsed.host.toLowerCase() !== expectedHost) {
    throw new Error(
      `URL host "${parsed.host}" does not match the configured Atlassian site "${expectedHost}".`,
    );
  }
  return parsed;
}

export function pageIdFromUrl(url: string, baseUrl: string): string {
  const parsed = assertSameSite(url, baseUrl);
  const target = `${parsed.pathname}${parsed.search}`;
  for (const pattern of PAGE_URL_PATTERNS) {
    const match = target.match(pattern);
    if (match?.[1]) return match[1];
  }
  const shortCode = parsed.pathname.match(SHORT_LINK_PATTERN)?.[1];
  if (shortCode) return decodeShortLink(shortCode);
  throw new Error(`Unable to find a page id in URL: ${url}`);
}

const SHORT_LINK_BASE64_LENGTH = 11;
const BYTE_BASE = 256n;

/**
 * Confluence short links (/wiki/x/CODE) are the page id as little-endian
 * bytes in base64, with "/" as "-", "+" as "_", and trailing "A"s removed.
 */
export function decodeShortLink(code: string): string {
  if (!/^[A-Za-z0-9_-]{1,11}$/.test(code)) {
    throw new Error(`Invalid Confluence short link code: ${code}`);
  }
  const base64 = code.replace(/-/g, '/').replace(/_/g, '+').padEnd(SHORT_LINK_BASE64_LENGTH, 'A');
  const bytes = Buffer.from(`${base64}=`, 'base64');
  let id = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) id = id * BYTE_BASE + BigInt(bytes[index]);
  if (id === 0n) throw new Error(`Invalid Confluence short link code: ${code}`);
  return id.toString();
}

export function issueKeyFromUrl(url: string, baseUrl: string): string {
  const parsed = assertSameSite(url, baseUrl);
  const target = `${parsed.pathname}${parsed.search}`;
  for (const pattern of ISSUE_URL_PATTERNS) {
    const match = target.match(pattern);
    if (match?.[1]) return normalizeIssueKey(match[1]);
  }
  throw new Error(`Unable to find a Jira issue key in URL: ${url}`);
}

export interface PageTarget {
  page_id?: string;
  url?: string;
}

export function resolvePageId(target: PageTarget, baseUrl: string, label = 'page'): string {
  if (target.page_id) return assertPageId(target.page_id, `${label} id`);
  if (target.url) return pageIdFromUrl(target.url, baseUrl);
  throw new Error(`Provide the ${label} id or URL.`);
}

export interface IssueTarget {
  ticket_key?: string;
  url?: string;
}

export function resolveIssueKey(target: IssueTarget, baseUrl: string): string {
  if (target.ticket_key) return normalizeIssueKey(target.ticket_key);
  if (target.url) return issueKeyFromUrl(target.url, baseUrl);
  throw new Error('Provide either url or ticket_key.');
}
