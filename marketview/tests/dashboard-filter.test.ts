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
        entityFeed: { entries: [] },
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
      readEntityFeedPage: async () => {
        throw new Error('unexpected Entity Feed page read');
      },
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
          },
        },
      },
    });
    expect(getArtifact).toHaveBeenCalledOnce();
    expect(resolveRef).not.toHaveBeenCalled();
    expect(setPayload).not.toHaveBeenCalled();
    expect(updateRefs).not.toHaveBeenCalled();
  });

  it('stops at an empty Entity Feed page without rewriting the payload', async () => {
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

    expect(result).toMatchObject({ ok: true, value: { matches: [] } });
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
        entityFeed: { entries: [] },
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
      readEntityFeedPage: async () => {
        registry.setRefs('d1', {
          'd1.w1': {
            type: 'widget',
            widgetId: 'MW_TARGET' as WidgetId,
            configurationId: 'WC_NEW' as ConfigId,
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
          },
        },
      },
    });
    expect(registry.resolveRef('d1.w1' as Ref)).toMatchObject({
      type: 'widget',
      widgetId: 'MW_TARGET' as WidgetId,
      configurationId: 'WC_NEW' as ConfigId,
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
          ...(kind === 'dashboard' ? { dashboard: { children: [] } } : { entityFeed: { entries: [] } }),
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

      await filterStoredDashboard('d1', 'carry', { registry, readEntityFeedPage: noPageRead, widgets });

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
        entityFeed: { entries: [] },
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
      const readEntityFeedPage = vi.fn(async (input: { limit: number; offset?: number }) => ({
        ok: true as const,
        value: {
          entries: Array.from({ length: input.limit }, (_, index) => feedEntry((input.offset ?? 0) + index + 1)),
          total: 260,
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
      ]);
      expect(result).toMatchObject({ ok: true, value: { matches: [], totalMatches: 0 } });
      expect(registry.getPayload('d1')).toMatchObject({
        window: { widgets: { length: 260, 259: { widgetId: 'MW_FEED_260', title: 'Feed 260' } } },
      });
    });

    it('loads only the Entity Feed widgets after those already stored', async () => {
      const registry = storedRegistry(feedPayload(Array.from({ length: 250 }, (_, index) => feedEntry(index + 1)), 260));
      const readEntityFeedPage = vi.fn(async (input: { limit: number; offset?: number }) => ({
        ok: true as const,
        value: {
          entries: Array.from({ length: input.limit }, (_, index) => feedEntry((input.offset ?? 0) + index + 1)),
          total: 260,
        },
      }));

      await filterStoredDashboard('d1', 'no such widget', {
        registry,
        readEntityFeedPage,
        widgets: unexpectedRender,
      });

      expect(readEntityFeedPage.mock.calls).toEqual([
        [{ entityId: 'MA_EURUSD', limit: 10, offset: 250 }],
      ]);
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
        readEntityFeedPage: vi.fn(),
        widgets: { renderDashboardWidget: async () => ({ ok: false, error }) },
      })).resolves.toEqual({
        ok: false,
        error: { kind: 'widget', action: 'widget-snippet', error },
      });
    });

    it('matches titles and Widget IDs case-insensitively and shows at most the limit', async () => {
      const registry = storedRegistry(feedPayload([
        { ...feedEntry(1), title: 'Untitled', snippet: snippet('EURUSD Skew') },
        { ...feedEntry(2), title: 'Skew raw', snippet: snippet('Carry') },
        { ...feedEntry(3), widgetId: 'MW_SKEW_3', snippet: snippet('Feed 3') },
        { ...feedEntry(4), snippet: snippet('Skew four') },
      ], 4));

      const result = await filterStoredDashboard('d1', 'SKEW', {
        registry,
        readEntityFeedPage: vi.fn(),
        widgets: unexpectedRender,
      }, 2);

      expect(result).toMatchObject({
        ok: true,
        value: {
          matches: [
            { index: 0, ref: 'd1.w1', title: 'EURUSD Skew' },
            { index: 2, ref: 'd1.w3', title: 'Feed 3' },
          ],
          totalMatches: 3,
        },
      });
      if (!result.ok) throw new Error('expected the filter to succeed');
      expect(Object.keys(result.value.refs)).toEqual(['d1.w1', 'd1.w3']);
    });

    it('shows thirty matches by default', async () => {
      const registry = storedRegistry(feedPayload(
        Array.from({ length: 31 }, (_, index) => ({ ...feedEntry(index + 1), snippet: snippet(`Feed ${index + 1}`) })),
        31,
      ));

      const result = await filterStoredDashboard('d1', 'feed', {
        registry,
        readEntityFeedPage: vi.fn(),
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
        readEntityFeedPage: vi.fn(),
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
