import { describe, expect, it } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import type { WidgetId, WidgetModule } from '../../../widget/index.js';
import { createMarketViewWidget } from '../../widget.js';
import { createWidgetEvidenceRecorder } from '../widget-evidence.js';

describe('Widget evidence recorder', () => {
  it('records an Endpoint request by its method and path and forwards it', async () => {
    const forwarded: unknown[] = [];
    const recorder = createWidgetEvidenceRecorder({
      async request(path, init) {
        forwarded.push([path, init]);
        return {};
      },
    });

    const { audit } = await recorder.record(
      'read',
      () => recorder.port.request({ method: 'GET', path: '/v1/charts/CH_TEST' } as Endpoint),
    );

    expect(audit.calls).toEqual([{
      name: 'chart.definition',
      request: { method: 'GET', path: '/v1/charts/CH_TEST' },
    }]);
    expect(forwarded).toEqual([[{ method: 'GET', path: '/v1/charts/CH_TEST' }, undefined]]);
  });

  it.each([
    ['POST', '/v1/marketview/widgets/configurations', 'configuration.create'],
    ['GET', '/v1/marketview/widgets/configurations/WC_ONE', 'configuration.detail'],
    ['GET', '/v1/marketview/widgets/MW_ONE', 'widget.metadata'],
    ['GET', '/v1/marketview/dashboards', 'dashboard.list'],
    ['GET', '/v1/charts/CH_ONE', 'chart.definition'],
    ['POST', '/v1/plots/entities', 'entity.resolve'],
    ['GET', '/v1/marketview/constituents', 'constituents.resolve'],
    ['POST', '/v1/data/visualizations/DV_ONE/render', 'dv.render'],
    ['POST', '/v1/plots/runner', 'ch.runner'],
    ['GET', '/v1/users/me', 'upstream'],
  ])('names a %s %s call %s', async (method, path, name) => {
    const recorder = createWidgetEvidenceRecorder({ request: async () => ({}) });

    const { audit } = await recorder.record(
      'read',
      () => recorder.port.request({ method, path } as Endpoint),
    );

    expect(audit.calls.map((call) => call.name)).toEqual([name]);
  });

  it('records the query and body a call sends', async () => {
    const recorder = createWidgetEvidenceRecorder({ request: async () => ({}) });

    const { audit } = await recorder.record('change', () => recorder.port.request(
      { method: 'POST', path: '/v1/marketview/widgets/configurations' } as Endpoint,
      { query: { limit: 5 }, body: { relativeDate: '-1y' } },
    ));

    expect(audit.calls).toStrictEqual([{
      name: 'configuration.create',
      request: {
        method: 'POST',
        path: '/v1/marketview/widgets/configurations',
        query: { limit: 5 },
        body: { relativeDate: '-1y' },
      },
    }]);
  });

  async function failureOf(error: unknown) {
    const recorder = createWidgetEvidenceRecorder({
      async request() {
        throw error;
      },
    });
    const { audit } = await recorder.record(
      'read',
      () => recorder.port.request({ method: 'GET', path: '/v1/charts/CH_ONE' } as Endpoint)
        .catch(() => undefined),
    );
    return { failure: audit.failure, callError: audit.calls[0]?.error };
  }

  it('records a Marquee failure with its details and without the body the message repeats', async () => {
    const body = '{"error":"Not authorized"}';

    expect(await failureOf(new MarqueeError(
      'auth_expired',
      `Not authenticated. Run: marquee auth login — ${body}`,
      {
        status: 401,
        path: '/v1/data/visualizations/DV_ONE/render',
        body,
        responseClassification: 'http_401',
      },
    ))).toStrictEqual({
      failure: {
        message: 'Not authenticated. Run: marquee auth login',
        status: 401,
        path: '/v1/data/visualizations/DV_ONE/render',
        body,
        responseClassification: 'http_401',
      },
      callError: 'Not authenticated. Run: marquee auth login',
    });
  });

  it('keeps a Marquee failure message that does not end with its body', async () => {
    expect(await failureOf(new MarqueeError('http', 'Marquee returned 500 for /v1/charts/CH_ONE', {
      status: 500,
      body: 'Internal error',
    }))).toStrictEqual({
      failure: {
        message: 'Marquee returned 500 for /v1/charts/CH_ONE',
        status: 500,
        body: 'Internal error',
      },
      callError: 'Marquee returned 500 for /v1/charts/CH_ONE',
    });
    expect((await failureOf(new MarqueeError('timeout', 'Request timed out after 30s'))).failure)
      .toStrictEqual({ message: 'Request timed out after 30s' });
  });

  it('records only the message of a failure that is not a Marquee error', async () => {
    expect((await failureOf(Object.assign(new Error('chart failed — denied'), {
      details: { status: 403, body: 'denied' },
    }))).failure).toStrictEqual({ message: 'chart failed — denied' });
    expect((await failureOf(null)).failure).toStrictEqual({ message: 'null' });
  });

  it('records a cancelled request unless it is aborted Dashboard enrichment', async () => {
    const cancelled = new MarqueeError('network', 'Request canceled after caller aborted', { isCanceled: true });
    const recorder = createWidgetEvidenceRecorder({
      async request() {
        throw cancelled;
      },
    });
    const aborted = new AbortController();
    aborted.abort();
    const send = (path: string, signal: AbortSignal) => recorder.record(
      'read',
      () => recorder.port.request({ method: 'GET', path } as Endpoint, { signal }).catch(() => undefined),
    );

    const failures = await Promise.all([
      send('/v1/marketview/dashboards', aborted.signal),
      send('/v1/marketview/dashboards', new AbortController().signal),
      send('/v1/charts/CH_ONE', aborted.signal),
    ]);

    expect(failures.map(({ audit }) => audit.failure)).toStrictEqual([
      undefined,
      { message: 'Request canceled after caller aborted' },
      { message: 'Request canceled after caller aborted' },
    ]);
  });

  it('stops recording into a load\'s call log once the load returns', async () => {
    const recorder = createWidgetEvidenceRecorder({ request: async () => ({}) });
    const chart = { method: 'GET', path: '/v1/charts/CH_TEST' } as Endpoint;
    const widget = {
      get: async () => {
        await recorder.port.request(chart);
        return { ok: false, error: {} };
      },
    } as unknown as WidgetModule;

    const { audit } = await createMarketViewWidget(widget, recorder).get({
      widgetId: 'MW_TEST',
      configurationId: null,
      parameters: [],
    } as never);
    await recorder.port.request(chart);

    expect(audit.calls).toHaveLength(1);
  });

  it('records parameter overrides as a change in the load audit', async () => {
    const recorder = createWidgetEvidenceRecorder({ request: async () => ({}) });
    const failure = { ok: false, error: { kind: 'widget-not-found', identity: { widgetId: 'MW_TEST' } } } as const;
    const widget: WidgetModule = { get: async () => failure, render: async () => failure };

    const { audit } = await createMarketViewWidget(widget, recorder).get({
      widgetId: 'MW_TEST' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'tenor', value: '2y' }],
      detail: 'full',
    });

    expect(audit.intent).toBe('change');
  });
});
