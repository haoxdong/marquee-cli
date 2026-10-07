/** @format */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { MarqueeError } from '../index.js';
import { ProxyHttpTransport } from '../proxy.js';

function proxy(fetchFn: typeof fetch): ProxyHttpTransport {
  return new ProxyHttpTransport({
    baseUrl: 'https://credential-service.internal/marquee',
    accountId: 'acct-1',
    sessionId: 'thread-1',
    invocationToken: 'signed-invocation',
    fetchFn,
  });
}

describe('ProxyHttpTransport', () => {
  it('keeps the diagnostic preview bound for ordinary typed requests', async () => {
    const body = 'fixture '.repeat(150);
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 400 }));
    const failure = await proxy(fetchFn)
      .request('/v1/probe')
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'http', details: { status: 400 } });
    expect((failure as MarqueeError).details?.body).toHaveLength(1024);
  });
  it('surfaces manual upstream redirects for content UUID resolution', async () => {
    const location =
      'https://marquee.gs.com/content/markets/en/2026/06/10/doc-1.html';
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location },
      })
    );
    const transport = proxy(fetchFn);

    await expect(
      transport.request('/research/services/documentRedirect', {
        query: { id: 'doc-1' },
        redirect: 'manual',
      })
    ).resolves.toEqual({
      redirected: 'manual',
      status: 301,
      location,
    });
    expect(fetchFn.mock.calls[0][1].redirect).toBe('manual');
  });

  it('routes Marquee requests through the Credential Service without cookies', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ login: 'Jane.Doe/NY' }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );
    const transport = proxy(fetchFn);

    const result = await transport.request('/v1/users/self', {
      query: { verbose: true },
      headers: {
        Authorization: 'Bearer wrong-token',
        Cookie: 'idfsSSO=must-not-forward',
      },
    });

    expect(result).toEqual({ login: 'Jane.Doe/NY' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://credential-service.internal/marquee/v1/users/self?verbose=true'
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer signed-invocation',
      'X-MarqueeBot-Account-Id': 'acct-1',
      'X-MarqueeBot-Session-Id': 'thread-1',
      Accept: 'application/json',
    });
    expect((init.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  it('sends a caller body as JSON and omits the body when there is none', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const transport = proxy(fetchFn);

    await transport.request('/v1/search', {
      method: 'POST',
      body: { query: 'rates' },
    });
    await transport.request('/v1/users/self');

    expect(fetchFn.mock.calls[0][1].body).toBe('{"query":"rates"}');
    expect(fetchFn.mock.calls[1][1]).not.toHaveProperty('body');
  });

  it('strips caller credentials case-insensitively before calling the Credential Service', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ documents: [] }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );
    const transport = proxy(fetchFn);

    await transport.request('/research/search/reports/advanced-search', {
      method: 'POST',
      headers: {
        Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
        AUTHORIZATION: 'Bearer caller-token',
        cookie: 'idfsSSO=must-not-forward',
      },
      body: { query: 'rates' },
    });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers).toMatchObject({
      Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
      Authorization: 'Bearer signed-invocation',
      'X-MarqueeBot-Account-Id': 'acct-1',
      'X-MarqueeBot-Session-Id': 'thread-1',
      'Content-Type': 'application/json;charset=utf-8',
    });
    expect(
      (init.headers as Record<string, string>).AUTHORIZATION
    ).toBeUndefined();
    expect((init.headers as Record<string, string>).cookie).toBeUndefined();
  });

  it('normalizes absolute Marquee URLs through the Credential Service origin before adding auth', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html: '<html />' }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );
    const transport = proxy(fetchFn);

    await transport.request(
      'https://marquee.gs.com/content/research/en/reports/doc-1.html?date=2026-07-04',
      {
        responseType: 'text',
      }
    );

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://credential-service.internal/marquee/content/research/en/reports/doc-1.html?date=2026-07-04'
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer signed-invocation',
      'X-MarqueeBot-Account-Id': 'acct-1',
      'X-MarqueeBot-Session-Id': 'thread-1',
    });
  });

  it('rejects non-Marquee absolute URLs before attaching proxy auth', async () => {
    const fetchFn = vi.fn();
    const transport = proxy(fetchFn);

    await expect(
      transport.request('https://example.com/v1/users/self')
    ).rejects.toMatchObject({
      code: 'config',
      message: 'Proxy transport only accepts marquee.gs.com URLs or paths',
    } satisfies Partial<MarqueeError>);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces proxy re-link prompts from structured auth failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: 'relink_required',
            message: 'Goldman link expired. Re-link Goldman to continue.',
          },
        }),
        {
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
        }
      )
    );
    const transport = proxy(fetchFn);

    await expect(transport.request('/v1/users/self')).rejects.toMatchObject({
      code: 'auth_expired',
      message: 'Goldman link expired. Re-link Goldman to continue.',
      details: {
        status: 401,
        path: '/v1/users/self',
        credentialServiceCode: 'relink_required',
      },
    } satisfies Partial<MarqueeError>);
  });

  it.each([
    ['Not entitled to this visualization', 'entitlement_401'],
    ['Error getting entity', 'entity_401'],
  ])('preserves upstream DataViz failure: %s', async (message, provenance) => {
    const body = JSON.stringify({ message });
    const transport = proxy(
      async () =>
        new Response(body, {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
    );

    await expect(
      transport.request('/v1/data/visualizations/DV_FAILURE/render', {
        method: 'POST',
      })
    ).rejects.toMatchObject({
      code: 'http',
      message:
        'Marquee returned 401 for /v1/data/visualizations/DV_FAILURE/render',
      details: {
        status: 401,
        path: '/v1/data/visualizations/DV_FAILURE/render',
        body,
        responseClassification: provenance,
      },
    });
  });

  it('keeps a structured relink failure authoritative over upstream-looking text', async () => {
    const transport = proxy(
      async () =>
        new Response(
          JSON.stringify({
            detail: {
              code: 'relink_required',
              message: 'Not entitled to an active session. Re-link Goldman.',
            },
          }),
          { status: 401 }
        )
    );

    await expect(transport.request('/v1/users/self')).rejects.toMatchObject({
      code: 'auth_expired',
      details: { credentialServiceCode: 'relink_required' },
    });
  });

  it('keeps existing proxy forbidden handling for an entitlement response', async () => {
    const transport = proxy(
      async () =>
        new Response(
          JSON.stringify({
            message: 'Not entitled to this visualization',
          }),
          { status: 403 }
        )
    );

    await expect(
      transport.request('/v1/data/visualizations/DV_FAILURE')
    ).rejects.toMatchObject({
      code: 'auth_expired',
      details: { status: 403 },
    });
  });

  it('surfaces the Credential Service policy refusal without a Marquee status', async () => {
    const detail =
      'Credential Service only allows read-scoped Marquee requests';
    const transport = proxy(
      async () => new Response(JSON.stringify({ detail }), { status: 403 })
    );

    const error: unknown = await transport
      .request('/v1/users/query', { method: 'POST', body: {} })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'http',
      message: detail,
      details: { path: '/v1/users/query' },
    });
    expect((error as MarqueeError).details).not.toHaveProperty('status');
  });

  it('keeps a 401 carrying the refusal text an auth failure', async () => {
    const transport = proxy(
      async () =>
        new Response(
          JSON.stringify({
            detail:
              'Credential Service only allows read-scoped Marquee requests',
          }),
          { status: 401 }
        )
    );

    await expect(transport.request('/v1/users/self')).rejects.toMatchObject({
      code: 'auth_expired',
      details: { status: 401 },
    });
  });

  it('keeps a 403 whose string detail is not the refusal an auth failure', async () => {
    const transport = proxy(
      async () =>
        new Response(
          JSON.stringify({
            detail: 'User not entitled to view Widget with id MW_NOT_ENTITLED',
          }),
          { status: 403 }
        )
    );

    await expect(
      transport.request('/v1/marketview/widgets/MW_NOT_ENTITLED')
    ).rejects.toMatchObject({
      code: 'auth_expired',
      details: { status: 403 },
    });
  });

  it('omits the Credential Service code from an unstructured auth failure', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 401 }));
    const transport = proxy(fetchFn);

    const error: unknown = await transport
      .request('/v1/users/self')
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'auth_expired',
      details: { status: 401, path: '/v1/users/self' },
    });
    expect((error as MarqueeError).details).not.toHaveProperty(
      'credentialServiceCode'
    );
  });

  it('classifies unreadable proxy error response bodies', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockRejectedValue(new Error('body stream failed')),
    });
    const transport = proxy(fetchFn);

    await expect(transport.request('/v1/users/self')).rejects.toMatchObject({
      code: 'http',
      message: 'Credential Service returned 502 for /v1/users/self',
      details: {
        status: 502,
        path: '/v1/users/self',
        body: 'Unable to read proxy error response body: body stream failed',
      },
    } satisfies Partial<MarqueeError>);
  });

  it('rejects a successful proxy response with the wrong requested media type', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const transport = proxy(fetchFn);

    await expect(
      transport.request('/research/search/reports_2/doc-search/doc-1', {
        expectedContentType: 'application/prs.gir-search-service.v3+json',
      })
    ).rejects.toMatchObject({
      code: 'http',
      message: expect.stringContaining(
        'Unexpected content type application/json'
      ),
      details: expect.objectContaining({ contentType: 'application/json' }),
    });
  });
});

