export interface AtlassianAuth {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface RequestOptions {
  errorContext: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Return 3xx responses to the caller instead of following them. */
  manualRedirect?: boolean;
}

export class AtlassianApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AtlassianApiError';
  }
}

export const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_ERROR_DETAIL_CHARS = 500;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAUTHORIZED = 401;

/**
 * Authenticated JSON client for one Atlassian Cloud site. Only site-relative
 * paths are accepted so credentials are never sent to another host.
 */
export class AtlassianHttp {
  readonly baseUrl: string;
  private readonly authorization: string;

  constructor(auth: AtlassianAuth) {
    if (!auth.baseUrl) throw new Error('ATLASSIAN_BASE_URL is required');
    if (!auth.email) throw new Error('ATLASSIAN_EMAIL is required');
    if (!auth.apiToken) throw new Error('ATLASSIAN_API_TOKEN is required');
    this.baseUrl = auth.baseUrl.replace(/\/+$/, '');
    const credentials = Buffer.from(`${auth.email}:${auth.apiToken}`, 'utf8').toString('base64');
    this.authorization = `Basic ${credentials}`;
  }

  async json<T>(path: string, options: RequestOptions): Promise<T> {
    const response = await this.send(path, options);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async send(path: string, options: RequestOptions): Promise<Response> {
    const response = await this.fetchWithRateLimitRetry(this.siteUrl(path), this.buildInit(options), options);
    if (response.ok) return response;
    if (options.manualRedirect && isRedirect(response.status)) return response;
    throw await toApiError(response, options.errorContext);
  }

  private siteUrl(path: string): string {
    if (!path.startsWith('/')) {
      throw new Error(`Refusing to call a non site-relative path: ${path}`);
    }
    return `${this.baseUrl}${path}`;
  }

  private buildInit(options: RequestOptions): RequestInit {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: 'application/json',
      ...options.headers,
    };
    const init: RequestInit = { method: options.method ?? 'GET', headers };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (options.manualRedirect) init.redirect = 'manual';
    return init;
  }

  private async fetchWithRateLimitRetry(
    url: string,
    init: RequestInit,
    options: RequestOptions,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchWithTimeout(url, init, options.errorContext);
      if (response.status !== HTTP_TOO_MANY_REQUESTS || attempt >= MAX_RATE_LIMIT_RETRIES) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      await sleep(retryDelayMs(response, attempt));
    }
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  errorContext: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`${errorContext}: request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
}

/** Query string with %20 for spaces (Atlassian does not always decode "+"). */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_DELAY_MS * (attempt + 1);
  return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toApiError(response: Response, context: string): Promise<AtlassianApiError> {
  const body = await response.text().catch(() => '');
  const detail = describeErrorBody(body);
  const hint =
    response.status === HTTP_UNAUTHORIZED
      ? ' Check ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN.'
      : '';
  const status = `${response.status} ${response.statusText}`.trim();
  return new AtlassianApiError(
    `${context}: ${status}${detail ? ` - ${detail}` : ''}${hint}`,
    response.status,
  );
}

function describeErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  const messages = parseErrorMessages(trimmed);
  if (messages.length) return truncate(messages.join('; '));
  if (trimmed.startsWith('<')) return '(HTML error page omitted)';
  return truncate(trimmed.replace(/\s+/g, ' '));
}

function parseErrorMessages(body: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  return [
    ...stringList(record.errorMessages),
    ...errorsField(record.errors),
    ...stringList([record.message, record.errorMessage]),
    ...nestedV1Errors(record.data),
  ];
}

function errorsField(errors: unknown): string[] {
  if (Array.isArray(errors)) {
    return errors.flatMap((error) => {
      if (typeof error === 'string') return [error];
      const item = (error ?? {}) as Record<string, unknown>;
      return stringList([item.detail ?? item.title ?? item.message ?? item.code]);
    });
  }
  if (errors && typeof errors === 'object') {
    return Object.entries(errors).map(([field, message]) => `${field}: ${String(message)}`);
  }
  return [];
}

function nestedV1Errors(data: unknown): string[] {
  const errors = (data as { errors?: unknown } | undefined)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((error) => {
    const message = (error as { message?: { translation?: unknown; key?: unknown } })?.message;
    return stringList([message?.translation ?? message?.key]);
  });
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_DETAIL_CHARS ? `${value.slice(0, MAX_ERROR_DETAIL_CHARS)}…` : value;
}
