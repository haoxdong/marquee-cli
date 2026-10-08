import type { Ref } from '../../artifact-registry/index.js';
import type { ConfigId, WidgetId } from '../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { filterStoredDashboard } from '../dashboard-filter.js';
import type { EntityFeedPageReader } from '../dashboard-hydration.js';
import type { MarketViewWidgetOperations } from '../dashboard-widget-operations.js';

const unexpectedRender: MarketViewWidgetOperations = {
  renderDashboardWidget: async () => {
    throw new Error('unexpected Widget render');
  },
};

function entry(widgetId: string, configurationId?: string) {
  return {
    widgetId: widgetId as WidgetId,
    ...(configurationId ? { configurationId: configurationId as ConfigId } : {}),
    title: widgetId,
    widgetDefinition: { id: widgetId },
    widgetParameterOverrides: [],
    selectedContext: null,
  };
}

describe('stored Entity Feed filtering', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) rmSync(refsDir, { recursive: true, force: true });
    refsDir = undefined;
  });

  it('keeps a previously loaded Widget match referenceable without rewriting it', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'dashboard-filter-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.storeArtifact({
      namespace: 'd1',
      root: { type: 'entity-feed', entityId: 'MA_EURUSD', entityKind: 'asset' },
      refs: {
        'd1.w17': {
          type: 'widget',
          widgetId: 'MW_SKEW' as WidgetId,
          configurationId: 'WC_SKEW' as ConfigId,
          selectedContext: 'MA_EURUSD',
        },
      },
      payload: {
        kind: 'entity-feed',
        entityFeed: { entries: Array.from({ length: 17 }, (_, index) => ({ widgetId: index === 16 ? 'MW_SKEW' : `MW_OTHER_${index + 1}` })) },
        cursor: { page: 1, pageSize: 10, total: 17 },
        browserTarget: 'https://marquee.gs.com/s/marketview/EURUSD',
        window: {
          title: 'EURUSD',
          author: null,
          description: null,
          tags: [],
          link: 'https://marquee.gs.com/s/marketview/EURUSD',
          entityId: 'MA_EURUSD',
          entityKind: 'asset',
          total: 17,
          widgets: Array.from({ length: 17 }, (_, index) => ({
            widgetId: index === 16 ? 'MW_SKEW' : `MW_OTHER_${index + 1}`,
            title: index === 16 ? 'How has EURUSD 1m 25d skew evolved?' : `Other ${index + 1}`,
            ...(index === 16
              ? {
                  snippet: {
                    title: 'How has EURUSD 1m 25d skew evolved?',
                    isTitleResolved: true,
                    parameterLines: ['cross=EURUSD'],
                  },
                }
              : {}),
          })),
        },
      },
    });
    const getArtifact = vi.spyOn(registry, 'getArtifact');
    const resolveRef = vi.spyOn(registry, 'resolveRef');
    const setPayload = vi.spyOn(registry, 'setPayload');
    const updateRefs = vi.spyOn(registry, 'updateRefs');

    const result = await filterStoredDashboard('d1', 'skew', {
      registry,
      readEntityFeedPage: async () => ({ ok: true, value: { entries: [entry('MW_SKEW')], total: 1 } }),
      widgets: unexpectedRender,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        matches: [{
          ref: 'd1.w17',
          title: 'How has EURUSD 1m 25d skew evolved?',
        }],
        refs: {
          'd1.w17': {
            type: 'widget',
            widgetId: 'MW_SKEW' as WidgetId,
            configurationId: 'WC_SKEW' as ConfigId,
            selectedContext: 'MA_EURUSD',
          },
        },
      },
    });
    expect(getArtifact).toHaveBeenCalledOnce();
    expect(resolveRef).not.toHaveBeenCalled();
    expect(setPayload).not.toHaveBeenCalled();
    expect(updateRefs).not.toHaveBeenCalled();
  });

  it('fails on an empty incomplete Entity Feed page without rewriting the payload', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'dashboard-filter-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.storeArtifact({
      namespace: 'd1',
      root: { type: 'entity-feed', entityId: 'MA_EURUSD', entityKind: 'asset' },
      payload: {
        kind: 'entity-feed',
        entityFeed: { entries: [] },
        cursor: { page: 1, pageSize: 10, total: 1 },
        browserTarget: 'https://marquee.gs.com/s/marketview/EURUSD',
        window: {
          title: 'EURUSD',
          author: null,
          description: null,
          tags: [],
          link: 'https://marquee.gs.com/s/marketview/EURUSD',
          entityId: 'MA_EURUSD',
          entityKind: 'asset',
          total: 1,
          widgets: [],
        },
      },
    });
    const setPayload = vi.spyOn(registry, 'setPayload');
    const readEntityFeedPage = vi.fn<EntityFeedPageReader>()
      .mockResolvedValueOnce({ ok: true, value: { entries: [], total: 0 } })
      .mockRejectedValue(new Error('unexpected second Entity Feed page read'));

    const result = await filterStoredDashboard('d1', 'skew', {
      registry,
      readEntityFeedPage,
      widgets: unexpectedRender,
    });

    expect(result).toEqual({ ok: false, error: { kind: 'entity-feed', error: { kind: 'invalid-feed', problem: 'response' } } });
    expect(readEntityFeedPage).toHaveBeenCalledOnce();
    expect(setPayload).not.toHaveBeenCalled();
  });

  it('preserves a Widget ref enriched while the Entity Feed hydrates', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'dashboard-filter-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.storeArtifact({
      namespace: 'd1',
      root: { type: 'entity-feed', entityId: 'MA_EURUSD', entityKind: 'asset' },
      payload: {
        kind: 'entity-feed',
        entityFeed: { entries: [entry('MW_TARGET', 'WC_OLD')] },
        cursor: { page: 1, pageSize: 1, total: 2 },
        browserTarget: 'https://marquee.gs.com/s/marketview/EURUSD',
        window: {
          title: 'EURUSD',
          author: null,
          description: null,
          tags: [],
          link: 'https://marquee.gs.com/s/marketview/EURUSD',
          entityId: 'MA_EURUSD',
          entityKind: 'asset',
          total: 2,
          widgets: [{
            widgetId: 'MW_TARGET' as WidgetId,
            configurationId: 'WC_OLD' as ConfigId,
            title: 'Target Widget',
            snippet: { title: 'Target Widget', isTitleResolved: true, parameterLines: [] },
          }],
        },
      },
    });

    const result = await filterStoredDashboard('d1', 'target', {
      registry,
      readEntityFeedPage: async ({ query }) => {
        if (query !== undefined) return { ok: true, value: { entries: [entry('MW_TARGET', 'WC_OLD')], total: 1 } };
        registry.setRefs('d1', {
          'd1.w1': {
            type: 'widget',
            widgetId: 'MW_TARGET' as WidgetId,
            configurationId: 'WC_NEW' as ConfigId,
            selectedContext: null,
          },
        });
        return {
          ok: true,
          value: {
            entries: [{
              widgetId: 'MW_OTHER' as WidgetId,
              title: 'Other Widget',
              widgetDefinition: { id: 'MW_OTHER' },
              widgetParameterOverrides: [],
              selectedContext: null,
            }],
            total: 2,
          },
        };
      },
      widgets: unexpectedRender,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        refs: {
          'd1.w1': {
            type: 'widget',
            widgetId: 'MW_TARGET' as WidgetId,
            configurationId: 'WC_NEW' as ConfigId,
            selectedContext: null,
          },
        },
      },
    });
    expect(registry.resolveRef('d1.w1' as Ref)).toMatchObject({
      type: 'widget',
      widgetId: 'MW_TARGET' as WidgetId,
      configurationId: 'WC_NEW' as ConfigId,
      selectedContext: null,
    });
  });

  describe('rendering the Widget Snippet of a shown match that has none', () => {
    const renderedSnippet = { title: 'EURUSD carry', isTitleResolved: true, parameterLines: ['cross=EURUSD'] };

    function storeCarryDashboard(kind: 'dashboard' | 'entity-feed', snippet?: typeof renderedSnippet) {
      refsDir = mkdtempSync(join(tmpdir(), 'dashboard-filter-'));
      const registry = createArtifactRegistry(refsDir, process.ppid);
      registry.storeArtifact({
        namespace: 'd1',
        root: { type: 'dashboard', dashboardId: 'MD_CARRY' },
        refs: {},
        payload: {
          kind,
          ...(kind === 'dashboard' ? { dashboard: { children: [] } } : { entityFeed: { entries: [entry('MW_CARRY')] } }),
          cursor: { page: 1, pageSize: 10, total: 1 },
          browserTarget: 'https://marquee.gs.com/s/marketview/dashboards/MD_CARRY',
          window: {
            title: 'EURUSD',
            author: null,
            description: null,
            tags: [],
            link: 'https://marquee.gs.com/s/marketview/dashboards/MD_CARRY',
            ...(kind === 'entity-feed' ? { entityId: 'MA_EURUSD' } : {}),
            total: 1,
            widgets: [{
              widgetId: 'MW_CARRY' as WidgetId,
              childId: 'CHILD_CARRY',
              title: 'Carry',
              selectedContext: 'MA_EURUSD',
              widgetDefinition: { id: 'MW_CARRY' },
              widgetParameterOverrides: [{ name: 'cross', value: 'MA_EURUSD' }],
              ...(snippet ? { snippet } : {}),
            }],
          },
        },
      });
      return registry;
    }

    function renderer() {
      return {
        renderDashboardWidget: vi.fn<MarketViewWidgetOperations['renderDashboardWidget']>(async () => ({
          ok: true as const,
          value: { snippet: renderedSnippet, configurationId: 'WC_CARRY' as ConfigId },
        })),
      };
    }

    const noPageRead = async () => {
      throw new Error('unexpected Entity Feed page read');
    };

    it('renders a Dashboard match with its own params and stores the snippet', async () => {
      const registry = storeCarryDashboard('dashboard');
      const widgets = renderer();

      await filterStoredDashboard('d1', 'carry', { registry, readEntityFeedPage: noPageRead, widgets });

      expect(widgets.renderDashboardWidget).toHaveBeenCalledWith(
        { id: 'MW_CARRY' },
        [{ name: 'cross', value: 'MA_EURUSD' }],
        'MA_EURUSD',
        undefined,
      );
      expect(registry.getPayload('d1')).toMatchObject({
        window: { widgets: [{ snippet: renderedSnippet, configurationId: 'WC_CARRY' as ConfigId }] },
      });
    });

    it('renders an Entity Feed match with the feed title as its context display value', async () => {
      const registry = storeCarryDashboard('entity-feed');
      const widgets = renderer();

      await filterStoredDashboard('d1', 'carry', { registry, readEntityFeedPage: async () => ({ ok: true, value: { entries: [entry('MW_CARRY')], total: 1 } }), widgets });

      expect(widgets.renderDashboardWidget).toHaveBeenCalledWith(
        { id: 'MW_CARRY' },
        [{ name: 'cross', value: 'MA_EURUSD', displayValue: 'EURUSD' }],
        'MA_EURUSD',
        undefined,
      );
    });

    it('persists the ref of a match shown for the first time', async () => {
      const registry = storeCarryDashboard('dashboard', renderedSnippet);

      await filterStoredDashboard('d1', 'carry', { registry, readEntityFeedPage: noPageRead, widgets: unexpectedRender });

      expect(registry.resolveRef('d1.w1' as Ref)).toEqual({
        type: 'widget',
        widgetId: 'MW_CARRY',
        selectedContext: 'MA_EURUSD',
        dashboardId: 'MD_CARRY',
        childId: 'CHILD_CARRY',
        configurationId: null,
      });
    });

    it('leaves a Dashboard payload unwritten when every match already has its snippet', async () => {
      const registry = storeCarryDashboard('dashboard', renderedSnippet);
      const setPayload = vi.spyOn(registry, 'setPayload');

      await filterStoredDashboard('d1', 'carry', { registry, readEntityFeedPage: noPageRead, widgets: unexpectedRender });

      expect(setPayload).not.toHaveBeenCalled();
    });
  });

  describe('stored Dashboard payloads', () => {
    function feedPayload(
      widgets: readonly Record<string, unknown>[],
      total: number,
      entityId: string | null = 'MA_EURUSD',
    ) {
      return {
        kind: 'entity-feed',
        entityFeed: { entries: widgets },
        cursor: { page: 1, pageSize: 10, total },
        browserTarget: 'https://marquee.gs.com/s/marketview/asset/MA_EURUSD',
        window: {
          title: 'EURUSD',
          author: null,
          description: null,
          tags: [],
          link: 'https://marquee.gs.com/s/marketview/asset/MA_EURUSD',
          ...(entityId ? { entityId } : {}),
          entityKind: 'asset',
          total,
          widgets,
        },
      };
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

    function storedRegistry(payload: unknown) {
      refsDir = mkdtempSync(join(tmpdir(), 'dashboard-filter-'));
      const registry = createArtifactRegistry(refsDir, process.ppid);
      registry.storeArtifact({
        namespace: 'd1',
        root: { type: 'entity-feed', entityId: 'MA_EURUSD', entityKind: 'asset' },
        payload,
      });
      return registry;
    }

    const snippet = (title: string) => ({ title, isTitleResolved: true, parameterLines: [] });

    it('reports a namespace that holds no Dashboard', async () => {
      refsDir = mkdtempSync(join(tmpdir(), 'dashboard-filter-'));
      const registry = createArtifactRegistry(refsDir, process.ppid);

      await expect(filterStoredDashboard('d9', 'skew', {
        registry,
        readEntityFeedPage: vi.fn(),
        widgets: unexpectedRender,
      })).resolves.toEqual({ ok: false, error: { kind: 'artifact-payload-not-found', ref: 'd9' } });
    });

    it('reports a namespace whose payload is not a Dashboard', async () => {
      const registry = storedRegistry({ entries: [], query: 'skew' });

      await expect(filterStoredDashboard('d1', 'skew', {
        registry,
        readEntityFeedPage: vi.fn(),
        widgets: unexpectedRender,
      })).resolves.toEqual({ ok: false, error: { kind: 'artifact-payload-not-found', ref: 'd1' } });
    });

    it('reports a stored Entity Feed without its entity ID as a payload to reload', async () => {
      const registry = storedRegistry(feedPayload([], 1, null));

      await expect(filterStoredDashboard('d1', 'skew', {
        registry,
        readEntityFeedPage: vi.fn(),
        widgets: unexpectedRender,
      })).resolves.toEqual({ ok: false, error: { kind: 'artifact-payload-not-found', ref: 'd1' } });
    });

    it('loads the missing Entity Feed widgets in pages of at most 250 and stores them', async () => {
      const registry = storedRegistry(feedPayload([], 260));
      const readEntityFeedPage = vi.fn(async (input: { limit?: number; offset?: number; query?: string }) => ({
        ok: true as const,
        value: {
          entries: Array.from({ length: input.query !== undefined ? 0 : input.limit ?? 0 }, (_, index) => feedEntry((input.offset ?? 0) + index + 1)),
          total: input.query !== undefined ? 0 : 260,
        },
      }));

      const result = await filterStoredDashboard('d1', 'no such widget', {
        registry,
        readEntityFeedPage,
        widgets: unexpectedRender,
      });

      expect(readEntityFeedPage.mock.calls).toEqual([
        [{ entityId: 'MA_EURUSD', limit: 250, offset: 0 }],
        [{ entityId: 'MA_EURUSD', limit: 10, offset: 250 }],
        [{ entityId: 'MA_EURUSD', query: 'no such widget' }],
      ]);
      expect(result).toMatchObject({ ok: true, value: { matches: [], totalMatches: 0 } });
      expect(registry.getPayload('d1')).toMatchObject({
        window: { widgets: { length: 260, 259: { widgetId: 'MW_FEED_260', title: 'Feed 260' } } },
      });
    });

    it('loads only the Entity Feed widgets after those already stored', async () => {
      const registry = storedRegistry(feedPayload(Array.from({ length: 250 }, (_, index) => feedEntry(index + 1)), 260));
      const readEntityFeedPage = vi.fn(async (input: { limit?: number; offset?: number; query?: string }) => ({
        ok: true as const,
        value: {
          entries: Array.from({ length: input.query !== undefined ? 0 : input.limit ?? 0 }, (_, index) => feedEntry((input.offset ?? 0) + index + 1)),
          total: input.query !== undefined ? 0 : 260,
        },
      }));

      await filterStoredDashboard('d1', 'no such widget', {
        registry,
        readEntityFeedPage,
        widgets: unexpectedRender,
      });

      expect(readEntityFeedPage.mock.calls).toEqual([
        [{ entityId: 'MA_EURUSD', limit: 10, offset: 250 }],
        [{ entityId: 'MA_EURUSD', query: 'no such widget' }],
      ]);
    });

    it('completes short unfiltered pages using actual offsets before querying', async () => {
      const registry = storedRegistry(feedPayload([], 3));
      const readEntityFeedPage = vi.fn<EntityFeedPageReader>()
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(1)], total: 3 } })
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(2)], total: 3 } })
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(3)], total: 3 } })
        .mockResolvedValueOnce({ ok: true, value: { entries: [], total: 0 } });
      const result = await filterStoredDashboard('d1', 'none', { registry, readEntityFeedPage, widgets: unexpectedRender });
      expect(result).toMatchObject({ ok: true, value: { matches: [], totalMatches: 0 } });
      expect(readEntityFeedPage.mock.calls).toEqual([
        [{ entityId: 'MA_EURUSD', limit: 3, offset: 0 }],
        [{ entityId: 'MA_EURUSD', limit: 2, offset: 1 }],
        [{ entityId: 'MA_EURUSD', limit: 1, offset: 2 }],
        [{ entityId: 'MA_EURUSD', query: 'none' }],
      ]);
      expect(registry.getPayload('d1')).toMatchObject({ entityFeed: { entries: { length: 3 } }, window: { widgets: { length: 3 } } });
    });

    it('rebuilds a legacy original tail while preserving enriched stored widgets', async () => {
      const payload = feedPayload([
        { ...feedEntry(1), snippet: snippet('One') },
        { ...feedEntry(2), configurationId: 'WC_RENDERED', snippet: snippet('Two') },
      ], 2);
      payload.entityFeed.entries = [feedEntry(1)];
      const registry = storedRegistry(payload);
      const readEntityFeedPage = vi.fn<EntityFeedPageReader>()
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(2)], total: 2 } })
        .mockResolvedValue({ ok: true, value: { entries: [feedEntry(2)], total: 1 } });
      const first = await filterStoredDashboard('d1', 'carry 3m', { registry, readEntityFeedPage, widgets: unexpectedRender });
      expect(first).toMatchObject({ ok: true, value: { matches: [{ ref: 'd1.w2', title: 'Two' }], refs: { 'd1.w2': { configurationId: 'WC_RENDERED' } } } });
      const second = await filterStoredDashboard('d1', 'carry 3m', { registry, readEntityFeedPage, widgets: unexpectedRender });
      expect(second).toMatchObject({ ok: true, value: { matches: [{ ref: 'd1.w2', title: 'Two' }] } });
      expect(readEntityFeedPage.mock.calls).toEqual([
        [{ entityId: 'MA_EURUSD', limit: 1, offset: 1 }],
        [{ entityId: 'MA_EURUSD', query: 'carry 3m' }],
        [{ entityId: 'MA_EURUSD', query: 'carry 3m' }],
      ]);
    });

    it('selects configured variants by original identity across repeated snippet enrichment', async () => {
      const originals = [entry('MW_CARRY', 'WC_1M'), entry('MW_CARRY', 'WC_3M')];
      const registry = storedRegistry(feedPayload(originals, 2));
      const readEntityFeedPage = vi.fn<EntityFeedPageReader>()
        .mockResolvedValue({ ok: true, value: { entries: [entry('MW_CARRY', 'WC_3M')], total: 1 } });
      const widgets = { renderDashboardWidget: vi.fn(async () => ({ ok: true as const, value: { snippet: snippet('Carry three months'), configurationId: 'WC_RENDERED' as ConfigId } })) };
      const first = await filterStoredDashboard('d1', 'carry 3m', { registry, readEntityFeedPage, widgets });
      expect(first).toMatchObject({ ok: true, value: { matches: [{ index: 1, ref: 'd1.w2', title: 'Carry three months' }], refs: { 'd1.w2': { configurationId: 'WC_RENDERED' } } } });
      const second = await filterStoredDashboard('d1', 'carry 3m', { registry, readEntityFeedPage, widgets });
      expect(second).toMatchObject({ ok: true, value: { matches: [{ index: 1, ref: 'd1.w2', title: 'Carry three months' }] } });
      expect(widgets.renderDashboardWidget).toHaveBeenCalledOnce();
      expect(registry.getPayload('d1')).toMatchObject({ entityFeed: { entries: [{ configurationId: 'WC_1M' }, { configurationId: 'WC_3M' }] } });
    });

    it('pages queried matches by actual received count and reports the server total', async () => {
      const registry = storedRegistry(feedPayload([1, 2, 3, 4].map((index) => ({ ...feedEntry(index), snippet: snippet(`Stored ${index}`) })), 4));
      const readEntityFeedPage = vi.fn<EntityFeedPageReader>()
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(4)], total: 4 } })
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(2)], total: 4 } })
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(1)], total: 4 } });
      const result = await filterStoredDashboard('d1', 'carry 3m', { registry, readEntityFeedPage, widgets: unexpectedRender }, 3);
      expect(result).toMatchObject({ ok: true, value: { matches: [{ ref: 'd1.w4' }, { ref: 'd1.w2' }, { ref: 'd1.w1' }], totalMatches: 4 } });
      expect(readEntityFeedPage.mock.calls).toEqual([
        [{ entityId: 'MA_EURUSD', query: 'carry 3m' }],
        [{ entityId: 'MA_EURUSD', query: 'carry 3m', limit: 2, offset: 1 }],
        [{ entityId: 'MA_EURUSD', query: 'carry 3m', limit: 1, offset: 2 }],
      ]);
      expect(registry.getPayload('d1')).toMatchObject({ window: { widgets: [{ widgetId: 'MW_FEED_1' }, { widgetId: 'MW_FEED_2' }, { widgetId: 'MW_FEED_3' }, { widgetId: 'MW_FEED_4' }] } });
    });

    it.each([
      { name: 'a dependency failure', page: { ok: false, error: { kind: 'dependency', source: 'feed', failure: { kind: 'timeout' } } }, error: { kind: 'dependency', source: 'feed', failure: { kind: 'timeout' } } },
      { name: 'an incomplete empty page', page: { ok: true, value: { entries: [], total: 2 } }, error: { kind: 'invalid-feed', problem: 'response' } },
      { name: 'an unknown configured identity', page: { ok: true, value: { entries: [entry('MW_FEED_2', 'WC_UNKNOWN')], total: 2 } }, error: { kind: 'invalid-feed', problem: 'widget-entry' } },
    ] as const)('fails loudly on $name in a later queried page', async ({ page, error }) => {
      const registry = storedRegistry(feedPayload([1, 2].map((index) => ({ ...feedEntry(index), snippet: snippet(`Stored ${index}`) })), 2));
      const readEntityFeedPage = vi.fn<EntityFeedPageReader>()
        .mockResolvedValueOnce({ ok: true, value: { entries: [feedEntry(1)], total: 2 } })
        .mockResolvedValueOnce(page);
      const result = await filterStoredDashboard('d1', 'carry 3m', { registry, readEntityFeedPage, widgets: unexpectedRender }, 2);
      expect(result).toEqual({ ok: false, error: { kind: 'entity-feed', error } });
      expect(registry.resolveRef('d1.w1' as Ref)).toBeUndefined();
    });

    it('returns an Entity Feed page failure', async () => {
      const registry = storedRegistry(feedPayload([], 1));
      const error = { kind: 'dependency', source: 'feed', failure: { kind: 'timeout' } } as const;

      await expect(filterStoredDashboard('d1', 'skew', {
        registry,
        readEntityFeedPage: async () => ({ ok: false, error }),
        widgets: unexpectedRender,
      })).resolves.toEqual({ ok: false, error: { kind: 'entity-feed', error } });
    });

    it('returns the Widget failure of a shown match', async () => {
      const registry = storedRegistry(feedPayload([feedEntry(1)], 1));
      const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_FEED_1' } } as const;

      await expect(filterStoredDashboard('d1', 'feed', {
        registry,
        readEntityFeedPage: async () => ({ ok: true, value: { entries: [feedEntry(1)], total: 1 } }),
        widgets: { renderDashboardWidget: async () => ({ ok: false, error }) },
      })).resolves.toEqual({
        ok: false,
        error: { kind: 'widget', action: 'widget-snippet', error },
      });
    });

    it('uses server membership and order while retaining canonical titles and indices', async () => {
      const registry = storedRegistry(feedPayload([
        { ...feedEntry(1), title: 'Untitled', snippet: snippet('EURUSD Skew') },
        { ...feedEntry(2), title: 'Skew raw', snippet: snippet('Carry') },
        { ...feedEntry(3), widgetId: 'MW_SKEW_3', snippet: snippet('Feed 3') },
        { ...feedEntry(4), snippet: snippet('Skew four') },
      ], 4));

      const result = await filterStoredDashboard('d1', 'SKEW', {
        registry,
        readEntityFeedPage: async () => ({ ok: true, value: { entries: [{ ...feedEntry(3), widgetId: 'MW_SKEW_3' as WidgetId }, feedEntry(1), feedEntry(4)], total: 3 } }),
        widgets: unexpectedRender,
      }, 2);

      expect(result).toMatchObject({
        ok: true,
        value: {
          matches: [
            { index: 2, ref: 'd1.w3', title: 'Feed 3' },
            { index: 0, ref: 'd1.w1', title: 'EURUSD Skew' },
          ],
          totalMatches: 3,
        },
      });
      if (!result.ok) throw new Error('expected the filter to succeed');
      expect(Object.keys(result.value.refs)).toEqual(['d1.w3', 'd1.w1']);
    });

    it('shows thirty matches by default', async () => {
      const registry = storedRegistry(feedPayload(
        Array.from({ length: 31 }, (_, index) => ({ ...feedEntry(index + 1), snippet: snippet(`Feed ${index + 1}`) })),
        31,
      ));

      const result = await filterStoredDashboard('d1', 'feed', {
        registry,
        readEntityFeedPage: async () => ({ ok: true, value: { entries: Array.from({ length: 31 }, (_, index) => feedEntry(index + 1)), total: 31 } }),
        widgets: unexpectedRender,
      });

      expect(result).toMatchObject({ ok: true, value: { totalMatches: 31 } });
      if (!result.ok) throw new Error('expected the filter to succeed');
      expect(result.value.matches).toHaveLength(30);
    });

    it('gives an Entity Feed match a Widget ref without Dashboard placement', async () => {
      const registry = storedRegistry(feedPayload([{
        ...feedEntry(1),
        childId: 'CHILD_1',
        configurationId: 'WC_FEED_1',
        selectedContext: 'MA_EURUSD',
        snippet: snippet('Feed 1'),
      }], 1));

      await filterStoredDashboard('d1', 'feed', {
        registry,
        readEntityFeedPage: async () => ({ ok: true, value: { entries: [{ ...feedEntry(1), configurationId: 'WC_FEED_1' as ConfigId }], total: 1 } }),
        widgets: unexpectedRender,
      });

      expect(registry.resolveRef('d1.w1' as Ref)).toEqual({
        type: 'widget',
        widgetId: 'MW_FEED_1',
        configurationId: 'WC_FEED_1',
        selectedContext: 'MA_EURUSD',
      });
    });
  });
});