const coldRemint = JSON.parse(
  readFileSync(
    new URL(
      '../../../contract/regressions/credential-cold-remint-timeout.json',
      import.meta.url
    ),
    'utf8'
  )
) as {
  cases: {
    name: string;
    responseAfterMs: number;
    timeoutMs?: number;
    succeeds: boolean;
  }[];
};

describe('cold Credential Service re-mint regression', () => {
  it.each(coldRemint.cases)(
    '$name',
    async ({ responseAfterMs, timeoutMs, succeeds }) => {
      vi.useFakeTimers();
      try {
        const transport = proxy(
          (_url, init) =>
            new Promise<Response>((resolve, reject) => {
              const response = setTimeout(
                () =>
                  resolve(
                    new Response(JSON.stringify({ authenticated: true }), {
                      headers: { 'content-type': 'application/json' },
                    })
                  ),
                responseAfterMs
              );
              init?.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(response);
                  reject(new DOMException('Aborted', 'AbortError'));
                },
                { once: true }
              );
            })
        );
        const result = transport.request('/v1/users/self', { timeoutMs }).then(
          (value) => ({ ok: true, value }),
          (error: MarqueeError) => ({ ok: false, code: error.code })
        );
        await vi.advanceTimersByTimeAsync(responseAfterMs);
        expect(await result).toEqual(
          succeeds
            ? { ok: true, value: { authenticated: true } }
            : { ok: false, code: 'timeout' }
        );
      } finally {
        vi.useRealTimers();
      }
    }
  );
});
