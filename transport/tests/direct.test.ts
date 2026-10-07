import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../direct.js';
import type { MarqueeError } from '../errors.js';
import type { CookieJar } from '../cookies.js';

/** The URL a fetch mock was called with. */
function hrefOf(url: RequestInfo | URL): string {
  return url instanceof Request ? url.url : String(url);
}

function makeJar(): CookieJar {
  return { cookies: [{ name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' }], updatedAt: 0 };
}

function makeJarWithCsrf(): CookieJar {
  return {
    cookies: [
      { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
      { name: 'MARQUEE-CSRF-TOKEN', value: 'csrf-token', domain: 'marquee.gs.com', path: '/' },
    ],
    updatedAt: 0,
  };
}

function makeJarWithIdToken(): CookieJar {
  return {
    cookies: [
      { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
      { name: 'MarqueeIdToken', value: 'jwt-token', domain: 'marquee.gs.com', path: '/' },
      { name: 'MARQUEE-CSRF-TOKEN', value: 'csrf-token', domain: 'marquee.gs.com', path: '/' },
    ],
    updatedAt: 0,
  };
}

function makeJarWithResearchCookies(): CookieJar {
  return {
    cookies: [
      { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
      { name: 'MarqueeLogin', value: 'login', domain: 'marquee.gs.com', path: '/' },
      { name: 'MarqueeIdToken', value: 'jwt-token', domain: 'marquee.gs.com', path: '/' },
      { name: 'MARQUEE-CSRF-TOKEN', value: 'csrf-token', domain: 'marquee.gs.com', path: '/' },
      { name: 'JSESSIONID', value: 'research-js', domain: 'marquee.gs.com', path: '/' },
      { name: 'session', value: 'research-session', domain: 'marquee.gs.com', path: '/' },
      { name: 'panama_scope_id', value: 'research-scope', domain: 'marquee.gs.com', path: '/' },
      { name: 'panama_scope_started', value: 'research-started', domain: 'marquee.gs.com', path: '/' },
    ],
    updatedAt: 0,
  };
}

function mockFetch(response: Partial<{
  status: number;
  body: unknown;
  setCookie: string;
  headers: Record<string, string>;
}>) {
  const status = response.status ?? 200;
  const body = response.body ?? {};
  const headers = new Headers({
    'content-type': 'application/json',
    ...response.headers,
  });
  if (response.setCookie) {
    headers.append('set-cookie', response.setCookie);
  }
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));
}

interface ClassificationResponse {
  status: number;
  contentType: string;
  body: string;
}

type ClassificationExpectation =
  | { kind: 'success'; value: unknown }
  | { kind: 'error'; code: 'auth_expired' | 'http' };

interface ClassificationCase {
  name: string;
  path: string;
  init?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    responseType?: 'json' | 'text' | 'arrayBuffer';
    isHtmlAccepted?: boolean;
  };
  responses: ClassificationResponse[];
  expected: ClassificationExpectation;
  calls: number;
}

function classificationResponse(response: ClassificationResponse): Response {
  return new Response(response.body, {
    status: response.status,
    headers: new Headers({ 'content-type': response.contentType }),
  });
}

function stalledBodyFetch(status: number, contentType = 'application/json'): typeof fetch {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    const stream = new ReadableStream({
      start(controller) {
        const failSlowly = setTimeout(() => controller.error(new Error('body remained stalled')), 100);
        const onAbort = () => {
          clearTimeout(failSlowly);
          controller.error(new DOMException('aborted', 'AbortError'));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      },
    });
    return new Response(stream, {
      status,
      headers: new Headers({ 'content-type': contentType }),
    });
  });
}

function researchHtmlRequest(html: string) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  const fetchFn = vi.fn().mockResolvedValue(
    new Response(html, { status: 200, headers }),
  );
  const transport = new HttpTransport({
    jar: makeJar(),
    jarPath: '/dev/null',
    fetchFn,
  });
  const response = transport.request('/content/research/en/reports/doc-1.html', {
    isHtmlAccepted: true,
    responseType: 'text',
  });
  return { response, fetchFn };
}

async function expectAcceptedResearchHtml(html: string): Promise<void> {
  const { response, fetchFn } = researchHtmlRequest(html);
  await expect(response).resolves.toBe(html);
  expect(fetchFn).toHaveBeenCalledTimes(1);
}

async function expectResearchHtmlAuthFailure(
  html: string,
  diagnostic?: string,
): Promise<void> {
  const { response, fetchFn } = researchHtmlRequest(html);
  await expect(response).rejects.toMatchObject({
    code: 'auth_expired',
    message: expect.stringContaining('Access denied or session expired'),
    details: expect.objectContaining({
      contentType: 'text/html; charset=utf-8',
      ...(diagnostic === undefined
        ? {}
        : { body: expect.stringContaining(diagnostic) }),
    }),
  });
  expect(fetchFn).toHaveBeenCalledTimes(1);
}

describe('HttpTransport', () => {
  it('keeps the diagnostic preview bound for ordinary typed requests', async () => {
    const body = 'fixture '.repeat(150);
    const fetchFn = vi.fn().mockResolvedValue(new Response(body, { status: 400 }));
    const transport = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    const failure = await transport.request('/v1/probe').catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'http', details: { status: 400 } });
    expect((failure as MarqueeError).details?.body).toHaveLength(1024);
  });
  it('attaches Cookie + Origin headers and returns parsed JSON on 200', async () => {
    const jar = makeJar();
    const fetchFn = mockFetch({ body: { ok: true } });
    const t = new HttpTransport({ jar, jarPath: '/dev/null', fetchFn });

    const result = await t.request('/v1/users/self');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://marquee.gs.com/v1/users/self');
    expect((init.headers as Record<string, string>).Cookie).toContain('sid=abc');
    expect((init.headers as Record<string, string>).Origin).toBe('https://marquee.gs.com');
  });

  it.each([
    ['successful', 200],
    ['non-2xx', 503],
  ])('bounds a stalled %s response body by the request deadline', async (_name, status) => {
    const t = new HttpTransport({
      jar: makeJar(),
      jarPath: '/dev/null',
      fetchFn: stalledBodyFetch(status),
      saveFn: () => {},
    });

    await expect(t.request('/v1/x', { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
      details: { path: '/v1/x' },
    });
  });

  it('bounds a stalled HTML response body before classifying authentication', async () => {
    const t = new HttpTransport({
      jar: makeJar(),
      jarPath: '/dev/null',
      fetchFn: stalledBodyFetch(200, 'text/html'),
      saveFn: () => {},
    });

    await expect(t.request('/research/session-exchange', { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
      details: { path: '/research/session-exchange' },
    });
  });

  it.each([
    ['text', 'text'],
    ['array buffer', 'arrayBuffer'],
  ] as const)('bounds a stalled %s response body by the request deadline', async (_name, responseType) => {
    const t = new HttpTransport({
      jar: makeJar(),
      jarPath: '/dev/null',
      fetchFn: stalledBodyFetch(200),
      saveFn: () => {},
    });

    await expect(t.request('/v1/x', { timeoutMs: 20, responseType })).rejects.toMatchObject({
      code: 'timeout',
      details: { path: '/v1/x' },
    });
  });

  it('sends browser-equivalent MarketView headers and bearer auth when an id token is present', async () => {
    const fetchFn = mockFetch({ body: { ok: true } });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await t.request('/v1/marketview/widgets/MW1');

    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt-token',
      Referer: 'https://marquee.gs.com/s/marketview/',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Dash-AppId': 'MarketView',
      'X-Application': 'mqda-mv',
      'X-Flatten-Status': 'true',
    });
  });

  it('sends research session-exchange without an id-token bearer', async () => {
    const fetchFn = mockFetch({ body: { token: 'research-token' } });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await t.request('/research/session-exchange');

    const [, init] = fetchFn.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Referer).toBe('https://marquee.gs.com/content/research/site/search.html');
    expect(headers.Cookie).toContain('sid=abc');
  });

  it('does not retry research session-exchange through tokenExchange on 401', async () => {
    const fetchFn = mockFetch({ status: 401, body: { message: 'unauthorized' } });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/session-exchange')).rejects.toMatchObject({ code: 'auth_expired' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://marquee.gs.com/research/session-exchange');
  });

  it('allows advanced-search requests to override Accept and Authorization headers', async () => {
    const fetchFn = mockFetch({ body: { ok: true } });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await t.request('/research/search/reports/advanced-search', {
      method: 'POST',
      headers: {
        Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
        Authorization: 'Bearer research-session-token',
      },
      body: { filter: '(all EQ ${(US CPI)}$)' },
    });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers).toMatchObject({
      Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
      Authorization: 'Bearer research-session-token',
      Referer: 'https://marquee.gs.com/content/research/site/search.html',
      'Content-Type': 'application/json;charset=utf-8',
    });
  });

  it('sends advanced-search cookie-only, never attaching an id-token bearer', async () => {
    // The research realm authorizes on the Marquee session cookies alone; the MarketView
    // id-token/access-token bearer is actively rejected there (401). So the
    // transport must not fall back to it for /research/* search requests.
    const fetchFn = mockFetch({ body: { resultCount: 1 } });
    const t = new HttpTransport({ jar: makeJarWithResearchCookies(), jarPath: '/dev/null', fetchFn });

    await t.request('/research/search/reports/advanced-search', {
      method: 'POST',
      headers: { Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8' },
      body: { filter: '(all EQ ${(US CPI)}$)' },
    });

    const [, init] = fetchFn.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toContain('session=research-session');
    expect(headers.Referer).toBe('https://marquee.gs.com/content/research/site/search.html');
  });

  it('does not retry advanced-search through tokenExchange on 401', async () => {
    const fetchFn = mockFetch({ status: 401, body: { message: 'Unauthorized' } });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/search/reports/advanced-search', {
      method: 'POST',
      headers: { Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8' },
      body: { filter: '(all EQ ${(US CPI)}$)' },
    })).rejects.toMatchObject({ code: 'auth_expired' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns array buffers for binary response requests', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
    }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    const result = await t.request('/content/research/en/reports/doc-1.pdf', {
      headers: { Accept: 'application/pdf' },
      responseType: 'arrayBuffer',
    });

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual([1, 2, 3]);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers).toMatchObject({ Accept: 'application/pdf' });
  });

  it('mints the access token before the first DV render POST', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = hrefOf(url);
      const headers = init?.headers as Record<string, string>;
      if (href === 'https://marquee.gs.com/tokenExchange') {
        return new Response(JSON.stringify({
          accessToken: 'access-token',
          expiryInMillis: 300_000,
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href === 'https://marquee.gs.com/v1/data/visualizations/DV1/render') {
        return new Response(JSON.stringify({
          authentication: headers.Authorization,
          appId: headers['X-Dash-AppId'],
          xApplication: headers['X-Application'],
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      throw new Error(`unexpected request ${href}`);
    });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/data/visualizations/DV1/render', {
      method: 'POST',
      body: { component: {}, visualization: {}, references: { configId: 'WC1' } },
    })).resolves.toEqual({ authentication: 'Bearer access-token', appId: 'MarketView', xApplication: 'mqda-mv' });

    expect(fetchFn.mock.calls.map(([url]) => hrefOf(url))).toEqual([
      'https://marquee.gs.com/tokenExchange',
      'https://marquee.gs.com/v1/data/visualizations/DV1/render',
    ]);
  });

  it('keeps research-realm cookies off MarketView token and DV render requests', async () => {
    let tokenCookie = '';
    let renderCookie = '';
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = hrefOf(url);
      const headers = init?.headers as Record<string, string>;
      if (href === 'https://marquee.gs.com/tokenExchange') {
        tokenCookie = headers.Cookie;
        return new Response(JSON.stringify({
          accessToken: 'access-token',
          expiryInMillis: 300_000,
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href === 'https://marquee.gs.com/v1/data/visualizations/DV1/render') {
        renderCookie = headers.Cookie;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      throw new Error(`unexpected request ${href}`);
    });
    const t = new HttpTransport({ jar: makeJarWithResearchCookies(), jarPath: '/dev/null', fetchFn });

    await t.request('/v1/data/visualizations/DV1/render', {
      method: 'POST',
      body: { component: {}, visualization: {}, references: { configId: 'WC1' } },
    });

    for (const cookie of [tokenCookie, renderCookie]) {
      expect(cookie).toContain('MarqueeLogin=login');
      expect(cookie).toContain('MarqueeIdToken=jwt-token');
      expect(cookie).not.toContain('JSESSIONID=research-js');
      expect(cookie).not.toContain('session=research-session');
      expect(cookie).not.toContain('panama_scope_id=research-scope');
      expect(cookie).not.toContain('panama_scope_started=research-started');
    }
  });

  it('keeps research-realm cookies on research requests', async () => {
    const fetchFn = mockFetch({ body: { token: 'research-token' } });
    const t = new HttpTransport({ jar: makeJarWithResearchCookies(), jarPath: '/dev/null', fetchFn });

    await t.request('/research/session-exchange');

    const [, init] = fetchFn.mock.calls[0];
    const cookie = (init.headers as Record<string, string>).Cookie;
    expect(cookie).toContain('JSESSIONID=research-js');
    expect(cookie).toContain('session=research-session');
    expect(cookie).toContain('panama_scope_id=research-scope');
    expect(cookie).toContain('panama_scope_started=research-started');
  });

  it('throws MarqueeError(auth_expired) on 401', async () => {
    const fetchFn = mockFetch({ status: 401, body: { error: 'unauth' } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await expect(t.request('/v1/x')).rejects.toMatchObject({ code: 'auth_expired' });
  });

  it('keeps ordinary 401 response bodies out of the generic auth contract', async () => {
    const fetchFn = mockFetch({ status: 401, body: { messages: ['Log-in URL: https://idfs.gs.com/login'] } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    try {
      await t.request('/v1/marketview/widgets/MW1');
      throw new Error('expected auth_expired');
    } catch (e) {
      expect(e).toMatchObject({
        code: 'auth_expired',
        message: 'Not authenticated. Run: marquee auth login',
        details: { status: 401, path: '/v1/marketview/widgets/MW1' },
      });
      expect((e as { details?: Record<string, unknown> }).details).not.toHaveProperty('body');
    }
  });

  it('surfaces an entitlement 401 as the real error, not "auth login"', async () => {
    const fetchFn = mockFetch({ status: 401, body: { errorMessages: ['User is not entitled to view this resource'] } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    const err = await t.request('/v1/data/visualizations/DV1/render', { method: 'POST', body: {} })
      .then(() => null, (e: unknown) => e);

    expect(err).toMatchObject({
      code: 'http',
      details: {
        status: 401,
        body: expect.stringContaining('not entitled'),
        responseClassification: 'entitlement_401',
      },
    });
    expect((err as { message: string }).message).not.toContain('marquee auth login');
  });

  it('surfaces an entity-resolution 401 as the real error, not "auth login"', async () => {
    // Marquee mis-statuses an app-level "Error getting entity" as HTTP 401. It is NOT
    // an auth failure (the session is valid), so it must surface the real error rather
    // than sending the user to re-login. No retry — the failure is not a load transient.
    const fetchFn = mockFetch({ status: 401, body: { detail: "Error getting entity = 'DV_TEST'." } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    const err = await t.request('/v1/marketview/widgets/MW1').then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({
      code: 'http',
      details: {
        status: 401,
        body: expect.stringContaining('Error getting entity'),
        responseClassification: 'entity_401',
      },
    });
    expect((err as { message: string }).message).not.toContain('marquee auth login');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('omits retry timing from a rate-limit failure without Retry-After', async () => {
    const transport = new HttpTransport({
      jar: makeJar(),
      jarPath: '/dev/null',
      fetchFn: mockFetch({ status: 429, body: { detail: 'rate limit' } }),
    });

    const error: unknown = await transport.request('/v1/marketview/widgets/MW1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ details: { status: 429 } });
    expect((error as MarqueeError).details).not.toHaveProperty('retryAfterMs');
  });

  it('keeps Retry-After timing off a failure that is not a rate limit', async () => {
    const transport = new HttpTransport({
      jar: makeJar(),
      jarPath: '/dev/null',
      fetchFn: mockFetch({ status: 503, body: { detail: 'unavailable' }, headers: { 'retry-after': '5' } }),
    });

    const error: unknown = await transport.request('/v1/marketview/widgets/MW1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ details: { status: 503 } });
    expect((error as MarqueeError).details).not.toHaveProperty('retryAfterMs');
  });

  it('preserves provider retry timing on rate-limit failures', async () => {
    const transport = new HttpTransport({
      jar: makeJar(),
      jarPath: '/dev/null',
      fetchFn: mockFetch({
        status: 429,
        body: { detail: 'rate limit' },
        headers: { 'retry-after': '2.5' },
      }),
    });

    await expect(transport.request('/v1/marketview/widgets/MW1')).rejects.toMatchObject({
      details: {
        status: 429,
        retryAfterMs: 2_500,
      },
    });
  });

  it('bounds a stalled 401 body read by the request deadline instead of hanging', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      const stream = new ReadableStream({
        start(controller) {
          // Headers arrive, but the body never streams — only the request timer
          // firing (via the abort signal) settles it.
          const onAbort = () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            controller.error(err);
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        },
      });
      return new Response(stream, { status: 401, headers: new Headers({ 'content-type': 'application/json' }) });
    });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    // Headers already proved a 401; a stalled diagnostic body read must be bounded
    // without replacing the classified auth failure with a timeout.
    await expect(t.request('/v1/marketview/widgets/MW1', { timeoutMs: 50 })).rejects.toMatchObject({
      code: 'auth_expired',
      message: 'Not authenticated. Run: marquee auth login',
      details: { status: 401, path: '/v1/marketview/widgets/MW1' },
    });
  });

  it('a genuine (non-entity) 401 still directs to auth login', async () => {
    const fetchFn = mockFetch({ status: 401, body: { error: 'unauth' } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).rejects.toMatchObject({
      code: 'auth_expired',
      message: 'Not authenticated. Run: marquee auth login',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('exchanges the id token for an access token and retries a 401 once', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = hrefOf(url);
      const headers = init?.headers as Record<string, string>;
      if (href === 'https://marquee.gs.com/v1/marketview/widgets/MW1' && headers.Authorization === 'Bearer jwt-token') {
        return new Response(JSON.stringify({ error: 'unauth' }), {
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href === 'https://marquee.gs.com/tokenExchange') {
        expect(init?.method).toBe('POST');
        expect(headers.Authorization).toBe('Bearer jwt-token');
        expect(headers['User-Agent']).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        expect(headers['Accept-Language']).toBe('en-US,en;q=0.9');
        expect(headers['X-MARQUEE-CSRF-TOKEN']).toBe('csrf-token');
        return new Response(JSON.stringify({
          accessToken: 'access-token',
          expiryInMillis: 300_000,
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href === 'https://marquee.gs.com/v1/marketview/widgets/MW1' && headers.Authorization === 'Bearer access-token') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      throw new Error(`unexpected request ${href} ${headers.Authorization}`);
    });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).resolves.toEqual({ ok: true });

    expect(fetchFn.mock.calls.map(([url]) => hrefOf(url))).toEqual([
      'https://marquee.gs.com/v1/marketview/widgets/MW1',
      'https://marquee.gs.com/tokenExchange',
      'https://marquee.gs.com/v1/marketview/widgets/MW1',
    ]);
  });

  // Token exchange is an auth-recovery attempt after the original request already
  // returned 401. If recovery cannot mint a token, the command still fails loudly
  // with the original classified auth error instead of a secondary diagnostic.
  it.each([
    ['non-ok response', new Response(JSON.stringify({ error: 'exchange failed' }), {
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
    })],
    ['HTML response', new Response('<html><body>Access denied</body></html>', {
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    })],
    ['empty body', new Response('', {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    })],
    ['malformed JSON', new Response('{not-json', {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    })],
  ])('surfaces the original 401 when tokenExchange returns a %s', async (_name, tokenExchangeResponse) => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      const href = hrefOf(url);
      if (href === 'https://marquee.gs.com/v1/marketview/widgets/MW1') {
        return new Response(JSON.stringify({ error: 'unauth' }), {
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href === 'https://marquee.gs.com/tokenExchange') {
        return tokenExchangeResponse;
      }
      throw new Error(`unexpected request ${href}`);
    });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).rejects.toMatchObject({
      code: 'auth_expired',
      message: 'Not authenticated. Run: marquee auth login',
    });
    expect(fetchFn.mock.calls.map(([url]) => hrefOf(url))).toEqual([
      'https://marquee.gs.com/v1/marketview/widgets/MW1',
      'https://marquee.gs.com/tokenExchange',
    ]);
  });

  it('refreshes the access token after its exchange expiry window elapses', async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let tokenExchangeCount = 0;
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = hrefOf(url);
      const headers = init?.headers as Record<string, string>;
      if (href === 'https://marquee.gs.com/tokenExchange') {
        tokenExchangeCount += 1;
        return new Response(JSON.stringify({
          accessToken: `access-token-${tokenExchangeCount}`,
          expiryInMillis: 31_000,
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href.startsWith('https://marquee.gs.com/v1/data/visualizations/')) {
        return new Response(JSON.stringify({ authentication: headers.Authorization }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      throw new Error(`unexpected request ${href}`);
    });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });
    try {
      await expect(t.request('/v1/data/visualizations/DV1/render', {
        method: 'POST',
        body: {},
      })).resolves.toEqual({
        authentication: 'Bearer access-token-1',
      });
      now += 1_001;
      await expect(t.request('/v1/data/visualizations/DV2/render', {
        method: 'POST',
        body: {},
      })).resolves.toEqual({
        authentication: 'Bearer access-token-2',
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(fetchFn.mock.calls.map(([url]) => hrefOf(url))).toEqual([
      'https://marquee.gs.com/tokenExchange',
      'https://marquee.gs.com/v1/data/visualizations/DV1/render',
      'https://marquee.gs.com/tokenExchange',
      'https://marquee.gs.com/v1/data/visualizations/DV2/render',
    ]);
  });

  it('retries a transient 200 HTML API response before parsing JSON', async () => {
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('<html><body>Gateway timeout</body></html>', { status: 200, headers }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }));
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).resolves.toEqual({ ok: true });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([url]) => hrefOf(url))).toEqual([
      'https://marquee.gs.com/v1/marketview/widgets/MW1',
      'https://marquee.gs.com/v1/marketview/widgets/MW1',
    ]);
  });

  it('retries a transient 200 access-denied API HTML response before parsing JSON', async () => {
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('<html><body>Access denied</body></html>', { status: 200, headers }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: 'MD1', title: 'Market Regime' }],
      }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }));
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/dashboards', {
      query: { view_as: 'edit', size: 100, page: 1 },
    })).resolves.toEqual({
      results: [{ id: 'MD1', title: 'Market Regime' }],
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([url]) => hrefOf(url))).toEqual([
      'https://marquee.gs.com/v1/marketview/dashboards?view_as=edit&size=100&page=1',
      'https://marquee.gs.com/v1/marketview/dashboards?view_as=edit&size=100&page=1',
    ]);
  });

  it('reports persistent generic 200 API HTML as an upstream failure after one retry', async () => {
    const html = `<!DOCTYPE html>
      <!-- saved from url=(0151)file:///error-pages/templates/akamai.html -->
      <html><body><h1>Access Denied</h1><p>Reference #18.gateway</p></body></html>`;
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockImplementation(async () => (
      new Response(html, { status: 200, headers })
    ));
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).rejects.toMatchObject({
      code: 'http',
      message: 'Unexpected HTML response for /v1/marketview/widgets/MW1',
      details: expect.objectContaining({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: expect.stringContaining('akamai.html'),
      }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not treat authentication vocabulary inside a gateway page as positive auth evidence', async () => {
    const html = `<!DOCTYPE html><html><body>
      <h1>Bad Gateway</h1>
      <p>The SSO upstream is temporarily unavailable.</p>
      <p>Reference #18.gateway</p>
    </body></html>`;
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockImplementation(async () => (
      new Response(html, { status: 200, headers })
    ));
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).rejects.toMatchObject({
      code: 'http',
      message: 'Unexpected HTML response for /v1/marketview/widgets/MW1',
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not treat isolated authentication vocabulary as positive auth evidence', async () => {
    const html = '<!DOCTYPE html><html><body><p>The login service is temporarily unavailable.</p></body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockImplementation(async () => (
      new Response(html, { status: 200, headers })
    ));
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/marketview/widgets/MW1')).rejects.toMatchObject({
      code: 'http',
      message: 'Unexpected HTML response for /v1/marketview/widgets/MW1',
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports generic HTML from an ineligible JSON API request as an upstream failure without retrying', async () => {
    const html = '<!DOCTYPE html><html><body><h1>Access Denied</h1><p>Reference #18.gateway</p></body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers }));
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/search/reports/advanced-search', {
      method: 'POST',
      body: { query: 'rates' },
    })).rejects.toMatchObject({
      code: 'http',
      message: 'Unexpected HTML response for /research/search/reports/advanced-search',
      details: expect.objectContaining({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: expect.stringContaining('Reference #18.gateway'),
      }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each<ClassificationCase>([
    {
      name: 'ordinary JSON succeeds',
      path: '/v1/example',
      responses: [{ status: 200, contentType: 'application/json', body: '{"ok":true}' }],
      expected: { kind: 'success', value: { ok: true } },
      calls: 1,
    },
    {
      name: 'transient generic HTML retries once and succeeds',
      path: '/v1/example',
      responses: [
        { status: 200, contentType: 'text/html', body: '<html><body>Gateway timeout</body></html>' },
        { status: 200, contentType: 'application/json', body: '{"ok":true}' },
      ],
      expected: { kind: 'success', value: { ok: true } },
      calls: 2,
    },
    {
      name: 'persistent generic HTML becomes an upstream failure',
      path: '/v1/example',
      responses: [
        { status: 200, contentType: 'text/html', body: '<html><body>Gateway timeout</body></html>' },
        { status: 200, contentType: 'text/html', body: '<html><body>Gateway timeout</body></html>' },
      ],
      expected: { kind: 'error', code: 'http' },
      calls: 2,
    },
    {
      name: 'gateway HTML containing SSO vocabulary remains an upstream failure',
      path: '/v1/example',
      responses: [
        { status: 200, contentType: 'text/html', body: '<html><h1>Bad Gateway</h1><p>SSO upstream unavailable. Reference #18.gateway</p></html>' },
        { status: 200, contentType: 'text/html', body: '<html><h1>Bad Gateway</h1><p>SSO upstream unavailable. Reference #18.gateway</p></html>' },
      ],
      expected: { kind: 'error', code: 'http' },
      calls: 2,
    },
    {
      name: 'gateway HTML with login outage vocabulary in a heading remains an upstream failure',
      path: '/v1/example',
      responses: [
        { status: 200, contentType: 'text/html', body: '<html><h1>Login service unavailable</h1><p>Bad Gateway</p></html>' },
        { status: 200, contentType: 'text/html', body: '<html><h1>Login service unavailable</h1><p>Bad Gateway</p></html>' },
      ],
      expected: { kind: 'error', code: 'http' },
      calls: 2,
    },
    {
      name: 'gateway HTML with SSO outage vocabulary in a title remains an upstream failure',
      path: '/v1/example',
      responses: [
        { status: 200, contentType: 'text/html', body: '<html><title>SSO outage</title><body><h1>Bad Gateway</h1></body></html>' },
        { status: 200, contentType: 'text/html', body: '<html><title>SSO outage</title><body><h1>Bad Gateway</h1></body></html>' },
      ],
      expected: { kind: 'error', code: 'http' },
      calls: 2,
    },
    {
      name: 'recognizable login HTML expires authentication without retrying',
      path: '/v1/example',
      responses: [{ status: 200, contentType: 'text/html', body: '<html><body><form action="/idfs"><input name="pf.username"><input type="password" name="pf.pass"></form></body></html>' }],
      expected: { kind: 'error', code: 'auth_expired' },
      calls: 1,
    },
    {
      name: 'recognizable login HTML wins over gateway vocabulary without retrying',
      path: '/v1/example',
      responses: [{ status: 200, contentType: 'text/html', body: '<html><body><form action="/idfs"><input name="pf.username"><input type="password" name="pf.pass"></form><footer>Akamai Reference #18.login</footer></body></html>' }],
      expected: { kind: 'error', code: 'auth_expired' },
      calls: 1,
    },
    {
      name: 'explicitly accepted article HTML succeeds',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><body><article>Research body</article></body></html>' }],
      expected: { kind: 'success', value: '<html><body><article>Research body</article></body></html>' },
      calls: 1,
    },
    {
      name: 'accepted article prose may discuss authentication',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><body><article><h1>Identity outlook</h1><p>This research discusses SSO login flows as article prose.</p></article></body></html>' }],
      expected: { kind: 'success', value: '<html><body><article><h1>Identity outlook</h1><p>This research discusses SSO login flows as article prose.</p></article></body></html>' },
      calls: 1,
    },
    {
      name: 'accepted article prose may discuss gateway vocabulary',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><head><title>Akamai Technologies outlook</title></head><body><article><h1>Akamai Technologies outlook</h1><p>We compare gateway timeout and proxy error rates while an upstream service is unavailable.</p></article></body></html>' }],
      expected: { kind: 'success', value: '<html><head><title>Akamai Technologies outlook</title></head><body><article><h1>Akamai Technologies outlook</h1><p>We compare gateway timeout and proxy error rates while an upstream service is unavailable.</p></article></body></html>' },
      calls: 1,
    },
    {
      name: 'explicitly accepted HTML still rejects a recognizable gateway page',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><h1>Gateway timeout</h1><p>Reference #18.gateway</p></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'accepted HTML with generic access-denied gateway prose remains an upstream failure',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><h1>Access Denied</h1><p>Reference #18.gateway</p></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'accepted HTML rejects a sparse semantic article wrapper around a gateway shell',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><article><h1>Access Denied</h1><p>Reference #18.gateway</p></article></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'accepted HTML rejects a gateway shell after a long article whose paragraphs are left unclosed',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><article><p>Rates rallied through the quarter as inflation cooled.<p>We expect curve steepening to continue into next year.</article><p>Reference #18.gateway</p></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'accepted HTML with a bare access-denied shell remains an upstream failure',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><h1>Access Denied</h1></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'accepted HTML with access-denied administrator guidance remains an upstream failure',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><p>Access denied. Contact your administrator.</p></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'accepted HTML with access-denied login guidance expires authentication',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><p>Access denied. Please sign in again.</p></html>' }],
      expected: { kind: 'error', code: 'auth_expired' },
      calls: 1,
    },
    {
      name: 'explicitly accepted HTML preserves login evidence over gateway vocabulary',
      path: '/content/research/en/reports/doc.html',
      init: { isHtmlAccepted: true, responseType: 'text' },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><body><form action="/idfs"><input type="password" name="pf.pass"></form><footer>Akamai Reference #18.login</footer></body></html>' }],
      expected: { kind: 'error', code: 'auth_expired' },
      calls: 1,
    },
    {
      name: 'a genuine 401 expires authentication',
      path: '/v1/example',
      responses: [{ status: 401, contentType: 'application/json', body: '{"error":"expired"}' }],
      expected: { kind: 'error', code: 'auth_expired' },
      calls: 1,
    },
    {
      name: 'a gateway-shaped HTML 401 preserves its upstream classification',
      path: '/v1/example',
      responses: [{ status: 401, contentType: 'text/html', body: '<html><h1>Access Denied</h1><p>Reference #18.gateway</p></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'a login-form HTML 401 remains an authentication failure despite gateway vocabulary',
      path: '/v1/example',
      responses: [{ status: 401, contentType: 'text/html', body: '<html><form action="/idfs"><input type="password" name="pf.pass"></form><footer>Reference #18.login</footer></html>' }],
      expected: { kind: 'error', code: 'auth_expired' },
      calls: 1,
    },
    {
      name: 'a structured entity 401 preserves its upstream classification',
      path: '/v1/example',
      responses: [{ status: 401, contentType: 'application/json', body: '{"error":"Error getting entity for example"}' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'a structured entitlement 401 preserves its upstream classification',
      path: '/v1/example',
      responses: [{ status: 401, contentType: 'application/json', body: '{"errorMessages":["User is not entitled to view this resource"]}' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'rate limiting preserves its upstream classification',
      path: '/v1/example',
      responses: [{ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'malformed non-HTML success becomes an upstream failure',
      path: '/v1/example',
      responses: [{ status: 200, contentType: 'text/plain', body: 'not json' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
    {
      name: 'mutation requests never gain an HTML retry',
      path: '/v1/example',
      init: { method: 'POST', body: { value: 1 } },
      responses: [{ status: 200, contentType: 'text/html', body: '<html><body>Gateway timeout</body></html>' }],
      expected: { kind: 'error', code: 'http' },
      calls: 1,
    },
  ])('enforces the response-classification decision table: $name', async (testCase) => {
    const fetchFn = vi.fn();
    for (const response of testCase.responses) {
      fetchFn.mockResolvedValueOnce(classificationResponse(response));
    }
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    const result = t.request(testCase.path, testCase.init);
    if (testCase.expected.kind === 'success') {
      await expect(result).resolves.toEqual(testCase.expected.value);
    } else {
      await expect(result).rejects.toMatchObject({ code: testCase.expected.code });
    }
    expect(fetchFn).toHaveBeenCalledTimes(testCase.calls);
  });

  it('throws MarqueeError(http) with status + body on 5xx', async () => {
    const fetchFn = mockFetch({ status: 500, body: { error: 'boom' } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await expect(t.request('/v1/x')).rejects.toMatchObject({
      code: 'http',
      details: expect.objectContaining({ status: 500 }),
    });
  });

  it('throws MarqueeError(network) when fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await expect(t.request('/v1/x')).rejects.toMatchObject({ code: 'network' });
  });

  it('explains how to fix NO_PROXY when direct Marquee DNS fails behind a configured proxy', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');
    vi.stubEnv('NO_PROXY', '.gs.com');
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND marquee.gs.com'), {
      code: 'ENOTFOUND',
      hostname: 'marquee.gs.com',
    });
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    try {
      await expect(t.request('/v1/x')).rejects.toThrow(
        'NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1"',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the ordinary DNS error when NO_PROXY does not match Marquee', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');
    vi.stubEnv('NO_PROXY', 'example.com');
    vi.stubEnv('no_proxy', 'localhost');
    const fetchFn = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND marquee.gs.com'));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    try {
      await expect(t.request('/v1/x')).rejects.toThrow(
        'Cannot reach https://marquee.gs.com: getaddrinfo ENOTFOUND marquee.gs.com',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reports caller-aborted requests as canceled instead of transport timeouts', async () => {
    const ac = new AbortController();
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    ));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    const request = t.request('/v1/x', { signal: ac.signal });

    ac.abort();

    await expect(request).rejects.toMatchObject({
      code: 'network',
      message: 'Request canceled after faster hedge completed',
      details: expect.objectContaining({ isCanceled: true }),
    });
  });

  it('reports its own request deadline as a transport timeout', async () => {
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    ));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/v1/x', { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'timeout',
      message: 'Request timed out after 0.01s',
      details: { path: '/v1/x' },
    });
  });

  it('updates the jar from Set-Cookie and persists on change', async () => {
    const jar = makeJar();
    const saved: CookieJar[] = [];
    const fetchFn = mockFetch({ setCookie: 'newSid=v2; Domain=marquee.gs.com; Path=/' });
    const t = new HttpTransport({
      jar,
      jarPath: '/tmp/test-jar.json',
      fetchFn,
      saveFn: (_p, j) => {
        saved.push(j);
      },
    });

    await t.request('/v1/users/self');

    expect(saved).toHaveLength(1);
    expect(jar.cookies.find((c) => c.name === 'newSid')?.value).toBe('v2');
  });

  it('fails the request when changed cookies cannot be persisted', async () => {
    const jar = makeJar();
    const fetchFn = mockFetch({ setCookie: 'newSid=v2; Domain=marquee.gs.com; Path=/' });
    const t = new HttpTransport({
      jar,
      jarPath: '/tmp/test-jar.json',
      fetchFn,
      saveFn: () => {
        throw new Error('persist failed');
      },
    });

    await expect(t.request('/v1/users/self')).rejects.toMatchObject({
      code: 'persistence',
      message: 'Failed to persist cookie jar /tmp/test-jar.json: persist failed',
      details: expect.objectContaining({
        path: '/v1/users/self',
        jarPath: '/tmp/test-jar.json',
      }),
    });
  });

  it('sends POST with JSON body and Content-Type', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/things', { method: 'POST', body: { x: 1 } });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json;charset=utf-8');
    expect(init.body).toBe(JSON.stringify({ x: 1 }));
  });

  it('sends Marquee CSRF headers for mutating requests', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJarWithCsrf(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/things', { method: 'POST', body: { x: 1 } });
    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>)['X-MARQUEE-CSRF-TOKEN']).toBe('csrf-token');
    expect((init.headers as Record<string, string>)['X-Dash-AppId']).toBe('MarketView');
  });

  it('sends MQSITE AppId for dashboard mutations', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/marketview/dashboards/MD_TEMP', { method: 'PUT', body: { id: 'MD_TEMP' } });
    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    expect((init.headers as Record<string, string>)['X-MARQUEE-CSRF-TOKEN']).toBe('csrf-token');
    expect((init.headers as Record<string, string>)['X-Dash-AppId']).toBe('MQSITE');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json;charset=utf-8');
  });

  it('uses Web-equivalent MarketView application headers for DV render requests', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = hrefOf(url);
      const headers = init?.headers as Record<string, string>;
      if (href === 'https://marquee.gs.com/tokenExchange') {
        return new Response(JSON.stringify({
          accessToken: 'access-token',
          expiryInMillis: 300_000,
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      }
      if (href === 'https://marquee.gs.com/v1/data/visualizations/DV1/render') {
        if (headers['X-Dash-AppId'] !== 'MarketView' || headers['X-Application'] !== 'mqda-mv') {
          return new Response(JSON.stringify({ error: 'wrong app headers' }), {
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
          });
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      });
    });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/data/visualizations/DV1/render', {
      method: 'POST',
      body: { component: {}, visualization: {}, references: { configId: 'WC1' } },
    });

    const [, init] = fetchFn.mock.calls[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Dash-AppId']).toBe('MarketView');
    expect(headers['X-Application']).toBe('mqda-mv');
  });

  it('uses MarketView AppId for dashboard children append requests', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/marketview/dashboards/MD_TEMP/children', { method: 'POST', body: [] });
    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    expect((init.headers as Record<string, string>)['X-MARQUEE-CSRF-TOKEN']).toBe('csrf-token');
    expect((init.headers as Record<string, string>)['X-Dash-AppId']).toBe('MarketView');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json;charset=utf-8');
  });

  it('uses MQSITE AppId for dashboard child delete requests', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJarWithIdToken(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/marketview/dashboards/MD_TEMP/children/CHILD_OLD', { method: 'DELETE' });
    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    expect((init.headers as Record<string, string>)['X-MARQUEE-CSRF-TOKEN']).toBe('csrf-token');
    expect((init.headers as Record<string, string>)['X-Dash-AppId']).toBe('MQSITE');
  });

  it('sends CSRF on GET requests to /v1/ paths (matches browser behavior)', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJarWithCsrf(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/users/self');
    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>)['X-MARQUEE-CSRF-TOKEN']).toBe('csrf-token');
  });

  it('appends query string from query option', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/search', { query: { q: 'AAPL', limit: 5 } });
    const [url] = fetchFn.mock.calls[0];
    expect(url).toContain('q=AAPL');
    expect(url).toContain('limit=5');
  });

  it('appends array query values as repeated keys', async () => {
    const fetchFn = mockFetch({ body: {} });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await t.request('/v1/search', { query: { types: ['Widget', 'Asset'] } });
    const [url] = fetchFn.mock.calls[0];
    expect(url).toContain('types=Widget');
    expect(url).toContain('types=Asset');
  });

  it('does not retry obvious SSO HTML and reports trimmed auth diagnostics', async () => {
    const html = '<!DOCTYPE html><html><body>SSO Login</body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await expect(t.request('/v1/marketview/widgets/MWTEST')).rejects.toMatchObject({
      code: 'auth_expired',
      message: expect.stringContaining('Access denied or session expired'),
      details: expect.objectContaining({
        contentType: 'text/html; charset=utf-8',
        body: expect.stringContaining('SSO Login'),
      }),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns HTML text when the caller explicitly accepts HTML responses', async () => {
    const html = '<!DOCTYPE html><html><body><article>GIR body</article></body></html>';
    await expectAcceptedResearchHtml(html);
  });

  it('returns accepted article HTML when prose and metadata mention auth vocabulary', async () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Identity infrastructure primer</title>
      <meta name="description" content="OAuth, SSO, SAML, and login flows affect enterprise software spending">
    </head><body>
      <main>
        <article data-testid="Chapter">
          <h1>Identity infrastructure primer</h1>
          <p>Vendors describe OAuth, SSO, and SAML login flows in product disclosures, but this is normal article prose.</p>
        </article>
      </main>
    </body></html>`;
    await expectAcceptedResearchHtml(html);
  });

  it('returns accepted article HTML when long prose mentions denied access events', async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Paragraph ${index + 1} reviews an access denied event and later session expired banner as ordinary incident-analysis prose, not as the current page auth state.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body>
      <article data-testid="Chapter">
        <h1>Operational risk review</h1>
        ${paragraphs}
      </article>
    </body></html>`;
    await expectAcceptedResearchHtml(html);
  });

  it('returns accepted Chapter HTML when article prose quotes auth prompts', async () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) => (
      `<p>Paragraph ${index + 1} analyzes identity software incident workflows, customer-support paths, and entitlement language in enterprise procurement.</p>`
    ));
    const html = `<!DOCTYPE html><html><body>
      <main data-testid="Chapter">
        <h1>Enterprise identity support workflows</h1>
        ${paragraphs.slice(0, 2).join('')}
        <blockquote><p>Access denied. Contact your administrator.</p></blockquote>
        ${paragraphs.slice(2).join('')}
        <p>The quoted banner is part of the article body, not the state of this HTML response.</p>
      </main>
    </body></html>`;
    await expectAcceptedResearchHtml(html);
  });

  it('returns accepted Chapter HTML when page title contains auth keywords as article prose', async () => {
    const paragraphs = Array.from({ length: 4 }, (_, index) => (
      `<p>Paragraph ${index + 1} reviews identity infrastructure vendors, access-control spending, and enterprise software procurement trends.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><head>
      <title>SSO login flows affect software spending</title>
    </head><body>
      <main data-testid="Chapter">
        <h1>Identity software outlook</h1>
        ${paragraphs}
      </main>
    </body></html>`;
    await expectAcceptedResearchHtml(html);
  });

  it('returns accepted nested Chapter HTML when article prose quotes auth prompts', async () => {
    const html = `<!DOCTYPE html><html><body>
      <div data-testid="Chapter">
        <div>
          <p>Paragraph 1 analyzes identity software incident workflows and entitlement language in enterprise procurement.</p>
        </div>
        <blockquote><p>Please sign in again.</p></blockquote>
        <p>The quoted banner is part of the article body, not the state of this HTML response.</p>
      </div>
    </body></html>`;
    await expectAcceptedResearchHtml(html);
  });

  it('rejects long semantic Chapter auth shells with short body prompts', async () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body>
      <article data-testid="Chapter">
        <p>Please sign in again.</p>
        ${paragraphs}
      </article>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Please sign in again');
  });

  it('rejects long accepted HTML auth shells with clear auth headings', async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body>
      <article>
        <h1>Login</h1>
        ${paragraphs}
      </article>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Login');
  });

  it('rejects accepted HTML form controls before auth keyword checks', async () => {
    const html = `<!DOCTYPE html><html><body>
      <form action="/idp/resume">
        <label for="user">User</label>
        <input id="user" name="pf.username">
        <label for="secret">Secret</label>
        <input id="secret" type="password" name="pf.pass">
      </form>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'pf.username');
  });

  it('rejects accepted HTML auth titles outside long article wrappers', async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><head>
      <title>Goldman Sachs IDFS</title>
    </head><body>
      <article>
        ${paragraphs}
      </article>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Goldman Sachs IDFS');
  });

  it('rejects page-level auth prompts outside long accepted Chapter HTML', async () => {
    const paragraphs = Array.from({ length: 3 }, (_, index) => (
      `<p>Paragraph ${index + 1} analyzes identity software incident workflows, customer-support paths, and entitlement language in enterprise procurement.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body>
      <main data-testid="Chapter">
        <h1>Enterprise identity support workflows</h1>
        ${paragraphs}
      </main>
      <button type="button">Please sign in again.</button>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html);
  });

  it.each([
    ['paragraph prompt', '<p>Please sign in again.</p>'],
    ['title prompt', '<title>Please sign in again</title>'],
  ])('rejects long accepted HTML auth shells with a short %s', async (_name, prompt) => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><head>${prompt}</head><body>
      <main>
        ${paragraphs}
      </main>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Please sign in again');
  });

  it.each([
    ['button prompt', '<button type="button">Please sign in again.</button>'],
    ['link prompt', '<a href="/login">Please sign in again.</a>'],
  ])('rejects long accepted HTML auth shells with a short %s', async (_name, prompt) => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body>
      <main>
        ${prompt}
        ${paragraphs}
      </main>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Please sign in again');
  });

  it('rejects long accepted HTML auth shells with nested markup in a short prompt', async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body>
      <main>
        <p>Please <span>sign</span> in again.</p>
        ${paragraphs}
      </main>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Please <span>sign</span> in again');
  });

  it('rejects long accepted HTML auth shells with nested prompts inside wrappers', async () => {
    const paragraphs = Array.from({ length: 3 }, (_, index) => (
      `<p>Legal/help copy ${index + 1} explains browser requirements, approved identity providers, support contacts, and access requirements for users.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><body><section><p>Please sign in again.</p>${paragraphs}</section></body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Please sign in again');
  });

  it.each([
    ['IDFS', '<title>Goldman Sachs IDFS</title>'],
    ['SSO', '<title>Goldman Sachs SSO</title>'],
    ['Login', '<title>GoldmanSachs - Login</title>'],
    ['Sign In', '<title>Goldman Sachs - Sign In</title>'],
    ['SignIn', '<title>GoldmanSachs SignIn</title>'],
  ])('rejects long accepted HTML auth shells with a branded %s title', async (_name, title) => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => (
      `<p>Help text ${index + 1} explains browser requirements, approved identity providers, legal notices, and support contacts for users who need access to the platform.</p>`
    )).join('');
    const html = `<!DOCTYPE html><html><head>${title}</head><body>
      <main>
        ${paragraphs}
      </main>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Goldman');
  });

  it('rejects semantic article login shells without form controls', async () => {
    const html = `<!DOCTYPE html><html><body>
      <article>
        <h1>Login</h1>
        <p>Sign in with SSO</p>
      </article>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Sign in with SSO');
  });

  it('rejects short accepted HTML auth shells even when article text is non-auth prose', async () => {
    const html = '<!DOCTYPE html><html><body><article>Brand</article><h1>Login</h1><p>Sign in with SSO.</p></body></html>';
    await expectResearchHtmlAuthFailure(html, 'Sign in with SSO');
  });

  it('rejects paragraph-only semantic article auth shells', async () => {
    const html = '<!DOCTYPE html><html><body><article><p>Sign in with SSO</p></article></body></html>';
    await expectResearchHtmlAuthFailure(html, 'Sign in with SSO');
  });

  it.each([
    ['punctuated SSO prompt', '<!DOCTYPE html><html><body><article><p>Sign in with SSO.</p></article></body></html>', 'Sign in with SSO.'],
    ['short trailing prompt text', '<!DOCTYPE html><html><body><article><p>Login to continue.</p></article></body></html>', 'Login to continue.'],
    ['sign-in-again prompt', '<!DOCTYPE html><html><body><article><p>Please sign in again.</p></article></body></html>', 'Please sign in again.'],
    ['markup-split sign-in-again prompt', '<!DOCTYPE html><html><body><article><p>Please <span>sign</span> in again.</p></article></body></html>', 'Please <span>sign</span> in again.'],
    ['entity-spaced sign-in-again prompt', '<!DOCTYPE html><html><body><article><p>Please sign&nbsp;in again.</p></article></body></html>', 'Please sign&nbsp;in again.'],
    ['numeric-entity-spaced sign-in-again prompt', '<!DOCTYPE html><html><body><article><p>Please sign&#160;in again.</p></article></body></html>', 'Please sign&#160;in again.'],
    ['hex-entity-spaced sign-in-again prompt', '<!DOCTYPE html><html><body><article><p>Please sign&#xA0;in again.</p></article></body></html>', 'Please sign&#xA0;in again.'],
    ['branded sign-in-again prompt', '<!DOCTYPE html><html><body><article><p>Goldman Sachs</p><p>Please sign in again.</p></article></body></html>', 'Please sign in again.'],
  ])('rejects paragraph-only semantic article auth shells with %s', async (_name, html, diagnostic) => {
    await expectResearchHtmlAuthFailure(html, diagnostic);
  });

  it('rejects expired-session article HTML even when the caller explicitly accepts HTML responses', async () => {
    const html = `<!DOCTYPE html><html><body>
      <article data-testid="Chapter">
        <h1>Session expired</h1>
        <p>Access denied. Please sign in again.</p>
      </article>
    </body></html>`;
    await expectResearchHtmlAuthFailure(html, 'Session expired');
  });

  it('rejects prefixed expired-session article auth shells', async () => {
    const html = '<!DOCTYPE html><html><body><article><p>Your session expired. Please sign in again.</p></article></body></html>';
    await expectResearchHtmlAuthFailure(html, 'Your session expired');
  });

  it.each([
    ['has expired copy', 'Your session has expired', 'Your session has expired'],
  ])('rejects common short expired HTML shells with %s', async (_name, text, diagnostic) => {
    const html = `<!DOCTYPE html><html><body><article><p>${text}</p></article></body></html>`;
    await expectResearchHtmlAuthFailure(html, diagnostic);
  });

  it('rejects login HTML even when the caller explicitly accepts HTML responses', async () => {
    const html = '<!DOCTYPE html><html><head><title>GoldmanSachs - Login</title></head><body>SSO Login</body></html>';
    await expectResearchHtmlAuthFailure(html, 'GoldmanSachs - Login');
  });

  it('rejects sparse IDFS auth HTML without form controls', async () => {
    const html = '<!DOCTYPE html><html><head><title>Goldman Sachs IDFS</title></head><body></body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/content/research/en/reports/doc-1.html', {
      isHtmlAccepted: true,
      responseType: 'text',
    })).rejects.toMatchObject({
      code: 'auth_expired',
      details: expect.objectContaining({
        body: expect.stringContaining('Goldman Sachs IDFS'),
      }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects sparse IDFS auth HTML even when a branding article is present', async () => {
    const html = '<!DOCTYPE html><html><head><title>Goldman Sachs IDFS</title></head><body><article>Brand</article></body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/content/research/en/reports/doc-1.html', {
      isHtmlAccepted: true,
      responseType: 'text',
    })).rejects.toMatchObject({
      code: 'auth_expired',
      details: expect.objectContaining({
        body: expect.stringContaining('Goldman Sachs IDFS'),
      }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects non-auth HTML text responses as upstream failures unless the caller opts in', async () => {
    const html = '<!DOCTYPE html><html><body><article>GIR body</article></body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/content/research/en/reports/doc-1.html', {
      responseType: 'text',
    })).rejects.toMatchObject({
      code: 'http',
      message: 'Unexpected HTML response for /content/research/en/reports/doc-1.html',
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws http error when non-200 response has HTML content-type', async () => {
    const html = '<!DOCTYPE html><html><body>Forbidden</body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 403, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });
    await expect(t.request('/v1/marketview/widgets/MWTEST')).rejects.toMatchObject({
      code: 'http',
      details: expect.objectContaining({ status: 403 }),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 3xx as a branded RedirectResult under redirect: manual, with the location absolutized', async () => {
    const headers = new Headers({ location: '../content/markets/en/2026/06/10/doc-1.html' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 301, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    const result = await t.request('/research/services/documentRedirect', {
      query: { id: 'doc-1' },
      redirect: 'manual',
    });

    expect(result).toEqual({
      redirected: 'manual',
      status: 301,
      location: 'https://marquee.gs.com/research/content/markets/en/2026/06/10/doc-1.html',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).Cookie).toContain('sid=abc');
  });

  it('keeps built-in redirect following when redirect: manual is not requested', async () => {
    const fetchFn = mockFetch({ body: { ok: true } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await t.request('/v1/users/self');

    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBeUndefined();
  });

  it('routes non-3xx manual-redirect responses through the normal failure pipeline', async () => {
    const html = '<!DOCTYPE html><html><body>Not found</body></html>';
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 404, headers }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/services/documentRedirect', {
      query: { id: 'missing' },
      redirect: 'manual',
    })).rejects.toMatchObject({
      code: 'http',
      details: expect.objectContaining({ status: 404 }),
    });
  });

  it('rejects a successful response with the wrong requested media type', async () => {
    const fetchFn = mockFetch({ body: { id: 'doc-1' } });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/search/reports_2/doc-search/doc-1', {
      expectedContentType: 'application/prs.gir-search-service.v3+json',
    })).rejects.toMatchObject({
      code: 'http',
      message: expect.stringContaining('Unexpected content type application/json'),
      details: expect.objectContaining({ contentType: 'application/json' }),
    });
  });

  it('fails loud when doc-search rejects a narrow Accept header with 406', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      return headers.Accept === '*/*'
        ? new Response('{"id":"doc-1"}', {
            status: 200,
            headers: new Headers({
              'content-type': 'application/prs.gir-search-service.v3+json',
            }),
          })
        : new Response('Not Acceptable', {
            status: 406,
            headers: new Headers({ 'content-type': 'text/plain' }),
          });
    });
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/search/reports_2/doc-search/doc-1', {
      headers: { Accept: 'application/prs.gir-search-service.v3+json' },
      expectedContentType: 'application/prs.gir-search-service.v3+json',
    })).rejects.toMatchObject({
      code: 'http',
      details: expect.objectContaining({ status: 406, body: 'Not Acceptable' }),
    });
  });

  it('classifies login HTML before rejecting the requested media type', async () => {
    const loginHtml = '<html><body><form action="/idfs"><input name="pf.username"><input type="password" name="pf.pass"></form></body></html>';
    const fetchFn = vi.fn().mockResolvedValue(new Response(loginHtml, {
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    }));
    const t = new HttpTransport({ jar: makeJar(), jarPath: '/dev/null', fetchFn });

    await expect(t.request('/research/search/reports_2/doc-search/doc-1', {
      expectedContentType: 'application/prs.gir-search-service.v3+json',
    })).rejects.toMatchObject({
      code: 'auth_expired',
      message: expect.stringContaining('marquee auth login'),
    });
  });
});
