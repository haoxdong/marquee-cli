import { describe, expect, it, vi } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { createEntityFeedProductionAdapter } from '../production.js';

describe('Entity Feed production adapter', () => {
  it('returns a closed semantic dependency failure without provider diagnostics', async () => {
    const adapter = createEntityFeedProductionAdapter({
      async request() {
        throw new MarqueeError(
          'auth_expired',
          'Not authenticated. Run: marquee auth login at upstream path /v1/marketview/widgets',
        );
      },
    });

    await expect(adapter.page('MA_AAPL', { limit: 1 })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dependency',
        source: 'feed',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });
  });

  it.each([
    {
      name: 'a classified feed failure',
      path: '/v1/marketview/widgets',
      error: new MarqueeError('auth_expired', 'Provider authentication diagnostic'),
      expected: { kind: 'dependency', source: 'feed', failure: { kind: 'authentication-required', realm: 'marquee' } },
    },
    {
      name: 'an unclassified feed failure',
      path: '/v1/marketview/widgets',
      error: new Error('Provider network diagnostic'),
      expected: { kind: 'dependency', source: 'feed', failure: { kind: 'unavailable' } },
    },
    {
      name: 'a classified preferences failure',
      path: '/v1/marketview/preferences',
      error: new MarqueeError('timeout', 'Provider timeout diagnostic'),
      expected: { kind: 'dependency', source: 'preferences', failure: { kind: 'timeout' } },
    },
    {
      name: 'an unclassified preferences failure',
      path: '/v1/marketview/preferences',
      error: new Error('Provider network diagnostic'),
      expected: { kind: 'dependency', source: 'preferences', failure: { kind: 'unavailable' } },
    },
  ])('returns a closed semantic dependency failure for $name', async ({ path: failedPath, error, expected }) => {
    const adapter = createEntityFeedProductionAdapter({
      async request({ path }) {
        if (path === failedPath) throw error;
        return path === '/v1/marketview/widgets' ? { total_results: 0, results: [] } : { value: { pins: [] } };
      },
    });

    await expect(adapter.read('MA_AAPL')).resolves.toEqual({ ok: false, error: expected });
  });

  it('returns the feed failure when both the feed and preferences fail', async () => {
    const adapter = createEntityFeedProductionAdapter({
      async request({ path }) {
        if (path === '/v1/marketview/widgets') throw new MarqueeError('auth_expired', 'Feed diagnostic');
        throw new MarqueeError('timeout', 'Preferences diagnostic');
      },
    });

    await expect(adapter.read('MA_AAPL')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dependency',
        source: 'feed',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });
  });

  it('preserves the feed Widget values, route context, and available dates for direct rendering', async () => {
    const widgetDefinition = {
      id: 'MW_DATED',
      title: 'Dated Widget',
      metadata: { title: 'Dated Widget' },
      underlyingChartId: 'CH_DATED',
      visualizationType: 'Plot',
      contextParameter: { field: 'asset', type: 'Asset' },
      relativeDate: '6M',
      calculatedDates: {
        startDate: '2026-01-30',
        endDate: '2026-07-30',
        interval: '1D',
      },
      renderParams: {
        component: {
          asset: 'MA_AAPL',
          tenor: '5y',
        },
        controls: [
          { id: 'asset', value: 'MA_IGNORED_DUPLICATE' },
          { id: 'Relative Date', value: '6M' },
        ],
      },
    };
    const request = vi.fn(async () => ({
      total_results: 1,
      results: [widgetDefinition],
    }));

    const result = await createEntityFeedProductionAdapter({ request })
      .page('MA_AAPL', { limit: 1 });

    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: [{
          widgetDefinition,
          widgetParameterOverrides: [
            { field: 'asset', value: 'MA_AAPL' },
            { field: 'tenor', value: '5y' },
          ],
          selectedContext: 'MA_AAPL',
          widgetDates: {
            startDate: '2026-01-30',
            endDate: '2026-07-30',
            interval: '1D',
            relativeDate: '6M',
          },
        }],
      },
    });
  });

  it('maps feed entries directly while preserving identity, rank, and pins', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/marketview/widgets') {
        return {
          total_results: 2,
          results: [{
            id: 'mw_late',
            title: 'Late Widget',
            rank: 7,
            configurationId: 'wc_late',
            underlyingChartId: 'CH_LATE',
            visualizationType: 'line',
            relativeDate: '6M',
            parameters: [{ field: 'assetId', value: 'MA_AAPL' }],
          }, {
            id: 'MW_FIRST',
            title: 'First Widget',
            rank: 1,
            underlyingChartId: 'DV_FIRST',
            renderParams: { component: { type: 'table' } },
          }],
        };
      }
      if (path === '/v1/marketview/preferences') {
        return { value: { pins: [{ widgetId: 'mw_late', configurationId: 'wc_late' }] } };
      }
      throw new Error(`unexpected path ${path}`);
    });
    const result = await createEntityFeedProductionAdapter({ request }).read('MA_AAPL');

    expect(result).toEqual({
      ok: true,
      value: {
        total: 2,
        pins: [{ widgetId: 'MW_LATE', configurationId: 'WC_LATE' }],
        entries: [{
          widgetId: 'MW_LATE',
          title: 'Late Widget',
          rank: 7,
          configurationId: 'WC_LATE',
          widgetDefinition: {
            id: 'mw_late',
            title: 'Late Widget',
            rank: 7,
            configurationId: 'wc_late',
            underlyingChartId: 'CH_LATE',
            visualizationType: 'line',
            relativeDate: '6M',
            parameters: [{ field: 'assetId', value: 'MA_AAPL' }],
          },
          widgetParameterOverrides: [],
          selectedContext: null,
        }, {
          widgetId: 'MW_FIRST',
          title: 'First Widget',
          rank: 1,
          widgetDefinition: {
            id: 'MW_FIRST',
            title: 'First Widget',
            rank: 1,
            underlyingChartId: 'DV_FIRST',
            renderParams: { component: { type: 'table' } },
          },
          widgetParameterOverrides: [{ field: 'type', value: 'table' }],
          selectedContext: null,
        }],
      },
    });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/widgets' }, {
      query: { context: 'MA_AAPL', includeFilters: false },
      hedgeDelaysMs: [1000, 2000],
    });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/preferences' });
  });

  it('drops a saved pin that names no Widget', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/marketview/widgets') return { total_results: 0, results: [] };
      if (path === '/v1/marketview/preferences') {
        return { value: { pins: [42, { configurationId: 'wc_orphan' }, 'mw_kept'] } };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const result = await createEntityFeedProductionAdapter({ request }).read('MA_AAPL');

    expect(result.ok && result.value.pins).toEqual([{ widgetId: 'MW_KEPT' }]);
  });

  it('reads a later Widget page without rereading preferences', async () => {
    const request = vi.fn(async () => ({
      total_results: 12,
      results: [{ id: 'MW11', title: 'Eleven', rank: 11 }],
    }));
    const adapter = createEntityFeedProductionAdapter({ request });

    await expect(adapter.page('BR', { limit: 2, offset: 10 })).resolves.toEqual({
      ok: true,
      value: {
        total: 12,
        entries: [{
          widgetId: 'MW11',
          title: 'Eleven',
          rank: 11,
          widgetDefinition: { id: 'MW11', title: 'Eleven', rank: 11 },
          widgetParameterOverrides: [],
          selectedContext: null,
        }],
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/widgets' }, {
      query: { context: 'BR', includeFilters: false, limit: 2, offset: 10 },
      hedgeDelaysMs: [1000, 2000],
    });
  });

  it('preserves configured identity in server query results', async () => {
    const request = vi.fn(async () => ({
      total_results: 1,
      results: [{ id: 'MW_CARRY', configurationId: 'WC_3M', title: 'Carry' }],
    }));
    const adapter = createEntityFeedProductionAdapter({ request });
    const result = await adapter.page('MA_EURUSD', { query: 'carry 3m' });
    expect(result).toMatchObject({ ok: true, value: { total: 1, entries: [{ widgetId: 'MW_CARRY', configurationId: 'WC_3M' }] } });
  });

  it.each([
    ['asset', 'MA_AAPL', 'Asset'],
    ['country', 'US', 'Country'],
    ['portfolio', 'MP_BOOK', 'Portfolio'],
  ] as const)(
    'passes an Entity Feed %s route scope directly as Selected Context',
    async (_label, entityId, type) => {
      const request = vi.fn(async () => ({
        total_results: 1,
        results: [{
          id: 'MW_CONTEXT',
          title: 'Context Widget',
          underlyingChartId: 'CH_CONTEXT',
          contextParameter: {
            field: 'context',
            type,
          },
          parameters: [],
        }],
      }));
      const adapter = createEntityFeedProductionAdapter({ request });

      const result = await adapter.page(entityId, { limit: 1 });

      expect(result).toMatchObject({
        ok: true,
        value: {
          entries: [{
            widgetDefinition: {
              id: 'MW_CONTEXT',
              title: 'Context Widget',
              underlyingChartId: 'CH_CONTEXT',
              contextParameter: {
                field: 'context',
                type,
              },
              parameters: [],
            },
            widgetParameterOverrides: [],
            selectedContext: entityId,
          }],
        },
      });
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it('leaves Selected Context null for a contextless feed Widget', async () => {
    const adapter = createEntityFeedProductionAdapter({
      async request() {
        return {
          total_results: 1,
          results: [{
            id: 'MW_CONTEXTLESS',
            title: 'Contextless Widget',
            underlyingChartId: 'CH_CONTEXTLESS',
          }],
        };
      },
    });

    const result = await adapter.page('MA_AAPL', { limit: 1 });

    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: [{ selectedContext: null }],
      },
    });
  });

  it('fails loud when a provider Widget cannot normalize into a semantic binding', async () => {
    const adapter = createEntityFeedProductionAdapter({
      async request() {
        return { total_results: 1, results: [{ id: 'MW_MISSING_TITLE' }] };
      },
    });

    await expect(adapter.page('MA_AAPL', { limit: 1 })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-feed',
        problem: 'widget-entry',
      },
    });
  });

  it.each([
    ['a Widget ID that is a Config ID', { id: 'WC_NOT_A_WIDGET', title: 'Swapped' }],
    ['a Config ID that is a Widget ID', { id: 'MW_FEED', title: 'Swapped', configurationId: 'MW_NOT_A_CONFIG' }],
  ])('fails loud on a feed Widget with %s', async (_label, widget) => {
    const adapter = createEntityFeedProductionAdapter({
      async request() {
        return { total_results: 1, results: [widget] };
      },
    });

    await expect(adapter.page('MA_AAPL', { limit: 1 })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-feed',
        problem: 'widget-entry',
      },
    });
  });

  it('returns a typed feed failure when available Widget dates are malformed', async () => {
    const adapter = createEntityFeedProductionAdapter({
      async request({ path }) {
        if (path === '/v1/marketview/widgets') {
          return {
            total_results: 1,
            results: [{
              id: 'MW_BAD_DATES',
              title: 'Bad dates',
              calculatedDates: {
                startDate: '2026-01-30',
                endDate: '2026-07-30',
              },
            }],
          };
        }
        return { value: { pins: [] } };
      },
    });

    await expect(adapter.read('MA_AAPL')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-feed',
        problem: 'widget-entry',
      },
    });
  });

  it.each([
    ['nested under value', { value: { pins: [{ id: 'mw_nested' }] } }, [{ widgetId: 'MW_NESTED' }]],
    ['at the root', { pins: [{ id: 'mw_root', configId: 'wc_root' }] }, [{ widgetId: 'MW_ROOT', configurationId: 'WC_ROOT' }]],
    ['absent', { value: {} }, []],
    ['lacking a widget id', { pins: [{ configId: 'wc_orphan' }, { id: 'mw_kept' }] }, [{ widgetId: 'MW_KEPT' }]],
  ])('decodes preferences with pins %s', async (_shape, preferences, pins) => {
    const adapter = createEntityFeedProductionAdapter({
      async request({ path }) {
        return path === '/v1/marketview/widgets' ? { total_results: 0, results: [] } : preferences;
      },
    });

    await expect(adapter.read('MA_AAPL')).resolves.toMatchObject({ ok: true, value: { pins } });
  });
});
