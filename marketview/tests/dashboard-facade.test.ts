import type { Ref } from '../../artifact-registry/index.js';
import type { ConfigId, WidgetId } from '../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../../artifact-registry/index.js';
import {
  createMarketViewCore,
  isMarketViewDashboardArtifactPayload,
  type MarketViewCoreDependencies,
} from '../facade.js';
import type { Dashboard } from '../../dashboard/index.js';
import { createEntityFeedModule, type EntityFeedModule } from '../../entity-feed/index.js';
import type { Entity, EntityModule } from '../../entity/index.js';
import { createFakeDashboardModule } from './fake-dashboard.js';

function unexpected(): never {
  throw new Error('unexpected dependency call');
}

const search = {
  search: unexpected,
};

const emptyDashboardPreferences = async () => ({
  ok: true as const,
  value: [],
});

const dashboardWidgets = {
  async renderDashboardWidget(widgetDefinition: Readonly<Record<string, unknown>>) {
    const widgetId = String(widgetDefinition.id);
    const title = widgetId === 'MW_ONE'
      ? 'Widget One'
      : 'Example Corp A skew';
    return {
      ok: true as const,
      value: {
        configurationId: typeof widgetDefinition.configurationId === 'string'
          ? widgetDefinition.configurationId as ConfigId
          : null,
        snippet: {
          title,
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    };
  },
};

function entityResolver(
  entities: readonly Entity[] = [],
): Pick<EntityModule, 'resolveIdentity'> {
  return {
    async resolveIdentity(input) {
      return {
        ok: true,
        value: entities.find((entity) => (
          entity.kind === input.kind
          && (entity.entityId === input.value || entity.aliases.includes(input.value))
        )) ?? null,
      };
    },
  };
}

function dashboardFacade(
  dependencies: Pick<MarketViewCoreDependencies, 'registry'> & Partial<MarketViewCoreDependencies>,
) {
  return createMarketViewCore({
    dashboard: createFakeDashboardModule(),
    entity: entityResolver(),
    entityFeed: { get: unexpected },
    search,
    dashboardWidgets: { renderDashboardWidget: unexpected },
    ...dependencies,
  });
}

describe('MarketView Dashboard facade', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) rmSync(refsDir, { recursive: true, force: true });
    refsDir = undefined;
  });

  it('delegates a saved read to Dashboard and owns its Artifact lifecycle', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-dashboard-facade-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const widgetDefinition = {
      id: 'MW_ONE',
      metadata: { title: 'Widget One' },
      underlyingChartId: 'CH_ONE',
      parameters: [],
    };
    const renderDashboardWidget = vi.fn(async () => ({
      ok: true as const,
      value: {
        configurationId: 'WC_ONE' as ConfigId,
        snippet: {
          title: 'Widget One',
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    }));
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_CANONICAL',
      name: 'Canonical Dashboard',
      kind: 'thematic',
      description: 'Read through Dashboard',
      tags: ['canonical'],
      permissions: { viewers: [], editors: [], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        name: 'Widget One',
        parameters: [],
        widgetDefinition,
        widgetParameterOverrides: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_CANONICAL',
    }]);
    const marketView = dashboardFacade({
      dashboard,
      registry,
      dashboardPreferences: emptyDashboardPreferences,
      dashboardWidgets: {
        ...dashboardWidgets,
        renderDashboardWidget,
      },
    });

    const result = await marketView.readDashboard({ identifier: 'MD_CANONICAL' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'dashboard',
        dashboard: {
          name: 'Canonical Dashboard',
        },
        window: {
          title: 'Canonical Dashboard',
          widgets: [{
            widgetId: 'MW_ONE' as WidgetId,
            title: 'Widget One',
            configurationId: 'WC_ONE' as ConfigId,
          }],
        },
        artifact: {
          namespace: 'd1',
          root: {
            type: 'dashboard',
            dashboardId: 'MD_CANONICAL',
          },
        },
      },
    });
    expect(registry.resolveRef('d1' as Ref)).toMatchObject({
      type: 'dashboard',
      dashboardId: 'MD_CANONICAL',
    });
    expect(renderDashboardWidget).toHaveBeenCalledExactlyOnceWith(
      widgetDefinition,
      [],
      null,
      undefined,
    );

    const rawResult = await marketView.readDashboard({
      identifier: 'MD_CANONICAL',
      detail: 'raw',
    });

    expect(rawResult.ok).toBe(true);
    expect(renderDashboardWidget).toHaveBeenCalledTimes(1);
  });

  it('preserves saved Dashboard child rank', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-dashboard-rank-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_RANKED',
      name: 'Ranked Dashboard',
      kind: 'thematic',
      tags: [],
      permissions: { viewers: [], editors: [], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_FIRST',
        rank: 1,
        widget: { widgetId: 'MW_FIRST' as WidgetId },
        name: 'First',
        parameters: [],
        widgetDefinition: { id: 'MW_FIRST', metadata: { title: 'First' } },
        widgetParameterOverrides: [],
      }, {
        kind: 'widget',
        childId: 'CHILD_SECOND',
        rank: 2,
        widget: { widgetId: 'MW_SECOND' as WidgetId },
        name: 'Second',
        parameters: [],
        widgetDefinition: { id: 'MW_SECOND', metadata: { title: 'Second' } },
        widgetParameterOverrides: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_RANKED',
    }]);
    const marketView = dashboardFacade({
      dashboard,
      registry,
      dashboardPreferences: async () => ({
        ok: true,
        value: [{ widgetId: 'MW_SECOND' }, { widgetId: 'MW_FIRST' }],
      }),
      dashboardWidgets,
    });

    const result = await marketView.readDashboard({ identifier: 'MD_RANKED', detail: 'raw' });

    if (!result.ok) throw new Error('expected Dashboard read to succeed');
    expect(result.value.window.widgets.map(({ widgetId }) => widgetId)).toEqual([
      'MW_FIRST',
      'MW_SECOND',
    ]);
  });

  it('hydrates the first page of widgets in page order across sections', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-dashboard-unsectioned-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const widgetDefinition = Array.from({ length: 13 }, (_, index) => ({
      id: `MW_${index + 1}`,
      metadata: { title: `Widget ${index + 1}` },
      parameters: [],
    }));
    const renderDashboardWidget = vi.fn(async (widget: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
      value: {
        configurationId: null,
        snippet: {
          title: String(Reflect.get(widget, 'id')),
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    }));
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MIXED',
      name: 'Mixed membership',
      kind: 'thematic',
      tags: [],
      permissions: { viewers: [], editors: [], administrators: [] },
      children: widgetDefinition.map((data, index) => ({
        kind: 'widget' as const,
        childId: `CHILD_${index + 1}`,
        rank: index + 1,
        widget: { widgetId: String(data.id) as WidgetId },
        name: String(data.metadata.title),
        parameters: [],
        widgetDefinition: data,
        widgetParameterOverrides: [],
      })),
      sections: [{
        sectionId: 'SECTION_ONE',
        name: 'First section',
        rank: 1,
        childIds: Array.from({ length: 6 }, (_, index) => `CHILD_${index + 1}`),
      }, {
        sectionId: 'SECTION_TWO',
        name: 'Collapsed section',
        rank: 2,
        childIds: Array.from({ length: 6 }, (_, index) => `CHILD_${index + 7}`),
      }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MIXED',
    }]);
    const marketView = dashboardFacade({
      dashboard,
      registry,
      dashboardPreferences: emptyDashboardPreferences,
      dashboardWidgets: { renderDashboardWidget },
    });

    const result = await marketView.readDashboard({ identifier: 'MD_MIXED' });

    if (!result.ok) throw new Error('expected Dashboard read to succeed');
    expect(result.value.window.sections).toEqual([
      { title: 'First section', widgetCount: 6, startIndex: 0, sectionId: 'SECTION_ONE' },
      { title: 'Collapsed section', widgetCount: 6, startIndex: 6, sectionId: 'SECTION_TWO' },
    ]);
    expect(renderDashboardWidget.mock.calls.map(([widget]) => Reflect.get(widget, 'id'))).toEqual(
      Array.from({ length: 10 }, (_, index) => `MW_${index + 1}`),
    );
    expect(result.value.window.widgets[9]?.snippet?.title).toBe('MW_10');
    expect(result.value.window.widgets[10]?.snippet).toBeUndefined();
    expect(result.value.window.widgets[12]?.snippet).toBeUndefined();
  });

  it('hydrates every widget within the limit, beyond one enrichment batch', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-dashboard-limit-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const widgetDefinition = Array.from({ length: 30 }, (_, index) => ({
      id: `MW_${index + 1}`,
      metadata: { title: `Widget ${index + 1}` },
      parameters: [],
    }));
    const renderDashboardWidget = vi.fn(async (widget: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
      value: {
        configurationId: null,
        snippet: {
          title: String(Reflect.get(widget, 'id')),
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    }));
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MIXED',
      name: 'Mixed membership',
      kind: 'thematic',
      tags: [],
      permissions: { viewers: [], editors: [], administrators: [] },
      children: widgetDefinition.map((data, index) => ({
        kind: 'widget' as const,
        childId: `CHILD_${index + 1}`,
        rank: index + 1,
        widget: { widgetId: String(data.id) as WidgetId },
        name: String(data.metadata.title),
        parameters: [],
        widgetDefinition: data,
        widgetParameterOverrides: [],
      })),
      sections: [{
        sectionId: 'SECTION_ONE',
        name: 'First section',
        rank: 1,
        childIds: Array.from({ length: 6 }, (_, index) => `CHILD_${index + 1}`),
      }, {
        sectionId: 'SECTION_TWO',
        name: 'Collapsed section',
        rank: 2,
        childIds: Array.from({ length: 6 }, (_, index) => `CHILD_${index + 7}`),
      }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MIXED',
    }]);
    const marketView = dashboardFacade({
      dashboard,
      registry,
      dashboardPreferences: emptyDashboardPreferences,
      dashboardWidgets: { renderDashboardWidget },
    });

    const result = await marketView.readDashboard({ identifier: 'MD_MIXED', limit: 25 });

    if (!result.ok) throw new Error('expected Dashboard read to succeed');
    expect(renderDashboardWidget).toHaveBeenCalledTimes(25);
    expect(result.value.window.widgets[24]?.snippet?.title).toBe('MW_25');
    expect(result.value.window.widgets[25]?.snippet).toBeUndefined();
    expect(result.value.artifact.root.cursor).toEqual({ page: 1, pageSize: 25, total: 30 });
  });

  it('classifies an MA identity as an Entity Feed read without touching Dashboard', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-entity-feed-facade-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const widgetDefinition = {
      id: 'MW_AAPL',
      title: 'Example Corp A skew',
      metadata: { title: 'Example Corp A skew' },
      underlyingChartId: 'CH_AAPL',
      visualizationType: 'Plot',
      renderParams: { component: { assetId: 'MA_AAPL' } },
    };
    const widgetDates = {
      startDate: '2025-07-30',
      endDate: '2026-07-30',
      interval: '1D',
      relativeDate: '1Y',
    };
    const entityFeed: EntityFeedModule = {
      async get() {
        return {
          ok: true,
          value: {
            entity: {
              kind: 'asset',
              entityId: 'MA_AAPL',
              label: 'Example Corp A',
              aliases: ['AAPL'],
              ticker: 'AAPL',
              assetClass: 'Equity',
              assetType: 'Single Stock',
              exchange: 'NASD',
              currency: 'USD',
            },
            entries: [{
              widgetId: 'MW_AAPL' as WidgetId,
              configurationId: 'WC_AAPL' as ConfigId,
              title: 'Example Corp A skew',
              widgetDefinition,
              widgetParameterOverrides: [{ field: 'assetId', value: 'MA_AAPL' }],
              selectedContext: 'MA_AAPL',
              widgetDates,
            }],
            total: 1,
          },
        };
      },
    };
    const dashboard = {
      get: unexpected,
      edit: unexpected,
      create: unexpected,
    };
    const renderDashboardWidget = vi.fn(async () => ({
      ok: true as const,
      value: {
        configurationId: 'WC_AAPL' as ConfigId,
        snippet: {
          title: 'Example Corp A skew',
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    }));
    const marketView = dashboardFacade({
      dashboard,
      entity: entityResolver([{
        kind: 'asset',
        entityId: 'MA_AAPL',
        label: 'Example Corp A',
        aliases: ['AAPL'],
        ticker: 'AAPL',
        assetClass: 'Equity',
        assetType: 'Single Stock',
        exchange: 'NASD',
        currency: 'USD',
      }]),
      entityFeed,
      registry,
      dashboardWidgets: {
        renderDashboardWidget,
      },
    });

    const result = await marketView.readDashboard({ identifier: 'MA_AAPL' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'entity-feed',
        entityFeed: {
          entity: { entityId: 'MA_AAPL' },
          total: 1,
        },
        window: {
          title: 'Example Corp A',
          identity: 'AAPL · Equity · Single Stock · NASD · USD',
          entityId: 'MA_AAPL',
          entityKind: 'asset',
          total: 1,
          widgets: [{
            widgetId: 'MW_AAPL' as WidgetId,
            title: 'Example Corp A skew',
            configurationId: 'WC_AAPL' as ConfigId,
          }],
        },
        artifact: {
          namespace: 'd1',
          root: {
            type: 'entity-feed',
            entityId: 'MA_AAPL',
            entityKind: 'asset',
          },
        },
      },
    });
    expect(registry.resolveRef('d1' as Ref)).toMatchObject({
      type: 'entity-feed',
      entityId: 'MA_AAPL',
      entityKind: 'asset',
    });
    expect(renderDashboardWidget).toHaveBeenCalledExactlyOnceWith(
      widgetDefinition,
      [{ field: 'assetId', value: 'MA_AAPL', displayValue: 'Example Corp A' }],
      'MA_AAPL',
      widgetDates,
    );
  });

  it('preserves non-context title tags in a raw Entity Feed read', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-entity-feed-raw-title-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const title = 'How does <Asset1:MA_OTHER_ONE> skew compare to <Asset2:MA_OTHER_TWO>?';
    const entityFeed: EntityFeedModule = {
      async get() {
        return {
          ok: true,
          value: {
            entity: {
              kind: 'asset',
              entityId: 'MA_AAPL',
              label: 'Example Corp A',
              aliases: ['AAPL'],
              ticker: 'AAPL',
            },
            entries: [{
              widgetId: 'MW_COMPARE' as WidgetId,
              configurationId: 'WC_COMPARE' as ConfigId,
              title,
              widgetDefinition: { id: 'MW_COMPARE', title },
              widgetParameterOverrides: [],
              selectedContext: 'MA_AAPL',
            }],
            total: 1,
          },
        };
      },
    };
    const marketView = dashboardFacade({
      entity: entityResolver([{
        kind: 'asset',
        entityId: 'MA_AAPL',
        label: 'Example Corp A',
        aliases: ['AAPL'],
        ticker: 'AAPL',
      }]),
      entityFeed,
      registry,
    });

    const result = await marketView.readDashboard({
      identifier: 'MA_AAPL',
      detail: 'raw',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        window: {
          widgets: [{ title }],
        },
      },
    });
  });
});

