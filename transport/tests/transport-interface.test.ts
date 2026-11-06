import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTransport,
  MarqueeError,
  type DependencyFailure,
  type Endpoint,
} from '../index.js';

function endpoint(path: string, method: Endpoint['method'] = 'GET'): Endpoint {
  return { method, path } as Endpoint;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'transport-interface-'));
  temporaryDirectories.push(directory);
  return directory;
}

function authenticatedJar() {
  return {
    cookies: [{
      name: 'MarqueeIdToken',
      value: 'id-token',
      domain: 'marquee.gs.com',
      path: '/',
      secure: true,
    }],
    updatedAt: 0,
  };
}

describe('transport interface', () => {
  it('hides direct execution behind the shared request interface', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://marquee.gs.com/v1/users/self',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer id-token' }),
      }),
    );
  });

  it('hides Credential Service execution behind the same request interface', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const transport = createTransport({
      execution: 'proxy',
      baseUrl: 'https://credential-service.test/marquee',
      accountId: 'account-1',
      sessionId: 'session-1',
      invocationToken: 'invocation-token',
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://credential-service.test/marquee/v1/users/self',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer invocation-token',
          'X-BotCube-Account-Id': 'account-1',
        }),
      }),
    );
  });

  it('loads and requires direct authentication before request execution', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({ cookies: [], updatedAt: 0 }));
    const fetchFn = vi.fn();
    const transport = createTransport({
      execution: 'direct',
      authentication: { cookieJarPath, required: true },
      fetchFn,
    });

    expect(() => transport.requireAuthentication()).toThrowError(
      expect.objectContaining({
        code: 'auth_expired',
        message: 'Not authenticated. Run: marquee auth login',
      }),
    );
    await expect(transport.request(endpoint('/v1/users/self'))).rejects.toMatchObject({
      code: 'auth_expired',
      message: 'Not authenticated. Run: marquee auth login',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('decorates direct execution with Recording from semantic factory configuration', async () => {
    const recordDir = temporaryDirectory();
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
        required: true,
      },
      recording: {
        environment: { MARQUEE_HTTP_RECORD: recordDir },
        naming: 'readable',
      },
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(readdirSync(recordDir)).toEqual(['GET_v1_users_self.json.gz']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('records live runs under the configured process id', async () => {
    const liveDir = temporaryDirectory();
    const transport = createTransport({
      execution: 'direct',
      authentication: { cookieJarPath: '/dev/null', jar: authenticatedJar(), required: true },
      recording: { environment: { MARQUEE_RECORD_LIVE: liveDir }, processId: 42 },
      fetchFn: vi.fn().mockResolvedValue(new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    });

    await transport.request(endpoint('/v1/users/self'));
    expect(readdirSync(liveDir)).toEqual(['cli-42']);
  });

  it('fails closed on a Recording miss without calling live fetch', async () => {
    const replayDir = temporaryDirectory();
    const fetchFn = vi.fn();
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
        required: true,
      },
      recording: {
        environment: { MARQUEE_HTTP_REPLAY: replayDir },
      },
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/missing'))).rejects.toThrow(
      'Cannot reach https://marquee.gs.com: recording replay miss: '
        + 'no recorded response for GET https://marquee.gs.com/v1/missing',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('serves replay through a replay fetch in place of Recordings, without persisting cookies', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const originalJar = JSON.stringify(authenticatedJar());
    writeFileSync(cookieJarPath, originalJar);
    const fetchFn = vi.fn();
    const replayFetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'new-session=value; Path=/; Secure',
      },
    }));
    const transport = createTransport({
      execution: 'direct',
      authentication: { cookieJarPath, jar: authenticatedJar(), required: true },
      recording: {
        environment: { MARQUEE_HTTP_REPLAY: temporaryDirectory() },
        replayFetch,
      },
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(replayFetch).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(readFileSync(cookieJarPath, 'utf8')).toBe(originalJar);
  });

  it('ignores a replay fetch outside replay', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const replayFetch = vi.fn();
    const transport = createTransport({
      execution: 'direct',
      authentication: { cookieJarPath: '/dev/null', jar: authenticatedJar(), required: true },
      recording: { environment: {}, replayFetch },
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(replayFetch).not.toHaveBeenCalled();
  });

  it('does not activate ambient Recording without semantic configuration', async () => {
    vi.stubEnv('MARQUEE_HTTP_REPLAY', temporaryDirectory());
    const cookieJarPath = join(temporaryDirectory(), 'cookies.json');
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'new-session=value; Path=/; Secure',
      },
    }));
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath,
        jar: authenticatedJar(),
      },
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(readFileSync(cookieJarPath, 'utf8')).toContain('new-session');
  });

  it('supports read-only callers without persisting response cookies', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const originalJar = JSON.stringify(authenticatedJar());
    writeFileSync(cookieJarPath, originalJar);
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath,
        jar: authenticatedJar(),
        persistCookies: false,
      },
      fetchFn: vi.fn().mockResolvedValue(new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'new-session=value; Path=/; Secure',
        },
      })),
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(readFileSync(cookieJarPath, 'utf8')).toBe(originalJar);
  });

  it('exposes only valid target cookies needed for browser authentication', () => {
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: {
          cookies: [
            ...authenticatedJar().cookies,
            { name: 'research', value: 'session', domain: '.gs.com', path: '/research' },
            { name: 'shared', value: 'yes', domain: '.gs.com', path: '/' },
            { name: 'idfsSSO', value: 'durable', domain: 'idfs.gs.com', path: '/' },
            { name: 'other', value: 'no', domain: 'example.com', path: '/' },
            {
              name: 'expired',
              value: 'no',
              domain: 'marquee.gs.com',
              path: '/',
              expires: 1,
            },
          ],
          updatedAt: 0,
        },
      },
      fetchFn: vi.fn(),
    });

    expect(transport.browserAuthenticationCookies()).toEqual([
      authenticatedJar().cookies[0],
      { name: 'research', value: 'session', domain: '.gs.com', path: '/research' },
      { name: 'shared', value: 'yes', domain: '.gs.com', path: '/' },
    ]);
    const unauthenticated = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: {
          cookies: [{ name: 'other', value: 'no', domain: 'example.com', path: '/' }],
          updatedAt: 0,
        },
      },
      fetchFn: vi.fn(),
    });
    expect(unauthenticated.browserAuthenticationCookies()).toBeUndefined();
  });

  it('recognizes surfaced redirects through the Transport interface', async () => {
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn: vi.fn().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: '/next' },
      })),
    });

    const result = await transport.request(endpoint('/start'), { redirect: 'manual' });

    expect(transport.isRedirect(result)).toBe(true);
    if (!transport.isRedirect(result)) throw new Error('expected redirect');
    expect(result).toEqual({
      redirected: 'manual',
      status: 302,
      location: 'https://marquee.gs.com/next',
    });
    expect(transport.isRedirect({
      status: 302,
      location: 'https://marquee.gs.com/unbranded',
    })).toBe(false);
  });

  it('completes provider evidence on success', async () => {
    const events: string[] = [];
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn: vi.fn().mockResolvedValue(new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    });
    const requester = transport.provider({
      owner: 'document',
      evidence: {
        reserve() {
          events.push('reserve');
          return {
            succeed: () => events.push('succeed'),
            fail: () => events.push('fail'),
            cancel: () => events.push('cancel'),
          };
        },
      },
    });

    await expect(requester.request(endpoint('/v1/document'))).resolves.toEqual({ ok: true });
    expect(events).toEqual(['reserve', 'succeed']);
  });

  it('owns provider evidence and failure ordering behind one request interface', async () => {
    const failure = new MarqueeError('http', 'rate limited', { status: 429 });
    const fetchFn = vi.fn().mockResolvedValue(new Response('rate limited', {
      status: 429,
      headers: { 'content-type': 'text/plain' },
    }));
    const events: string[] = [];
    const failures: unknown[] = [];
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn,
    });
    const requester = transport.provider({
      owner: 'marketview-search',
      evidence: {
        reserve(call) {
          events.push(`reserve:${call.owner}:${call.operation}`);
          return {
            succeed: () => events.push('succeed'),
            fail: (value) => {
              events.push('fail');
              failures.push(value);
            },
            cancel: (value) => {
              expect(value).toMatchObject({
                kind: 'provider-failure',
                code: 'network',
                details: { isCanceled: true },
              });
              events.push('cancel');
            },
          };
        },
      },
    });

    await expect(requester.request(endpoint('/v1/search'))).rejects.toMatchObject({
      code: failure.code,
      details: failure.details,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'reserve:marketview-search:GET /v1/search',
      'fail',
    ]);
    expect(failures).toEqual([{
      kind: 'provider-failure',
      message: expect.stringContaining('Marquee returned 429'),
      code: 'http',
      details: expect.objectContaining({ status: 429, body: 'rate limited' }),
    }]);
  });

  it('captures required authentication failures inside provider evidence', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn();
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: { cookies: [], updatedAt: 0 },
        required: true,
      },
      fetchFn,
    });
    const requester = transport.provider({
      owner: 'marketview-search',
      evidence: {
        reserve() {
          events.push('reserve');
          return {
            succeed: () => events.push('succeed'),
            fail: () => events.push('fail'),
            cancel: () => events.push('cancel'),
          };
        },
      },
    });

    await expect(requester.request(endpoint('/v1/search'))).rejects.toMatchObject({
      code: 'auth_expired',
      message: 'Not authenticated. Run: marquee auth login',
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(events).toEqual(['reserve', 'fail']);
  });

  it('records caller cancellation in provider evidence', async () => {
    const events: string[] = [];
    // Like fetch, an already-aborted signal rejects with its abort reason before anything is sent.
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.reject(init?.signal?.reason));
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn,
    });
    const requester = transport.provider({
      owner: 'content-search',
      evidence: {
        reserve() {
          events.push('reserve');
          return {
            succeed: () => events.push('succeed'),
            fail: () => events.push('fail'),
            cancel: () => events.push('cancel'),
          };
        },
      },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(requester.request(endpoint('/v1/content/search'), {
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: 'network',
      details: { isCanceled: true },
    });

    expect(events).toEqual(['reserve', 'cancel']);
  });

  it('keeps the shared dependency failure vocabulary closed and mechanical', () => {
    const failures = [
      { kind: 'authentication-required', realm: 'research' },
      { kind: 'rate-limited', retryAfterMs: 1_000 },
      { kind: 'timeout' },
      { kind: 'unavailable' },
      { kind: 'cancelled' },
    ] satisfies readonly DependencyFailure[];

    expect(failures.map(({ kind }) => kind)).toEqual([
      'authentication-required',
      'rate-limited',
      'timeout',
      'unavailable',
      'cancelled',
    ]);
    expect(failures.map((failure) => Object.keys(failure))).toEqual([
      ['kind', 'realm'],
      ['kind', 'retryAfterMs'],
      ['kind'],
      ['kind'],
      ['kind'],
    ]);
  });
});
