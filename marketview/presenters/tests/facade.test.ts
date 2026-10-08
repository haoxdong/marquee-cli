import type { Ref } from '../../../artifact-registry/index.js';
import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../../../artifact-registry/index.js';
import type {
  MarketViewSearch,
  MarketViewSearchEntry,
  MarketViewSearchPage,
  MarketViewSearchValue,
} from '../../search/index.js';
import { createMarketViewCore } from '../../facade.js';

const carryEntry: MarketViewSearchEntry = {
  kind: 'configured-widget',
  identity: { widgetId: 'MW_CARRY' as WidgetId, configurationId: 'WC_CARRY' as ConfigId },
  snippet: {
    title: 'Carry',
    isTitleResolved: true,
    parameterLines: ['Asset'],
  },
};

const page: MarketViewSearchPage = {
  type: 'marketview-search',
  query: 'carry',
  results: [carryEntry],
  continuation: {
    query: 'carry',
    selectors: ['keyword-widget'],
    limit: 1,
  },
};

const searchValue: MarketViewSearchValue = {
  page,
  resultMetadata: [{ entry: carryEntry }],
};

function searchModule(overrides: Partial<MarketViewSearch> = {}): MarketViewSearch {
  return {
    async search() {
      return { ok: true, value: searchValue };
    },
    ...overrides,
  };
}