describe('stored MarketView Dashboard payload', () => {
  const cursor = { page: 1, pageSize: 10, total: 1 };
  const saved = {
    kind: 'dashboard',
    dashboard: {},
    window: {},
    cursor,
    browserTarget: 'https://marquee.gs.com/s/marketview/dashboards/MD_X',
  };
  const feed = {
    kind: 'entity-feed',
    entityFeed: {},
    window: {},
    cursor,
    browserTarget: 'https://marquee.gs.com/s/marketview/asset/MA_X',
  };

  it('recognizes a saved Dashboard and an Entity Feed payload', () => {
    expect(isMarketViewDashboardArtifactPayload(saved)).toBe(true);
    expect(isMarketViewDashboardArtifactPayload(feed)).toBe(true);
  });

  it.each([
    ['no payload', undefined],
    ['a null payload', null],
    ['a Search payload', { entries: [], query: 'skew' }],
    ['a null cursor', { ...saved, cursor: null }],
    ['no window', { kind: 'dashboard', dashboard: {}, cursor, browserTarget: saved.browserTarget }],
    ['no browser target', { ...saved, browserTarget: undefined }],
    ['an empty browser target', { ...saved, browserTarget: '' }],
    ['no cursor page', { ...saved, cursor: { pageSize: 10, total: 1 } }],
    ['no cursor page size', { ...saved, cursor: { page: 1, total: 1 } }],
    ['no cursor total', { ...saved, cursor: { page: 1, pageSize: 10 } }],
    ['a saved kind without its Dashboard', { ...feed, kind: 'dashboard' }],
    ['a feed kind without its Entity Feed', { ...saved, kind: 'entity-feed' }],
    ['another kind', { ...saved, kind: 'search' }],
  ])('rejects %s', (_, payload) => {
    expect(isMarketViewDashboardArtifactPayload(payload)).toBe(false);
  });
});

