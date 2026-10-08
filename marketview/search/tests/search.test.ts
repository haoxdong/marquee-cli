import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createMarketViewSearchModule,
  type MarketViewSearchDiscoveryEntry,
  type MarketViewSearchDiscoveryWidget,
  type MarketViewSearchPort,
} from '../module.js';
import { createInMemoryMarketViewSearchPort } from './fake-search-port.js';
type SearchWidgetValues = Readonly<{
  widgetDefinition: NonNullable<MarketViewSearchDiscoveryWidget['widgetDefinition']>;
  parameters: NonNullable<MarketViewSearchDiscoveryWidget['parameters']>;
  selectedContext: Exclude<MarketViewSearchDiscoveryWidget['selectedContext'], undefined>;
  widgetDates?: NonNullable<MarketViewSearchDiscoveryWidget['widgetDates']>;
}>;
function port(
  discover: MarketViewSearchPort['discover'],
): MarketViewSearchPort {
  return {
    discover,
  };
}

function renderValues(
  widgetId: string,
  configurationId: string | null,
): SearchWidgetValues {
  return {
    widgetDefinition: {
      id: widgetId,
      configurationId,
      metadata: { title: 'Authoritative snippet' },
      title: 'Search title',
      underlyingChartId: 'CH_SEARCH',
    },
    parameters: [],
    selectedContext: null,
  };
}

