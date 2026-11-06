import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataVizApi } from '../../../../api/data-viz/index.js';
import { createTransport, type TransportConfig } from '../../../../transport/index.js';
import { createDataVizFromAdapter } from '../../module.js';
import { createMarqueeDataVizAdapter } from '../marquee.js';

const executions = ['direct', 'proxy', 'session'] as const;

function transport(execution: typeof executions[number], fetchFn: typeof fetch) {
  const config: TransportConfig = execution === 'direct'
    ? {
        execution,
        authentication: { cookieJarPath: '/dev/null', persistCookies: false, jar: { cookies: [], updatedAt: 0 } },
        fetchFn,
      }
    : execution === 'proxy'
      ? { execution, baseUrl: 'https://proxy.test', accountId: 'account', sessionId: 'session', invocationToken: 'fixture', fetchFn }
      : { execution, baseUrl: 'https://api.marqueebot.com/marquee', sessionToken: 'sess_fixture', fetchFn };
  return createTransport(config);
}

function delayedRender(status = 200) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json({});
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({
        renderData: {
          data: [{ type: 'bar', x: ['Assets'], y: [1] }],
          layout: {},
        },
      }, { status })), 173_000);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  });
}

function render(execution: typeof executions[number], fetchFn: typeof fetch, visualizationType = 'DataViz') {
  const requester = transport(execution, fetchFn).provider({ owner: 'widget' });
  return createDataVizFromAdapter(createMarqueeDataVizAdapter({
    request: requester.request,
    target: { visualizationType },
  })).render({ targetId: 'DV_DELAYED', inputs: { widget: { renderParams: { component: {} } } } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('DataViz render deadline regression', () => {
  it.each(executions.flatMap(execution => ['DataViz', 'BaseComponent'].map(visualizationType => ({ execution, visualizationType }))))(
    'waits for a slow $visualizationType render over $execution', async ({ execution, visualizationType }) => {
      vi.useFakeTimers();
      const fetchFn = delayedRender();
      const result = render(execution, fetchFn, visualizationType);
      await vi.advanceTimersByTimeAsync(173_000);
      await expect(result).resolves.toMatchObject({ ok: true, value: { kind: 'visualization' } });
      expect(fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    },
  );

  it.each(executions)('surfaces a slow server error over %s without retrying', async (execution) => {
    vi.useFakeTimers();
    const fetchFn = delayedRender(503);
    const result = render(execution, fetchFn);
    await vi.advanceTimersByTimeAsync(173_000);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { kind: 'render-failure', failure: { kind: 'unavailable' } },
    });
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('honors an explicit bounded render deadline', async () => {
    vi.useFakeTimers();
    vi.stubEnv('MARQUEE_WIDGET_RENDER_TIMEOUT_MS', '25000');
    const result = render('direct', delayedRender());
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { kind: 'render-failure', failure: { kind: 'timeout' } },
    });
  });
});

describe('transport deadline policy', () => {
  it.each(executions)('keeps caller cancellation without a deadline over %s', async (execution) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const requester = transport(execution, delayedRender());
    const result = new DataVizApi({
      request: (endpoint, init) => requester.request(endpoint, {
        ...init,
        timeoutMs: 0,
        signal: controller.signal,
      }),
    }).renderVisualization('DV_DELAYED', {}).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(110_001);
    controller.abort();
    await expect(result).resolves.toMatchObject({ code: 'network', details: { isCanceled: true } });
  });

  it.each(executions)('keeps the default deadline for other requests over %s', async (execution) => {
    vi.useFakeTimers();
    const result = new DataVizApi(transport(execution, delayedRender()))
      .renderVisualization('DV_DELAYED', {}).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(110_001);
    await expect(result).resolves.toMatchObject({ code: 'timeout' });
  });
});