describe('MarketView Dashboard reads', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) rmSync(refsDir, { recursive: true, force: true });
    refsDir = undefined;
  });

  function newRegistry() {
    refsDir = mkdtempSync(join(tmpdir(), 'marketview-dashboard-read-'));
    return createArtifactRegistry(refsDir, process.ppid);
  }

  function feedEntry(index: number) {
    return {
      widgetId: `MW_FEED_${index}` as WidgetId,
      title: `Feed ${index}`,
      widgetDefinition: { id: `MW_FEED_${index}` },
      widgetParameterOverrides: [],
      selectedContext: null,
    };
  }

  function feedOf(entryCount: number, total = entryCount): EntityFeedModule {
    return {
      async get({ entity }) {
        return {
          ok: true,
          value: {
            entity,
            entries: Array.from({ length: entryCount }, (_, index) => feedEntry(index + 1)),
            total,
          },
        };
      },
    };
  }

  const country: Entity = {
    kind: 'country',
    entityId: 'US',
    label: 'United States',
    aliases: [],
    region: 'Americas',
    subRegion: 'North America',
  };
  const portfolio: Entity = {
    kind: 'portfolio',
    entityId: 'MP_BOOK',
    label: 'Rates Book',
    aliases: [],
    currency: 'EUR',
  };
  const asset: Entity = {
    kind: 'asset',
    entityId: 'MA_EXM',
    label: 'Example Corp',
    aliases: ['EXM'],
    assetClass: 'Equity',
    assetType: 'Single Stock',
    ticker: 'EXM',
    bbid: 'EXM UN',
    exchange: 'NYSE',
    currency: 'USD',
  };

  it.each([
    ['country', country, 'https://marquee.gs.com/s/marketview/country/US', 'United States', '', {
      name: 'United States',
      region: 'Americas',
      subRegion: 'North America',
    }],
    ['portfolio', portfolio, 'https://marquee.gs.com/s/marketview/portfolio/MP_BOOK', 'Rates Book', 'Portfolio · EUR', {
      name: 'Rates Book',
      currency: 'EUR',
    }],
    ['asset', asset, 'https://marquee.gs.com/s/marketview/asset/MA_EXM', 'Example Corp', 'EXM · Equity · Single Stock · NYSE · USD', {
      name: 'Example Corp',
      assetClass: 'Equity',
      type: 'Single Stock',
      ticker: 'EXM',
      bbid: 'EXM UN',
      exchange: 'NYSE',
      currency: 'USD',
    }],
  ] as const)('presents a %s Entity Feed with its own link, title and identity', async (_, entity, link, title, identity, entityIdentity) => {
    const registry = newRegistry();
    const marketView = dashboardFacade({
      entity: entityResolver([entity]),
      entityFeed: feedOf(1),
      registry,
    });

    const result = await marketView.readDashboard({ identifier: entity.entityId, detail: 'raw' });

    expect(result).toMatchObject({ ok: true, value: { kind: 'entity-feed' } });
    if (!result.ok) throw new Error('expected the Entity Feed read to succeed');
    expect(result.value.window).toStrictEqual({
      title,
      identity,
      entityId: entity.entityId,
      entityKind: entity.kind,
      entityIdentity,
      author: null,
      description: null,
      tags: [],
      link,
      total: 1,
      widgets: [{
        widgetId: 'MW_FEED_1',
        title: 'Feed 1',
        widgetDefinition: { id: 'MW_FEED_1' },
        widgetParameterOverrides: [],
        selectedContext: null,
      }],
    });
    expect(result.value.artifact.root).toEqual({
      type: 'entity-feed',
      entityId: entity.entityId,
      entityKind: entity.kind,
      cursor: { page: 1, pageSize: 10, total: 1 },
    });
    expect(registry.getPayload('d1')).toMatchObject({ kind: 'entity-feed', browserTarget: link });
  });

  it('reads an explicitly kinded Entity Feed through Entity resolution', async () => {
    const resolveIdentity = vi.fn<EntityModule['resolveIdentity']>(async () => ({ ok: true, value: portfolio }));
    const marketView = dashboardFacade({
      entity: { resolveIdentity },
      entityFeed: feedOf(0),
      registry: newRegistry(),
    });

    const result = await marketView.readDashboard({ identifier: 'rates-book', entityKind: 'portfolio' });

    expect(result).toMatchObject({ ok: true, value: { window: { title: 'Rates Book', entityKind: 'portfolio' } } });
    expect(resolveIdentity).toHaveBeenCalledExactlyOnceWith({ kind: 'portfolio', value: 'rates-book' });
  });

  it('renders only the first page of an Entity Feed and keeps the rest unrendered', async () => {
    const renderDashboardWidget = vi.fn(async (widgetDefinition: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
      value: {
        configurationId: null,
        snippet: { title: String(widgetDefinition.id), isTitleResolved: true, parameterLines: [] },
      },
    }));
    const marketView = dashboardFacade({
      entity: entityResolver([country]),
      entityFeed: feedOf(12, 40),
      registry: newRegistry(),
      dashboardWidgets: { renderDashboardWidget },
    });

    const result = await marketView.readDashboard({ identifier: 'US' });

    if (!result.ok) throw new Error('expected the Entity Feed read to succeed');
    expect(renderDashboardWidget).toHaveBeenCalledTimes(10);
    expect(result.value.window.widgets.map((widget) => widget.snippet?.title)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `MW_FEED_${index + 1}`),
      undefined,
      undefined,
    ]);
    expect(result.value.window.total).toBe(40);
    expect(result.value.artifact.root.cursor).toEqual({ page: 1, pageSize: 10, total: 40 });
  });

  it('loads beyond the first provider page through the Entity Feed module', async () => {
    const entries = Array.from({ length: 105 }, (_, index) => ({ id: `MW_FEED_${index + 1}`, title: `Feed ${index + 1}` }));
    const entityFeed = createEntityFeedModule({
      async request({ path }, init) {
        if (path === '/v1/marketview/preferences') return { value: { pins: [] } };
        if (path !== '/v1/marketview/widgets') throw new Error('Unexpected request');
        const offset = Number(init?.query?.offset ?? 0);
        const limit = Number(init?.query?.limit ?? 100);
        return { total_results: 105, results: entries.slice(offset, offset + limit) };
      },
    });
    const marketView = dashboardFacade({ entity: entityResolver([country]), entityFeed, registry: newRegistry() });

    const result = await marketView.readDashboard({ identifier: 'US', detail: 'raw', limit: 101 });

    expect(result.ok && result.value.window.widgets.length).toBe(101);
    expect(result.ok && result.value.window.widgets.at(-1)?.title).toBe('Feed 101');
    expect(result.ok && result.value.artifact.root.cursor).toEqual({ page: 1, pageSize: 101, total: 105 });
  });

  it('pages an Entity Feed by the requested limit', async () => {
    const marketView = dashboardFacade({
      entity: entityResolver([country]),
      entityFeed: feedOf(3),
      registry: newRegistry(),
    });

    const result = await marketView.readDashboard({ identifier: 'US', detail: 'raw', limit: 2 });

    expect(result).toMatchObject({ ok: true, value: { artifact: { root: { cursor: { page: 1, pageSize: 2, total: 3 } } } } });
  });

  it.each([
    ['an Entity resolution failure', async () => ({
      ok: false as const,
      error: { kind: 'malformed-entity' as const },
    }), { kind: 'entity', error: { kind: 'malformed-entity' } }],
    ['an unknown entity', async () => ({ ok: true as const, value: null }), {
      kind: 'entity-not-found',
      entityKind: 'portfolio',
      identifier: 'MP_GONE',
    }],
    ['an entity of another kind', async () => ({ ok: true as const, value: asset }), {
      kind: 'entity-not-found',
      entityKind: 'portfolio',
      identifier: 'MP_GONE',
    }],
  ] as const)('reports %s for an Entity Feed read', async (_, resolveIdentity, error) => {
    const marketView = dashboardFacade({
      entity: { resolveIdentity },
      registry: newRegistry(),
    });

    await expect(marketView.readDashboard({ identifier: 'MP_GONE' })).resolves.toEqual({ ok: false, error });
  });

  it('reports an Entity Feed failure', async () => {
    const error = { kind: 'dependency', source: 'feed', failure: { kind: 'timeout' } } as const;
    const marketView = dashboardFacade({
      entity: entityResolver([country]),
      entityFeed: { get: async () => ({ ok: false, error }) },
      registry: newRegistry(),
    });

    await expect(marketView.readDashboard({ identifier: 'US' })).resolves.toEqual({
      ok: false,
      error: { kind: 'entity-feed', error },
    });
  });

  it('reports a Widget failure while rendering an Entity Feed', async () => {
    const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_FEED_1' } } as const;
    const marketView = dashboardFacade({
      entity: entityResolver([country]),
      entityFeed: feedOf(1),
      registry: newRegistry(),
      dashboardWidgets: { renderDashboardWidget: async () => ({ ok: false, error }) },
    });

    await expect(marketView.readDashboard({ identifier: 'US' })).resolves.toEqual({
      ok: false,
      error: { kind: 'widget', action: 'widget-snippet', error },
    });
  });

  it('reports a Dashboard target that resolves to nothing', async () => {
    const marketView = dashboardFacade({
      registry: newRegistry(),
    });

    await expect(marketView.readDashboard({ identifier: 'G4 Rates' })).resolves.toEqual({
      ok: false,
      error: { kind: 'unresolved', identifier: 'G4 Rates' },
    });
  });

  function savedDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
    return {
      dashboardId: 'MD_SAVED',
      name: 'Saved Dashboard',
      kind: 'thematic',
      tags: ['rates'],
      permissions: { viewers: [], editors: [], administrators: [] },
      children: [],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_SAVED',
      ...overrides,
    };
  }

  function widgetChild(index: number) {
    return {
      kind: 'widget' as const,
      childId: `CHILD_${index}`,
      rank: index,
      widget: { widgetId: `MW_${index}` as WidgetId },
      name: `Widget ${index}`,
      parameters: [],
      widgetDefinition: { id: `MW_${index}` },
    };
  }

  it('presents a saved Dashboard with its own metadata and stores it under its link', async () => {
    const registry = newRegistry();
    const marketView = dashboardFacade({
      dashboard: createFakeDashboardModule([savedDashboard({
        author: 'Example Author',
        description: 'Rates regime',
        children: [widgetChild(1)],
      })]),
      registry,
      dashboardPreferences: emptyDashboardPreferences,
    });

    const result = await marketView.readDashboard({ identifier: 'MD_SAVED', detail: 'raw', namespace: 'd7' });

    if (!result.ok) throw new Error('expected the Dashboard read to succeed');
    expect(result.value.window).toStrictEqual({
      title: 'Saved Dashboard',
      author: 'Example Author',
      description: 'Rates regime',
      tags: ['rates'],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_SAVED',
      total: 1,
      widgets: [{
        widgetId: 'MW_1',
        title: 'Widget 1',
        type: 'Widget',
        childId: 'CHILD_1',
        configurationId: null,
        underlyingChartId: null,
        configurationParameters: [],
        parameters: [],
        renderParams: null,
        contextParameter: null,
        visualizationType: null,
        widgetDefinition: { id: 'MW_1' },
      }],
    });
    expect(result.value.artifact).toEqual({
      namespace: 'd7',
      root: { type: 'dashboard', dashboardId: 'MD_SAVED', cursor: { page: 1, pageSize: 10, total: 1 } },
    });
    expect(registry.getPayload('d7')).toMatchObject({
      kind: 'dashboard',
      browserTarget: 'https://marquee.gs.com/s/marketview/dashboards/MD_SAVED',
    });
    expect(registry.resolveRef('d7.w1' as Ref)).toEqual({
      type: 'widget',
      widgetId: 'MW_1',
      childId: 'CHILD_1',
      dashboardId: 'MD_SAVED',
    });
  });

  it('gives a saved Dashboard without author or description none', async () => {
    const marketView = dashboardFacade({
      dashboard: createFakeDashboardModule([savedDashboard()]),
      registry: newRegistry(),
      dashboardPreferences: emptyDashboardPreferences,
    });

    await expect(marketView.readDashboard({ identifier: 'MD_SAVED' })).resolves.toMatchObject({
      ok: true,
      value: { window: { author: null, description: null, total: 0, widgets: [] } },
    });
  });

  it('orders saved Dashboard Widgets by Section rank, once each, then the unsectioned ones', async () => {
    const marketView = dashboardFacade({
      dashboard: createFakeDashboardModule([savedDashboard({
        children: [1, 2, 3, 4, 5].map(widgetChild),
        sections: [
          { sectionId: 'SECTION_LATE', name: 'Late', rank: 2, childIds: ['CHILD_1', 'CHILD_4'] },
          { sectionId: 'SECTION_EARLY', name: 'Early', rank: 1, childIds: ['CHILD_3', 'CHILD_GONE', 'CHILD_1'] },
        ],
      })]),
      registry: newRegistry(),
      dashboardPreferences: emptyDashboardPreferences,
    });

    const result = await marketView.readDashboard({ identifier: 'MD_SAVED', detail: 'raw' });

    if (!result.ok) throw new Error('expected the Dashboard read to succeed');
    expect(result.value.window.widgets.map(({ widgetId }) => widgetId)).toEqual([
      'MW_3',
      'MW_1',
      'MW_4',
      'MW_2',
      'MW_5',
    ]);
    expect(result.value.window.sections).toEqual([
      { title: 'Early', widgetCount: 2, startIndex: 0, sectionId: 'SECTION_EARLY' },
      { title: 'Late', widgetCount: 1, startIndex: 2, sectionId: 'SECTION_LATE' },
    ]);
    if (result.value.kind !== 'dashboard') throw new Error('expected a saved Dashboard');
    expect(result.value.dashboard.sections.map(({ sectionId }) => sectionId)).toEqual(['SECTION_LATE', 'SECTION_EARLY']);
  });

  it('reports a Dashboard failure', async () => {
    const marketView = dashboardFacade({
      registry: newRegistry(),
      dashboardPreferences: emptyDashboardPreferences,
    });

    await expect(marketView.readDashboard({ identifier: 'MD_GONE' })).resolves.toEqual({
      ok: false,
      error: { kind: 'dashboard', error: { kind: 'not-found', dashboardId: 'MD_GONE' } },
    });
  });

  it('reports a Dashboard preferences failure', async () => {
    const error = { kind: 'dependency', failure: { kind: 'timeout' } } as const;
    const marketView = dashboardFacade({
      dashboard: createFakeDashboardModule([savedDashboard()]),
      registry: newRegistry(),
      dashboardPreferences: async () => ({ ok: false, error }),
    });

    await expect(marketView.readDashboard({ identifier: 'MD_SAVED' })).resolves.toEqual({
      ok: false,
      error: { kind: 'dashboard-preferences', error },
    });
  });

  it('fails loud when a saved Dashboard read has no preferences reader', async () => {
    const marketView = dashboardFacade({
      dashboard: createFakeDashboardModule([savedDashboard()]),
      registry: newRegistry(),
    });

    await expect(marketView.readDashboard({ identifier: 'MD_SAVED' }))
      .rejects.toThrow('Dashboard preferences dependency is not configured');
  });

  it('reports a Widget failure while rendering a saved Dashboard', async () => {
    const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_1' } } as const;
    const marketView = dashboardFacade({
      dashboard: createFakeDashboardModule([savedDashboard({ children: [widgetChild(1)] })]),
      registry: newRegistry(),
      dashboardPreferences: emptyDashboardPreferences,
      dashboardWidgets: { renderDashboardWidget: async () => ({ ok: false, error }) },
    });

    await expect(marketView.readDashboard({ identifier: 'MD_SAVED' })).resolves.toEqual({
      ok: false,
      error: { kind: 'widget', action: 'widget-snippet', error },
    });
  });

  it.each(['dashboard', 'entity', 'entityFeed', 'dashboardWidgets'])('fails loud without its %s dependency', async (missing) => {
    const dependencies: Record<string, unknown> = {
      dashboard: createFakeDashboardModule(),
      entity: entityResolver(),
      entityFeed: { get: unexpected },
      registry: newRegistry(),
      search,
      dashboardWidgets: { renderDashboardWidget: unexpected },
    };
    delete dependencies[missing];
    const marketView = createMarketViewCore(dependencies as MarketViewCoreDependencies);

    await expect(marketView.readDashboard({ identifier: 'MD_SAVED' }))
      .rejects.toThrow('MarketView Dashboard dependencies are not configured');
  });
});
