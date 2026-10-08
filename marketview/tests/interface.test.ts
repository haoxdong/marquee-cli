import type { ConfigId, WidgetId } from '../../widget/index.js';
import type { Dashboard } from '../../dashboard/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { createControlGroupModule } from '../../control-group/index.js';
import { createEntityModule, type EntityModule } from '../../entity/index.js';
import type { WidgetModule } from '../../widget/index.js';
import {
  createMarketView as createProductionMarketView,
  type MarketViewConfig,
  type MarketViewProviderEvidence,
} from '../index.js';
import { createFakeDashboardModule } from './fake-dashboard.js';

function unexpected(): never {
  throw new Error('unexpected MarketView dependency');
}

function createMarketView(
  config: Pick<MarketViewConfig, 'registry'> & Partial<MarketViewConfig>,
) {
  return createProductionMarketView({
    controlGroup: createControlGroupModule({ request: async () => unexpected() }),
    dashboardPreferencesRequester: {
      request: async () => ({ value: { pins: [] } }),
    },
    readEntityFeedPage: async () => unexpected(),
    dashboard: createFakeDashboardModule(),
    entity: createEntityModule({ request: async () => unexpected() }),
    entityFeed: { get: async () => unexpected() },
    searchRequester: { request: async () => unexpected() },
    widgetTransport: { request: async () => unexpected() },
    widget: { get: async () => unexpected(), render: async () => unexpected() },
    ...config,
  });
}

