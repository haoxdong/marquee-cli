// Request and response plumbing shared by the direct and proxy HTTP transports.
import type { HttpRequestInit } from './types.js';
import { MarqueeError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export function appendQuery(url: URL, query: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, String(item));
    }
  }
}

export interface RequestDeadline {
  signal: AbortSignal;
  // Classifies an AbortError as a caller cancel or a timeout; undefined for any other failure.
  abortError(error: unknown, path: string, timeoutSubject: string): MarqueeError | undefined;
  dispose(): void;
}

// Aborts on the caller's signal or after the request timeout, whichever comes first.
export function armRequestDeadline(init: Pick<HttpRequestInit, 'signal' | 'timeoutMs'>): RequestDeadline {
  const callerSignal = init.signal;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (callerSignal?.aborted) {
    abort();
  } else {
    callerSignal?.addEventListener('abort', abort, { once: true });
  }
  let hasTimedOut = false;
  const timeout = setTimeout(() => {
    hasTimedOut = true;
    abort();
  }, timeoutMs);
  return {
    signal: ac.signal,
    abortError: (error, path, timeoutSubject) => {
      if ((error as Error).name !== 'AbortError') return undefined;
      if (callerSignal?.aborted && !hasTimedOut) {
        return new MarqueeError('network', 'Request canceled after faster hedge completed', { path, isCanceled: true });
      }
      return new MarqueeError('timeout', `${timeoutSubject} timed out after ${timeoutMs / 1000}s`, { path });
    },
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abort);
    },
  };
}

// Branded so a JSON body that happens to carry status/location fields can
// never be mistaken for a surfaced redirect.
export interface RedirectResult {
  redirected: 'manual';
  status: number;
  location: string;
}

export function isRedirectResult(value: unknown): value is RedirectResult {
  return (
    typeof value === 'object' && value !== null &&
    (value as Partial<Record<keyof RedirectResult, unknown>>).redirected === 'manual' &&
    typeof (value as RedirectResult).status === 'number' &&
    typeof (value as RedirectResult).location === 'string'
  );
}

// Surfaces a 3xx with its Location header as sent when the caller asked for redirect: 'manual'.
export function manualRedirect(init: HttpRequestInit, response: Response): RedirectResult | undefined {
  if (init.redirect !== 'manual') return undefined;
  const location = response.headers.get('location');
  if (response.status < 300 || response.status >= 400 || location === null) return undefined;
  return {
    redirected: 'manual',
    status: response.status,
    location,
  };
}

export function assertExpectedContentType(
  expected: string | undefined,
  actual: string,
  status: number,
  path: string,
): void {
  const [mediaType] = actual.split(';', 1);
  if (!expected || mediaType?.trim().toLowerCase() === expected.toLowerCase()) return;
  throw new MarqueeError(
    'http',
    `Unexpected content type ${actual || '(missing)'} for ${path}; expected ${expected}`,
    { status, path, contentType: actual },
  );
}

// Reads the body as the caller's responseType, else as JSON ({} when empty);
// a non-JSON body throws the transport's own error.
export async function readResponseBody(
  response: Response,
  init: HttpRequestInit,
  nonJsonError: (text: string) => Error,
): Promise<unknown> {
  if (init.responseType === 'arrayBuffer') {
    return response.arrayBuffer();
  }
  if (init.responseType === 'text') {
    return response.text();
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw nonJsonError(text);
  }
}