describe('Search', () => {
  it('keeps every Asset result up to the requested limit', async () => {
    const results = Array.from({ length: 10 }, (_, index) => ({
      type: 'entity' as const,
      entityKind: 'asset' as const,
      entityId: `MA${index + 1}`,
      label: `Asset ${index + 1}`,
      qualifiers: [],
      url: `https://marquee.gs.com/s/marketview/asset/MA${index + 1}`,
    }));
    const search = createMarketViewSearchModule({
      port: port(async () => ({
        ok: true,
        value: {
          results,
        },
      })),
      widget: {
        async render() {
          throw new Error('not called');
        },
      },
    });

    const outcome = await search.search({
      query: 'AAPL',
      selectors: ['asset'],
      limit: 10,
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.value.page.results).toHaveLength(10);
    expect(outcome.value.page.results.at(-1)).toMatchObject({
      kind: 'entity',
      identity: { kind: 'asset', entityId: 'MA10' },
      label: 'Asset 10',
    });
  });

  it('preserves the five-result cap for non-Asset discovery families', async () => {
    const results = Array.from({ length: 10 }, (_, index) => ({
      type: 'dashboard' as const,
      dashboardId: `MD${index + 1}`,
      title: `Dashboard ${index + 1}`,
      category: { kind: 'thematic' as const },
      widgetCount: index + 1,
      url: `https://marquee.gs.com/s/marketview/dashboard/MD${index + 1}`,
    }));
    const search = createMarketViewSearchModule({
      port: port(async () => ({
        ok: true,
        value: {
          results,
        },
      })),
      widget: {
        async render() {
          throw new Error('not called');
        },
      },
    });

    const outcome = await search.search({
      query: 'rates',
      selectors: ['thematic'],
      limit: 10,
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.value.page.results).toHaveLength(5);
  });

  it('renders every Widget when the requested limit exceeds ten', async () => {
    const results = Array.from({ length: 11 }, (_, index) => ({
      type: 'widget' as const,
      widgetId: `MW${index + 1}` as WidgetId,
      title: `Widget ${index + 1}`,
      configurationId: `WC${index + 1}` as ConfigId,
      parameterLines: [],
      ...renderValues(`MW${index + 1}`, `WC${index + 1}`),
    }));
    const search = createMarketViewSearchModule({
      port: port(async () => ({
        ok: true,
        value: {
          results,
        },
      })),
      widget: {
        async render(widgetDefinition) {
          const widgetId = String(widgetDefinition.id) as WidgetId;
          const configurationId = String(widgetDefinition.configurationId) as ConfigId;
          return {
            ok: true,
            value: {
              detail: 'snippet' as const,
              widget: {
                widgetId,
                configurationId,
                title: widgetId,
                family: 'plot' as const,
                link: `https://marquee.gs.com/s/marketview/widget/${widgetId}`,
                bindings: [],
                parameters: [],
              },
              snippet: {
                title: widgetId,
                isTitleResolved: true,
                parameterLines: [],
              },
            },
          };
        },
      },
    });

    const outcome = await search.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 11,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.page.results[10]).toMatchObject({
      kind: 'configured-widget',
      identity: { widgetId: 'MW11' as WidgetId, configurationId: 'WC11' as ConfigId },
      snippet: {
        title: 'MW11',
        isTitleResolved: true,
        parameterLines: [],
      },
    });
  });

  describe('Widget search mode', () => {
    function widgetResult(
      widgetId: string,
      searchMode?: MarketViewSearchDiscoveryWidget['searchMode'],
    ): MarketViewSearchDiscoveryWidget {
      return {
        type: 'widget',
        widgetId: widgetId as WidgetId,
        title: widgetId,
        configurationId: `WC_${widgetId}` as ConfigId,
        parameterLines: [],
        ...(searchMode ? { searchMode } : {}),
        ...renderValues(widgetId, `WC_${widgetId}`),
      };
    }

    const widget: Parameters<typeof createMarketViewSearchModule>[0]['widget'] = {
      async render(widgetDefinition) {
        const widgetId = String(widgetDefinition.id) as WidgetId;
        return {
          ok: true,
          value: {
            detail: 'snippet',
            widget: {
              widgetId,
              configurationId: String(widgetDefinition.configurationId) as ConfigId,
              title: widgetId,
              family: 'plot',
              link: `https://marquee.gs.com/s/marketview/widget/${widgetId}`,
              bindings: [],
              parameters: [],
            },
            snippet: { title: widgetId, isTitleResolved: true, parameterLines: [] },
          },
        };
      },
    };

    it('tags each Widget with the mode of the call that found it when several modes are requested', async () => {
      const search = createMarketViewSearchModule({
        port: port(async (input) => ({
          ok: true,
          value: { results: [widgetResult(input.selectors[0] === 'keyword-widget' ? 'MW_KEYWORD' : 'MW_SEMANTIC')] },
        })),
        widget,
      });

      const outcome = await search.search({
        query: 'carry',
        selectors: ['keyword-widget', 'semantic-widget'],
        limit: 5,
      });

      expect(outcome).toMatchObject({
        ok: true,
        value: {
          resultMetadata: [{ widgetMode: 'keyword' }, { widgetMode: 'semantic' }],
        },
      });
    });

    it('keeps the mode the port reports when one mode is requested', async () => {
      const search = createMarketViewSearchModule({
        port: port(async () => ({ ok: true, value: { results: [widgetResult('MW_RANKED', 'llm-reranked')] } })),
        widget,
      });

      const outcome = await search.search({ query: 'carry', selectors: ['hybrid-widget'], limit: 5 });

      expect(outcome).toMatchObject({
        ok: true,
        value: { resultMetadata: [{ widgetMode: 'llm-reranked' }] },
      });
    });
  });

  it('passes Search Widget values directly to Widget.render', async () => {
    const render = vi.fn<
      Parameters<typeof createMarketViewSearchModule>[0]['widget']['render']
    >(async (widgetDefinition) => ({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: String(widgetDefinition.id) as WidgetId,
          configurationId: String(widgetDefinition.configurationId) as ConfigId,
          title: 'Authoritative snippet',
          family: 'plot',
          link: `https://marquee.gs.com/s/marketview/widget/${String(widgetDefinition.id)}`,
          bindings: [],
          parameters: [],
        },
        snippet: {
          title: 'Authoritative snippet',
          isTitleResolved: true,
          parameterLines: ['Asset'],
        },
      },
    }));
    const semanticValues: SearchWidgetValues = {
      ...renderValues('MW_SEARCH', 'WC_SEARCH'),
      parameters: [{ field: 'tenor', value: '2y' }],
      selectedContext: 'MA_SELECTED',
      widgetDates: {
        startDate: '2026-01-30',
        endDate: '2026-07-30',
        interval: '1D',
        relativeDate: '6M',
      },
    };
    const search = createMarketViewSearchModule({
      port: createInMemoryMarketViewSearchPort({
        results: [{
          type: 'widget',
          widgetId: 'MW_SEARCH' as WidgetId,
          title: 'Search title',
          configurationId: 'WC_SEARCH' as ConfigId,
          parameterLines: [],
          ...semanticValues,
        }],
      }),
      widget: { render },
    });

    await expect(search.search({
      query: 'AAPL carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        page: {
          results: [{
            kind: 'configured-widget',
            identity: { widgetId: 'MW_SEARCH' as WidgetId, configurationId: 'WC_SEARCH' as ConfigId },
            snippet: {
              title: 'Authoritative snippet',
              parameterLines: ['Asset'],
            },
          }],
        },
      },
    });
    expect(render).toHaveBeenCalledExactlyOnceWith(
      semanticValues.widgetDefinition,
      semanticValues.parameters,
      semanticValues.selectedContext,
      semanticValues.widgetDates,
      'snippet',
    );
  });

  it('keeps missing compatible configuration identity private to Widget.render', async () => {
    const semanticValues = renderValues('MW_UNCONFIGURED', null);
    const render = vi.fn<
      Parameters<typeof createMarketViewSearchModule>[0]['widget']['render']
    >(async () => ({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: 'MW_UNCONFIGURED' as WidgetId,
          configurationId: 'WC_MINTED' as ConfigId,
          title: 'Minted Widget',
          family: 'plot',
          bindings: [],
          parameters: [],
        },
        snippet: {
          title: 'Minted Widget',
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    }));
    const search = createMarketViewSearchModule({
      port: createInMemoryMarketViewSearchPort({
        results: [{
          type: 'widget',
          widgetId: 'MW_UNCONFIGURED' as WidgetId,
          title: 'Unconfigured Widget',
          configurationId: null,
          parameterLines: [],
          ...semanticValues,
        }],
      }),
      widget: { render },
    });

    await expect(search.search({
      query: 'unconfigured',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        page: {
          results: [{
            kind: 'configured-widget',
            identity: { widgetId: 'MW_UNCONFIGURED' as WidgetId, configurationId: 'WC_MINTED' as ConfigId },
          }],
        },
      },
    });
    expect(render).toHaveBeenCalledExactlyOnceWith(
      semanticValues.widgetDefinition,
      semanticValues.parameters,
      semanticValues.selectedContext,
      undefined,
      'snippet',
    );
  });

  it('fails loud when a Widget result lacks semantic render values', async () => {
    const render = vi.fn<
      Parameters<typeof createMarketViewSearchModule>[0]['widget']['render']
    >();
    const search = createMarketViewSearchModule({
      port: createInMemoryMarketViewSearchPort({
        results: [{
          type: 'widget',
          widgetId: 'MW_MALFORMED' as WidgetId,
          title: 'Malformed Widget',
          configurationId: 'WC_MALFORMED' as ConfigId,
          parameterLines: [],
        }],
      }),
      widget: { render },
    });

    await expect(search.search({
      query: 'malformed',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW_MALFORMED' as WidgetId },
        problem: 'invalid-response',
      },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('returns a semantic page and preserves the literal query in one keyword discovery', async () => {
    const discover = vi.fn<MarketViewSearchPort['discover']>(async () => ({
      ok: true,
      value: {
        results: [
          {
            type: 'widget',
            widgetId: 'MW_FIRST' as WidgetId,
            title: 'First widget',
            configurationId: 'WC_FIRST' as ConfigId,
            parameterLines: ['Asset'],
            ...renderValues('MW_FIRST', 'WC_FIRST'),
          },
          {
            type: 'entity',
            entityKind: 'asset',
            entityId: 'MA_SECOND',
            label: 'Second dashboard',
            qualifiers: [],
            url: 'https://marquee.gs.com/s/marketview/asset/MA_SECOND',
          },
        ],
      },
    }));
    const search = createMarketViewSearchModule({
      port: port(discover),
      widget: {
        async render(widgetDefinition) {
          return {
            ok: true,
            value: {
              detail: 'snippet' as const,
              widget: {
                widgetId: String(widgetDefinition.id) as WidgetId,
                configurationId: String(widgetDefinition.configurationId) as ConfigId,
                title: 'First widget',
                family: 'plot' as const,
                bindings: [],
                parameters: [],
              },
              snippet: {
                title: 'First widget',
                isTitleResolved: true,
                parameterLines: ['Asset'],
              },
            },
          };
        },
      },
    });

    await expect(search.search({
      query: '  AAPL carry  ',
      selectors: ['keyword-widget', 'asset'],
      limit: 7,
    })).resolves.toEqual({
      ok: true,
      value: {
        page: {
          type: 'marketview-search',
          query: '  AAPL carry  ',
          results: [
            {
              kind: 'configured-widget',
              identity: { widgetId: 'MW_FIRST' as WidgetId, configurationId: 'WC_FIRST' as ConfigId },
              snippet: {
                title: 'First widget',
                isTitleResolved: true,
                parameterLines: ['Asset'],
              },
            },
            {
              kind: 'entity',
              identity: { kind: 'asset', entityId: 'MA_SECOND' },
              label: 'Second dashboard',
            },
          ],
          continuation: {
            query: '  AAPL carry  ',
            selectors: ['keyword-widget', 'asset'],
            limit: 7,
          },
        },
        resultMetadata: [
            {
              entry: {
                kind: 'configured-widget',
                identity: { widgetId: 'MW_FIRST' as WidgetId, configurationId: 'WC_FIRST' as ConfigId },
                snippet: {
                  title: 'First widget',
                  isTitleResolved: true,
                  parameterLines: ['Asset'],
                },
              },
            },
            {
              entry: {
                kind: 'entity',
                identity: { kind: 'asset', entityId: 'MA_SECOND' },
                label: 'Second dashboard',
              },
              detail: { kind: 'entity', qualifiers: [] },
              url: 'https://marquee.gs.com/s/marketview/asset/MA_SECOND',
            },
        ],
      },
    });
    expect(discover).toHaveBeenNthCalledWith(1, {
      query: '  AAPL carry  ',
      selectors: ['keyword-widget', 'asset'],
      limit: 7,
      signal: expect.any(AbortSignal),
    });
  });

  it('rejects invalid input before discovery', async () => {
    const discover = vi.fn<MarketViewSearchPort['discover']>();
    const search = createMarketViewSearchModule({
      port: port(discover),
      widget: {
        async render() {
          throw new Error('not called');
        },
      },
    });

    await expect(search.search({ query: '   ', selectors: ['keyword-widget'], limit: 5 })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-query' },
    });
    await expect(search.search({ query: 'carry', selectors: [], limit: 5 })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-selector-set' },
    });
    await expect(search.search({ query: 'carry', selectors: ['keyword-widget'], limit: 0 })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-limit' },
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it('fails loud when one discovery branch fails', async () => {
    const discover = vi.fn<MarketViewSearchPort['discover']>(async (input) => (
      input.selectors[0] === 'keyword-widget'
        ? {
            ok: false,
            error: {
              kind: 'discovery-failed',
              failure: { kind: 'authentication-required', realm: 'marquee' },
            },
          }
        : { ok: true, value: { results: [] } }
    ));
    const search = createMarketViewSearchModule({
      port: port(discover),
      widget: {
        async render() {
          throw new Error('not called');
        },
      },
    });

    await expect(search.search({
      query: 'carry',
      selectors: ['keyword-widget', 'asset'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
      evidence: {
        kind: 'discovery-call',
        index: 0,
        selectors: ['keyword-widget', 'asset'],
      },
    });
  });

  it('keeps Widget render failures semantic at the application seam', async () => {
    const search = createMarketViewSearchModule({
      port: createInMemoryMarketViewSearchPort({
        results: [{
          type: 'widget',
          widgetId: 'MW_FAIL' as WidgetId,
          title: 'Widget that fails hydration',
          configurationId: 'WC_FAIL' as ConfigId,
          parameterLines: [],
          ...renderValues('MW_FAIL', 'WC_FAIL'),
        }],
      }),
      widget: {
        async render() {
          return {
            ok: false,
            error: {
              kind: 'widget-load-failure',
              identity: { widgetId: 'MW_FAIL' },
              failure: { kind: 'unavailable' },
            },
          };
        },
      },
    });

    await expect(search.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW_FAIL' as WidgetId },
        problem: 'dependency',
      },
    });
  });

  it('preserves typed Widget Snippet failures at the application seam', async () => {
    const search = createMarketViewSearchModule({
      port: createInMemoryMarketViewSearchPort({
        results: [{
          type: 'widget',
          widgetId: 'MW_FAIL' as WidgetId,
          title: 'Widget that fails snippet projection',
          configurationId: 'WC_FAIL' as ConfigId,
          parameterLines: [],
          ...renderValues('MW_FAIL', 'WC_FAIL'),
        }],
      }),
      widget: {
        async render() {
          return {
            ok: false,
            error: {
              kind: 'missing-display-evidence',
              identity: { widgetId: 'MW_FAIL' },
              field: 'Basket',
            },
          };
        },
      },
    });

    await expect(search.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW_FAIL' as WidgetId },
        problem: 'widget-error',
        widgetError: {
          kind: 'missing-display-evidence',
          identity: { widgetId: 'MW_FAIL' as WidgetId },
          field: 'Basket',
        },
      },
    });
  });

  it('distinguishes cancellation and unexpected Widget result modes', async () => {
    let result: Awaited<ReturnType<
      Parameters<
        typeof createMarketViewSearchModule
      >[0]['widget']['render']
    >> = {
      ok: false as const,
      error: {
        kind: 'widget-load-failure' as const,
        identity: { widgetId: 'MW_FAIL' },
        failure: { kind: 'cancelled' as const },
      },
    };
    const widget = {
      async render() {
        return result;
      },
    };
    const search = createMarketViewSearchModule({
      port: createInMemoryMarketViewSearchPort({
        results: [{
          type: 'widget',
          widgetId: 'MW_FAIL' as WidgetId,
          title: 'Widget that fails hydration',
          configurationId: 'WC_FAIL' as ConfigId,
          parameterLines: [],
          ...renderValues('MW_FAIL', 'WC_FAIL'),
        }],
      }),
      widget,
    });

    await expect(search.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW_FAIL' as WidgetId },
        problem: 'cancelled',
      },
    });

    result = {
      ok: true as const,
      value: { detail: 'full' } as never,
    };

    await expect(search.search({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW_FAIL' as WidgetId },
        problem: 'unexpected-result-mode',
      },
    });
  });
});

