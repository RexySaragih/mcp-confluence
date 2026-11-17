type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

let savedFetch: typeof globalThis.fetch | undefined;

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function mockFetch(handlers: FetchHandler[]): void {
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    for (const handler of handlers) {
      const response = await handler(url, init);
      if (response) return response;
    }

    throw new Error(`Unmocked fetch: ${url} ${init?.method ?? 'GET'}`);
  }) as typeof fetch;
}

export function restoreMockFetch(): void {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
}

export interface RecordedRequest {
  url: string;
  method: string;
  body?: unknown;
}

/** Like mockFetch, but also returns a live log of every request made. */
export function mockFetchRecording(handlers: FetchHandler[]): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  const recorder: FetchHandler = (url, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url, method: init?.method ?? 'GET', body });
    return undefined;
  };
  mockFetch([recorder, ...handlers]);
  return requests;
}

export function route(
  matcher: string | RegExp,
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchHandler {
  return (url, init) => {
    const matches = typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url);
    return matches ? responder(url, init) : undefined;
  };
}
