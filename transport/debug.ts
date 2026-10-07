// MARQUEE_DEBUG: human-readable HTTP debug output on stderr, modeled on GitHub
// CLI's GH_DEBUG (ADR 0073). `1` prints one line per request; `api` adds
// headers, bodies and canceled (hedged) attempts, with credentials masked.
import { Buffer } from 'node:buffer';
import { isBinaryContentType, sanitizeRecordedTextBody } from './recording.js';

type DebugLevel = 'requests' | 'api';

const MASK = '████████████████████';
const MAX_RESPONSE_BODY_BYTES = 100_000;
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);

export function debugLevel(value: string | undefined): DebugLevel | undefined {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (['', '0', 'false', 'no'].includes(normalized)) return undefined;
  return normalized.includes('api') ? 'api' : 'requests';
}

/** Wraps `fetch` so each exchange is written to stderr as one block when it settles. */
export function createDebugFetch(fetchFn: typeof fetch | undefined, level: DebugLevel): typeof fetch {
  return async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method ?? 'GET';
    const startMs = performance.now();
    const elapsed = () => `${Math.round(performance.now() - startMs)}ms`;
    let response: Response;
    try {
      response = await (fetchFn ?? globalThis.fetch)(input, init);
    } catch (error) {
      const { message, canceled } = failure(error);
      if (level === 'api') {
        const outcome = canceled ? `canceled after ${elapsed()}` : `failed after ${elapsed()}: ${message}`;
        process.stderr.write(`${[...requestLines(url, method, init), `* Request ${outcome}`].join('\n')}\n`);
      } else if (!canceled) {
        process.stderr.write(`* ${method} ${url} failed ${elapsed()}: ${message}\n`);
      }
      throw error;
    }
    if (level === 'requests') {
      process.stderr.write(`* ${method} ${url} ${response.status} ${elapsed()}\n`);
      return response;
    }
    const { body, outcome } = await readableResponseBody(response);
    const lines = [
      ...requestLines(url, method, init),
      `< ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      ...headerLines('<', response.headers),
      '',
      ...body,
      `* Request ${outcome} ${elapsed()}`,
    ];
    process.stderr.write(`${lines.join('\n')}\n`);
    return response;
  };
}

function failure(error: unknown): { message: string; canceled: boolean } {
  return {
    message: error instanceof Error ? error.message : String(error),
    canceled: error instanceof Error && error.name === 'AbortError',
  };
}

function requestLines(url: URL, method: string, init: RequestInit): string[] {
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? init.body : '';
  return [
    `* Request to ${url}`,
    `> ${method} ${url.pathname}${url.search}`,
    ...headerLines('>', headers),
    '',
    // Stryker disable next-line StringLiteral: every request body is sent with a content-type
    ...(body ? [sanitizeRecordedTextBody(headers.get('content-type') ?? '', body), ''] : []),
  ];
}

function headerLines(prefix: string, headers: Headers): string[] {
  return [...headers].map(([name, value]) => `${prefix} ${name}: ${maskHeader(name, value)}`);
}

function maskHeader(name: string, value: string): string {
  if (!CREDENTIAL_HEADERS.has(name) && !name.includes('token')) return value;
  const [scheme, credential] = value.split(' ');
  return name === 'authorization' && credential ? `${scheme} ${MASK}` : MASK;
}

// The debug copy of the body may fail to read (a deadline, a reset, a canceled hedge);
// the block still prints, and transport's own read meets the failure as it would unwrapped.
async function readableResponseBody(response: Response): Promise<{ body: string[]; outcome: string }> {
  try {
    return { body: await responseBodyLines(response), outcome: 'took' };
  } catch (error) {
    const { message, canceled } = failure(error);
    return canceled
      ? { body: [], outcome: 'canceled after' }
      : { body: [`* body could not be read: ${message}`, ''], outcome: 'took' };
  }
}

async function responseBodyLines(response: Response): Promise<string[]> {
  const contentType = response.headers.get('content-type') ?? '';
  if (isBinaryContentType(contentType)) return [];
  const text = await response.clone().text();
  if (text === '') return [];
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_RESPONSE_BODY_BYTES) {
    return [`* body is too long (${bytes} bytes) to print, skipping (longer than ${MAX_RESPONSE_BODY_BYTES} bytes)`, ''];
  }
  return [sanitizeRecordedTextBody(contentType, text), ''];
}