describe('MarketView interface', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('exposes only the ratified nested noun tree', () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-interface-'));
    const marketView = createMarketView({
      registry: createArtifactRegistry(directory, 'marketview-interface'),
    });

    expect(Object.keys(marketView)).toEqual(['search', 'widget', 'dashboard']);
    expect(Object.keys(marketView.widget)).toEqual(['get']);
    expect(Object.keys(marketView.dashboard)).toEqual(['get', 'edit', 'create']);
  });

  it('returns typed results with evidence and no presentation outcome', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-outcome-'));
    const marketView = createMarketView({
      registry: createArtifactRegistry(directory, 'marketview-outcome'),
    });

    await expect(marketView.dashboard.create({
      name: ' ',
      widgetRefs: [],
    })).resolves.toEqual({
      result: {
        ok: false,
        error: {
          kind: 'dashboard',
          error: { kind: 'invalid-name', name: ' ' },
        },
      },
      evidence: [],
    });

    await expect(marketView.dashboard.edit({
      target: 'MD_EMPTY',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: [],
      removeSectionRefs: [],
    })).resolves.toEqual({
      result: {
        ok: false,
        error: { kind: 'invalid-input', reason: 'no-mutations' },
      },
      evidence: [],
    });

    await expect(marketView.widget.get({
      target: 'not-a-widget',
      overrides: [],
      detail: 'full',
    })).resolves.toEqual({
      result: {
        ok: false,
        error: { kind: 'invalid-widget-id', input: 'not-a-widget' },
      },
      evidence: [],
    });

    await expect(marketView.dashboard.get({
      target: '@missing',
    })).resolves.toEqual({
      result: {
        ok: false,
        error: {
          kind: 'artifact-not-found',
          ref: 'missing',
          availableRefs: [],
        },
      },
      evidence: [],
    });

    await expect(marketView.search({
      query: ' ',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      result: {
        ok: false,
        error: {
          kind: 'invalid-query',
        },
      },
      evidence: [],
    });
  });

  it('keeps Search adapter diagnostics in ordered facade evidence', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-search-evidence-'));
    const entries: Array<{
      order: number;
      owner: string;
      operation: string;
      outcome: 'dispatched' | 'succeeded' | 'failed' | 'cancelled';
      value?: unknown;
    }> = [];
    const evidence = {
      reserve(call: Readonly<{ owner: string; operation: string }>) {
        const entry = {
          order: entries.length + 1,
          ...call,
          outcome: 'dispatched' as const,
        };
        entries.push(entry);
        return {
          succeed: (value?: unknown) => Object.assign(entry, { outcome: 'succeeded', value }),
          fail: (value?: unknown) => Object.assign(entry, { outcome: 'failed', value }),
          cancel: (value?: unknown) => Object.assign(entry, { outcome: 'cancelled', value }),
        };
      },
      snapshot: () => entries,
    };
    const marketView = createMarketView({
      registry: createArtifactRegistry(directory, 'marketview-search-evidence'),
      searchRequester: {
        request: async () => ({}),
      },
      evidence,
    });

    await expect(marketView.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      result: {
        ok: false,
        error: {
          kind: 'discovery-failed',
          failure: { kind: 'unavailable' },
        },
      },
      evidence: [{
        order: 1,
        owner: 'marketview-search.adapter',
        operation: 'discover',
        outcome: 'failed',
        value: {
          kind: 'adapter-failure',
          message: 'Adapter "marketview.search" failed: Unsupported MarketView search response shape: missing resultsMap; record a Scenario before accepting this fallback.',
          selectors: ['keyword-widget'],
        },
      }, {
        order: 2,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: {
          kind: 'discovery-failure-reference',
          selectors: ['keyword-widget'],
        },
      }],
    });
  });

  it('passes an explicit Config ID with a Widget ID target to Widget.get', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-widget-explicit-config-'));
    const get = vi.fn<WidgetModule['get']>(async () => ({
      ok: false,
      error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } },
    }));
    const marketView = createMarketView({
      registry: createArtifactRegistry(directory, 'marketview-widget-explicit-config'),
      widget: { get, render: async () => unexpected() },
    });

    await marketView.widget.get({
      target: 'MW_ONE',
      configurationId: 'WC_ONE',
      overrides: [],
      detail: 'full',
    });
    expect(get).toHaveBeenCalledWith(expect.objectContaining({
      widgetId: 'MW_ONE',
      configurationId: 'WC_ONE',
    }));
  });

  it('claims a fresh Widget Ref when viewing a root Widget Ref', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-widget-artifact-intent-'));
    const registry = createArtifactRegistry(directory, 'marketview-widget-artifact-intent');
    expect(registry.claimWidget()).toBe('w1');
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId, selectedContext: null },
    });
    const widget: WidgetModule = {
      async get() {
        return {
          ok: true,
          value: {
            detail: 'full',
            widget: {
              widgetId: 'MW_ONE' as WidgetId,
              configurationId: 'WC_ONE' as ConfigId,
              title: 'Widget One',
              chartId: 'CH_ONE',
              family: 'plot',
              bindings: [],
              parameters: [],
            },
            snippet: {
              title: 'Widget One',
              isTitleResolved: true,
              parameterLines: [],
            },
            execution: {
              family: 'plot',
              value: {
                projection: {
                  kind: 'plot',
                  chartType: 'line',
                  isOrdinal: false,
                  series: [],
                  axes: [],
                },
                specification: { data: [], layout: {} },
                rows: [],
                rowModel: {
                  summary: 'time series, 0 series, 0 points',
                  columns: ['date'],
                },
                seriesCount: 0,
                hasSeriesLabels: true,
                isEmpty: true,
              },
            },
          },
        };
      },
      render: async () => unexpected(),
    };
    const marketView = createMarketView({
      registry,
      widget,
    });

    const ordinary = await marketView.widget.get({
      target: '@w1',
      overrides: [],
      detail: 'full',
    });
    expect(ordinary.result).toMatchObject({ ok: true, value: { namespace: 'w2' } });
    expect(registry.claimWidget()).toBe('w3');
  });

  it('appends synthetic evidence after shared log order', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-evidence-order-'));
    const evidenceLog: MarketViewProviderEvidence[] = [{
      order: 1,
      owner: 'prior-operation',
      operation: 'first',
      outcome: 'succeeded',
    }, {
      order: 2,
      owner: 'prior-operation',
      operation: 'second',
      outcome: 'succeeded',
    }];
    const marketView = createMarketView({
      registry: createArtifactRegistry(directory, 'marketview-evidence-order'),
      searchRequester: {
        async request() {
          evidenceLog.push({
            order: 3,
            owner: 'marketview-search',
            operation: 'request',
            outcome: 'dispatched',
          }, {
            order: 4,
            owner: 'marketview-search',
            operation: 'request',
            outcome: 'succeeded',
          });
          return { [['results', 'Map'].join('')]: { widgets: [] } };
        },
      },
      evidence: { snapshot: () => evidenceLog },
    });

    const outcome = await marketView.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 1,
    });

    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        kind: 'search',
        search: {
          page: {
            type: 'marketview-search',
            query: 'carry',
            results: [],
          },
        },
      },
    });
    expect(outcome.evidence.map(({ order }) => order)).toEqual([3, 4, 5]);
  });
});

