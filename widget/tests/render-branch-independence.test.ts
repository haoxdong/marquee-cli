// ADR 0059 requires Widget rendering to start its data, title, and params branches
// independently; ADR 0073 proves it here by holding one branch's response open with MSW
// and requiring the other branches' requests to arrive before it is released.
// No clock is read: a serialized render never delivers the awaited arrivals.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createControlGroupModule } from '../../control-group/index.js';
import { createEntityModule } from '../../entity/index.js';
import { createTransport } from '../../transport/index.js';
import { createWidget, type WidgetDefinition } from '../index.js';

type Branch = 'data' | 'title' | 'params';

const MARQUEE = 'https://marquee.gs.com';
const basketId = `MA${'B'.repeat(14)}`;
const portfolioId = `MP${'A'.repeat(14)}`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

// Serves each branch's requests; every request of the held branch waits for release.
function serveBranches(held: Branch) {
  const arrived = { data: deferred(), title: deferred(), params: deferred() };
  const release = deferred();
  const enter = async (name: Branch): Promise<void> => {
    arrived[name].resolve();
    if (name === held) await release.promise;
  };
  server.use(
    http.get(`${MARQUEE}/v1/data/visualizations/DV_PARALLEL`, async () => {
      await enter('data');
      return HttpResponse.json({});
    }),
    http.post(`${MARQUEE}/v1/data/visualizations/DV_PARALLEL/render`, async () => {
      await enter('data');
      return HttpResponse.json({
        renderData: { data: [{ type: 'bar', x: ['A'], y: [1] }], layout: {} },
      });
    }),
    http.post(`${MARQUEE}/v1/marketview/widgets/MW_PARALLEL/metadata`, async () => {
      await enter('title');
      return HttpResponse.json({ metadata: {} });
    }),
    http.get(`${MARQUEE}/v1/plots/entities`, async ({ request }) => {
      if (new URL(request.url).searchParams.get('type') === 'Portfolio') {
        await enter('params');
        return HttpResponse.json({
          portfolios: [{ id: portfolioId, name: 'Growth Portfolio' }],
        });
      }
      return HttpResponse.json({
        assets: [{ id: basketId, name: 'Global Growth Basket' }],
      });
    }),
    http.get(`${MARQUEE}/v1/marketview/dashboards`, () => HttpResponse.json({ results: [] })),
    http.post(`${MARQUEE}/tokenExchange`, () => HttpResponse.json({
      accessToken: 'access-token',
      expiryInMillis: Number.MAX_SAFE_INTEGER,
    })),
  );
  return {
    arrivals: (branches: readonly Branch[]) => Promise.all(
      branches.map((name) => arrived[name].promise),
    ),
    release: release.resolve,
  };
}

function widgetModules() {
  const transport = createTransport({
    execution: 'direct',
    authentication: {
      cookieJarPath: '/dev/null',
      persistCookies: false,
      jar: {
        cookies: [{
          name: 'MarqueeIdToken',
          value: 'id-token',
          domain: 'marquee.gs.com',
          path: '/',
          secure: true,
        }],
        updatedAt: 0,
      },
    },
  });
  const entity = createEntityModule(transport);
  return {
    widget: createWidget(transport, {
      entity,
      controlGroup: createControlGroupModule(transport),
    }),
    entity,
  };
}

function widgetModule() {
  return widgetModules().widget;
}

const widgetDefinition = {
  id: 'MW_PARALLEL',
  configurationId: 'WC_PARALLEL',
  title: `Exposure to <Asset:${basketId}>`,
  useEntityTitle: true,
  underlyingChartId: 'DV_PARALLEL',
  visualizationType: 'DataViz',
  parameters: [{ field: 'portfolio', type: 'Portfolio', value: portfolioId }],
  renderParams: { component: { portfolio: portfolioId }, controls: [] },
} as unknown as WidgetDefinition;

const renderedSnippet = {
  title: 'Exposure to Global Growth Basket',
  parameterLines: ['portfolio=Growth Portfolio'],
};

