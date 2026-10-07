import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebugFetch } from '../debug.js';
import { createTransport, type Endpoint } from '../index.js';

function endpoint(path: string, method: Endpoint['method'] = 'GET'): Endpoint {
  return { method, path } as Endpoint;
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnbmF0dXJlLXZhbHVl';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function captureStderr(): () => string {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return () => chunks.join('').replace(/\d+ms/g, '<ms>');
}

function jarWithCredentials() {
  const cookie = (name: string, value: string) => ({
    name, value, domain: 'marquee.gs.com', path: '/', secure: true,
  });
  return {
    cookies: [cookie('MarqueeIdToken', JWT), cookie('MARQUEE-CSRF-TOKEN', 'csrf-secret')],
    updatedAt: 0,
  };
}

function directTransport(fetchFn: typeof fetch) {
  return createTransport({
    execution: 'direct',
    authentication: { cookieJarPath: '/dev/null', jar: jarWithCredentials(), persistCookies: false },
    fetchFn,
  });
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('MARQUEE_DEBUG', () => {
  it('prints each request with masked headers and redacted bodies when set to api', async () => {
    vi.stubEnv('MARQUEE_DEBUG', 'api');
    const stderr = captureStderr();
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(
        { accessToken: 'plain-access-token', idToken: JWT, expiryInMillis: 600000 },
        { 'set-cookie': 'session=cookie-secret; Path=/' },
      ))
      .mockResolvedValueOnce(json({ ok: true }, { 'x-dash-requestid': 'req-1' }));

    await directTransport(fetchFn).request(endpoint('/v1/data/visualizations/DV1/render', 'POST'), {
      query: { a: 1 },
      body: { token: 'body-secret', id: 'DV1' },
    });

    expect(stderr()).toBe(`* Request to https://marquee.gs.com/tokenExchange
> POST /tokenExchange
> accept: application/json
> accept-language: en-US,en;q=0.9
> authorization: Bearer ████████████████████
> content-type: application/json
> cookie: ████████████████████
> origin: https://marquee.gs.com
> referer: https://marquee.gs.com/s/
> user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36
> x-marquee-csrf-token: ████████████████████

< 200
< content-type: application/json
< set-cookie: ████████████████████

{"accessToken":"redacted.contract.fixture.credential","idToken":"redacted.contract.fixture.jwt","expiryInMillis":600000}

* Request took <ms>
* Request to https://marquee.gs.com/v1/data/visualizations/DV1/render?a=1
> POST /v1/data/visualizations/DV1/render?a=1
> accept: application/json
> accept-language: en-US,en;q=0.9
> authorization: Bearer ████████████████████
> content-type: application/json;charset=utf-8
> cookie: ████████████████████
> origin: https://marquee.gs.com
> referer: https://marquee.gs.com/s/marketview/
> user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36
> x-application: mqda-mv
> x-dash-appid: MarketView
> x-flatten-status: true
> x-marquee-csrf-token: ████████████████████

{"token":"redacted.contract.fixture.credential","id":"DV1"}

< 200
< content-type: application/json
< x-dash-requestid: req-1

{"ok":true}

* Request took <ms>
`);
  });

  it('prints one line per request with method, URL, status and duration when set to 1', async () => {
    vi.stubEnv('MARQUEE_DEBUG', '1');
    const stderr = captureStderr();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));

    await expect(directTransport(fetchFn).request(endpoint('/v1/users/self'), { query: { a: 1 } }))
      .resolves.toEqual({ ok: true });

    expect(stderr()).toBe('* GET https://marquee.gs.com/v1/users/self?a=1 200 <ms>\n');
  });

  it('prints response bodies up to 100 KB and skips larger ones', async () => {
    vi.stubEnv('MARQUEE_DEBUG', 'api');
    const stderr = captureStderr();
    const text = (bytes: number) => new Response('x'.repeat(bytes), {
      headers: { 'content-type': 'text/plain' },
    });
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(text(100_000))
      .mockResolvedValueOnce(text(100_001));
    const transport = directTransport(fetchFn);

    await transport.request(endpoint('/v1/a'), { responseType: 'text' });
    await transport.request(endpoint('/v1/b'), { responseType: 'text' });

    const [small, large] = stderr().split('* Request to ').slice(1);
    expect(small).toContain(`\n\n${'x'.repeat(100_000)}\n\n* Request took`);
    expect(large).toContain('\n\n* body is too long (100001 bytes) to print, skipping (longer than 100000 bytes)\n\n* Request took');
    expect(large).not.toContain('xxxx');
  });

  it('prints no body for binary or empty responses and a body without a content-type', async () => {
    vi.stubEnv('MARQUEE_DEBUG', 'api');
    const stderr = captureStderr();
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('%PDF-binary', { headers: { 'content-type': 'application/pdf' } }))
      .mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('untyped')));
    const transport = directTransport(fetchFn);

    await transport.request(endpoint('/v1/pdf'), { responseType: 'arrayBuffer' });
    await transport.request(endpoint('/v1/empty'), { responseType: 'text' });
    await transport.request(endpoint('/v1/untyped'), { responseType: 'text' });

    const [pdf, empty, untyped] = stderr().split('* Request to ').slice(1);
    expect(pdf).toContain('< content-type: application/pdf\n\n* Request took');
    expect(empty).toContain('< content-type: text/plain\n\n* Request took');
    expect(untyped).toContain('< 200\n\nuntyped\n\n* Request took');
  });

  it('masks an authorization header that has no scheme', async () => {
    vi.stubEnv('MARQUEE_DEBUG', 'api');
    const stderr = captureStderr();
    await directTransport(vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true })))
      .request(endpoint('/v1/users/self'), { headers: { Authorization: 'bare-secret' } });
    expect(stderr()).toContain('> authorization: ████████████████████\n');
    expect(stderr()).not.toContain('bare-secret');
  });

  it('prints the exchange and keeps the outcome when the response body cannot be read', async () => {
    const outcome = async () => {
      const fetchFn = vi.fn<typeof fetch>(async (input) => requestUrl(input).endsWith('/tokenExchange')
        ? json({ accessToken: 'access', expiryInMillis: 600000 })
        : new Response(new ReadableStream({ start: (stream) => stream.error(new Error('socket reset')) }), {
          headers: { 'content-type': 'application/json' },
        }));
      const error = await directTransport(fetchFn).request(endpoint('/v1/users/self')).catch((e: unknown) => e);
      return { error: String(error), calls: fetchFn.mock.calls.length };
    };
    const stderr = captureStderr();
    const withoutDebug = await outcome();
    vi.stubEnv('MARQUEE_DEBUG', 'api');

    expect(await outcome()).toEqual(withoutDebug);
    const [, exchange] = stderr().split('* Request to https://marquee.gs.com/v1/users/self\n');
    expect(exchange).toContain('\n< 200\n< content-type: application/json\n\n* body could not be read: socket reset\n\n* Request took <ms>\n');
  });

  it('prints a hedged attempt canceled while its response body is read', async () => {
    vi.stubEnv('MARQUEE_DEBUG', 'api');
    const stderr = captureStderr();
    let attempts = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      if (requestUrl(input).endsWith('/tokenExchange')) return json({ accessToken: 'access', expiryInMillis: 600000 });
      attempts += 1;
      if (attempts > 1) return json({ ok: true });
      // The first attempt's headers arrive, but its body stalls until the hedge wins and cancels it.
      return new Response(new ReadableStream({
        start: (stream) => init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason)),
      }), { headers: { 'content-type': 'application/json' } });
    });

    // The caller gives up well before the test timeout, so a hedge that never settles fails as a cancellation.
    await expect(directTransport(fetchFn).provider({ owner: 'widget' })
      .request(endpoint('/v1/users/self'), { hedgeDelaysMs: [10], signal: AbortSignal.timeout(2_000) }))
      .resolves.toEqual({ ok: true });

    // The hedge resolves before the canceled attempt's body read fails, so its block prints after.
    const attemptBlocks = await vi.waitFor(() => {
      const blocks = stderr().split('* Request to ').filter((block) => block.startsWith('https://marquee.gs.com/v1/users/self'));
      expect(blocks).toHaveLength(2);
      return blocks;
    });
    expect(attemptBlocks.some((block) => block.endsWith('\n< 200\n< content-type: application/json\n\n* Request canceled after <ms>\n')))
      .toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'no'])('prints nothing when set to %j', async (value) => {
    if (value !== undefined) vi.stubEnv('MARQUEE_DEBUG', value);
    const stderr = captureStderr();
    await directTransport(vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true })))
      .request(endpoint('/v1/users/self'));
    expect(stderr()).toBe('');
  });
});