function renderedWidget(
  identity: Readonly<{ configurationId?: string; selectedContext?: string }> = {},
): Extract<Awaited<ReturnType<WidgetModule['get']>>, { ok: true }>['value'] {
  return {
    detail: 'full',
    widget: {
      widgetId: 'MW_ONE' as WidgetId,
      ...(identity.configurationId ? { configurationId: identity.configurationId as ConfigId } : {}),
      ...(identity.selectedContext ? { selectedContext: identity.selectedContext } : {}),
      title: 'Widget One',
      chartId: 'CH_ONE',
      family: 'plot',
      bindings: [],
      parameters: [],
    },
    snippet: { title: 'Widget One', isTitleResolved: true, parameterLines: [] },
    execution: {
      family: 'plot',
      value: {
        projection: { kind: 'plot', chartType: 'line', isOrdinal: false, series: [], axes: [] },
        specification: { data: [], layout: {} },
        rows: [],
        rowModel: { summary: 'time series, 0 series, 0 points', columns: ['date'] },
        seriesCount: 0,
        hasSeriesLabels: true,
        isEmpty: true,
      },
    },
  } as Extract<Awaited<ReturnType<WidgetModule['get']>>, { ok: true }>['value'];
}

describe('MarketView Widget get', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function setup(get: WidgetModule['get'], evidenceLog?: MarketViewProviderEvidence[]) {
    directory = mkdtempSync(join(tmpdir(), 'marketview-widget-get-'));
    const registry = createArtifactRegistry(directory, 'marketview-widget-get');
    const marketView = createMarketView({
      registry,
      widget: { get, render: async () => unexpected() },
      ...(evidenceLog ? { evidence: { snapshot: () => evidenceLog } } : {}),
    });
    return { marketView, registry };
  }

  it('records the Widget audit after the provider evidence of a successful get and claims its Ref', async () => {
    const evidenceLog: MarketViewProviderEvidence[] = [
      { order: 1, owner: 'prior-operation', operation: 'first', outcome: 'succeeded' },
    ];
    const { marketView, registry } = setup(async () => {
      evidenceLog.push({ order: 2, owner: 'widget.request', operation: 'GET /widget', outcome: 'succeeded' });
      return { ok: true, value: renderedWidget({ configurationId: 'WC_ONE', selectedContext: 'MA_ACME' }) };
    }, evidenceLog);

    const outcome = await marketView.widget.get({ target: 'MW_ONE', overrides: [], detail: 'full' });

    expect(outcome).toStrictEqual({
      result: { ok: true, value: { widget: renderedWidget({ configurationId: 'WC_ONE', selectedContext: 'MA_ACME' }), namespace: 'w1' } },
      evidence: [
        { order: 2, owner: 'widget.request', operation: 'GET /widget', outcome: 'succeeded' },
        { order: 3, owner: 'widget', operation: 'get', outcome: 'succeeded', value: { intent: 'read', calls: [] } },
      ],
    });
    expect(registry.resolveRef(registry.refName('w1'))).toStrictEqual({
      type: 'widget',
      widgetId: 'MW_ONE',
      configurationId: 'WC_ONE',
      selectedContext: 'MA_ACME',
    });
  });

  it('claims a Widget Ref without a Config ID or Selected Context the Widget does not have', async () => {
    const { marketView, registry } = setup(async () => ({ ok: true, value: renderedWidget() }));

    await marketView.widget.get({ target: 'MW_ONE', overrides: [], detail: 'snippet' });

    expect(registry.resolveRef(registry.refName('w1'))).toStrictEqual({ type: 'widget', widgetId: 'MW_ONE', configurationId: null, selectedContext: null });
  });

  it('returns a failed get as a Widget error with a failed Widget audit', async () => {
    const evidenceLog: MarketViewProviderEvidence[] = [];
    const { marketView, registry } = setup(async () => ({
      ok: false,
      error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } },
    }), evidenceLog);

    await expect(marketView.widget.get({
      target: 'MW_ONE',
      overrides: [{ field: 'ric', value: 'GC' }],
      detail: 'full',
    })).resolves.toStrictEqual({
      result: {
        ok: false,
        error: { kind: 'widget', error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } } },
      },
      evidence: [
        { order: 1, owner: 'widget', operation: 'get', outcome: 'failed', value: { intent: 'change', calls: [] } },
      ],
    });
    expect(registry.getAllRefs()).toEqual({});
  });

  it('gets a Widget Ref with its stored Config ID and Selected Context unless the input overrides them', async () => {
    const get = vi.fn<WidgetModule['get']>(async () => ({
      ok: false,
      error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } },
    }));
    const { marketView, registry } = setup(get);
    registry.setRefs(registry.claimWidget(), {
      w1: {
        type: 'widget',
        widgetId: 'MW_ONE' as WidgetId,
        configurationId: 'WC_ONE' as ConfigId,
        selectedContext: 'MA_ACME',
      },
    });
    registry.setRefs(registry.claimWidget(), { w2: { type: 'widget', widgetId: 'MW_TWO' as WidgetId, configurationId: null, selectedContext: null } });

    await marketView.widget.get({ target: '@w1', overrides: [], detail: 'full' });
    await marketView.widget.get({
      target: '@w1',
      configurationId: 'WC_TWO',
      selectedContext: 'MA_OTHER',
      overrides: [{ field: 'ric', value: 'GC' }],
      detail: 'snippet',
    });
    await marketView.widget.get({ target: '@w2', overrides: [], detail: 'full' });
    await marketView.widget.get({ target: 'MW_THREE', overrides: [], detail: 'full' });

    expect(get.mock.calls.map(([input]) => input)).toStrictEqual([
      { widgetId: 'MW_ONE', configurationId: 'WC_ONE', selectedContext: 'MA_ACME', parameters: [], detail: 'full' },
      {
        widgetId: 'MW_ONE',
        configurationId: 'WC_TWO',
        selectedContext: 'MA_OTHER',
        parameters: [{ field: 'ric', value: 'GC' }],
        detail: 'snippet',
      },
      { widgetId: 'MW_TWO', configurationId: null, selectedContext: null, parameters: [], detail: 'full' },
      { widgetId: 'MW_THREE', configurationId: null, selectedContext: null, parameters: [], detail: 'full' },
    ]);
  });

  it('rejects a missing Ref with the current Refs and a Ref that is not a Widget', async () => {
    const evidenceLog: MarketViewProviderEvidence[] = [
      { order: 1, owner: 'prior-operation', operation: 'first', outcome: 'succeeded' },
    ];
    const { marketView, registry } = setup(async () => unexpected(), evidenceLog);
    registry.setRefs(registry.claimDashboard(), { d1: { type: 'dashboard', dashboardId: 'MD_ONE' } });

    await expect(Promise.all([
      marketView.widget.get({ target: '@w9', overrides: [], detail: 'full' }),
      marketView.widget.get({ target: '@d1', overrides: [], detail: 'full' }),
    ])).resolves.toStrictEqual([{
      result: { ok: false, error: { kind: 'artifact-not-found', ref: 'w9', availableRefs: ['d1'] } },
      evidence: [],
    }, {
      result: {
        ok: false,
        error: { kind: 'wrong-artifact-kind', ref: 'd1', artifact: { type: 'dashboard', dashboardId: 'MD_ONE' } },
      },
      evidence: [],
    }]);
  });
});

