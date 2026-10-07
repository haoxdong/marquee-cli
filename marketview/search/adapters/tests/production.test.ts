import { describe, expect, it, vi } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../../transport/index.js';
import { createMarketViewSearchProductionPort } from '../production.js';

function searchPort(
  resultsMap: Readonly<Record<string, unknown>>,
  recordAdapterFailure?: Parameters<typeof createMarketViewSearchProductionPort>[1],
) {
  return createMarketViewSearchProductionPort({
    async request() {
      return { resultsMap };
    },
  }, recordAdapterFailure);
}

describe('MarketView Search production adapter', () => {
  it('records decoder diagnostics outside the closed Search error', async () => {
    const recordAdapterFailure = vi.fn();
    const port = searchPort({ widgets: [{ data: { title: 'Missing identity' } }] }, recordAdapterFailure);

    await expect(port.discover({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
    expect(recordAdapterFailure).toHaveBeenCalledWith('discover', {
      kind: 'adapter-failure',
      message: 'Adapter "marketview.search" failed: Unsupported MarketView search response shape: widget entry missing id; record a Scenario before accepting this fallback.',
      selectors: ['keyword-widget'],
    });
  });

  it.each([
    [{ id: 'WC_SWAPPED', title: 'Swapped' }, 'widget entry id is malformed'],
    [{ id: 'MW_SWAPPED', title: 'Swapped', configurationId: 'MW_SWAPPED' }, 'widget entry configurationId is malformed'],
  ])('records a swapped Widget or Config ID as a decoder diagnostic', async (data, reason) => {
    const recordAdapterFailure = vi.fn();
    const port = searchPort({ widgets: [{ data }] }, recordAdapterFailure);

    await expect(port.discover({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toMatchObject({ ok: false, error: { kind: 'discovery-failed' } });
    expect(recordAdapterFailure).toHaveBeenCalledWith('discover', expect.objectContaining({
      message: `Adapter "marketview.search" failed: Unsupported MarketView search response shape: ${reason}; record a Scenario before accepting this fallback.`,
    }));
  });

  it('leaves provider diagnostics in the Transport evidence log', async () => {
    const recordAdapterFailure = vi.fn();
    const port = createMarketViewSearchProductionPort({
      async request() {
        throw new MarqueeError('http', 'Credential Service rejected MarketView Search', {
          status: 403,
          body: 'relink your Goldman account',
          credentialServiceCode: 'relink_required',
        });
      },
    }, recordAdapterFailure);

    await expect(port.discover({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
    expect(recordAdapterFailure).not.toHaveBeenCalled();
  });

  it('maps Search Widget dates and Selected Context directly', async () => {
    const widgetDefinition = {
      id: 'MW_DIRECT',
      metadata: { title: 'Direct Search Widget' },
      configurationId: 'WC_DIRECT',
      underlyingChartId: 'CH_DIRECT',
      contextParameter: {
        field: 'Asset',
        type: 'Asset',
        value: 'MA_STALE',
        values: { default: 'MA_DEFAULT' },
      },
      renderParams: {
        component: { tenor: '2y' },
        controls: [
          { id: 'Asset', value: 'MA_SELECTED' },
          { id: 'Relative Date', value: '6M' },
        ],
      },
      relativeDate: '6M',
      calculatedDates: {
        startDate: '2026-01-30',
        endDate: '2026-07-30',
        interval: '1D',
      },
    };
    const port = searchPort({
      widgets: [{ data: widgetDefinition }],
    });

    await expect(port.discover({
      query: 'direct',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      ok: true,
      value: {
        results: [{
          type: 'widget',
          widgetId: 'MW_DIRECT',
          title: 'Direct Search Widget',
          configurationId: 'WC_DIRECT',
          parameterLines: [],
          widgetDefinition,
          parameters: [{ field: 'tenor', value: '2y' }],
          selectedContext: 'MA_SELECTED',
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

  it('uses a Search Widget context default when no render assignment is present', async () => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_DEFAULT_CONTEXT',
          title: 'Default context',
          underlyingChartId: 'CH_DEFAULT_CONTEXT',
          contextParameter: {
            field: 'Asset',
            type: 'Asset',
            values: { default: 'MA_DEFAULT' },
          },
          renderParams: { controls: [] },
        },
      }],
    });

    await expect(port.discover({
      query: 'default context',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [{
          widgetId: 'MW_DEFAULT_CONTEXT',
          parameters: [],
          selectedContext: 'MA_DEFAULT',
        }],
      },
    });
  });

  it.each([
    [[], { default: 'MA_DEFAULT' }, {}, 'MA_DEFAULT'],
    [['UA'], { default: 'UA' }, { elementType: '' }, 'UA'],
  ])(
    'uses a fieldless Search Widget context default as its Selected Context: %j %j %j',
    async (options, values, extraContext, selectedContext) => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_FIELDLESS_CONTEXT',
          title: 'Fieldless context',
          underlyingChartId: 'CH_FIELDLESS_CONTEXT',
          contextParameter: {
            field: '',
            options,
            values,
            ...extraContext,
          },
          renderParams: { controls: [] },
        },
      }],
    });

    await expect(port.discover({
      query: 'fieldless context',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [{
          widgetId: 'MW_FIELDLESS_CONTEXT',
          parameters: [],
          selectedContext,
        }],
      },
    });
    },
  );

  it('does not promote a sole context option to a selected value', async () => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_SOLE_CONTEXT_OPTION',
          title: 'Sole context option',
          underlyingChartId: 'CH_SOLE_CONTEXT_OPTION',
          contextParameter: {
            field: 'Asset',
            type: 'Asset',
            options: ['MA_ONLY'],
            values: {},
          },
          renderParams: { controls: [] },
        },
      }],
    });

    await expect(port.discover({
      query: 'sole context option',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [{
          widgetId: 'MW_SOLE_CONTEXT_OPTION',
          parameters: [],
          selectedContext: null,
        }],
      },
    });
  });

  it('preserves the search request and translates provider results', async () => {
    const request = vi.fn(async () => ({
      requestId: 'request-1',
      resultsMap: {
        widgets: [{
          data: {
            id: 'MW_WIDGET',
            metadata: { title: 'Carry widget' },
            configurationId: 'WC_WIDGET',
            underlyingChartId: 'CH_WIDGET',
            contextParameter: {
              field: 'Asset',
              type: 'Asset',
              value: 'MA_SELECTED',
            },
            parameters: [{ field: 'tenor', type: 'Enum' }],
            renderParams: {
              component: { tenor: '2y' },
              controls: [{ id: 'Asset', value: 'MA_SELECTED' }],
            },
            relativeDate: '6M',
          },
        }],
        assets: [{
          data: {
            id: 'MA_ASSET',
            name: 'Apple',
            type: 'Single Stock',
            assetClass: 'Equity',
            ticker: 'AAPL',
          },
        }],
      },
    }));
    const port = createMarketViewSearchProductionPort({ request });
    const signal = new AbortController().signal;

    await expect(port.discover({
      query: '  AAPL carry  ',
      selectors: ['keyword-widget', 'asset'],
      limit: 7,
      signal,
    })).resolves.toEqual({
      ok: true,
      value: {
        results: [
          {
            type: 'widget',
            widgetId: 'MW_WIDGET',
            title: 'Carry widget',
            configurationId: 'WC_WIDGET',
            parameterLines: [],
            widgetDefinition: expect.objectContaining({
              id: 'MW_WIDGET',
              underlyingChartId: 'CH_WIDGET',
            }),
            parameters: [{ field: 'tenor', value: '2y' }],
            selectedContext: 'MA_SELECTED',
          },
          {
            type: 'entity',
            entityKind: 'asset',
            entityId: 'MA_ASSET',
            label: 'Apple',
            qualifiers: ['Equity', 'Single Stock', 'AAPL'],
            url: 'https://marquee.gs.com/s/marketview/asset/MA_ASSET',
          },
        ],
      },
    });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/search' }, {
      query: {
        query: '  AAPL carry  ',
        types: ['Widget', 'Asset'],
        limit: 7,
        useNewSchema: false,
        combineSearchResults: false,
      },
      hedgeDelaysMs: [1000],
      signal,
    });
  });

  it('requests the Dashboard LLM pool in Web shape beside the keyword sources', async () => {
    const request = vi.fn(async (_endpoint: Endpoint, init?: { query?: Readonly<Record<string, unknown>> }) => (
      (init?.query?.types as string[]).includes('Dashboard LLM')
        ? {
            totalResults: 10,
            resultsMap: {
              dashboards_llm: [{
                type: 'Dashboard LLM',
                data: {
                  id: 'MD_WEB',
                  title: 'Web Dashboard',
                  type: 'Dashboard',
                  children: [],
                  alias: 'web-dashboard',
                },
              }, {
                type: 'Dashboard LLM',
                data: {
                  id: 'MD_WEB_2',
                  title: 'Second Web Dashboard',
                  type: 'Dashboard',
                  children: [],
                  alias: 'second-web-dashboard',
                },
              }],
            },
          }
        : {
            requestId: 'keyword-request',
            totalResults: 22,
            resultsMap: { assets: [{ data: { id: 'MA_ASSET', name: 'Asset' } }] },
          }
    ));
    const port = createMarketViewSearchProductionPort({ request });

    const discovered = await port.discover({
      query: 'Fed rate cuts',
      selectors: ['web-dashboard', 'asset'],
      limit: 1,
    });

    expect(request.mock.calls.map(([, init]) => init?.query)).toEqual([
      {
        query: 'Fed rate cuts',
        types: ['Asset'],
        limit: 1,
        useNewSchema: false,
        combineSearchResults: false,
      },
      { query: 'Fed rate cuts', types: ['Dashboard LLM'], combineSearchResults: false },
    ]);
    expect(discovered).toMatchObject({
      ok: true,
      value: {
        results: [
          { type: 'dashboard', dashboardId: 'MD_WEB', category: { kind: 'thematic' } },
          { type: 'entity', entityKind: 'asset', entityId: 'MA_ASSET' },
        ],
      },
    });
  });

  it('sends the Dashboard LLM limit only past Web\'s page of 10', async () => {
    const request = vi.fn(async () => ({ totalResults: 0, resultsMap: {} }));
    const port = createMarketViewSearchProductionPort({ request });

    await port.discover({ query: 'rates', selectors: ['web-dashboard'], limit: 20 });

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/search' }, expect.objectContaining({
      query: { query: 'rates', types: ['Dashboard LLM'], limit: 20, combineSearchResults: false },
    }));
  });

  it('fails loud when the Dashboard LLM request fails beside keyword sources', async () => {
    const port = createMarketViewSearchProductionPort({
      async request(_path, init) {
        if ((init?.query?.types as string[]).includes('Dashboard LLM')) {
          throw new MarqueeError('http', 'Dashboard LLM unavailable', { status: 503 });
        }
        return { totalResults: 0, resultsMap: {} };
      },
    });

    await expect(port.discover({
      query: 'rates',
      selectors: ['web-dashboard', 'asset'],
      limit: 2,
    })).resolves.toEqual({
      ok: false,
      error: { kind: 'discovery-failed', failure: { kind: 'unavailable' } },
    });
  });

  it('applies the result limit independently to each requested source', async () => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_WIDGET',
          title: 'Widget',
          configurationId: 'WC_WIDGET',
          underlyingChartId: 'CH_WIDGET',
        },
      }],
      dashboards: [{
        data: {
          id: 'MD_DASHBOARD',
          title: 'Dashboard',
          type: 'Dashboard',
          children: [],
          alias: 'dashboard',
        },
      }],
      assets: [{
        data: {
          id: 'MA_ASSET',
          name: 'Asset',
        },
      }],
      countries: [{
        data: {
          id: 'COUNTRY',
          name: 'Country',
        },
      }],
      portfolios: [{
        data: {
          id: 'MP_PORTFOLIO',
          name: 'Portfolio',
        },
      }],
    });

    await expect(port.discover({
      query: 'multi-source',
      selectors: [
        'keyword-widget',
        'thematic',
        'asset',
        'country',
        'portfolio',
      ],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [
          { type: 'widget', widgetId: 'MW_WIDGET' },
          { type: 'dashboard', dashboardId: 'MD_DASHBOARD' },
          { type: 'entity', entityKind: 'asset', entityId: 'MA_ASSET' },
          { type: 'entity', entityKind: 'country', entityId: 'COUNTRY' },
          { type: 'entity', entityKind: 'portfolio', entityId: 'MP_PORTFOLIO' },
        ],
      },
    });
  });

  it('uses the provider URL when a Dashboard alias is exactly empty', async () => {
    const port = searchPort({
      dashboards: [{
        data: {
          id: 'MD_EMPTY_ALIAS',
          title: 'Empty alias Dashboard',
          type: 'Thematic',
          children: [],
          alias: '',
          url: '/s/marketview/dashboards/MD_EMPTY_ALIAS',
        },
      }],
    });

    await expect(port.discover({
      query: 'empty alias',
      selectors: ['thematic'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [{
          type: 'dashboard',
          dashboardId: 'MD_EMPTY_ALIAS',
          url: 'https://marquee.gs.com/s/marketview/dashboards/MD_EMPTY_ALIAS',
        }],
      },
    });
  });

  it.each([
    { alias: '', url: undefined },
    { alias: '   ', url: '/s/marketview/dashboards/MD_BAD_ALIAS' },
  ])('fails loud outside the exact empty-alias fallback: %j', async ({ alias, url }) => {
    const port = searchPort({
      dashboards: [{
        data: {
          id: 'MD_BAD_ALIAS',
          title: 'Bad alias Dashboard',
          type: 'Thematic',
          children: [],
          alias,
          url,
        },
      }],
    });

    await expect(port.discover({
      query: 'bad alias',
      selectors: ['thematic'],
      limit: 1,
    })).resolves.toMatchObject({ ok: false });
  });

  it('preserves requested source order in one provider response', async () => {
    const port = searchPort({
      assets: [{
        data: {
          id: 'MA_ASSET',
          name: 'Asset',
        },
      }],
      countries: [{
        data: {
          id: 'COUNTRY',
          name: 'Country',
        },
      }],
    });

    await expect(port.discover({
      query: 'ordered sources',
      selectors: ['country', 'asset'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [
          { entityKind: 'country', entityId: 'COUNTRY' },
          { entityKind: 'asset', entityId: 'MA_ASSET' },
        ],
      },
    });
  });

  it('fails loud on a malformed unrequested source after ordered sources', async () => {
    const port = searchPort({
      countries: [{
        data: {
          id: 'COUNTRY',
          name: 'Country',
        },
      }],
      portfolios: [{
        data: { name: 'Malformed Portfolio' },
      }],
    });

    await expect(port.discover({
      query: 'validate remainder',
      selectors: ['country'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
  });

  it('projects every requested Widget mode from one provider response', async () => {
    const request = vi.fn(async () => ({
      resultsMap: {
        widgets: [{
          data: {
            id: 'MW_SHARED',
            title: 'Keyword Widget',
            configurationId: 'WC_KEYWORD',
            underlyingChartId: 'CH_KEYWORD',
          },
        }],
        widgets_llm: [{
          data: {
            id: 'MW_SHARED',
            title: 'Semantic Widget',
            configurationId: 'WC_SEMANTIC',
            underlyingChartId: 'CH_SEMANTIC',
          },
        }],
        widgets_ranked: [{
          data: {
            id: 'MW_SHARED',
            title: 'Ranked Widget',
            configurationId: 'WC_RANKED',
            underlyingChartId: 'CH_RANKED',
          },
        }],
      },
    }));
    const port = createMarketViewSearchProductionPort({ request });

    await expect(port.discover({
      query: 'multi-mode',
      selectors: ['hybrid-widget', 'keyword-widget', 'semantic-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [
          { widgetId: 'MW_SHARED', searchMode: 'llm-reranked' },
          { widgetId: 'MW_SHARED', searchMode: 'keyword' },
          { widgetId: 'MW_SHARED', searchMode: 'semantic' },
        ],
      },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('uses keyword and semantic buckets as the multi-mode hybrid fallback', async () => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_KEYWORD',
          title: 'Keyword Widget',
          configurationId: 'WC_KEYWORD',
          underlyingChartId: 'CH_KEYWORD',
        },
      }],
      widgets_llm: [{
        data: {
          id: 'MW_SEMANTIC',
          title: 'Semantic Widget',
          configurationId: 'WC_SEMANTIC',
          underlyingChartId: 'CH_SEMANTIC',
        },
      }],
    });

    await expect(port.discover({
      query: 'hybrid fallback',
      selectors: ['keyword-widget', 'semantic-widget', 'hybrid-widget'],
      limit: 2,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [
          { widgetId: 'MW_KEYWORD', searchMode: 'keyword' },
          { widgetId: 'MW_SEMANTIC', searchMode: 'semantic' },
          { widgetId: 'MW_KEYWORD', searchMode: 'llm-reranked' },
          { widgetId: 'MW_SEMANTIC', searchMode: 'llm-reranked' },
        ],
      },
    });
  });

  it('fails loud on a duplicate Widget identity within one requested mode', async () => {
    const duplicate = {
      data: {
        id: 'MW_DUPLICATE',
        title: 'Duplicate Widget',
        configurationId: 'WC_DUPLICATE',
        underlyingChartId: 'CH_DUPLICATE',
      },
    };
    const port = searchPort({
      widgets: [duplicate, duplicate],
      widgets_llm: [],
    });

    await expect(port.discover({
      query: 'duplicate',
      selectors: ['keyword-widget', 'semantic-widget'],
      limit: 2,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
  });

  it('fails loud on malformed provider entries beyond the result limit', async () => {
    const port = searchPort({
      assets: [
        { data: { id: 'MA_VISIBLE', name: 'Visible Asset' } },
        { data: { name: 'Malformed Asset' } },
      ],
    });

    await expect(port.discover({
      query: 'malformed tail',
      selectors: ['asset'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
  });

  it('fails loud on an unsupported provider shape', async () => {
    const port = searchPort({ widgets: [{ data: { title: 'Missing identity' } }] });

    await expect(port.discover({
      query: 'carry',
      selectors: ['keyword-widget'],
      limit: 5,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
  });

  it('maps an unconfigured Widget without inventing configuration identity', async () => {
    const widgetDefinition = {
      id: 'MW_UNCONFIGURED',
      title: 'Unconfigured Widget',
      underlyingChartId: 'CH_UNCONFIGURED',
    };
    const port = searchPort({
      widgets: [{
        data: widgetDefinition,
      }],
    });

    await expect(port.discover({
      query: 'unconfigured',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [{
          widgetId: 'MW_UNCONFIGURED',
          configurationId: null,
          widgetDefinition,
          parameters: [],
          selectedContext: null,
        }],
      },
    });
  });

  it.each([
    [[], {}, {}],
    [[], { default: '' }, {}],
    [[], {}, { type: 'Asset' }],
    [['MA_LIVE_OPTION'], { default: '' }, {}],
    [['MA_LIVE_OPTION'], { default: '' }, { elementType: '' }],
    [['MA_LIVE_OPTION', 'KR'], {}, { elementType: '' }],
    [['MA_LIVE_OPTION', 'KR'], { default: '' }, {}],
  ])(
    'maps fieldless Search context state to no Selected Context: %j %j %j',
    async (options, values, extraContext) => {
      const port = searchPort({
        widgets: [{
          data: {
            id: 'MW_EMPTY_CONTEXT',
            title: 'Empty context',
            underlyingChartId: 'CH_EMPTY_CONTEXT',
            contextParameter: {
              field: '',
              options,
              values,
              ...extraContext,
            },
            renderParams: { controls: [] },
          },
        }],
      });

      await expect(port.discover({
        query: 'empty context',
        selectors: ['keyword-widget'],
        limit: 1,
      })).resolves.toMatchObject({
        ok: true,
        value: {
          results: [{
            widgetId: 'MW_EMPTY_CONTEXT',
            parameters: [],
            selectedContext: null,
          }],
        },
      });
    },
  );

  it.each([
    { id: 'tenor' },
    { id: 'tenor', default: '1y' },
  ])(
    'preserves the selected component value in whole Widget Definition: %j',
    async (control) => {
      const port = searchPort({
        widgets: [{
          data: {
            id: 'MW_SELECTED_COMPONENT',
            title: 'Selected component',
            underlyingChartId: 'CH_SELECTED_COMPONENT',
            renderParams: {
              component: { tenor: '2y' },
              controls: [control],
            },
          },
        }],
      });

      await expect(port.discover({
        query: 'selected component',
        selectors: ['keyword-widget'],
        limit: 1,
      })).resolves.toMatchObject({
        ok: true,
        value: {
          results: [{
            parameters: [{ field: 'tenor', value: '2y' }],
            widgetDefinition: {
              renderParams: {
                component: { tenor: '2y' },
              },
            },
          }],
        },
      });
    },
  );

  it.each([7, { id: 'WC_OBJECT' }, '   '])(
    'fails loud when a present configuration identity is malformed: %j',
    async (configurationId) => {
      const port = searchPort({
        widgets: [{
          data: {
            id: 'MW_BAD_CONFIGURATION',
            title: 'Malformed Config',
            configurationId,
            underlyingChartId: 'CH_BAD_CONFIGURATION',
          },
        }],
      });

      await expect(port.discover({
        query: 'malformed configuration',
        selectors: ['keyword-widget'],
        limit: 1,
      })).resolves.toEqual({
        ok: false,
        error: {
          kind: 'discovery-failed',
          failure: { kind: 'unavailable' },
        },
      });
    },
  );

  it.each([
    {
      field: 'calculatedDates',
      value: { startDate: '2026-01-30', endDate: '2026-07-30' },
      problem: 'widget entry calculatedDates.interval is malformed',
    },
    {
      field: 'contextParameter',
      value: [],
      problem: 'widget entry contextParameter is malformed',
    },
    {
      field: 'contextParameter',
      value: { field: '', options: [], values: [] },
      problem: 'widget entry contextParameter.values is malformed',
    },
    {
      field: 'contextParameter',
      value: { field: '', options: [{ id: 'MA_BAD' }], values: {} },
      problem: 'widget entry contextParameter.options is malformed',
    },
    {
      field: 'contextParameter',
      value: { field: '', options: ['   '], values: {} },
      problem: 'widget entry contextParameter.options is malformed',
    },
    {
      field: 'contextParameter',
      value: { field: '', options: [], values: {}, elementType: null },
      problem: 'widget entry contextParameter.elementType is malformed',
    },
    {
      field: 'contextParameter',
      value: { field: '', options: [], values: {}, value: 'MA_SELECTED' },
      problem: 'widget entry contextParameter.value is malformed',
    },
    {
      field: 'contextParameter',
      value: { field: 'Asset', value: { id: 'MA_BAD' } },
      problem: 'widget entry contextParameter.value is malformed',
    },
  ])('fails loud when $field is malformed', async ({ field, value, problem: _problem }) => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_MALFORMED',
          title: 'Malformed Widget',
          configurationId: 'WC_MALFORMED',
          underlyingChartId: 'CH_MALFORMED',
          [field]: value,
        },
      }],
    });

    await expect(port.discover({
      query: 'malformed',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
  });

  it('skips anonymous empty-id render controls the provider ships', async () => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_ANONYMOUS_CONTROL',
          title: 'Anonymous control',
          configurationId: 'WC_ANONYMOUS_CONTROL',
          underlyingChartId: 'CH_ANONYMOUS_CONTROL',
          renderParams: {
            controls: [
              { id: '', type: 'Enum', value: '1y' },
              { id: 'Asset', value: 'MA_SELECTED' },
            ],
          },
        },
      }],
    });

    await expect(port.discover({
      query: 'anonymous control',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        results: [{
          widgetId: 'MW_ANONYMOUS_CONTROL',
          parameters: [{ field: 'Asset', value: 'MA_SELECTED' }],
        }],
      },
    });
  });

  it.each([
    {
      control: { value: 'MA_ONE' },
      problem: 'widget entry renderParams control missing field',
    },
    {
      control: { field: '', id: 'Asset', value: 'MA_ONE' },
      problem: 'widget entry renderParams control missing field',
    },
    {
      control: { field: 7, id: '', value: 'MA_ONE' },
      problem: 'widget entry renderParams control missing field',
    },
    {
      control: { field: '', id: 7, value: 'MA_ONE' },
      problem: 'widget entry renderParams control missing field',
    },
    {
      control: { id: 7, value: 'MA_ONE' },
      problem: 'widget entry renderParams control missing field',
    },
    {
      control: { id: 'Asset' },
      problem: 'widget entry renderParams control Asset missing value',
    },
  ])('fails loud when a render control is malformed: $problem', async ({
    control,
    problem: _problem,
  }) => {
    const port = searchPort({
      widgets: [{
        data: {
          id: 'MW_MALFORMED_CONTROL',
          title: 'Malformed control',
          configurationId: 'WC_MALFORMED_CONTROL',
          underlyingChartId: 'CH_MALFORMED_CONTROL',
          renderParams: { controls: [control] },
        },
      }],
    });

    await expect(port.discover({
      query: 'malformed',
      selectors: ['keyword-widget'],
      limit: 1,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'discovery-failed',
        failure: { kind: 'unavailable' },
      },
    });
  });
});

describe('MarketView Search production adapter translation', () => {
  type Input = Parameters<ReturnType<typeof createMarketViewSearchProductionPort>['discover']>[0];

  function respond(response: unknown) {
    const request = vi.fn(async (_endpoint: Endpoint, _init?: unknown) => response);
    return { request, port: createMarketViewSearchProductionPort({ request }) };
  }

  async function discover(response: unknown, input: Partial<Input> = {}) {
    return respond(response).port.discover({
      query: 'q',
      selectors: ['keyword-widget'],
      limit: 5,
      ...input,
    });
  }

  const unavailable = {
    ok: false,
    error: { kind: 'discovery-failed', failure: { kind: 'unavailable' } },
  };

  function widgetData(extra: Record<string, unknown> = {}) {
    return { id: 'MW_A', title: 'A', ...extra };
  }

  async function decodedWidget(extra: Record<string, unknown>) {
    const outcome = await discover({ resultsMap: { widgets: [{ data: widgetData(extra) }] } });
    if (!outcome.ok) throw new Error(`expected a decoded Widget, got ${JSON.stringify(outcome)}`);
    return outcome.value.results[0];
  }

  it.each([
    [['keyword-widget'], ['Widget'], false],
    [['semantic-widget'], ['Widget LLM'], false],
    [['hybrid-widget'], ['Widget', 'Widget LLM', 'Widget Ranked'], true],
    [['keyword-widget', 'hybrid-widget'], ['Widget', 'Widget LLM', 'Widget Ranked'], true],
    [['thematic'], ['Dashboard'], false],
    [['asset'], ['Asset'], false],
    [['country'], ['Country'], false],
    [['portfolio'], ['Portfolio'], false],
  ] as const)('requests %j as provider types %j with new schema %s', async (selectors, types, useNewSchema) => {
    const { request, port } = respond({ resultsMap: {} });

    await port.discover({ query: 'q', selectors, limit: 3 });

    expect(request).toHaveBeenCalledExactlyOnceWith(
      { method: 'GET', path: '/v1/marketview/search' },
      {
        query: { query: 'q', types, limit: 3, useNewSchema, combineSearchResults: false },
        hedgeDelaysMs: [1000],
      },
    );
  });

  it('omits the Dashboard LLM limit at Web\'s page of 10', async () => {
    const { request, port } = respond({ resultsMap: {} });

    await port.discover({ query: 'q', selectors: ['web-dashboard'], limit: 10 });

    expect(request.mock.calls.map(([, init]) => init)).toEqual([{
      query: { query: 'q', types: ['Dashboard LLM'], combineSearchResults: false },
      hedgeDelaysMs: [1000],
    }]);
  });

  it('decodes a sole Dashboard LLM response', async () => {
    await expect(discover({
      resultsMap: {
        dashboards_llm: [{ data: { id: 'MD_WEB', title: 'Web', type: 'Dashboard', children: [], alias: 'web' } }],
      },
    }, { selectors: ['web-dashboard'] })).resolves.toMatchObject({
      ok: true,
      value: { results: [{ dashboardId: 'MD_WEB', url: 'https://marquee.gs.com/s/marketview/dashboards/web' }] },
    });
  });

  it.each([
    ['a missing resultsMap', {}],
    ['a null resultsMap', { resultsMap: null }],
    ['an array resultsMap', { resultsMap: [] }],
    ['a non-array bucket', { resultsMap: { widgets: {} } }],
    ['a non-object entry', { resultsMap: { widgets: [7] } }],
    ['an array entry', { resultsMap: { widgets: [[]] } }],
    ['an entry without data', { resultsMap: { widgets: [{}] } }],
    ['a blank Widget id', { resultsMap: { widgets: [{ data: widgetData({ id: '   ' }) }] } }],
    ['a Widget without a title', { resultsMap: { widgets: [{ data: { id: 'MW_A' } }] } }],
  ])('fails loud on %s', async (_label, response) => {
    await expect(discover(response)).resolves.toEqual(unavailable);
  });

  it('prefers the metadata title and trims it', async () => {
    await expect(decodedWidget({ title: 'Data title', metadata: { title: '  Meta title  ' } }))
      .resolves.toMatchObject({ title: 'Meta title' });
  });

  it('falls back to the data title when metadata is not an object', async () => {
    await expect(decodedWidget({ title: ' Data title ', metadata: 'Meta title' }))
      .resolves.toMatchObject({ title: 'Data title' });
  });

  it('reads render assignments from value, then default, then values.default', async () => {
    await expect(decodedWidget({
      renderParams: {
        controls: [
          { id: 'value', value: 'V', default: 'D', values: { default: 'VD' } },
          { id: 'default', default: 'D', values: { default: 'VD' } },
          { id: 'values', values: { default: 'VD' } },
          { field: 'field', id: 'ignored', value: 'F' },
        ],
      },
    })).resolves.toMatchObject({
      parameters: [
        { field: 'value', value: 'V' },
        { field: 'default', value: 'D' },
        { field: 'values', value: 'VD' },
        { field: 'field', value: 'F' },
      ],
    });
  });

  it.each([
    ['a non-object values', { id: 'tenor', values: 'VD' }],
    ['an empty values', { id: 'tenor', values: {} }],
  ])('fails loud on a render control with %s and no value', async (_label, control) => {
    await expect(discover({
      resultsMap: { widgets: [{ data: widgetData({ renderParams: { controls: [control] } }) }] },
    })).resolves.toEqual(unavailable);
  });

  it('keeps a falsy explicit control value', async () => {
    await expect(decodedWidget({ renderParams: { controls: [{ id: 'flag', value: false }] } }))
      .resolves.toMatchObject({ parameters: [{ field: 'flag', value: false }] });
  });

  it.each([
    ['null renderParams', { renderParams: null }],
    ['null component and controls', { renderParams: { component: null, controls: null } }],
    ['no component or controls', { renderParams: {} }],
  ])('maps %s to no parameters', async (_label, extra) => {
    await expect(decodedWidget(extra)).resolves.toMatchObject({ parameters: [] });
  });

  it('keeps component assignments when controls are absent', async () => {
    await expect(decodedWidget({ renderParams: { component: { tenor: '2y' } } }))
      .resolves.toMatchObject({ parameters: [{ field: 'tenor', value: '2y' }] });
  });

  it.each([
    ['a non-object renderParams', { renderParams: [] }],
    ['a non-object component', { renderParams: { component: 'tenor' } }],
    ['non-array controls', { renderParams: { controls: {} } }],
    ['a non-object control', { renderParams: { controls: ['tenor'] } }],
    ['an empty control field', { renderParams: { controls: [{ field: '', value: 'V' }] } }],
  ])('fails loud on %s', async (_label, extra) => {
    await expect(discover({ resultsMap: { widgets: [{ data: widgetData(extra) }] } }))
      .resolves.toEqual(unavailable);
  });

  it('maps calculated dates without a relative date', async () => {
    await expect(decodedWidget({
      calculatedDates: { startDate: '2026-01-30', endDate: '2026-07-30', interval: '1D' },
    })).resolves.toEqual(expect.objectContaining({
      widgetDates: { startDate: '2026-01-30', endDate: '2026-07-30', interval: '1D' },
    }));
  });

  it('maps null calculated dates to no Widget Dates', async () => {
    await expect(decodedWidget({ calculatedDates: null, relativeDate: '6M' }))
      .resolves.not.toHaveProperty('widgetDates');
  });

  it.each([
    ['a non-object', 'dates'],
    ['a blank start date', { startDate: ' ', endDate: '2026-07-30', interval: '1D' }],
    ['a missing end date', { startDate: '2026-01-30', interval: '1D' }],
  ])('fails loud on calculated dates with %s', async (_label, calculatedDates) => {
    await expect(discover({ resultsMap: { widgets: [{ data: widgetData({ calculatedDates }) }] } }))
      .resolves.toEqual(unavailable);
  });

  it('takes the relative date from the last Relative Date control and drops it from parameters', async () => {
    await expect(decodedWidget({
      renderParams: {
        controls: [
          { id: 'relative date', value: '1Y' },
          { id: 'tenor', value: '2y' },
          { id: 'RELATIVE\tDATE', value: '2Y' },
          { id: 'Relative  Date', value: '3M' },
          { id: 'Relative Dates', value: 'kept' },
          { id: 'My Relative Date', value: 'kept too' },
        ],
      },
      calculatedDates: { startDate: '2026-01-30', endDate: '2026-07-30', interval: '1D' },
    })).resolves.toMatchObject({
      parameters: [
        { field: 'tenor', value: '2y' },
        { field: 'Relative Dates', value: 'kept' },
        { field: 'My Relative Date', value: 'kept too' },
      ],
      widgetDates: { relativeDate: '3M' },
    });
  });

  it('prefers the provider relative date over a Relative Date control', async () => {
    await expect(decodedWidget({
      relativeDate: '6M',
      renderParams: { controls: [{ id: 'Relative Date', value: '1Y' }] },
      calculatedDates: { startDate: '2026-01-30', endDate: '2026-07-30', interval: '1D' },
    })).resolves.toMatchObject({ widgetDates: { relativeDate: '6M' } });
  });

  it('maps a null relative date to Widget Dates without one', async () => {
    await expect(decodedWidget({
      relativeDate: null,
      calculatedDates: { startDate: '2026-01-30', endDate: '2026-07-30', interval: '1D' },
    })).resolves.toEqual(expect.objectContaining({
      widgetDates: { startDate: '2026-01-30', endDate: '2026-07-30', interval: '1D' },
    }));
  });

  it('maps a null configuration identity to none', async () => {
    await expect(decodedWidget({ configurationId: null }))
      .resolves.toMatchObject({ configurationId: null });
  });

  it.each([
    ['a non-string relative date', { relativeDate: 6 }],
    ['a null Relative Date control', { renderParams: { controls: [{ id: 'Relative Date', value: null }] } }],
  ])('fails loud on %s', async (_label, extra) => {
    await expect(discover({
      resultsMap: { widgets: [{ data: widgetData(extra) }] },
    })).resolves.toEqual(unavailable);
  });

  it('takes the last render assignment of the context field and drops it from parameters', async () => {
    await expect(decodedWidget({
      contextParameter: { field: 'Asset', value: 'MA_PROVIDER' },
      renderParams: {
        controls: [
          { id: 'Asset', value: 'MA_FIRST' },
          { id: 'tenor', value: '2y' },
          { id: 'Asset', value: 'MA_LAST' },
        ],
      },
    })).resolves.toMatchObject({
      parameters: [{ field: 'tenor', value: '2y' }],
      selectedContext: 'MA_LAST',
    });
  });

  it('uses the provider context value when no assignment names the field', async () => {
    await expect(decodedWidget({
      contextParameter: { field: 'Asset', value: 'MA_PROVIDER', values: { default: 'MA_DEFAULT' } },
    })).resolves.toMatchObject({ selectedContext: 'MA_PROVIDER' });
  });

  it.each([
    ['a null default', { values: { default: null } }],
    ['an empty value', { value: '', values: { default: 'MA_DEFAULT' } }],
  ])('maps a context with %s to no Selected Context', async (_label, extra) => {
    await expect(decodedWidget({ contextParameter: { field: 'Asset', ...extra } }))
      .resolves.toMatchObject({ selectedContext: null });
  });

  it('ignores non-object context values', async () => {
    await expect(decodedWidget({ contextParameter: { field: 'Asset', value: 'MA', values: 'MA_IGNORED' } }))
      .resolves.toMatchObject({ selectedContext: 'MA' });
  });

  it('maps a null contextParameter to no Selected Context', async () => {
    await expect(decodedWidget({ contextParameter: null }))
      .resolves.toMatchObject({ selectedContext: null });
  });

  it.each([
    ['a missing field', { value: 'MA' }],
    ['a blank field', { field: '  ', value: 'MA' }],
  ])('fails loud on a contextParameter with %s', async (_label, contextParameter) => {
    await expect(discover({ resultsMap: { widgets: [{ data: widgetData({ contextParameter }) }] } }))
      .resolves.toEqual(unavailable);
  });

  it.each([
    ['a non-array options', { field: '', options: 'UA', values: {} }],
    ['a numeric elementType', { field: '', options: [], values: {}, elementType: 7 }],
    ['a non-string default', { field: '', options: [], values: { default: 7 } }],
  ])('fails loud on a fieldless contextParameter with %s', async (_label, contextParameter) => {
    await expect(discover({ resultsMap: { widgets: [{ data: widgetData({ contextParameter }) }] } }))
      .resolves.toEqual(unavailable);
  });

  it.each([
    ['a string elementType and null value', { elementType: 'Asset', value: null }],
    ['an empty value', { value: '' }],
  ])('accepts a fieldless contextParameter with %s', async (_label, extra) => {
    await expect(decodedWidget({
      contextParameter: { field: '', options: [], values: { default: 'UA' }, ...extra },
    })).resolves.toMatchObject({ selectedContext: 'UA' });
  });

  it('maps a null fieldless default to no Selected Context', async () => {
    await expect(decodedWidget({ contextParameter: { field: '', options: [], values: { default: null } } }))
      .resolves.toMatchObject({ selectedContext: null });
  });

  it('keeps a fieldless context out of parameter filtering', async () => {
    await expect(decodedWidget({
      contextParameter: { field: '', options: [], values: { default: 'UA' } },
      renderParams: { component: { tenor: '2y' } },
    })).resolves.toMatchObject({ parameters: [{ field: 'tenor', value: '2y' }], selectedContext: 'UA' });
  });

  it('reads each mode\'s own bucket among several Widget modes', async () => {
    const outcome = await discover({
      resultsMap: {
        widgets: [{ data: { id: 'MW_KEYWORD', title: 'Keyword' } }],
        widgets_llm: [{ data: { id: 'MW_SEMANTIC', title: 'Semantic' } }],
      },
    }, { selectors: ['semantic-widget', 'keyword-widget'] });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [
          { widgetId: 'MW_SEMANTIC', searchMode: 'semantic' },
          { widgetId: 'MW_KEYWORD', searchMode: 'keyword' },
        ],
      },
    });
  });

  it('prefers the ranked bucket for a sole hybrid mode', async () => {
    const outcome = await discover({
      resultsMap: {
        widgets: [{ data: { id: 'MW_KEYWORD', title: 'Keyword' } }],
        widgets_ranked: [{ data: { id: 'MW_RANKED', title: 'Ranked' } }],
      },
    }, { selectors: ['hybrid-widget'] });

    expect(outcome).toEqual({
      ok: true,
      value: { results: [expect.objectContaining({ widgetId: 'MW_RANKED' })] },
    });
    expect(outcome.ok && outcome.value.results[0]).not.toHaveProperty('searchMode');
  });

  it('falls back to keyword then semantic buckets for a sole hybrid mode without ranked results', async () => {
    const outcome = await discover({
      resultsMap: {
        widgets: [{ data: { id: 'MW_KEYWORD', title: 'Keyword' } }],
        widgets_llm: [{ data: { id: 'MW_SEMANTIC', title: 'Semantic' } }],
        widgets_ranked: [],
      },
    }, { selectors: ['hybrid-widget'] });

    expect(outcome).toEqual({
      ok: true,
      value: {
        results: [
          expect.objectContaining({ widgetId: 'MW_KEYWORD' }),
          expect.objectContaining({ widgetId: 'MW_SEMANTIC' }),
        ],
      },
    });
  });

  it('reads every Widget bucket in order for a sole keyword mode', async () => {
    const outcome = await discover({
      resultsMap: {
        widgets_ranked: [{ data: { id: 'MW_RANKED', title: 'Ranked' } }],
        widgets_llm: [{ data: { id: 'MW_SEMANTIC', title: 'Semantic' } }],
        widgets: [{ data: { id: 'MW_KEYWORD', title: 'Keyword' } }],
      },
    });

    expect(outcome.ok && outcome.value.results.map((entry) => entry.type === 'widget' && entry.widgetId))
      .toEqual(['MW_KEYWORD', 'MW_SEMANTIC', 'MW_RANKED']);
  });

  it('prefers ranked results for hybrid among several Widget modes', async () => {
    const outcome = await discover({
      resultsMap: {
        widgets: [{ data: { id: 'MW_KEYWORD', title: 'Keyword' } }],
        widgets_ranked: [{ data: { id: 'MW_RANKED', title: 'Ranked' } }],
      },
    }, { selectors: ['hybrid-widget', 'keyword-widget'] });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [
          { widgetId: 'MW_RANKED', searchMode: 'llm-reranked' },
          { widgetId: 'MW_KEYWORD', searchMode: 'keyword' },
        ],
      },
    });
  });

  it('fails loud on a duplicate Widget identity for a sole mode', async () => {
    const entry = { data: { id: 'MW_DUPLICATE', title: 'Duplicate' } };
    await expect(discover({ resultsMap: { widgets: [entry], widgets_llm: [entry] } }, { limit: 1 }))
      .resolves.toEqual(unavailable);
  });

  it.each([
    ['Dashboard', 'dashboards', { id: 'SAME', title: 'D', type: 'Dashboard', children: [], alias: 'd' }],
    ['asset', 'assets', { id: 'SAME', name: 'A' }],
  ])('fails loud on a duplicate %s identity', async (_label, bucket, data) => {
    await expect(discover({ resultsMap: { [bucket]: [{ data }, { data }] } }, { selectors: ['thematic'] }))
      .resolves.toEqual(unavailable);
  });

  it('caps each source at the limit', async () => {
    const outcome = await discover({
      resultsMap: {
        assets: [
          { data: { id: 'MA_1', name: 'One' } },
          { data: { id: 'MA_2', name: 'Two' } },
          { data: { id: 'MA_3', name: 'Three' } },
        ],
      },
    }, { selectors: ['asset'], limit: 2 });

    expect(outcome.ok && outcome.value.results.map((entry) => entry.type === 'entity' && entry.entityId))
      .toEqual(['MA_1', 'MA_2']);
  });

  it('translates a named Dashboard with its alias URL and child count', async () => {
    const outcome = await discover({
      resultsMap: {
        dashboards: [{
          data: {
            id: 'MD_NAMED',
            title: '  Rates Monitor  ',
            type: 'Thematic',
            children: [{}, {}, {}],
            alias: 'rates monitor/1',
          },
        }],
      },
    }, { selectors: ['thematic'] });

    expect(outcome).toEqual({
      ok: true,
      value: {
        results: [{
          type: 'dashboard',
          dashboardId: 'MD_NAMED',
          title: 'Rates Monitor',
          category: { kind: 'named', value: 'Thematic' },
          widgetCount: 3,
          url: 'https://marquee.gs.com/s/marketview/dashboards/rates%20monitor%2F1',
        }],
      },
    });
  });

  it.each([null, undefined])('uses the provider URL when a Dashboard alias is %s', async (alias) => {
    await expect(discover({
      resultsMap: {
        dashboards: [{
          data: { id: 'MD', title: 'D', type: 'Dashboard', children: [], alias, url: '/s/marketview/dashboards/MD' },
        }],
      },
    }, { selectors: ['thematic'] })).resolves.toMatchObject({
      ok: true,
      value: { results: [{ url: 'https://marquee.gs.com/s/marketview/dashboards/MD' }] },
    });
  });

  it.each([
    ['a non-relative provider URL', { alias: '', url: 'https://example.com/d' }],
    ['a non-string alias', { alias: 7 }],
    ['missing children', { alias: 'd', children: undefined }],
    ['a missing type', { alias: 'd', type: undefined }],
    ['a missing title', { alias: 'd', title: undefined }],
    ['a missing id', { alias: 'd', id: undefined }],
  ])('fails loud on a Dashboard with %s', async (_label, extra) => {
    await expect(discover({
      resultsMap: { dashboards: [{ data: { id: 'MD', title: 'D', type: 'Dashboard', children: [], ...extra } }] },
    }, { selectors: ['thematic'] })).resolves.toEqual(unavailable);
  });

  it('translates an Asset with its qualifiers and provider URL', async () => {
    await expect(discover({
      resultsMap: {
        assets: [{
          data: {
            id: 'MA_FULL',
            name: '  Apple  ',
            assetClass: 'Equity',
            type: 'Asset',
            ticker: 'AAPL',
            bbid: 'AAPL UW',
            url: '/s/marketview/asset/MA_FULL?tab=1',
          },
        }],
      },
    }, { selectors: ['asset'] })).resolves.toEqual({
      ok: true,
      value: {
        results: [{
          type: 'entity',
          entityKind: 'asset',
          entityId: 'MA_FULL',
          label: 'Apple',
          qualifiers: ['Equity', 'AAPL', 'AAPL UW'],
          url: 'https://marquee.gs.com/s/marketview/asset/MA_FULL?tab=1',
        }],
      },
    });
  });

  it('drops empty and non-string Asset qualifiers and encodes its built URL', async () => {
    await expect(discover({
      resultsMap: { assets: [{ data: { id: 'MA X/1', name: 'X', assetClass: '', type: 7, ticker: 'X' } }] },
    }, { selectors: ['asset'] })).resolves.toEqual({
      ok: true,
      value: {
        results: [{
          type: 'entity',
          entityKind: 'asset',
          entityId: 'MA X/1',
          label: 'X',
          qualifiers: ['X'],
          url: 'https://marquee.gs.com/s/marketview/asset/MA%20X%2F1',
        }],
      },
    });
  });

  it('mirrors a blank-name Asset untitled and unlinked', async () => {
    await expect(discover({
      resultsMap: { assets: [{ data: { id: 'MA_BLANK', name: '' } }] },
    }, { selectors: ['asset'] })).resolves.toEqual({
      ok: true,
      value: {
        results: [{ type: 'entity', entityKind: 'asset', entityId: 'MA_BLANK', label: '', qualifiers: [] }],
      },
    });
  });

  it.each([
    ['a blank name with a provider URL', { name: '', url: '/s/marketview/asset/MA' }],
    ['a whitespace name', { name: '   ' }],
    ['a non-relative URL', { name: 'A', url: 'asset/MA' }],
  ])('fails loud on an Asset with %s', async (_label, extra) => {
    await expect(discover({
      resultsMap: { assets: [{ data: { id: 'MA', ...extra } }] },
    }, { selectors: ['asset'] })).resolves.toEqual(unavailable);
  });

  it('translates a country with its sub-region', async () => {
    await expect(discover({
      resultsMap: { countries: [{ data: { id: 'JP', name: '  Japan  ', subRegion: 'Asia' } }] },
    }, { selectors: ['country'] })).resolves.toEqual({
      ok: true,
      value: {
        results: [{
          type: 'entity',
          entityKind: 'country',
          entityId: 'JP',
          label: 'Japan',
          qualifiers: ['Asia'],
          url: 'https://marquee.gs.com/s/marketview/country/JP',
        }],
      },
    });
  });

  it('translates a portfolio with its currency', async () => {
    await expect(discover({
      resultsMap: { portfolios: [{ data: { id: 'MP', name: '  Book  ', currency: 'USD' } }] },
    }, { selectors: ['portfolio'] })).resolves.toEqual({
      ok: true,
      value: {
        results: [{
          type: 'entity',
          entityKind: 'portfolio',
          entityId: 'MP',
          label: 'Book',
          qualifiers: ['USD'],
          url: 'https://marquee.gs.com/s/marketview/portfolio/MP',
        }],
      },
    });
  });

  it.each([
    ['country', 'countries', { id: 'JP', name: 'Japan' }, 'country'],
    ['portfolio', 'portfolios', { id: 'MP', name: 'Book' }, 'portfolio'],
  ] as const)('maps a %s without its qualifier to none', async (selector, bucket, data, kind) => {
    await expect(discover({ resultsMap: { [bucket]: [{ data }] } }, { selectors: [selector] }))
      .resolves.toEqual({
        ok: true,
        value: {
          results: [{
            type: 'entity',
            entityKind: kind,
            entityId: data.id,
            label: data.name,
            qualifiers: [],
            url: `https://marquee.gs.com/s/marketview/${kind}/${data.id}`,
          }],
        },
      });
  });

  it.each([
    ['country', 'countries', { name: 'Japan' }],
    ['country', 'countries', { id: 'JP' }],
    ['portfolio', 'portfolios', { id: 'MP' }],
  ] as const)('fails loud on a %s entry missing its id or name', async (selector, bucket, data) => {
    await expect(discover({ resultsMap: { [bucket]: [{ data }] } }, { selectors: [selector] }))
      .resolves.toEqual(unavailable);
  });

  it('orders unrequested sources after requested ones', async () => {
    const outcome = await discover({
      resultsMap: {
        dashboards: [{ data: { id: 'MD', title: 'D', type: 'Dashboard', children: [], alias: 'd' } }],
        assets: [{ data: { id: 'MA', name: 'A' } }],
        countries: [{ data: { id: 'JP', name: 'Japan' } }],
        portfolios: [{ data: { id: 'MP', name: 'P' } }],
      },
    }, { selectors: ['portfolio', 'portfolio'] });

    expect(outcome.ok && outcome.value.results.map((entry) => (
      entry.type === 'dashboard' ? entry.dashboardId : entry.type === 'entity' ? entry.entityId : entry.widgetId
    ))).toEqual(['MP', 'MD', 'MA', 'JP']);
  });

  it('joins the Dashboard LLM pool after keyword sources, capped at the limit', async () => {
    const request = vi.fn(async (_endpoint: Endpoint, init?: { query?: Readonly<Record<string, unknown>> }) => (
      (init?.query?.types as string[]).includes('Dashboard LLM')
        ? {
            totalResults: 2,
            resultsMap: {
              dashboards_llm: [
                { data: { id: 'MD_WEB', title: 'Web', type: 'Dashboard', children: [], alias: 'web' } },
                { data: { title: 'Malformed beyond the limit' } },
              ],
            },
          }
        : { totalResults: 1, resultsMap: { countries: [{ data: { id: 'JP', name: 'Japan' } }] } }
    ));
    const port = createMarketViewSearchProductionPort({ request });

    await expect(port.discover({ query: 'q', selectors: ['country', 'web-dashboard'], limit: 1 }))
      .resolves.toMatchObject({
        ok: true,
        value: { results: [{ entityId: 'JP' }, { dashboardId: 'MD_WEB' }] },
      });
  });

  it('decodes the keyword sources when the Dashboard LLM pool is absent', async () => {
    const request = vi.fn(async (_endpoint: Endpoint, init?: { query?: Readonly<Record<string, unknown>> }) => (
      (init?.query?.types as string[]).includes('Dashboard LLM')
        ? { totalResults: 0, resultsMap: {} }
        : { totalResults: 1, resultsMap: { countries: [{ data: { id: 'JP', name: 'Japan' } }] } }
    ));
    const port = createMarketViewSearchProductionPort({ request });

    await expect(port.discover({ query: 'q', selectors: ['web-dashboard', 'country'], limit: 1 }))
      .resolves.toMatchObject({ ok: true, value: { results: [{ entityId: 'JP' }] } });
  });

  it.each([
    ['a non-object Dashboard LLM response', 'llm', []],
    ['a Dashboard LLM response without resultsMap', 'llm', { totalResults: 0 }],
    ['a non-array Dashboard LLM bucket', 'llm', { totalResults: 0, resultsMap: { dashboards_llm: {} } }],
    ['a non-object keyword response', 'keyword', 'oops'],
    ['a keyword response without resultsMap', 'keyword', { totalResults: 0 }],
  ])('fails loud on %s beside keyword sources', async (_label, side, response) => {
    const port = createMarketViewSearchProductionPort({
      async request(_endpoint, init) {
        const llm = (init?.query?.types as string[]).includes('Dashboard LLM');
        if ((side === 'llm') === llm) return response;
        return { totalResults: 0, resultsMap: {} };
      },
    });

    await expect(port.discover({ query: 'q', selectors: ['web-dashboard', 'country'], limit: 1 }))
      .resolves.toEqual(unavailable);
  });

  it.each([
    ['auth_expired', {}, { kind: 'authentication-required', realm: 'marquee' }],
    ['timeout', {}, { kind: 'timeout' }],
    ['network', { isCanceled: true }, { kind: 'cancelled' }],
    ['http', { status: 429 }, { kind: 'rate-limited' }],
    ['http', { status: 500 }, { kind: 'unavailable' }],
  ] as const)('classifies a %s Marquee failure %j', async (code, details, failure) => {
    const port = createMarketViewSearchProductionPort({
      async request() {
        throw new MarqueeError(code, 'failed', details);
      },
    });

    await expect(port.discover({ query: 'q', selectors: ['country'], limit: 1 }))
      .resolves.toEqual({ ok: false, error: { kind: 'discovery-failed', failure } });
  });

  it('propagates a failure that is neither a decode nor a Marquee error', async () => {
    const recordAdapterFailure = vi.fn();
    const port = createMarketViewSearchProductionPort({
      async request() {
        throw new TypeError('bug');
      },
    }, recordAdapterFailure);

    await expect(port.discover({ query: 'q', selectors: ['country'], limit: 1 }))
      .rejects.toThrow(new TypeError('bug'));
    expect(recordAdapterFailure).not.toHaveBeenCalled();
  });

  it('reports a decode failure without a recorder', async () => {
    await expect(discover({ resultsMap: { widgets: [{}] } })).resolves.toEqual(unavailable);
  });
});
