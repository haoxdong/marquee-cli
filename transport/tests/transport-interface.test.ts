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
  describe('hedged attempts', () => {
    // Each attempt waits until the test answers it, whatever its abort signal says.
    function heldAttempts() {
      const attempts: Array<{ signal: AbortSignal | undefined; answer: (status: number, body: unknown) => void }> = [];
      const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
        attempts.push({
          signal: init?.signal ?? undefined,
          answer: (status, body) => resolve(new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          })),
        });
      }));
      const requester = createTransport({
        execution: 'direct',
        authentication: { cookieJarPath: '/dev/null', jar: authenticatedJar() },
        fetchFn,
      }).provider({ owner: 'widget' });
      const attempt = (index: number) => {
        const sent = attempts[index];
        if (!sent) throw new Error(`attempt ${index + 1} was never sent`);
        return sent;
      };
      return { fetchFn, requester, attempt };
    }

    it('aborts only the losing attempts once one succeeds', async () => {
      const { fetchFn, requester, attempt } = heldAttempts();
      const request = requester.request(endpoint('/v1/marketview/widgets/MW1'), { hedgeDelaysMs: [0] });
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

      attempt(1).answer(200, { attempt: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempt(0).answer(404, { detail: 'late loser' });

      await expect(request).resolves.toEqual({ attempt: 2 });

      expect(attempt(0).signal?.aborted).toBe(true);
      expect(attempt(1).signal?.aborted).toBe(false);
    });

    it('waits for an attempt in flight when a hedge is rate limited, and sends no more', async () => {
      const { fetchFn, requester, attempt } = heldAttempts();
      const request = requester.request(endpoint('/v1/marketview/widgets/MW1'), { hedgeDelaysMs: [0, 200] });
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

      attempt(1).answer(429, { detail: 'rate limited' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      attempt(0).answer(200, { attempt: 1 });

      await expect(request).resolves.toEqual({ attempt: 1 });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('fails at once on a deterministic client error without waiting for other attempts', async () => {
      const { fetchFn, requester, attempt } = heldAttempts();
      const request = requester.request(endpoint('/v1/marketview/widgets/MW1'), { hedgeDelaysMs: [0] });
      const outcome = request.then(() => 'resolved', (error: unknown) => error);
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

      attempt(1).answer(404, { detail: 'missing' });
      await vi.waitFor(() => expect(attempt(0).signal?.aborted).toBe(true));
      attempt(0).answer(200, { attempt: 1 });

      await expect(outcome).resolves.toMatchObject({ code: 'http', details: { status: 404 } });
    });

    it("fails with the first attempt's error once every attempt fails", async () => {
      const { fetchFn, requester, attempt } = heldAttempts();
      // The caller gives up soon after both failures, so a request left pending ends as a cancellation.
      const caller = new AbortController();
      const outcome = requester.request(endpoint('/v1/marketview/widgets/MW1'), {
        hedgeDelaysMs: [0],
        signal: caller.signal,
      }).then(() => 'resolved', (error: unknown) => error);
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

      attempt(1).answer(503, { detail: 'second' });
      attempt(0).answer(503, { detail: 'first' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      caller.abort();

      await expect(outcome).resolves.toMatchObject({
        code: 'http',
        details: { status: 503, body: expect.stringContaining('first') },
      });
    });
  });

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
      baseUrl: 'https://credential-service.internal/marquee',
      accountId: 'account-1',
      sessionId: 'session-1',
      invocationToken: 'invocation-token',
      fetchFn,
    });

    await expect(transport.request(endpoint('/v1/users/self'))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://credential-service.internal/marquee/v1/users/self',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer invocation-token',
          'X-MarqueeBot-Account-Id': 'account-1',
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

    await expect(requester.request(endpoint('/v1/search'), {
      hedgeDelaysMs: [1],
    })).rejects.toMatchObject({
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

  it('completes evidence once for a hedged request', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchFn.mock.calls.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      return Promise.resolve(new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn,
    });
    const requester = transport.provider({
      owner: 'entity',
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

    await expect(requester.request(endpoint('/v1/entities'), {
      hedgeDelaysMs: [0],
    })).resolves.toEqual({ ok: true });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['reserve', 'succeed']);
  });

  it('resolves with the first successful hedge when both complete', async () => {
    const responses: Array<(response: Response) => void> = [];
    const fetchFn = vi.fn(() => (
      new Promise<Response>((resolve) => {
        responses.push(resolve);
      })
    ));
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn,
    });
    const requester = transport.provider({ owner: 'widget' });

    const request = requester.request(endpoint('/v1/marketview/widgets/MW1'), {
      hedgeDelaysMs: [0],
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    responses[0]?.(new Response('{"attempt":1}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    responses[1]?.(new Response('{"attempt":2}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(request).resolves.toEqual({ attempt: 1 });
  });

  it('does not wait for an abort-insensitive hedge loser after a winner settles', async () => {
    const responses: Array<(response: Response) => void> = [];
    const fetchFn = vi.fn(() => (
      new Promise<Response>((resolve) => {
        responses.push(resolve);
      })
    ));
    const transport = createTransport({
      execution: 'direct',
      authentication: {
        cookieJarPath: '/dev/null',
        jar: authenticatedJar(),
      },
      fetchFn,
    });
    const requester = transport.provider({ owner: 'widget' });

    const request = requester.request(endpoint('/v1/marketview/widgets/MW1'), {
      hedgeDelaysMs: [0],
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    responses[0]?.(new Response('{"attempt":1}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(request).resolves.toEqual({ attempt: 1 });
  });

  it('records caller cancellation in provider evidence', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn();
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
      hedgeDelaysMs: [1],
    })).rejects.toMatchObject({
      code: 'network',
      details: { isCanceled: true },
    });

    expect(fetchFn).not.toHaveBeenCalled();
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