function recordingEvidence(entries: MarketViewProviderEvidence[]) {
  return {
    reserve(call: Readonly<{ owner: string; operation: string }>) {
      const entry: { -readonly [K in keyof MarketViewProviderEvidence]: MarketViewProviderEvidence[K] } = {
        order: entries.length + 1,
        ...call,
        outcome: 'dispatched',
      };
      entries.push(entry);
      return {
        succeed: (value?: unknown) => Object.assign(entry, { outcome: 'succeeded', value }),
        fail: (value?: unknown) => Object.assign(entry, { outcome: 'failed', value }),
        cancel: (value?: unknown) => Object.assign(entry, { outcome: 'cancelled', value }),
      };
    },
    snapshot: () => entries,
  };
}

const EMPTY_DASHBOARD: Dashboard = {
  dashboardId: 'MD_EMPTY',
  name: 'Empty Board',
  kind: 'custom',
  tags: ['FX'],
  permissions: { viewers: [], editors: ['test-owner'], administrators: [] },
  children: [],
  sections: [],
  link: 'https://marquee.gs.com/s/marketview/dashboards/MD_EMPTY',
};

const WIDGET_DASHBOARD: Dashboard = {
  ...EMPTY_DASHBOARD,
  dashboardId: 'MD_WIDGET',
  name: 'Widget Board',
  children: [{
    kind: 'widget',
    childId: 'CHILD_ONE',
    rank: 1,
    widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
    name: 'Widget One',
    parameters: [],
    widgetDefinition: { id: 'MW_ONE', metadata: { title: 'Widget One' }, underlyingChartId: 'CH_ONE', parameters: [] },
    widgetParameterOverrides: [],
  }],
  link: 'https://marquee.gs.com/s/marketview/dashboards/MD_WIDGET',
};