describe('MarketView facade', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) rmSync(refsDir, { recursive: true, force: true });
    refsDir = undefined;
  });

  it('owns Search artifact lifecycle and gives the presenter a narrow ref handoff', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'surface-facade-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const marketView = createMarketViewCore({
      search: searchModule(),
      registry,
    });

    const result = await marketView.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        page,
        artifact: {
          namespace: 's1',
          searchUrl: expect.stringContaining('/search?query=carry'),
        },
      },
    });
    if (!result.ok) throw new Error('expected Search success');
    expect(registry.resolveRef('s1' as Ref)).toEqual({
      type: 'search',
      searchKind: 'market-data',
    });
    expect(registry.getPayload('s1')).toMatchObject({ query: 'carry' });
    expect(registry.resolveRef('s1.w1' as Ref)).toEqual({
      type: 'widget',
      widgetId: 'MW_CARRY',
      configurationId: 'WC_CARRY',
      selectedContext: null,
    });
  });

  it('stores a browser target for a country Search result', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'surface-facade-country-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const countryUrl = 'https://marquee.gs.com/s/marketview/country/BR';
    const countryEntry = {
      kind: 'entity' as const,
      identity: { kind: 'country' as const, entityId: 'BR' },
      label: 'Brazil',
    };
    const marketView = createMarketViewCore({
      registry,
      search: searchModule({
        async search() {
          return {
            ok: true,
            value: {
              page: { ...page, results: [countryEntry] },
              resultMetadata: [{ entry: countryEntry, url: countryUrl }],
            },
          };
        },
      }),
    });

    await marketView.search({ query: 'Brazil', selectors: ['country'], limit: 1 });

    expect(registry.resolveRef('s1.d1' as Ref)).toEqual({
      type: 'entity-feed',
      entityId: 'BR',
      entityKind: 'country',
    });
    expect(registry.getPayload('s1')).toMatchObject({
      browserTargets: { 's1.d1': countryUrl },
    });
  });

  it('registers Widget refs in the same canonical mode order the presenter displays', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'surface-facade-mode-order-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const marketView = createMarketViewCore({
      search: searchModule({
        async search() {
          return {
            ok: true,
            value: {
              page: {
                ...page,
                results: [
                  {
                    kind: 'configured-widget',
                    identity: { widgetId: 'MW_SEMANTIC' as WidgetId, configurationId: 'WC_SEMANTIC' as ConfigId },
                    snippet: {
                      title: 'Semantic result',
                      isTitleResolved: true,
                      parameterLines: [],
                    },
                  },
                  {
                    kind: 'configured-widget',
                    identity: { widgetId: 'MW_KEYWORD' as WidgetId, configurationId: 'WC_KEYWORD' as ConfigId },
                    snippet: {
                      title: 'Keyword result',
                      isTitleResolved: true,
                      parameterLines: [],
                    },
                  },
                ],
              },
              resultMetadata: [
                  {
                    entry: {
                      kind: 'configured-widget',
                      identity: { widgetId: 'MW_SEMANTIC' as WidgetId, configurationId: 'WC_SEMANTIC' as ConfigId },
                      snippet: {
                        title: 'Semantic result',
                        isTitleResolved: true,
                        parameterLines: [],
                      },
                    },
                    widgetMode: 'semantic',
                  },
                  {
                    entry: {
                      kind: 'configured-widget',
                      identity: { widgetId: 'MW_KEYWORD' as WidgetId, configurationId: 'WC_KEYWORD' as ConfigId },
                      snippet: {
                        title: 'Keyword result',
                        isTitleResolved: true,
                        parameterLines: [],
                      },
                    },
                    widgetMode: 'keyword',
                  },
              ],
            },
          };
        },
      }),
      registry,
    });

    await marketView.search({
      query: 'carry',
      selectors: ['semantic-widget', 'keyword-widget'],
      limit: 2,
    });

    expect(registry.resolveRef('s1.w1' as Ref)).toMatchObject({ widgetId: 'MW_KEYWORD' });
    expect(registry.resolveRef('s1.w2' as Ref)).toMatchObject({ widgetId: 'MW_SEMANTIC' });
  });

  it('closes Registry failures as MarketView Search errors', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'surface-facade-registry-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const recordSearchFailure = vi.fn();
    vi.spyOn(registry, 'claimSearch').mockImplementation(() => {
      throw new Error('Registry policy rejected Search artifact');
    });
    const marketView = createMarketViewCore({
      search: searchModule(),
      registry,
      recordSearchFailure,
    });

    await expect(marketView.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'artifact-policy-failed',
      },
    });
    expect(recordSearchFailure).toHaveBeenCalledWith('artifact-policy', {
      kind: 'artifact-policy-failure',
      message: 'Registry policy rejected Search artifact',
    });
  });

  it('closes child-ref persistence inside the facade error boundary', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'surface-facade-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    vi.spyOn(registry, 'setRefs').mockImplementation(() => {
      throw new Error('Registry rejected Search child refs');
    });
    const marketView = createMarketViewCore({
      search: searchModule(),
      registry,
    });

    await expect(marketView.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'artifact-policy-failed',
      },
    });
  });

  function widgetEntry(id: string): MarketViewSearchEntry {
    return {
      kind: 'configured-widget',
      identity: { widgetId: `MW_${id}` as WidgetId, configurationId: `WC_${id}` as ConfigId },
      snippet: { title: id, isTitleResolved: true, parameterLines: [] },
    };
  }

  async function searchRefs(resultMetadata: MarketViewSearchValue['resultMetadata']) {
    refsDir = mkdtempSync(join(tmpdir(), 'surface-facade-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const marketView = createMarketViewCore({
      registry,
      search: searchModule({
        async search() {
          return {
            ok: true,
            value: { page: { ...page, results: resultMetadata.map(({ entry }) => entry) }, resultMetadata },
          };
        },
      }),
    });
    const result = await marketView.search({ query: 'carry trade', selectors: ['keyword-widget'], limit: 6 });
    if (!result.ok) throw new Error('expected Search success');
    return {
      searchUrl: result.value.artifact?.searchUrl,
      refs: registry.getAllRefs(),
      browserTargets: (registry.getPayload('s1') as { browserTargets: unknown }).browserTargets,
    };
  }

  it('numbers Widget refs in mode order and Dashboard refs over titled results apart', async () => {
    const dashboardUrl = 'https://marquee.gs.com/s/marketview/dashboards/MD_RATES';
    const { searchUrl, refs, browserTargets } = await searchRefs([
      {
        entry: { kind: 'dashboard', identity: { dashboardId: 'MD_RATES' }, title: 'Rates' },
        url: dashboardUrl,
      },
      { entry: { kind: 'entity', identity: { kind: 'asset', entityId: 'MA_UNTITLED' }, label: '' } },
      { entry: widgetEntry('SEMANTIC'), widgetMode: 'semantic' },
      { entry: { kind: 'entity', identity: { kind: 'country', entityId: 'BR' }, label: 'Brazil' } },
      { entry: widgetEntry('KEYWORD'), widgetMode: 'keyword' },
      { entry: widgetEntry('UNMARKED') },
    ]);

    expect(searchUrl).toBe('https://marquee.gs.com/s/marketview/search?query=carry%20trade');
    expect(refs).toStrictEqual({
      s1: { type: 'search', searchKind: 'market-data' },
      's1.w1': { type: 'widget', widgetId: 'MW_KEYWORD', configurationId: 'WC_KEYWORD', selectedContext: null },
      's1.w2': { type: 'widget', widgetId: 'MW_UNMARKED', configurationId: 'WC_UNMARKED', selectedContext: null },
      's1.w3': { type: 'widget', widgetId: 'MW_SEMANTIC', configurationId: 'WC_SEMANTIC', selectedContext: null },
      's1.d1': { type: 'dashboard', dashboardId: 'MD_RATES' },
      's1.d2': { type: 'entity-feed', entityId: 'BR', entityKind: 'country' },
    });
    expect(browserTargets).toStrictEqual({ 's1.d1': dashboardUrl });
  });

  it('keeps Widget refs in result order when only one mode is marked', async () => {
    const { refs } = await searchRefs([
      { entry: widgetEntry('SEMANTIC'), widgetMode: 'semantic' },
      { entry: widgetEntry('UNMARKED') },
    ]);

    expect(refs).toStrictEqual({
      s1: { type: 'search', searchKind: 'market-data' },
      's1.w1': { type: 'widget', widgetId: 'MW_SEMANTIC', configurationId: 'WC_SEMANTIC', selectedContext: null },
      's1.w2': { type: 'widget', widgetId: 'MW_UNMARKED', configurationId: 'WC_UNMARKED', selectedContext: null },
    });
  });
});
