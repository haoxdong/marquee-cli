import { describe, expect, it } from 'vitest';
import { MarqueeError } from '../../../transport/index.js';
import { createEntityModule } from '../../../entity/index.js';
import { createControlGroupModule } from '../../../control-group/index.js';
import {
  createWidget,
  type ConfigId,
  type RenderedWidget,
  type WidgetId,
  type WidgetResult,
} from '../../index.js';
import type { WidgetPort } from '../port.js';

// Widget view reads the Config, the authors and the Plot Chart together once the Widget
// arrives: the output is unchanged, and the first failure is the error.

type Respond = (init: Readonly<{ body?: unknown }>) => unknown;

/** A transport that answers from `responses`; `pending` requests answer only when aborted. */
function createAdapter(
  responses: Readonly<Record<string, Respond>>,
  pending: readonly string[] = [],
): WidgetPort & { aborted: string[] } {
  const aborted: string[] = [];
  return {
    aborted,
    async request(target, init) {
      const key = `${target.method} ${target.path}`;
      if (pending.includes(key)) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted.push(key);
            reject(new MarqueeError('network', `${key} canceled`, { isCanceled: true }));
          });
        });
      }
      const respond = responses[key];
      if (!respond) throw new Error(`unexpected ${key}`);
      return respond(init ?? {});
    },
  };
}

function widgetModule(adapter: WidgetPort) {
  return createWidget(adapter, {
    entity: createEntityModule(adapter),
    controlGroup: createControlGroupModule(adapter),
  });
}

const WIDGET = 'GET /v1/marketview/widgets/MW_ORDER';
const USERS = 'POST /v1/users/query';
const CONFIG_POST = 'POST /v1/marketview/widgets/configurations';
const CONFIG_GET = 'GET /v1/marketview/widgets/configurations';
const CHART = 'GET /v1/charts/CH_ORDER';

function forbidden(path: string): MarqueeError {
  return new MarqueeError('http', `Marquee returned 403 for ${path}`, { status: 403, path });
}

function chartNotFound(): MarqueeError {
  return new MarqueeError('http', 'Marquee returned 404 for /v1/charts/CH_ORDER', {
    status: 404,
    path: '/v1/charts/CH_ORDER',
  });
}

function plotResponses(widget: Readonly<Record<string, unknown>> = {}): Record<string, Respond> {
  return {
    [WIDGET]: () => ({
      id: 'MW_ORDER',
      title: 'Ordered plot',
      underlyingChartId: 'CH_ORDER',
      authors: ['AUTHOR'],
      label: 'external',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'Ordered plot' },
      ...widget,
    }),
    [CONFIG_POST]: () => ({
      id: 'WC_ORDER',
      widgetId: 'MW_ORDER',
      underlyingChartId: 'CH_ORDER',
      parameters: [],
    }),
    [CONFIG_GET]: () => [{ id: 'WC_ORDER', widgetId: 'MW_ORDER', parameters: [] }],
    [USERS]: () => ({ totalResults: 1, results: [{ id: 'AUTHOR', name: 'Morgan Sample' }] }),
    [CHART]: () => ({
      description: 'USD.foo()',
      chartType: 'line',
      expressions: [{ label: 'Series' }],
      relativeStartDate: '-1y',
      interval: 'Daily',
    }),
    'POST /v1/plots/runner': () => ({
      expressions: ['USD.foo()'],
      results: [{ type: 'series', values: { '2026-01-01': 1, '2026-01-02': 2 } }],
      statistics: [{ error: 'Error', message: 'No statistics for empty series.' }],
    }),
    'GET /v1/marketview/dashboards': () => ({ results: [] }),
  };
}

function dataVizResponses(): Record<string, Respond> {
  return {
    [WIDGET]: () => ({
      id: 'MW_ORDER',
      title: 'Ordered table',
      underlyingChartId: 'DV_ORDER',
      visualizationType: 'DataViz',
      authors: ['AUTHOR'],
      renderParams: { component: {} },
      parameters: [],
      metadata: { title: 'Ordered table' },
    }),
    [CONFIG_POST]: () => ({
      id: 'WC_ORDER',
      widgetId: 'MW_ORDER',
      underlyingChartId: 'DV_ORDER',
      parameters: [],
    }),
    [USERS]: () => ({ totalResults: 1, results: [{ id: 'AUTHOR', name: 'Morgan Sample' }] }),
    'GET /v1/data/visualizations/DV_ORDER': () => ({}),
    'POST /v1/data/visualizations/DV_ORDER/render': () => ({ renderData: { data: [], layout: {} } }),
    'GET /v1/marketview/dashboards': () => ({ results: [] }),
  };
}

function view(
  adapter: WidgetPort,
  input: Readonly<{ configurationId?: string; parameters?: readonly { field: string; value: string }[] }> = {},
): Promise<WidgetResult<RenderedWidget>> {
  return widgetModule(adapter).get({
    widgetId: 'MW_ORDER' as WidgetId,
    configurationId: (input.configurationId ?? null) as ConfigId,
    parameters: input.parameters ?? [],
    detail: 'full',
  });
}

const ACCESS_DENIED = { kind: 'widget-access-denied', identity: { widgetId: 'MW_ORDER' } };

describe('Widget view setup reads', () => {
  it.each([
    ['plot', plotResponses],
    ['DataViz', dataVizResponses],
  ] as const)('renders a %s Widget with its authors', async (_family, responses) => {
    await expect(view(createAdapter(responses()))).resolves.toMatchObject({
      ok: true,
      value: { detail: 'full', widget: { widgetId: 'MW_ORDER', authors: ['Morgan Sample'] } },
    });
  });

  it.each([
    ['the Config', CONFIG_POST, () => { throw forbidden('/v1/marketview/widgets/configurations'); }],
    ['the author lookup', USERS, () => { throw forbidden('/v1/users/query'); }],
  ] as const)('fails with %s error', async (_read, key, respond) => {
    await expect(view(createAdapter({ ...plotResponses(), [key]: respond })))
      .resolves.toEqual({ ok: false, error: ACCESS_DENIED });
  });

  it.each([
    ['', {}],
    [' with its Config', { configurationId: 'WC_ORDER' }],
    [' under -p relativeDate', { parameters: [{ field: 'relativeDate', value: 'ytd' }] }],
  ] as const)('fails a missing Chart as a render failure%s', async (_case, input) => {
    const adapter = createAdapter({ ...plotResponses(), [CHART]: () => { throw chartNotFound(); } });

    await expect(view(adapter, input)).resolves.toEqual({
      ok: false,
      error: {
        kind: 'plottool-failure',
        identity: { widgetId: 'MW_ORDER' },
        problem: { kind: 'chart-not-found', chartId: 'CH_ORDER' },
      },
    });
  });

  it('rejects an unknown parameter without waiting on the author lookup or the Chart', async () => {
    const adapter = createAdapter(plotResponses(), [USERS, CHART]);

    await expect(view(adapter, {
      configurationId: 'WC_ORDER',
      parameters: [{ field: 'notAParameter', value: 'x' }],
    })).resolves.toMatchObject({ ok: false, error: { kind: 'unknown-input', input: 'notAParameter' } });
    expect(adapter.aborted).toEqual(expect.arrayContaining([USERS, CHART]));
  });

  it('rejects a malformed access label without waiting on the author lookup', async () => {
    const adapter = createAdapter(plotResponses({ label: 'bogus' }), [USERS]);

    await expect(view(adapter)).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_ORDER' },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'widget.label bogus is not a supported access label',
      },
    });
    expect(adapter.aborted).toEqual([USERS]);
  });
});