describe('MarketView Dashboard get', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const PRIOR = { order: 1, owner: 'prior-operation', operation: 'first', outcome: 'succeeded' } as const;

  /** A Dashboard read records one provider call, after one entry an earlier operation left. */
  function setup(overrides: Partial<Pick<MarketViewConfig, 'entity' | 'widget'>> = {}) {
    directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-get-'));
    const registry = createArtifactRegistry(directory, 'marketview-dashboard-get');
    const evidence = recordingEvidence([{ ...PRIOR }]);
    const dashboard = createFakeDashboardModule([EMPTY_DASHBOARD, WIDGET_DASHBOARD]);
    const marketView = createMarketView({
      dashboard: {
        ...dashboard,
        async get(dashboardId) {
          evidence.reserve({ owner: 'dashboard.request', operation: `GET ${dashboardId}` }).succeed();
          return dashboard.get(dashboardId);
        },
      },
      registry,
      evidence,
      ...overrides,
    });
    return { marketView, registry };
  }

  const dashboardRead = (dashboardId: string) => ({
    order: 2,
    owner: 'dashboard.request',
    operation: `GET ${dashboardId}`,
    outcome: 'succeeded',
    value: undefined,
  });

  it('rejects a blank -S query, -S without a Dashboard Ref, and a Ref that is not a Dashboard', async () => {
    const { marketView, registry } = setup();
    registry.setRefs(registry.claimWidget(), { w1: { type: 'widget', widgetId: 'MW_ONE' as WidgetId, configurationId: null, selectedContext: null } });

    await expect(Promise.all([
      marketView.dashboard.get({ target: '@w1', search: ' ' }),
      marketView.dashboard.get({ target: 'MD_EMPTY', search: 'carry' }),
      marketView.dashboard.get({ target: '@w1' }),
      marketView.dashboard.get({ target: '@d9', search: 'carry' }),
    ])).resolves.toStrictEqual([
      { result: { ok: false, error: { kind: 'invalid-refinement', problem: 'empty-search' } }, evidence: [] },
      { result: { ok: false, error: { kind: 'invalid-refinement', problem: 'ref-required' } }, evidence: [] },
      {
        result: {
          ok: false,
          error: { kind: 'wrong-artifact-kind', ref: 'w1', artifact: { type: 'widget', widgetId: 'MW_ONE', configurationId: null, selectedContext: null } },
        },
        evidence: [],
      },
      { result: { ok: false, error: { kind: 'artifact-not-found', ref: 'd9', availableRefs: ['w1'] } }, evidence: [] },
    ]);
  });

  it('reads a Dashboard by ID with the given limit, and again by its Ref', async () => {
    const { marketView } = setup();

    const byId = await marketView.dashboard.get({ target: 'MD_EMPTY', limit: 5 });
    const byRef = await marketView.dashboard.get({ target: '@d1' });

    expect(byId).toMatchObject({
      result: {
        ok: true,
        value: {
          kind: 'dashboard',
          window: { title: 'Empty Board', total: 0 },
          artifact: { namespace: 'd1', root: { type: 'dashboard', dashboardId: 'MD_EMPTY', cursor: { pageSize: 5 } } },
        },
      },
      evidence: [dashboardRead('MD_EMPTY')],
    });
    expect(byId.evidence).toHaveLength(1);
    expect(byRef.result).toMatchObject({
      ok: true,
      value: {
        artifact: { namespace: 'd2', root: { type: 'dashboard', dashboardId: 'MD_EMPTY', cursor: { pageSize: 10 } } },
      },
    });
  });

  it('returns a Dashboard read failure as a Dashboard error with its provider evidence', async () => {
    const { marketView } = setup();

    await expect(marketView.dashboard.get({ target: 'MD_MISSING' })).resolves.toStrictEqual({
      result: { ok: false, error: { kind: 'dashboard', error: { kind: 'not-found', dashboardId: 'MD_MISSING' } } },
      evidence: [dashboardRead('MD_MISSING')],
    });
  });

  it('appends the Dashboard Widget audit to a failed Widget hydration', async () => {
    const { marketView } = setup({
      widget: {
        get: async () => unexpected(),
        render: async () => ({ ok: false, error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } } }),
      },
    });

    await expect(marketView.dashboard.get({ target: 'MD_WIDGET' })).resolves.toStrictEqual({
      result: {
        ok: false,
        error: {
          kind: 'widget',
          action: 'widget-snippet',
          error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } },
        },
      },
      evidence: [
        dashboardRead('MD_WIDGET'),
        { order: 3, owner: 'dashboard-widget', operation: 'hydrate', outcome: 'failed', value: { intent: 'read', calls: [] } },
      ],
    });
  });

  it('searches a Dashboard Ref within its stored Dashboard without reading it again', async () => {
    const { marketView } = setup();
    await marketView.dashboard.get({ target: 'MD_EMPTY' });

    await expect(marketView.dashboard.get({ target: '@d1', search: 'carry', limit: 3 })).resolves.toMatchObject({
      result: {
        ok: true,
        value: {
          kind: 'dashboard',
          artifact: { namespace: 'd1', root: { type: 'dashboard', dashboardId: 'MD_EMPTY' } },
          refinement: { kind: 'filter', query: 'carry', matches: [], totalMatches: 0 },
        },
      },
      evidence: [],
    });
  });

  it('reads a Dashboard Ref without a stored Dashboard before searching it', async () => {
    const { marketView, registry } = setup();
    registry.setRefs(registry.claimDashboard(), { d1: { type: 'dashboard', dashboardId: 'MD_EMPTY' } });
    registry.setRefs(registry.claimDashboard(), { d2: { type: 'dashboard', dashboardId: 'MD_MISSING' } });

    const found = await marketView.dashboard.get({ target: '@d1', search: 'carry' });
    const missing = await marketView.dashboard.get({ target: '@d2', search: 'carry' });

    expect(found).toMatchObject({
      result: {
        ok: true,
        value: {
          artifact: { namespace: 'd1', root: { type: 'dashboard', dashboardId: 'MD_EMPTY' } },
          refinement: { kind: 'filter', query: 'carry', totalMatches: 0 },
        },
      },
      evidence: [dashboardRead('MD_EMPTY')],
    });
    expect(found.evidence).toHaveLength(1);
    expect(missing).toStrictEqual({
      result: { ok: false, error: { kind: 'dashboard', error: { kind: 'not-found', dashboardId: 'MD_MISSING' } } },
      evidence: [{ ...dashboardRead('MD_MISSING'), order: 3 }],
    });
  });

  it('reads an Entity Feed Ref as its stored entity kind, with or without -S', async () => {
    const resolveIdentity = vi.fn<EntityModule['resolveIdentity']>(async () => ({
      ok: false,
      error: { kind: 'access-denied' },
    }));
    const { marketView, registry } = setup({
      entity: { ...createEntityModule({ request: async () => unexpected() }), resolveIdentity },
    });
    registry.setRefs(registry.claimDashboard(), {
      d1: { type: 'entity-feed', entityId: 'ACME', entityKind: 'country' },
    });

    const outcomes = await Promise.all([
      marketView.dashboard.get({ target: '@d1' }),
      marketView.dashboard.get({ target: '@d1', search: 'carry' }),
    ]);

    expect(outcomes.map(({ result }) => result)).toStrictEqual([
      { ok: false, error: { kind: 'entity', error: { kind: 'access-denied' } } },
      { ok: false, error: { kind: 'entity', error: { kind: 'access-denied' } } },
    ]);
    expect(resolveIdentity.mock.calls).toStrictEqual([
      [{ kind: 'country', value: 'ACME' }],
      [{ kind: 'country', value: 'ACME' }],
    ]);
  });
});