describe('MARQUEE_DEBUG fetch failures', () => {
  // The clock reads 100ms when the request starts and 105ms when it settles.
  function clockedStderr(): () => string {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValue(105);
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    return () => chunks.join('');
  }

  const refused = new Error('connect ECONNREFUSED');
  const canceled = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

  it.each([
    ['api', refused, '* Request to https://marquee.gs.com/v1/a\n> GET /v1/a\n\n* Request failed after 5ms: connect ECONNREFUSED\n'],
    ['api', canceled, '* Request to https://marquee.gs.com/v1/a\n> GET /v1/a\n\n* Request canceled after 5ms\n'],
    ['requests', refused, '* GET https://marquee.gs.com/v1/a failed 5ms: connect ECONNREFUSED\n'],
    ['requests', canceled, ''],
  ] as const)('at level %s prints %s as a failed or canceled request and rethrows it', async (level, error, printed) => {
    const stderr = clockedStderr();
    const debugFetch = createDebugFetch(vi.fn<typeof fetch>().mockRejectedValue(error), level);

    await expect(debugFetch('https://marquee.gs.com/v1/a')).rejects.toBe(error);
    expect(stderr()).toBe(printed);
  });

  it('prints the status text beside the status and the elapsed time', async () => {
    const stderr = clockedStderr();
    const debugFetch = createDebugFetch(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202, statusText: 'Accepted' })),
      'api',
    );

    await debugFetch('https://marquee.gs.com/v1/a');
    expect(stderr()).toBe('* Request to https://marquee.gs.com/v1/a\n> GET /v1/a\n\n< 202 Accepted\n\n* Request took 5ms\n');
  });
});