describe('Search module behavior', () => {
  type Render = Parameters<typeof createMarketViewSearchModule>[0]['widget']['render'];

  const snippetRender: Render = async (widgetDefinition) => {
    const widgetId = String(widgetDefinition.id) as WidgetId;
    return {
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId,
          configurationId: String(widgetDefinition.configurationId) as ConfigId,
          title: widgetId,
          family: 'plot',
          bindings: [],
          parameters: [],
        },
        snippet: { title: widgetId, isTitleResolved: true, parameterLines: [] },
      },
    };
  };

  function widgetEntry(widgetId: string): MarketViewSearchDiscoveryWidget {
    return {
      type: 'widget',
      widgetId: widgetId as WidgetId,
      title: widgetId,
      configurationId: `WC_${widgetId}` as ConfigId,
      parameterLines: [],
      ...renderValues(widgetId, `WC_${widgetId}`),
    };
  }

  function entity(
    entityKind: 'asset' | 'country' | 'portfolio',
    entityId: string,
    url?: string,
  ): MarketViewSearchDiscoveryEntry {
    return { type: 'entity', entityKind, entityId, label: entityId, qualifiers: [], ...(url ? { url } : {}) };
  }

  function dashboard(dashboardId: string): MarketViewSearchDiscoveryEntry {
    return {
      type: 'dashboard',
      dashboardId,
      title: dashboardId,
      category: { kind: 'named', value: 'Thematic' },
      widgetCount: 2,
      url: `https://marquee.gs.com/s/marketview/dashboards/${dashboardId}`,
    };
  }

  function bySelector(
    results: Partial<Record<string, readonly MarketViewSearchDiscoveryEntry[]>>,
  ): MarketViewSearchPort {
    return port(async (input) => ({ ok: true, value: { results: input.selectors.flatMap((selector) => results[selector] ?? []) } }));
  }

  it.each([
    ['authentication-required', 'authentication'],
    ['rate-limited', 'rate-limit'],
    ['timeout', 'timeout'],
  ] as const)('classifies a %s Widget load failure as %s', async (kind, problem) => {
    const search = createMarketViewSearchModule({
      port: bySelector({ 'keyword-widget': [widgetEntry('MW_FAIL')] }),
      widget: {
        async render() {
          return {
            ok: false,
            error: {
              kind: 'widget-load-failure',
              identity: { widgetId: 'MW_FAIL' },
              failure: kind === 'authentication-required'
                ? { kind, realm: 'marquee' }
                : { kind },
            },
          };
        },
      },
    });

    await expect(search.search({ query: 'q', selectors: ['keyword-widget'], limit: 5 })).resolves.toEqual({
      ok: false,
      error: { kind: 'widget-hydration-failed', identity: { widgetId: 'MW_FAIL' }, problem },
    });
  });

  it.each([
    ['parameters', (): MarketViewSearchDiscoveryWidget => {
      const { parameters: _parameters, ...partial } = widgetEntry('MW_PARTIAL');
      return partial;
    }],
    ['Selected Context', (): MarketViewSearchDiscoveryWidget => {
      const { selectedContext: _selectedContext, ...partial } = widgetEntry('MW_PARTIAL');
      return partial;
    }],
  ])('fails loud when a Widget result lacks its %s', async (_label, partial) => {
    const render = vi.fn(snippetRender);
    const search = createMarketViewSearchModule({
      port: bySelector({ 'keyword-widget': [partial()] }),
      widget: { render },
    });

    await expect(search.search({ query: 'q', selectors: ['keyword-widget'], limit: 5 })).resolves.toEqual({
      ok: false,
      error: { kind: 'widget-hydration-failed', identity: { widgetId: 'MW_PARTIAL' }, problem: 'invalid-response' },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('fails loud when Widget.render returns no configuration identity', async () => {
    const search = createMarketViewSearchModule({
      port: bySelector({ 'keyword-widget': [widgetEntry('MW_NULL')] }),
      widget: {
        async render(widgetDefinition) {
          const rendered = await snippetRender(widgetDefinition, [], null, undefined, 'snippet');
          if (!rendered.ok || rendered.value.detail !== 'snippet') throw new Error('unreachable');
          return { ok: true, value: { ...rendered.value, widget: { ...rendered.value.widget, configurationId: null } } };
        },
      },
    });

    await expect(search.search({ query: 'q', selectors: ['keyword-widget'], limit: 5 })).resolves.toEqual({
      ok: false,
      error: { kind: 'widget-hydration-failed', identity: { widgetId: 'MW_NULL' }, problem: 'invalid-response' },
    });
  });

  it('renders at most ten Widgets at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    let renders = 0;
    const search = createMarketViewSearchModule({
      port: bySelector({
        'keyword-widget': Array.from({ length: 21 }, (_, index) => widgetEntry(`MW${index + 1}`)),
      }),
      widget: {
        async render(...args) {
          inFlight += 1;
          renders += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight -= 1;
          return snippetRender(...args);
        },
      },
    });

    const outcome = await search.search({ query: 'q', selectors: ['keyword-widget'], limit: 21 });

    expect(peak).toBe(10);
    expect(renders).toBe(21);
    expect(outcome.ok && outcome.value.page.results.map((entry) => (
      entry.kind === 'configured-widget' ? entry.identity.widgetId : entry.kind
    ))).toEqual(Array.from({ length: 21 }, (_, index) => `MW${index + 1}`));
  });

  it.each([
    ['country', (index: number) => entity('country', `C${index}`)],
    ['portfolio', (index: number) => entity('portfolio', `P${index}`)],
  ] as const)('keeps at most five %s results', async (selector, make) => {
    const search = createMarketViewSearchModule({
      port: bySelector({ [selector]: Array.from({ length: 7 }, (_, index) => make(index + 1)) }),
      widget: { render: vi.fn() },
    });

    const outcome = await search.search({ query: 'q', selectors: [selector], limit: 7 });

    expect(outcome.ok && outcome.value.page.results).toHaveLength(5);
  });

  it('caps each Dashboard kind separately and below five at a smaller limit', async () => {
    const search = createMarketViewSearchModule({
      port: bySelector({
        thematic: [dashboard('MD1'), dashboard('MD2'), dashboard('MD3')],
        country: [entity('country', 'C1'), entity('country', 'C2'), entity('country', 'C3')],
      }),
      widget: { render: vi.fn() },
    });

    const outcome = await search.search({ query: 'q', selectors: ['thematic', 'country'], limit: 2 });

    expect(outcome.ok && outcome.value.page.results.map((entry) => (
      entry.kind === 'dashboard' ? entry.identity.dashboardId : entry.kind === 'entity' ? entry.identity.entityId : ''
    ))).toEqual(['MD1', 'MD2', 'C1', 'C2']);
  });

  it('keeps the first of entries that share an identity across discovery calls', async () => {
    const search = createMarketViewSearchModule({
      port: bySelector({
        'keyword-widget': [widgetEntry('MW_ONE')],
        asset: [entity('asset', 'SHARED', 'https://marquee.gs.com/s/marketview/asset/SHARED')],
        country: [entity('country', 'SHARED'), entity('country', 'JP')],
        thematic: [dashboard('MW_ONE')],
      }),
      widget: { render: snippetRender },
    });

    const outcome = await search.search({
      query: 'q',
      selectors: ['keyword-widget', 'asset', 'country', 'thematic'],
      limit: 5,
    });

    expect(outcome.ok && outcome.value.page.results).toEqual([
      expect.objectContaining({ kind: 'configured-widget', identity: { widgetId: 'MW_ONE', configurationId: 'WC_MW_ONE' } }),
      { kind: 'entity', identity: { kind: 'asset', entityId: 'SHARED' }, label: 'SHARED' },
      { kind: 'entity', identity: { kind: 'country', entityId: 'JP' }, label: 'JP' },
    ]);
  });

  it('keeps the same Widget once per requested mode', async () => {
    const search = createMarketViewSearchModule({
      port: bySelector({
        'keyword-widget': [widgetEntry('MW_SHARED')],
        'semantic-widget': [widgetEntry('MW_SHARED')],
      }),
      widget: { render: snippetRender },
    });

    const outcome = await search.search({
      query: 'q',
      selectors: ['keyword-widget', 'semantic-widget', 'keyword-widget'],
      limit: 5,
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        page: { continuation: { selectors: ['keyword-widget', 'semantic-widget'] } },
        resultMetadata: [{ widgetMode: 'keyword' }, { widgetMode: 'semantic' }],
      },
    });
  });

  it('describes Dashboards and unlinked entities in result metadata', async () => {
    const search = createMarketViewSearchModule({
      port: bySelector({ thematic: [dashboard('MD1')], portfolio: [entity('portfolio', 'MP1')] }),
      widget: { render: vi.fn() },
    });

    const outcome = await search.search({ query: 'q', selectors: ['thematic', 'portfolio'], limit: 5 });

    expect(outcome.ok && outcome.value.resultMetadata).toEqual([
      {
        entry: { kind: 'dashboard', identity: { dashboardId: 'MD1' }, title: 'MD1' },
        detail: { kind: 'dashboard', category: { kind: 'named', value: 'Thematic' }, widgetCount: 2 },
        url: 'https://marquee.gs.com/s/marketview/dashboards/MD1',
      },
      {
        entry: { kind: 'entity', identity: { kind: 'portfolio', entityId: 'MP1' }, label: 'MP1' },
        detail: { kind: 'entity', qualifiers: [] },
      },
    ]);
  });

  it('cancels the other discovery calls and reports the failing call', async () => {
    const signals: AbortSignal[] = [];
    const search = createMarketViewSearchModule({
      port: port(async (input) => {
        if (input.signal) signals.push(input.signal);
        if (input.selectors[0] === 'country') {
          return { ok: false, error: { kind: 'discovery-failed', failure: { kind: 'timeout' } } };
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { ok: true, value: { results: [] } };
      }),
      widget: { render: vi.fn() },
    });

    await expect(search.search({ query: 'q', selectors: ['semantic-widget', 'country'], limit: 5 })).resolves.toEqual({
      ok: false,
      error: { kind: 'discovery-failed', failure: { kind: 'timeout' } },
      evidence: { kind: 'discovery-call', index: 1, selectors: ['country'] },
    });
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it.each([1.5, -1, Number.NaN])('rejects a limit of %s before discovery', async (limit) => {
    const discover = vi.fn<MarketViewSearchPort['discover']>();
    const search = createMarketViewSearchModule({ port: port(discover), widget: { render: vi.fn() } });

    await expect(search.search({ query: 'q', selectors: ['asset'], limit })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-limit' },
    });
    expect(discover).not.toHaveBeenCalled();
  });

  it('accepts a limit of one', async () => {
    const search = createMarketViewSearchModule({ port: bySelector({}), widget: { render: vi.fn() } });

    await expect(search.search({ query: 'q', selectors: ['asset'], limit: 1 }))
      .resolves.toMatchObject({ ok: true });
  });
});