describe('MarketView Dashboard edit and create', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('returns only the evidence a create records', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-write-'));
    const evidenceLog: MarketViewProviderEvidence[] = [
      { order: 1, owner: 'prior-operation', operation: 'first', outcome: 'succeeded' },
    ];
    const evidence = recordingEvidence(evidenceLog);
    const marketView = createMarketView({
      dashboard: createFakeDashboardModule([], {
        beforeCreate: () => evidence.reserve({ owner: 'dashboard', operation: 'create' }).succeed(),
      }),
      registry: createArtifactRegistry(directory, 'marketview-dashboard-write'),
      evidence,
    });

    const created = await marketView.dashboard.create({ name: 'Carry', widgetRefs: [] });

    expect(created.result).toMatchObject({ ok: true, value: { ref: 'd1' } });
    expect(created.evidence).toStrictEqual([
      { order: 2, owner: 'dashboard', operation: 'create', outcome: 'succeeded', value: undefined },
    ]);
  });

  it('splits an order into trimmed Refs and drops empty entries', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-order-'));
    const marketView = createMarketView({
      registry: createArtifactRegistry(directory, 'marketview-dashboard-order'),
    });
    const edit = (order: string) => marketView.dashboard.edit({
      target: 'MD_ONE',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: [],
      removeSectionRefs: [],
      order,
    });

    await expect(Promise.all([edit(',,'), edit(' @d1.s2,, @d1.s1')])).resolves.toStrictEqual([
      { result: { ok: false, error: { kind: 'invalid-input', reason: 'empty-order' } }, evidence: [] },
      { result: { ok: false, error: { kind: 'unknown-ref', refName: 'd1.s2' } }, evidence: [] },
    ]);
  });
});