describe('Widget render branch independence', () => {
  it.each<[Branch, Branch[]]>([
    ['data', ['title', 'params']],
    ['title', ['data', 'params']],
    ['params', ['data', 'title']],
  ])('full render reaches the other branches while %s is held', async (held, others) => {
    const branches = serveBranches(held);

    const result = widgetModule().render(widgetDefinition, [], null, undefined, 'full');
    await branches.arrivals(others);
    branches.release();

    await expect(result).resolves.toMatchObject({
      ok: true,
      value: { detail: 'full', snippet: renderedSnippet },
    });
  });

  it('cancels an in-flight DataViz spec when required parameter resolution fails', async () => {
    const branches = serveBranches('data');
    const specArrived = deferred();
    const releaseSpec = deferred();
    let specRequest: Request | undefined;
    server.use(
      http.get(`${MARQUEE}/v1/data/visualizations/DV_PARALLEL`, async ({ request }) => {
        specRequest = request;
        specArrived.resolve();
        await releaseSpec.promise;
        return HttpResponse.json({});
      }),
      http.get(`${MARQUEE}/v1/plots/entities`, async ({ request }) => {
        if (new URL(request.url).searchParams.get('type') === 'Portfolio') {
          await specArrived.promise;
          return HttpResponse.json({ portfolios: [] });
        }
        return HttpResponse.json({
          assets: [{ id: basketId, name: 'Global Growth Basket' }],
        });
      }),
    );

    try {
      const result = await widgetModule().render(widgetDefinition, [], null, undefined, 'full');
      expect(result).toEqual({
        ok: false,
        error: {
          kind: 'missing-display-evidence',
          identity: { widgetId: 'MW_PARALLEL' },
          field: 'portfolio',
          identifier: { kind: 'portfolio', value: portfolioId },
        },
      });
      expect(specRequest?.signal.aborted).toBe(true);
    } finally {
      releaseSpec.resolve();
      branches.release();
    }
  });

  it('cancels DataViz and editable dashboards when the title fails first', async () => {
    serveBranches('title');
    const specArrived = deferred();
    const dashboardsArrived = deferred();
    const release = deferred();
    const requests: Request[] = [];
    server.use(
      http.get(`${MARQUEE}/v1/data/visualizations/DV_PARALLEL`, async ({ request }) => {
        requests.push(request);
        specArrived.resolve();
        await release.promise;
        return HttpResponse.json({});
      }),
      http.get(`${MARQUEE}/v1/marketview/dashboards`, async ({ request }) => {
        requests.push(request);
        dashboardsArrived.resolve();
        await release.promise;
        return HttpResponse.json({ results: [] });
      }),
      http.post(`${MARQUEE}/v1/marketview/widgets/MW_PARALLEL/metadata`, async () => {
        await Promise.all([specArrived.promise, dashboardsArrived.promise]);
        return HttpResponse.json({ message: 'Title unavailable' }, { status: 503 });
      }),
    );

    try {
      const result = await widgetModule().render(widgetDefinition, [], null, undefined, 'full');
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'widget-load-failure', failure: { kind: 'unavailable' } },
      });
      expect(requests.map(({ signal }) => signal.aborted)).toEqual([true, true]);
    } finally {
      release.resolve();
    }
  });

  it('cancels Control Group expansion before overflow follow-ups when data fails', async () => {
    serveBranches('data');
    const groups = [`CG${'A'.repeat(14)}`, `CG${'B'.repeat(14)}`];
    const expansionArrived = deferred();
    const releaseExpansion = deferred();
    const requests: Request[] = [];
    server.use(
      http.get(`${MARQUEE}/v1/marketview/constituents`, async ({ request }) => {
        requests.push(request);
        expansionArrived.resolve();
        await releaseExpansion.promise;
        return HttpResponse.json({
          results: Array.from({ length: 100 }, (_, index) => ({
            constituentId: `MA_MEMBER_${index}`,
            name: `Member ${index}`,
            controlGroups: groups,
          })),
        });
      }),
      http.get(`${MARQUEE}/v1/data/visualizations/DV_PARALLEL`, async () => {
        await expansionArrived.promise;
        return HttpResponse.json({ message: 'Data unavailable' }, { status: 503 });
      }),
    );

    try {
      const result = await widgetModule().render({
        ...widgetDefinition,
        parameters: [{ field: 'basket', type: 'Asset', value: basketId, options: groups }],
        renderParams: { component: { basket: basketId }, controls: [] },
      }, [], null, undefined, 'full');
      expect(result).toMatchObject({ ok: false, error: { kind: 'data-viz-failure' } });
      expect(requests.map(({ signal }) => signal.aborted)).toEqual([true]);
    } finally {
      releaseExpansion.resolve();
    }
    // Flush the released response's continuations without a clock.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(requests).toHaveLength(1);
  });

  it('stops subsequent title lookups after failure without cancelling shared Entity work', async () => {
    serveBranches('data');
    const assetArrived = deferred();
    const releaseAsset = deferred();
    const entityRequests: string[] = [];
    let assetRequest: Request | undefined;
    server.use(
      http.get(`${MARQUEE}/v1/data/visualizations/DV_PARALLEL`, async () => {
        await assetArrived.promise;
        return HttpResponse.json({ message: 'Data unavailable' }, { status: 503 });
      }),
      http.get(`${MARQUEE}/v1/plots/entities`, async ({ request }) => {
        const type = new URL(request.url).searchParams.get('type');
        entityRequests.push(type ?? 'Asset');
        if (type === 'Country') return HttpResponse.json({ countries: [{ code: 'US', name: 'United States' }] });
        assetRequest = request;
        assetArrived.resolve();
        await releaseAsset.promise;
        return HttpResponse.json({ assets: [{ id: basketId, name: 'Global Growth Basket' }] });
      }),
    );
    const { widget, entity } = widgetModules();
    const shared = entity.resolve([{ kind: 'asset', value: basketId }]);
    const result = await widget.render({
      ...widgetDefinition,
      title: `Exposure to <Asset:${basketId}> in <Country:US>`,
      contextParameter: { field: 'Asset', type: 'Asset', values: { default: basketId } },
      parameters: [],
      renderParams: { component: { Asset: basketId }, controls: [] },
    }, [{ field: 'Asset', value: basketId }], basketId, undefined, 'full');

    try {
      expect(result).toMatchObject({ ok: false, error: { kind: 'data-viz-failure' } });
      expect(assetRequest?.signal.aborted).toBe(false);
    } finally {
      releaseAsset.resolve();
    }
    await expect(shared).resolves.toMatchObject({ ok: true });
    // Flush the completed Entity consumer's promise continuations, without a clock.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(entityRequests).toEqual(['Asset']);
  });

  it.each<[Branch, Branch]>([
    ['title', 'params'],
    ['params', 'title'],
  ])('Widget Snippet render reaches the other branch while %s is held', async (held, other) => {
    const branches = serveBranches(held);

    const result = widgetModule().render(widgetDefinition, [], null, undefined, 'snippet');
    await branches.arrivals([other]);
    branches.release();

    await expect(result).resolves.toMatchObject({
      ok: true,
      value: { detail: 'snippet', snippet: renderedSnippet },
    });
  });
});