describe('MarketView search evidence', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function setup(
    evidenceLog: MarketViewProviderEvidence[],
    request: () => Promise<unknown>,
    registryOverrides: Partial<ReturnType<typeof createArtifactRegistry>> = {},
  ) {
    directory = mkdtempSync(join(tmpdir(), 'marketview-search-outcome-'));
    return createMarketView({
      registry: {
        ...createArtifactRegistry(directory, 'marketview-search-outcome'),
        ...registryOverrides,
      },
      searchRequester: { request },
      evidence: recordingEvidence(evidenceLog),
    });
  }

  it('points a discovery failure at the failed MarketView Search call', async () => {
    const evidenceLog: MarketViewProviderEvidence[] = [];
    const marketView = setup(evidenceLog, async () => {
      evidenceLog.push(
        { order: 1, owner: 'marketview-search', operation: 'GET /v1/other', outcome: 'succeeded' },
        { order: 2, owner: 'other-owner', operation: 'GET /v1/marketview/search', outcome: 'succeeded' },
        { order: 3, owner: 'marketview-search', operation: 'GET /v1/marketview/search', outcome: 'succeeded' },
      );
      return {};
    });

    const outcome = await marketView.search({ query: 'carry', selectors: ['keyword-widget'], limit: 1 });

    expect(outcome.evidence.slice(3)).toStrictEqual([
      expect.objectContaining({ order: 4, owner: 'marketview-search.adapter', operation: 'discover', outcome: 'failed' }),
      {
        order: 5,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: { kind: 'discovery-failure-reference', selectors: ['keyword-widget'], providerEvidenceOrder: 3 },
      },
    ]);
  });

  it('records the search presentation and returns the Search Artifact', async () => {
    const evidenceLog: MarketViewProviderEvidence[] = [];
    const marketView = setup(evidenceLog, async () => ({ [['results', 'Map'].join('')]: { widgets: [] } }));

    const outcome = await marketView.search({ query: 'carry', selectors: ['keyword-widget'], limit: 1 });

    expect(outcome.result).toMatchObject({
      ok: true,
      value: { search: { artifact: { namespace: 's1' } } },
    });
    expect(outcome.evidence).toStrictEqual([
      { order: 1, owner: 'marketview-search', operation: 'presentation', outcome: 'succeeded', value: expect.any(Object) },
    ]);
  });

  it('records a Search Artifact policy failure', async () => {
    const evidenceLog: MarketViewProviderEvidence[] = [];
    const marketView = setup(evidenceLog, async () => ({ [['results', 'Map'].join('')]: { widgets: [] } }), {
      claimSearch: () => {
        throw new Error('registry is read-only');
      },
    });

    await expect(marketView.search({ query: 'carry', selectors: ['keyword-widget'], limit: 1 })).resolves.toStrictEqual({
      result: { ok: false, error: { kind: 'artifact-policy-failed' } },
      evidence: [{
        order: 1,
        owner: 'marketview-search',
        operation: 'artifact-policy',
        outcome: 'failed',
        value: { kind: 'artifact-policy-failure', message: 'registry is read-only' },
      }],
    });
  });
});
