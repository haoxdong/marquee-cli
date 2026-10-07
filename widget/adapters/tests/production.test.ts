import type { ConfigId, WidgetId } from '../../index.js';
import { describe, expect, it, vi } from 'vitest';
import { MarqueeError } from '../../../transport/index.js';
import { createEntityModule, type EntityModule } from '../../../entity/index.js';
import { createControlGroupModule } from '../../../control-group/index.js';
import {
  createWidgetConfigurationProjectionPort,
  createWidgetPersistenceAnchorPort,
  createWidgetProductionModule,
} from '../production.js';
import {
  createWidget as createProductionWidget,
  type RenderedWidget,
  type WidgetDates,
  type WidgetGetInput,
  type WidgetParameterOverride,
  type WidgetRenderDetail,
  type WidgetRenderValue,
  type WidgetResult,
  type WidgetValue,
} from '../../index.js';
import type { WidgetPort } from '../port.js';

type TestFullProjection = Readonly<{
  widget: WidgetRenderValue;
  snippet: RenderedWidget['snippet'];
  execution?: Extract<RenderedWidget, { detail: 'full' }>['execution'];
}>;

type TestReadInput = Readonly<{
  source: Readonly<{
    kind: 'id';
    id: string;
    configurationId?: string;
    contextIdentity?: string;
  }>;
  mode: 'view' | 'summary' | 'snippet';
  data?: 'render' | 'skip';
  canonicalConfiguration?: 'required';
  editableDashboards?: 'fetch' | 'skip';
}>;

type TestReadResult =
  | Readonly<{
      mode: 'snippet';
      snippet: RenderedWidget['snippet'] & Readonly<{
        configurationId: string;
        targetId: string;
      }>;
    }>
  | Readonly<{
      mode: 'view' | 'summary';
      view: TestFullProjection;
    }>;

type TestConfigureInput = Readonly<{
  widgetId: string;
  params: WidgetGetInput['parameters'];
  existingConfigurationId?: string;
  data?: 'render' | 'skip';
  editableDashboards?: 'fetch' | 'skip';
}>;

function createWidget(
  adapter: WidgetPort,
  options: { entity?: Partial<EntityModule> } = {},
) {
  return createProductionWidget(adapter, {
    controlGroup: createControlGroupModule(adapter),
    entity: Object.assign(createEntityModule(adapter), options.entity),
  });
}

function createCapabilities(
  adapter: WidgetPort,
  options?: Parameters<typeof createWidget>[1],
) {
  const widget = createWidget(adapter, options);
  const canonicalView = (
    value: Extract<Awaited<ReturnType<typeof widget.get>>, { ok: true }>['value'],
  ): TestFullProjection => ({
    widget: value.widget,
    snippet: value.snippet,
    ...('execution' in value ? { execution: value.execution } : {}),
  });
  return {
    async prepare(input: TestReadInput): Promise<WidgetResult<TestReadResult>> {
      const bindings = [
        ...(input.source.contextIdentity
          ? [{ field: 'context', value: input.source.contextIdentity }]
          : []),
      ];
      const result = await widget.get({
        widgetId: input.source.id as WidgetId,
        configurationId: (input.source.configurationId ?? null) as ConfigId,
        parameters: bindings,
        detail: input.mode === 'snippet' ? 'snippet' : 'full',
      });
      if (!result.ok) return result;
      if (!result.value.widget.configurationId) {
        throw new Error('Widget get returned no configuration identity');
      }
      if (input.mode === 'snippet') {
        return {
          ok: true,
          value: {
            mode: 'snippet',
            snippet: {
              ...result.value.snippet,
              configurationId: result.value.widget.configurationId,
              targetId: result.value.widget.chartId ?? '',
            },
          },
        };
      }
      return { ok: true, value: { mode: input.mode, view: canonicalView(result.value) } };
    },
    async configure(input: TestConfigureInput): Promise<WidgetResult<TestFullProjection>> {
      const result = await widget.get({
        widgetId: input.widgetId as WidgetId,
        configurationId: (input.existingConfigurationId ?? null) as ConfigId,
        parameters: input.params,
        detail: input.data === 'skip' ? 'snippet' : 'full',
      });
      return result.ok
        ? { ok: true, value: canonicalView(result.value) }
        : result;
    },
  };
}

type TestRenderValues = Readonly<{
  widget: WidgetValue;
  parameters: readonly WidgetParameterOverride[];
  selectedContext:
    | Readonly<{ kind: 'asset' | 'country' | 'portfolio'; entityId: string }>
    | Readonly<{ kind: 'control-group'; controlGroupId: string }>
    | null;
  relativeDate: string | null;
  widgetDates?: WidgetDates;
}>;

function renderTestValues(
  runtime: ReturnType<typeof createWidgetProductionModule>,
  input: TestRenderValues,
  detail: WidgetRenderDetail,
) {
  const context = input.selectedContext;
  return runtime.render(
    input.widget,
    input.parameters,
    context?.kind === 'control-group'
      ? context.controlGroupId
      : context?.entityId ?? null,
    input.widgetDates
      ? {
          ...input.widgetDates,
          ...(input.relativeDate ? { relativeDate: input.relativeDate } : {}),
        }
      : undefined,
    detail,
  );
}

/** Render values for a complete Data Viz Widget `MW_<id>` with no parameters or Selected Context. */
function widgetValues(id: string, overrides: Partial<WidgetValue> = {}): TestRenderValues {
  return {
    widget: {
      widgetId: `MW_${id}` as WidgetId,
      configurationId: `WC_${id}` as ConfigId,
      configuration: {
        configurationId: `WC_${id}` as ConfigId,
        widgetId: `MW_${id}` as WidgetId,
        targetId: `DV_${id}`,
        relativeDate: null,
      },
      projection: { kind: 'complete' },
      title: { embedded: null, fallback: 'Fallback', useEntityTitle: false },
      target: { family: 'data-viz', targetId: `DV_${id}`, route: 'visualization' },
      parameters: [],
      contextParameter: null,
      controls: [],
      componentInputs: [],
      entityLabels: [],
      tags: [],
      sources: [],
      ...overrides,
    },
    parameters: [],
    selectedContext: null,
    relativeDate: null,
  };
}

function viewOf(read: TestReadResult): TestFullProjection {
  if (read.mode === 'snippet') throw new Error('expected view read');
  return read.view;
}

type RequestCall = {
  path: string;
  init?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
    hedgeDelaysMs?: number[];
  } | undefined;
};

function createFakeRequestAdapter(
  handler:
    | ((path: string, init?: RequestCall['init']) => unknown | Promise<unknown>)
    | Readonly<Record<string, () => unknown | Promise<unknown>>>,
): WidgetPort & { calls: RequestCall[] } {
  const calls: RequestCall[] = [];
  return {
    calls,
    async request(target, targetInit) {
      // Fakes answer paths: an Endpoint reaches them as its path and method.
      const path = target.path;
      const init = { ...targetInit, method: target.method };
      calls.push({ path, init });
      if (typeof handler === 'function') return handler(path, init);
      const respond = Object.hasOwn(handler, path) ? handler[path] : undefined;
      if (!respond) throw new Error(`unexpected ${path}`);
      return respond();
    },
  };
}

describe('Widget', () => {
  it.each([
    ['external', 'Public: Anyone with this link can view this widget'],
    ['internal', 'Firmwide: Anyone in your organization can view this widget'],
    ['restricted', 'Private: Only people invited can view this widget'],
    ['external-restricted', 'Restricted: This widget is available to a restricted set of users'],
  ])('resolves full Widget authors and %s access wording', async (label, access) => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_AUTHORED') {
        return {
          id: 'MW_AUTHORED',
          title: 'Authored Widget',
          underlyingChartId: 'DV_AUTHORED',
          visualizationType: 'DataViz',
          authors: ['AUTHOR_ONE', 'AUTHOR_TWO'],
          label,
          renderParams: { component: {} },
          parameters: [],
          metadata: { title: 'Authored Widget' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_AUTHORED',
          widgetId: 'MW_AUTHORED' as WidgetId,
          underlyingChartId: 'DV_AUTHORED',
          parameters: [],
        };
      }
      if (path === '/v1/users/query') {
        expect(init).toEqual({
          method: 'POST',
          body: {
            fields: ['id', 'name'],
            limit: 100,
            orderBy: [],
            where: { id: ['AUTHOR_ONE', 'AUTHOR_TWO'] },
          },
        });
        return {
          totalResults: 2,
          results: [
            { id: 'AUTHOR_TWO', name: 'Alex Example' },
            { id: 'AUTHOR_ONE', name: 'Morgan Sample' },
          ],
        };
      }
      if (path === '/v1/data/visualizations/DV_AUTHORED') return {};
      if (path === '/v1/data/visualizations/DV_AUTHORED/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_AUTHORED' as WidgetId,
      configurationId: 'WC_AUTHORED' as ConfigId,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        widget: {
          authors: ['Morgan Sample', 'Alex Example'],
          access,
        },
      },
    });
  });

  it.each([
    ['a non-string access label', { label: 7 }, undefined, 'widget.label is not a string'],
    ['an unknown access label', { label: 'bogus' }, undefined, 'widget.label bogus is not a supported access label'],
    ['non-array authors', { authors: 'AUTHOR' }, undefined, 'widget.authors is not a non-empty string array'],
    ['a non-string author', { authors: [7] }, undefined, 'widget.authors is not a non-empty string array'],
    ['empty authors', { authors: [] }, undefined, 'widget.authors is not a non-empty string array'],
    ['mixed-type authors', { authors: ['AUTHOR', 7] }, undefined, 'widget.authors is not a non-empty string array'],
    ['a users response without results', {}, {}, 'users query response has no results array'],
    ['a non-record users result', {}, { results: ['AUTHOR'] }, 'users query result is not a record'],
    ['a users result without id', {}, { results: [{ name: 'Morgan Sample' }] }, 'users query result has no id'],
    ['a users result with an empty id', {}, { results: [{ id: '', name: 'Morgan Sample' }] }, 'users query result has no id'],
    ['a whitespace-only author name', {}, { results: [{ id: 'AUTHOR', name: '   ' }] }, 'users query result has no name'],
    ['a users response missing an author', {}, { results: [] }, 'users query result omits author AUTHOR'],
    ['a non-record render component', { renderParams: { component: 'SOFR' } }, undefined, 'renderParams.component is not a record'],
  ] as const)('fails invalid-response on %s', async (_name, widgetOverrides, usersResponse, detail) => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_BAD_SHAPE': () => ({
        id: 'MW_BAD_SHAPE',
        title: 'Bad Shape Widget',
        underlyingChartId: 'DV_BAD_SHAPE',
        visualizationType: 'DataViz',
        authors: ['AUTHOR'],
        label: 'external',
        renderParams: { component: {} },
        parameters: [],
        metadata: { title: 'Bad Shape Widget' },
        ...widgetOverrides,
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_BAD_SHAPE',
        widgetId: 'MW_BAD_SHAPE' as WidgetId,
        underlyingChartId: 'DV_BAD_SHAPE',
        parameters: [],
      }),
      '/v1/users/query': () => (usersResponse ?? { results: [{ id: 'AUTHOR', name: 'Morgan Sample' }] }),
      '/v1/data/visualizations/DV_BAD_SHAPE': () => ({}),
      '/v1/data/visualizations/DV_BAD_SHAPE/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_BAD_SHAPE' as WidgetId,
      configurationId: 'WC_BAD_SHAPE' as ConfigId,
      parameters: [],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD_SHAPE' as WidgetId },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail,
      },
    });
  });

  it('fails loud when the definition would require relative-date restoration its Config hides', async () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2026-07-06' };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_HIDDEN_RESTORE': () => ({
        id: 'MW_HIDDEN_RESTORE',
        title: 'Hidden Restore Widget',
        underlyingChartId: 'DV_HIDDEN_RESTORE',
        visualizationType: 'DataViz',
        renderParams: { component: { pricingDate: '2026-07-06' } },
        parameters: [
          { field: 'pricingDate', type: 'Date', values: { default: relativePricingDate } },
        ],
        metadata: { title: 'Hidden Restore Widget' },
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_HIDDEN_RESTORE',
        widgetId: 'MW_HIDDEN_RESTORE',
        underlyingChartId: 'DV_HIDDEN_RESTORE',
        parameters: [{ field: 'pricingDate', value: relativePricingDate }],
      }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_HIDDEN_RESTORE' as WidgetId,
      configurationId: 'WC_HIDDEN_RESTORE' as ConfigId,
      parameters: [],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_HIDDEN_RESTORE' },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'relative Date default requires restoration',
      },
    });
  });

  it('ignores malformed Full-only ownership fields for Product Surface snippets', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_OWNERSHIP',
        title: 'Surface ownership',
        underlyingChartId: 'DV_SURFACE_OWNERSHIP',
        visualizationType: 'DataViz',
        authors: 'malformed',
        label: { unexpected: true },
        renderParams: { component: {} },
        parameters: [],
        metadata: { title: 'Surface ownership' },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result.ok).toBe(true);
    expect(adapter.calls).toEqual([]);
  });

  it('keeps an unchanged Control Group value as Unknown in full parameter state', async () => {
    const controlGroupId = `CG${'A'.repeat(14)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/data/visualizations/DV_SAVED_GROUP/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/data/visualizations/DV_SAVED_GROUP': () => ({}),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SAVED_GROUP',
        configurationId: 'WC_SAVED_GROUP',
        title: 'Saved group',
        underlyingChartId: 'DV_SAVED_GROUP',
        visualizationType: 'DataViz',
        metadata: { title: 'Saved group' },
        renderParams: { component: { basket: controlGroupId } },
        parameters: [{ field: 'basket', type: 'Asset', values: { default: controlGroupId }, options: [] }],
      },
      [{ field: 'basket', value: controlGroupId }],
      null,
      undefined,
      'full',
    );

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.widget.parameters).toEqual([
      expect.objectContaining({ field: 'basket', default: 'Unknown', rawDefault: controlGroupId }),
    ]);
    expect(result.value.widget.parameterStates).toEqual([
      ['basket', expect.objectContaining({ field: 'basket', value: 'Unknown', rawValue: controlGroupId })],
    ]);
  });

  it('reports the default Selected Context of an unconfigured rendered Widget', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/data/visualizations/DV_SURFACE_CONTEXT': () => ({}),
      '/v1/data/visualizations/DV_SURFACE_CONTEXT/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/plots/entities': () => ({ assets: [{ id: 'MA_EURUSD', name: 'EURUSD' }] }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_CONTEXT',
        title: 'Carry',
        underlyingChartId: 'DV_SURFACE_CONTEXT',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          options: ['MA_EURUSD', 'MA_USDMXN'],
          values: { default: 'MA_EURUSD' },
        },
        renderParams: { component: { cross: 'MA_EURUSD' } },
        parameters: [],
        metadata: { title: 'Carry' },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.widget.selectedContext).toBe('MA_EURUSD');
  });

  it('leaves the Selected Context of a configured Widget unset when the render names none', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/plots/entities': () => ({ assets: [{ id: 'MA_EURUSD', name: 'EURUSD' }] }),
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_CONTEXT',
        title: 'Carry',
        underlyingChartId: 'DV_SURFACE_CONTEXT',
        visualizationType: 'DataViz',
        configurationId: 'WC_SURFACE_CONTEXT',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          options: ['MA_EURUSD', 'MA_USDMXN'],
          values: { default: 'MA_EURUSD' },
        },
        renderParams: { component: {} },
        parameters: [],
        metadata: { title: 'Carry' },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.widget.selectedContext).toBeNull();
  });

  it('excludes a saved assignment absent from the current Widget parameters', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_ASSIGNMENT',
        title: 'Surface assignment',
        underlyingChartId: 'DV_SURFACE_ASSIGNMENT',
        visualizationType: 'DataViz',
        renderParams: { component: { universe: 'G10' } },
        parameters: [{
          field: 'universe',
          type: 'Enum',
          values: { default: 'G10' },
          options: ['G10'],
        }],
        metadata: { title: 'Surface assignment' },
      },
      [
        { field: 'universe', value: 'G10' },
        { field: 'eurBased', value: false },
      ],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: ['universe=G10'],
        },
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('excludes a saved Config assignment absent from the current Widget render schema', async () => {
    const widget = {
      id: 'MW_STALE_CONFIG_ALIAS',
      title: 'Total quantity posted',
      underlyingChartId: 'DV_STALE_CONFIG_ALIAS',
      visualizationType: 'DataViz',
      renderParams: {
        component: {
          baseCommodity: 'MA_COPPER',
          contractCode: '3M',
        },
      },
      parameters: [
        {
          field: 'baseCommodity',
          type: 'Enum',
          values: { default: 'MA_COPPER' },
          options: ['MA_COPPER', 'MA_ALUMINIUM'],
        },
        {
          field: 'contractCode',
          type: 'Enum',
          values: { default: '3M' },
          options: ['1M', '3M'],
        },
      ],
      metadata: { title: 'Total quantity posted' },
    };
    let renderBody: unknown;
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_STALE_CONFIG_ALIAS') {
        return widget;
      }
      if (path === '/v1/marketview/widgets/configurations') {
        if (init?.method === 'GET') {
          return {
            id: 'WC_STALE_CONFIG_ALIAS',
            widgetId: widget.id,
            underlyingChartId: widget.underlyingChartId,
            parameters: [
              { field: 'base_commodity', value: 'MA_COPPER' },
              { field: 'contractCode', value: '1M' },
            ],
          };
        }
        return {
          id: 'WC_CURRENT_CONFIG',
          widgetId: widget.id,
          underlyingChartId: widget.underlyingChartId,
        };
      }
      if (path === '/v1/data/visualizations/DV_STALE_CONFIG_ALIAS') return {};
      if (path === '/v1/data/visualizations/DV_STALE_CONFIG_ALIAS/render') {
        renderBody = init?.body;
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: widget.id as WidgetId,
      configurationId: 'WC_STALE_CONFIG_ALIAS' as ConfigId,
      parameters: [{ field: 'baseCommodity', value: 'MA_ALUMINIUM' }],
      detail: 'full',
    });

    expect(result.ok).toBe(true);
    expect(renderBody).toMatchObject({
      component: {
        baseCommodity: 'MA_ALUMINIUM',
        contractCode: '1M',
      },
    });
    expect(renderBody).not.toHaveProperty('component.base_commodity');
  });

  it('preserves a saved Config-only country when changing relative date', async () => {
    const widget = {
      id: 'MW_CONFIG_ONLY_COUNTRY',
      title: 'ETF flow for <countryId:US>',
      underlyingChartId: 'CH_CONFIG_ONLY_COUNTRY',
      visualizationType: 'Plot',
      parameters: [],
      renderParams: { controls: [] },
      metadata: { title: 'ETF flow for Unknown Value' },
    };
    let configurationBody: unknown;
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONFIG_ONLY_COUNTRY') return widget;
      if (path === '/v1/marketview/widgets/configurations') {
        if (init?.method === 'POST') {
          configurationBody = init.body;
          return {
            id: 'WC_CONFIG_ONLY_COUNTRY_5Y',
            widgetId: widget.id,
            underlyingChartId: widget.underlyingChartId,
            relativeDate: '5y',
            parameters: [{ field: 'countryId', value: 'JP' }],
            metadata: { title: 'ETF flow for Japan' },
          };
        }
        return {
          id: 'WC_CONFIG_ONLY_COUNTRY',
          widgetId: widget.id,
          underlyingChartId: widget.underlyingChartId,
          parameters: [{ field: 'countryId', value: 'JP' }],
          metadata: { title: 'ETF flow for Japan' },
        };
      }
      if (path === '/v1/charts/CH_CONFIG_ONLY_COUNTRY') {
        return {
          description: 'US.etf_flow()',
          chartType: 'line',
          expressions: [{ label: 'Flow' }],
          relativeStartDate: '-10y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['US.etf_flow()'],
          results: [{ type: 'series', values: { '2026-08-09': 1 } }],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: widget.id as WidgetId,
      configurationId: 'WC_CONFIG_ONLY_COUNTRY' as ConfigId,
      parameters: [{ field: 'relativeDate', value: '5Y' }],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify({ error: result.error, calls: adapter.calls }));
    expect(configurationBody).toMatchObject({
      relativeDate: '5y',
      parameters: [{ field: 'countryId', value: 'JP' }],
    });
  });

  function savedRelativeDateAdapter(relativeDate: string) {
    const widget = {
      id: 'MW_SAVED_RELATIVE_DATE',
      title: 'ETF flow',
      underlyingChartId: 'CH_SAVED_RELATIVE_DATE',
      visualizationType: 'Plot',
      parameters: [],
      renderParams: { controls: [] },
      metadata: { title: 'ETF flow' },
    };
    return createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_SAVED_RELATIVE_DATE') return widget;
      if (path === '/v1/marketview/widgets/configurations' && init?.method !== 'POST') {
        return {
          id: 'WC_SAVED_RELATIVE_DATE',
          widgetId: widget.id,
          underlyingChartId: widget.underlyingChartId,
          relativeDate,
          parameters: [],
        };
      }
      if (path === '/v1/charts/CH_SAVED_RELATIVE_DATE') {
        return {
          description: 'US.etf_flow()',
          chartType: 'line',
          expressions: [{ label: 'Flow' }],
          relativeStartDate: '-10y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['US.etf_flow()'],
          results: [{ type: 'series', values: { '2026-08-09': 1 } }],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });
  }

  it('keeps the saved Config when -p relativeDate repeats its saved window', async () => {
    const adapter = savedRelativeDateAdapter('5y');

    const result = await createWidget(adapter).get({
      widgetId: 'MW_SAVED_RELATIVE_DATE' as WidgetId,
      configurationId: 'WC_SAVED_RELATIVE_DATE' as ConfigId,
      parameters: [{ field: 'relativeDate', value: '5Y' }],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify({ error: result.error, calls: adapter.calls }));
    expect(adapter.calls.filter(({ init }) => init?.method === 'POST').map(({ path }) => path))
      .not.toContain('/v1/marketview/widgets/configurations');
  });

  it('fails loud on a saved Config relativeDate outside the override grammar', async () => {
    const result = await createWidget(savedRelativeDateAdapter('soon')).get({
      widgetId: 'MW_SAVED_RELATIVE_DATE' as WidgetId,
      configurationId: 'WC_SAVED_RELATIVE_DATE' as ConfigId,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'invalid-response',
        source: 'configuration',
        problem: 'unsupported-payload-shape',
        detail: 'configuration.relativeDate soon is malformed',
      },
    });
  });

  it('uses an embedded Product Surface parameter value without matching it as user input', async () => {
    const controlGroupId = `CG${'A'.repeat(16)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/plots/entities': () => ({ results: [] }),
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_CONTROL_GROUP',
        title: 'Surface control group',
        underlyingChartId: 'DV_SURFACE_CONTROL_GROUP',
        visualizationType: 'DataViz',
        renderParams: {
          component: { Basket: controlGroupId },
          controls: [{ id: 'Basket', type: 'Asset', value: controlGroupId }],
        },
        metadata: { title: 'Surface control group' },
      },
      [{ field: 'Basket', value: controlGroupId, displayValue: 'Growth Basket' }],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: ['basket=Growth Basket'],
        },
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('uses coherent QuickPoll survey values supplied by a Product Surface', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_QUICKPOLL',
        title: 'Surface QuickPoll',
        underlyingChartId: 'DV_SURFACE_QUICKPOLL',
        visualizationType: 'DataViz',
        tags: ['QuickPoll'],
        renderParams: {
          component: {
            question: 5,
            surveyDate: '2025-08-01',
          },
          controls: [],
        },
        parameters: [
          { field: 'question', type: 'Integer', values: { default: 5 } },
          { field: 'surveyDate', type: 'Date', values: { default: '2025-08-01' } },
        ],
        metadata: { title: 'Surface QuickPoll' },
      },
      [
        { field: 'question', value: 5 },
        { field: 'surveyDate', value: '2025-08-01' },
      ],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: [
            'question=5',
            'surveyDate=2025-08-01',
          ],
        },
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('fails loud when opaque Product Surface assignment resolution is unavailable', async () => {
    const opaqueAssetId = `MA${'A'.repeat(16)}`;
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_ENTITY',
        title: 'Surface entity',
        underlyingChartId: 'CH_SURFACE_ENTITY',
        renderParams: {
          component: { asset: opaqueAssetId },
          controls: [{ id: 'asset', type: 'Asset', value: opaqueAssetId }],
        },
        metadata: { title: 'Surface entity' },
      },
      [{ field: 'asset', value: opaqueAssetId }],
      null,
      undefined,
      'snippet',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW_SURFACE_ENTITY' as WidgetId },
        failure: { kind: 'unavailable' },
      },
    });
    expect(adapter.calls).toEqual([{
      path: '/v1/plots/entities',
      init: { method: 'GET', query: { ids: [opaqueAssetId] } },
    }]);
  });

  it('fails typed when Product Surface Selected Context resolution is unavailable', async () => {
    const opaqueAssetId = `MA${'B'.repeat(16)}`;
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_CONTEXT',
        title: 'Surface context',
        underlyingChartId: 'CH_SURFACE_CONTEXT',
        contextParameter: {
          field: 'Basket',
          type: 'Asset',
          values: { default: opaqueAssetId },
        },
        renderParams: { component: { Basket: opaqueAssetId } },
        metadata: { title: 'Surface context' },
        relevance: 1,
      },
      [],
      opaqueAssetId,
      undefined,
      'snippet',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW_SURFACE_CONTEXT' as WidgetId },
        failure: { kind: 'unavailable' },
      },
    });
    expect(adapter.calls).toEqual([{
      path: '/v1/plots/entities',
      init: { method: 'GET', query: { ids: [opaqueAssetId] } },
    }]);
  });

  it('resolves an unresolved Product Surface title through the injected Entity module', async () => {
    const opaqueAssetId = `MA${'C'.repeat(16)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNRESOLVED_SURFACE_TITLE/metadata': () => ({ metadata: {} }),
    });
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: [{
        kind: 'asset' as const,
        entityId: opaqueAssetId,
        label: 'Resolved Basket',
        aliases: [],
      }],
    }));

    const result = await createWidget(adapter, {
      entity: {
        resolve,
        async resolveIdentity() {
          throw new Error('unexpected legacy Entity resolution');
        },
        async resolveMatches() {
          return { ok: true, value: [] };
        },
      },
    }).render(
      {
        id: 'MW_UNRESOLVED_SURFACE_TITLE',
        title: `Surface <Basket:${opaqueAssetId}>`,
        useEntityTitle: true,
        underlyingChartId: 'CH_UNRESOLVED_SURFACE_TITLE',
        contextParameter: {
          field: 'Basket',
          type: 'Asset',
          value: opaqueAssetId,
        },
        renderParams: {
          controls: [{ id: 'Basket', type: 'Asset', value: opaqueAssetId }],
        },
      },
      [],
      opaqueAssetId,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Surface Resolved Basket',
          parameterLines: ['basket=Resolved Basket', 'relativeDate='],
        },
      },
    });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(adapter.calls.map(({ path }) => path)).toEqual([
      '/v1/marketview/widgets/MW_UNRESOLVED_SURFACE_TITLE/metadata',
    ]);
  });

  it('uses direct Asset identity evidence for active-context title substitution', async () => {
    const activeAssetId = `MA${'E'.repeat(16)}`;
    const staleAssetId = `MA${'F'.repeat(16)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_DIRECT_CONTEXT_TITLE/metadata': () => ({ metadata: {} }),
    });
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: [{
        kind: 'asset' as const,
        entityId: activeAssetId,
        label: 'Active Asset',
        aliases: [activeAssetId],
        bbid: 'ACTIVE UW',
      }],
    }));

    const result = await createWidget(adapter, {
      entity: { resolve },
    }).render(
      {
        id: 'MW_DIRECT_CONTEXT_TITLE',
        title: `Surface <Basket:${staleAssetId}>`,
        useEntityTitle: true,
        underlyingChartId: 'CH_DIRECT_CONTEXT_TITLE',
        contextParameter: {
          field: 'Basket',
          type: 'Asset',
          value: staleAssetId,
        },
        renderParams: {
          controls: [{ id: 'Basket', type: 'Asset', value: staleAssetId }],
        },
      },
      [{ field: 'Basket', value: activeAssetId }],
      activeAssetId,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Surface ACTIVE UW',
          parameterLines: ['basket=Active Asset', 'relativeDate='],
        },
      },
    });
    expect(resolve).toHaveBeenCalledWith([{ kind: 'asset', value: activeAssetId }]);
  });

  it('recomputes a literal underlier title for the active Product Surface context', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_SURFACE_LITERAL_TITLE/metadata') {
        expect(init).toMatchObject({
          method: 'POST',
          body: { parameters: [{ field: 'Asset', value: 'MA_APPLE' }] },
        });
        return { metadata: { title: 'Computed Apple title' } };
      }
      throw new Error(`unexpected ${path}`);
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_LITERAL_TITLE',
        title: 'Stale literal title',
        useEntityTitle: false,
        underlyingChartId: 'CH_SURFACE_LITERAL_TITLE',
        contextParameter: {
          field: 'Asset',
          type: 'Asset',
          values: { default: 'MA_DEFAULT' },
        },
        renderParams: { component: { Asset: 'MA_DEFAULT' } },
      },
      [],
      'MA_APPLE',
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Computed Apple title',
          isTitleResolved: true,
        },
      },
    });
    expect(adapter.calls.map(({ path }) => path)).toEqual([
      '/v1/marketview/widgets/MW_SURFACE_LITERAL_TITLE/metadata',
    ]);
  });

  it('leaves empty component inputs out of the Widget title request', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_EMPTY_COMPONENT_INPUT/metadata': () => ({ metadata: { title: 'Flows for 1m' } }),
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_EMPTY_COMPONENT_INPUT',
        title: 'Flows in <region:Europe> for <tenor:1m>',
        underlyingChartId: 'CH_EMPTY_COMPONENT_INPUT',
        renderParams: { component: { region: '', tenor: '1m' }, controls: [] },
        parameters: [],
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({ ok: true, value: { snippet: { title: 'Flows for 1m' } } });
    expect(adapter.calls).toContainEqual({
      path: '/v1/marketview/widgets/MW_EMPTY_COMPONENT_INPUT/metadata',
      init: expect.objectContaining({ body: { parameters: [{ field: 'tenor', value: '1m' }] } }),
    });
  });

  it('uses a static useEntityTitle Widget title without metadata', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_STATIC_ENTITY_TITLE',
        title: 'Static Widget title',
        useEntityTitle: true,
        underlyingChartId: 'CH_STATIC_ENTITY_TITLE',
        renderParams: { component: {} },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: { snippet: { title: 'Static Widget title' } },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('defaults an omitted useEntityTitle flag to the saved-title branch', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_LEGACY_STATIC_TITLE',
        title: 'Legacy static Widget title',
        underlyingChartId: 'CH_LEGACY_STATIC_TITLE',
        renderParams: { component: {} },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: { snippet: { title: 'Legacy static Widget title' } },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('trusts a Product Surface metadata title computed for its active context', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_PRECOMPUTED_UNDERLIER_TITLE',
        title: 'Stale literal title',
        useEntityTitle: false,
        underlyingChartId: 'CH_PRECOMPUTED_UNDERLIER_TITLE',
        metadata: { title: 'Precomputed Apple title' },
        renderParams: { component: {} },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: { snippet: { title: 'Precomputed Apple title' } },
    });
    expect(adapter.calls).toEqual([]);
  });

  it.each([
    ['snippet', 'Selected Context', (controlGroupId: string) => ({
      selectedContext: controlGroupId,
      parameters: [],
    })],
    ['full', 'Selected Context', (controlGroupId: string) => ({
      selectedContext: controlGroupId,
      parameters: [],
    })],
    ['snippet', 'cross', (controlGroupId: string) => ({
      selectedContext: null,
      parameters: [{ field: 'cross', value: controlGroupId }],
    })],
    ['full', 'cross', (controlGroupId: string) => ({
      selectedContext: null,
      parameters: [{ field: 'cross', value: controlGroupId }],
    })],
  ] as const)('rejects a %s %s input that names a Control Group before rendering', async (
    detail,
    inputName,
    input,
  ) => {
    const storedAssetId = `MA${'A'.repeat(14)}`;
    const controlGroupId = `CG${'B'.repeat(14)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CONTEXT_INPUT': () => ({
        id: 'MW_CONTEXT_INPUT',
        title: 'Where is USDTRY spot trading?',
        useEntityTitle: false,
        underlyingChartId: 'CH_CONTEXT_INPUT',
        visualizationType: 'Control',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          options: [controlGroupId],
          values: { default: storedAssetId },
        },
        renderParams: {
          controls: [{ id: 'cross', type: 'Asset', value: storedAssetId }],
        },
        parameters: [],
      }),
      '/v1/marketview/widgets/configurations': () => ([{
        id: 'WC_CONTEXT_INPUT',
        widgetId: 'MW_CONTEXT_INPUT' as WidgetId,
        underlyingChartId: 'CH_CONTEXT_INPUT',
        parameters: [{ field: 'cross', value: storedAssetId }],
      }]),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_INPUT' as WidgetId,
      configurationId: 'WC_CONTEXT_INPUT' as ConfigId,
      ...input(controlGroupId),
      detail,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        identity: { widgetId: 'MW_CONTEXT_INPUT' as WidgetId },
        input: inputName,
        problem: 'control-group',
      },
    });
    expect(adapter.calls.map(({ path }) => path)).not.toContain('/v1/marketview/constituents');
  });

  it('matches a Control Group for a parameter that is not the Selected Context against its members', async () => {
    const storedAssetId = `MA${'A'.repeat(14)}`;
    const memberId = `MA${'C'.repeat(14)}`;
    const controlGroupId = `CG${'B'.repeat(14)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_BASKET_INPUT': () => ({
        id: 'MW_BASKET_INPUT',
        title: 'Basket performance',
        useEntityTitle: false,
        underlyingChartId: 'CH_BASKET_INPUT',
        visualizationType: 'Control',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          options: [storedAssetId],
          values: { default: storedAssetId },
        },
        renderParams: {
          controls: [{ id: 'cross', type: 'Asset', value: storedAssetId }],
        },
        parameters: [{
          field: 'basket',
          type: 'Asset',
          options: [controlGroupId],
          values: { default: controlGroupId },
        }],
      }),
      '/v1/marketview/widgets/configurations': () => ([{
        id: 'WC_BASKET_INPUT',
        widgetId: 'MW_BASKET_INPUT' as WidgetId,
        underlyingChartId: 'CH_BASKET_INPUT',
        parameters: [
          { field: 'cross', value: storedAssetId },
          { field: 'basket', value: controlGroupId },
        ],
      }]),
      '/v1/marketview/constituents': () => ({
        totalResults: 1,
        results: [{ constituentId: memberId, name: 'Basket member', controlGroups: [controlGroupId] }],
      }),
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_BASKET_INPUT' as WidgetId,
      configurationId: 'WC_BASKET_INPUT' as ConfigId,
      selectedContext: null,
      parameters: [{ field: 'basket', value: controlGroupId }],
      detail: 'snippet',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unmatched-input',
        identity: { widgetId: 'MW_BASKET_INPUT' as WidgetId },
        input: 'basket',
        requested: controlGroupId,
        candidates: ['Basket member'],
      },
    });
  });

  it('keeps name as the base when underlier metadata returns no title', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_NAME_BASE/metadata': () => ({ metadata: {} }),
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_NAME_BASE',
        title: '',
        name: 'Widget name fallback',
        useEntityTitle: false,
        underlyingChartId: 'CH_NAME_BASE',
        renderParams: { component: {} },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: { snippet: { title: 'Widget name fallback' } },
    });
    expect(adapter.calls.map(({ path }) => path)).toEqual([
      '/v1/marketview/widgets/MW_NAME_BASE/metadata',
    ]);
  });

  it('leaves an unassigned sole context option empty from Product Surface data', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('unexpected Widget request');
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_SOLE_CONTEXT_OPTION',
        title: 'Sole context option',
        useEntityTitle: true,
        underlyingChartId: 'CH_SURFACE_SOLE_CONTEXT_OPTION',
        contextParameter: {
          field: 'Asset',
          type: 'Asset',
          options: ['MA_ONLY'],
          values: {},
        },
        renderParams: { component: {}, controls: [] },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Sole context option',
          parameterLines: ['asset=', 'relativeDate='],
        },
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('resolves a dynamic title from the provider for a full Product Surface render', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_SURFACE_DYNAMIC_TITLE/metadata') {
        expect(init).toMatchObject({
          method: 'POST',
          body: { parameters: [{ field: 'universe', value: 'EM' }] },
        });
        return { metadata: { title: 'Dynamic title for EM' } };
      }
      if (path === '/v1/data/visualizations/DV_SURFACE_DYNAMIC_TITLE') return {};
      if (path === '/v1/data/visualizations/DV_SURFACE_DYNAMIC_TITLE/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_SURFACE_DYNAMIC_TITLE',
        configurationId: 'WC_SURFACE_DYNAMIC_TITLE',
        title: 'Fallback title for <universe:G10>',
        useEntityTitle: true,
        underlyingChartId: 'DV_SURFACE_DYNAMIC_TITLE',
        visualizationType: 'DataViz',
        renderParams: { component: { universe: 'G10' } },
        parameters: [{
          field: 'universe',
          type: 'Enum',
          values: { default: 'G10' },
          options: ['G10', 'EM'],
        }],
      },
      [{ field: 'universe', value: 'EM' }],
      null,
      undefined,
      'full',
    );

    if (!result.ok) {
      throw new Error(JSON.stringify({ error: result.error, calls: adapter.calls }));
    }
    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: { title: 'Dynamic title for EM' },
      },
    });
    expect(adapter.calls.map(({ path }) => path)).toContain(
      '/v1/marketview/widgets/MW_SURFACE_DYNAMIC_TITLE/metadata',
    );
  });

  it('applies exhaustive private Snippet assignments without Config persistence', async () => {
    const oldWidget = {
      id: 'MW_EXHAUSTIVE',
      title: 'Exhaustive',
      useEntityTitle: true,
      configurationId: 'WC_OLD' as ConfigId,
      underlyingChartId: 'DV_EXHAUSTIVE',
      visualizationType: 'DataViz',
      renderParams: { component: { universe: 'G10' } },
      parameters: [{
        field: 'universe',
        type: 'Enum',
        values: { default: 'G10' },
        options: ['G10', 'Latam'],
      }],
      metadata: { title: 'Exhaustive' },
    };
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_EXHAUSTIVE') {
        return init?.query?.context === 'WC_NEW'
          ? {
              ...oldWidget,
              configurationId: 'WC_NEW' as ConfigId,
              renderParams: { component: { universe: 'Latam' } },
              parameters: [{
                field: 'universe',
                type: 'Enum',
                values: { default: 'Latam' },
                options: ['G10', 'Latam'],
              }],
            }
          : oldWidget;
      }
      if (path === '/v1/marketview/widgets/configurations') {
        if (init?.method === 'GET') {
          return {
            id: 'WC_OLD',
            widgetId: 'MW_EXHAUSTIVE' as WidgetId,
            underlyingChartId: 'DV_EXHAUSTIVE',
            parameters: [],
          };
        }
        expect(init?.method).toBe('POST');
        return { id: 'WC_NEW' };
      }
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_EXHAUSTIVE' as WidgetId,
      configurationId: 'WC_OLD' as ConfigId,
      parameters: [
        { field: 'universe', value: 'G10' },
        { field: 'universe', value: 'Latam' },
      ],
      detail: 'snippet',
    });

    expect(result.ok).toBe(true);
    expect(adapter.calls.map(({ path, init }) => `${init?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_EXHAUSTIVE',
      'GET /v1/marketview/widgets/configurations',
    ]);
  });

  it('dereferences a Configured Widget Snippet without minting Config state', async () => {
    const oldWidget = {
      id: 'MW_VALIDATED',
      title: 'Validated',
      useEntityTitle: true,
      configurationId: 'WC_OLD' as ConfigId,
      underlyingChartId: 'DV_VALIDATED',
      visualizationType: 'DataViz',
      renderParams: { component: { universe: 'G10' } },
      parameters: [{
        field: 'universe',
        type: 'Enum',
        values: { default: 'G10' },
        options: ['G10', 'Latam'],
      }],
      metadata: { title: 'Validated' },
    };
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_VALIDATED') {
        return init?.query?.context === 'WC_NEW'
          ? {
              ...oldWidget,
              configurationId: 'WC_NEW' as ConfigId,
              renderParams: { component: { universe: 'Latam' } },
            }
          : oldWidget;
      }
      if (path === '/v1/marketview/widgets/configurations') {
        expect(init?.method).toBe('GET');
        return {
          id: 'WC_OLD',
          widgetId: 'MW_VALIDATED' as WidgetId,
          underlyingChartId: 'DV_VALIDATED',
          parameters: [{ field: 'universe', value: 'G10' }],
        };
      }
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const input = {
      widgetId: 'MW_VALIDATED' as WidgetId,
      configurationId: 'WC_OLD' as ConfigId,
      parameters: [
        { field: 'universe', value: 'G10' },
        { field: 'universe', value: 'Latam' },
      ],
      detail: 'snippet',
    } as const;
    const result = await createWidgetProductionModule(adapter, {
      controlGroup: createControlGroupModule(adapter),
      entity: createEntityModule(adapter),
    }).get(input);

    expect(result.ok).toBe(true);
    expect(adapter.calls.map(({ path, init }) => `${init?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_VALIDATED',
      'GET /v1/marketview/widgets/configurations',
    ]);
  });

  it.each([
    [{}, ['assetClass']],
    [{ field: 'Cross' }, ['cross', 'assetClass']],
  ])('takes only -p names, not provider labels, for a DataViz Widget Snippet (context %j)', async (contextParameter, candidates) => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_LABELS') {
        return {
          id: 'MW_LABELS',
          title: 'Labels',
          underlyingChartId: 'DV_LABELS',
          visualizationType: 'DataViz',
          contextParameter,
          renderParams: { component: {}, controls: [] },
          parameters: [{ field: 'Asset Class', type: 'Enum', value: 'FX', options: ['FX', 'Rates'] }],
        };
      }
      if (path === '/v1/data/visualizations/DV_LABELS') return {};
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_LABELS' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'Asset Class', value: 'Rates' }],
      detail: 'snippet',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'unknown-input',
        identity: { widgetId: 'MW_LABELS' as WidgetId },
        input: 'Asset Class',
        candidates,
      },
    });
  });

  it('does not load Chart-only controls for a private Widget Snippet', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONFIGURE') {
        return {
          id: 'MW_CONFIGURE',
          title: 'Configured',
          underlyingChartId: 'CH_CONFIGURE',
          renderParams: {
            component: {},
            controls: [],
          },
          parameters: [],
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return [{ id: 'WC_CONFIGURED' }];
      }
      if (path === '/v1/charts/CH_CONFIGURE') {
        return {
          id: 'CH_CONFIGURE',
          description: 'DataSeries("SPX")',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          controls: [{
            id: 'tenor',
            controlType: 'Enum',
            value: '1m',
            values: ['1m', '6m'],
          }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return { results: [{ type: 'series', values: { '2026-01-01': 1 } }] };
      }
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONFIGURE' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'tenor', value: '6m' }],
      detail: 'snippet',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unknown-input',
        identity: { widgetId: 'MW_CONFIGURE' as WidgetId },
        input: 'tenor',
        candidates: ['relativeDate'],
      },
    });
    expect(adapter.calls[0]).toMatchObject({
      path: '/v1/marketview/widgets/MW_CONFIGURE',
      init: { method: 'GET' },
    });
    expect(adapter.calls.map(({ path }) => path)).toEqual([
      '/v1/marketview/widgets/MW_CONFIGURE',
    ]);
  });

  it('resolves a default Widget Config before applying private Snippet parameters', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CONFIGURE': () => ({
        id: 'MW_CONFIGURE',
        title: 'Configured',
        underlyingChartId: 'CH_CONFIGURE',
        renderParams: {
          component: { asset: `MA${'J'.repeat(15)}` },
          controls: [{ id: 'asset', type: 'Asset', value: `MA${'J'.repeat(15)}` }],
        },
        parameters: [],
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_CONFIGURE',
        widgetId: 'MW_CONFIGURE' as WidgetId,
        underlyingChartId: 'CH_CONFIGURE',
        parameters: [{ field: 'asset', value: `MA${'J'.repeat(15)}` }],
      }),
      '/v1/plots/entities': () => ({ assets: [{ id: `MA${'J'.repeat(15)}`, name: 'Configured asset' }] }),
    });
    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONFIGURE' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'asset', value: `MA${'J'.repeat(15)}` }],
      detail: 'snippet',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        widget: { configurationId: 'WC_CONFIGURE' as ConfigId },
      },
    });
    expect(adapter.calls.map(({ path, init }) => `${init?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_CONFIGURE',
      'POST /v1/marketview/widgets/configurations',
      'GET /v1/plots/entities',
    ]);
    expect(adapter.calls[0]?.init?.hedgeDelaysMs).toEqual([1000]);
  });

  it('mints a default Widget Config without a context assignment when its Selected Context is unset', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNSET_CONTEXT': () => ({
        id: 'MW_UNSET_CONTEXT',
        title: 'Unset context',
        underlyingChartId: 'CH_UNSET_CONTEXT',
        contextParameter: { field: 'Asset', type: 'Asset', options: [], values: {} },
        renderParams: { component: {}, controls: [] },
        parameters: [],
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_UNSET_CONTEXT',
        widgetId: 'MW_UNSET_CONTEXT' as WidgetId,
        underlyingChartId: 'CH_UNSET_CONTEXT',
        parameters: [],
      }),
    });

    await createWidget(adapter).get({
      widgetId: 'MW_UNSET_CONTEXT' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'snippet',
    });

    expect(adapter.calls.find(({ init }) => init?.method === 'POST')?.init?.body).toEqual({
      widgetId: 'MW_UNSET_CONTEXT',
      underlyingChartId: 'CH_UNSET_CONTEXT',
      parameters: [],
    });
  });

  it('rejects a Snippet Selected Context for a Widget without a context parameter as user input', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_NO_CONTEXT': () => ({
        id: 'MW_NO_CONTEXT',
        title: 'No context',
        underlyingChartId: 'CH_NO_CONTEXT',
        renderParams: { component: {}, controls: [] },
        parameters: [],
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_NO_CONTEXT',
        widgetId: 'MW_NO_CONTEXT' as WidgetId,
        underlyingChartId: 'CH_NO_CONTEXT',
        parameters: [],
      }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_NO_CONTEXT' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_AAPL',
      parameters: [],
      detail: 'snippet',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        identity: { widgetId: 'MW_NO_CONTEXT' as WidgetId },
        input: 'Selected Context',
        problem: 'malformed',
      },
    });
  });

  it('rejects an unknown full-read parameter before minting a Config', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNKNOWN_FULL': () => ({
        id: 'MW_UNKNOWN_FULL',
        title: 'Unknown full',
        underlyingChartId: 'DV_UNKNOWN_FULL',
        visualizationType: 'DataViz',
        renderParams: { component: { tenor: '1y' }, controls: [] },
        parameters: [],
      }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_UNKNOWN_FULL' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'nope', value: 'v' }],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'unknown-input',
        identity: { widgetId: 'MW_UNKNOWN_FULL' as WidgetId },
        input: 'nope',
        candidates: ['tenor'],
      },
    });
    expect(adapter.calls).toHaveLength(1);
  });

  it('does not treat an applicable context as a Selected Context', async () => {
    const applicableAsset = `MA${'C'.repeat(14)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_APPLICABLE_CONTEXT',
        widgetId: 'MW_APPLICABLE_CONTEXT' as WidgetId,
        underlyingChartId: 'CH_APPLICABLE_CONTEXT',
        parameters: [],
      }),
      '/v1/marketview/widgets/MW_APPLICABLE_CONTEXT': () => ({
        id: 'MW_APPLICABLE_CONTEXT',
        title: 'Applicable context',
        useEntityTitle: true,
        metadata: { title: 'Applicable context', entityMetadata: {} },
        underlyingChartId: 'CH_APPLICABLE_CONTEXT',
        visualizationType: 'Plot',
        contextParameter: {
          field: 'Asset',
          options: [null, '', applicableAsset],
          values: {},
          elementType: 'asset',
        },
        supportedContexts: [applicableAsset],
        parameters: [],
        renderParams: { controls: [] },
      }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_APPLICABLE_CONTEXT' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: { parameterLines: ['asset=', 'relativeDate='] },
      },
    });
    expect(adapter.calls).toHaveLength(2);
  });

  it('fails loud on default Config endpoint failures for a private Snippet', async () => {
    const body = '{"detail": "rate limit exceeded"}';
    const result = await createWidget(createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CONFIGURE/metadata') {
        return { metadata: {} };
      }
      if (path === '/v1/marketview/widgets/MW_CONFIGURE') {
        return {
          id: 'MW_CONFIGURE',
          title: 'Configured',
          underlyingChartId: 'CH_CONFIGURE',
          renderParams: {
            component: { asset: 'MA_AAPL' },
            controls: [{ id: 'asset', type: 'Asset', value: 'MA_AAPL' }],
          },
          parameters: [],
        };
      }
      throw new MarqueeError(
        'http',
        'Marquee returned 429 for /v1/marketview/widgets/configurations',
        {
          path: '/v1/marketview/widgets/configurations',
          status: 429,
          body,
          responseClassification: 'http_status',
        },
      );
    })).get({
      widgetId: 'MW_CONFIGURE' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'asset', value: 'MA_AAPL' }],
      detail: 'snippet',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW_CONFIGURE' as WidgetId },
        failure: { kind: 'rate-limited' },
      },
    });
  });

  it('shows a Control Group Selected Context as Unknown in a snippet but fails a full render, without listing its members', async () => {
    const controlGroupId = `CG${'A'.repeat(14)}`;
    const memberId = `MA${'B'.repeat(14)}`;
    const adapter = createFakeRequestAdapter((path) => {
      throw new Error(`unexpected ${path}`);
    });
    const runtime = createWidgetProductionModule(adapter, {
      controlGroup: createControlGroupModule(adapter),
      entity: createEntityModule(adapter),
    });
    const input = widgetValues('CONTROL_GROUP_CONTEXT', {
      title: { embedded: 'Control Group context', fallback: 'Fallback', useEntityTitle: true },
      contextParameter: {
        field: 'Basket',
        type: 'Asset',
        kinds: ['asset', 'control-group'],
        value: controlGroupId,
        options: [controlGroupId, memberId],
      },
      entityLabels: [{ identity: memberId, label: 'Member' }],
    });

    await expect(renderTestValues(runtime, input, 'snippet')).resolves.toMatchObject({
      ok: true,
      value: { snippet: { parameterLines: ['basket=Unknown'] } },
    });
    await expect(renderTestValues(runtime, input, 'full')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_CONTROL_GROUP_CONTEXT' as WidgetId },
        source: 'widget',
        problem: 'selected-context-control-group',
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('fails invalid-response when a Data Viz Widget has no configuration', async () => {
    const assetId = `MA${'A'.repeat(14)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/data/visualizations/DV_UNRECORDED_DATA_VIZ': () => ({}),
      '/v1/data/visualizations/DV_UNRECORDED_DATA_VIZ/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });
    const runtime = createWidgetProductionModule(adapter, {
      controlGroup: createControlGroupModule(adapter),
      entity: createEntityModule(adapter),
    });

    const result = await renderTestValues(runtime, widgetValues('UNRECORDED_DATA_VIZ', {
      configurationId: null,
      configuration: null,
      title: { embedded: 'Unrecorded Data Viz', fallback: 'Fallback', useEntityTitle: false },
      contextParameter: {
        field: 'Basket',
        type: 'Asset',
        kinds: ['asset'],
        value: assetId,
        options: [assetId],
      },
      entityLabels: [{ identity: assetId, label: 'Member' }],
    }), 'full');

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_UNRECORDED_DATA_VIZ' as WidgetId },
        source: 'widget',
        problem: 'data-viz-configuration-missing',
      },
    });
  });

  it('carries Control Group failures through the Widget result boundary', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CONTROL_GROUP_FAILURE') {
        return {
          id: 'MW_CONTROL_GROUP_FAILURE',
          title: 'Control Group',
          contextParameter: {
            field: 'Asset',
            options: [`CG${'K'.repeat(15)}`],
            values: { default: 'MA_DEFAULT' },
            type: 'Asset',
          },
          parameters: [],
          supportedContexts: [`CG${'K'.repeat(15)}`],
          underlyingChartId: 'CH_CONTROL_GROUP_FAILURE',
          renderParams: {
            controls: [{ id: 'Asset', type: 'Asset', value: 'MA_DEFAULT' }],
          },
          metadata: { title: 'Control Group' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return [{
          id: 'WC_CONTROL_GROUP_FAILURE',
          widgetId: 'MW_CONTROL_GROUP_FAILURE' as WidgetId,
          underlyingChartId: 'CH_CONTROL_GROUP_FAILURE',
          parameters: [],
        }];
      }
      if (path === '/v1/marketview/constituents') {
        throw new MarqueeError('http', 'Too many requests', { status: 429, path });
      }
      throw new Error(`unexpected ${path}`);
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_CONTROL_GROUP_FAILURE' as WidgetId,
      configurationId: 'WC_CONTROL_GROUP_FAILURE' as ConfigId,
      parameters: [{ field: 'asset', value: 'MSFT' }],
      detail: 'snippet',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'control-group-resolution-failure',
        identity: { widgetId: 'MW_CONTROL_GROUP_FAILURE' as WidgetId },
        failure: {
          kind: 'dependency',
          controlGroupIds: [`CG${'K'.repeat(15)}`],
          failure: { kind: 'rate-limited' },
        },
      },
    });
  });

  it('reuses embedded labels while resolving an available Control Group', async () => {
    const assetId = `MA${'D'.repeat(14)}`;
    const unrelatedControlGroupId = `CG${'E'.repeat(16)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/data/visualizations/DV_EMBEDDED_ENTITY': () => ({}),
      '/v1/data/visualizations/DV_EMBEDDED_ENTITY/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
      '/v1/marketview/constituents': () => ({
        results: [{
          constituentId: `MA${'H'.repeat(16)}`,
          name: 'Available basket member',
          controlGroups: [unrelatedControlGroupId],
        }],
      }),
      '/v1/plots/entities': () => ({
        assets: [{
          id: assetId,
          name: 'Embedded asset',
        }],
      }),
    });

    const result = await renderTestValues(
      createWidgetProductionModule(adapter, {
        controlGroup: createControlGroupModule(adapter),
        entity: createEntityModule(adapter),
      }),
      widgetValues('EMBEDDED_ENTITY', {
        title: { embedded: 'Embedded Entity', fallback: 'Fallback', useEntityTitle: true },
        contextParameter: {
          field: 'Asset',
          type: 'Asset',
          kinds: ['asset'],
          value: assetId,
          options: [assetId, unrelatedControlGroupId],
        },
        entityLabels: [{ identity: assetId, label: 'Embedded asset' }],
      }),
      'full',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        snippet: { parameterLines: ['asset=Embedded asset'] },
      },
    });
    expect(adapter.calls.filter(({ path }) => path === '/v1/plots/entities'))
      .toEqual([]);
    expect(adapter.calls.filter(({ path }) => path === '/v1/marketview/constituents'))
      .toHaveLength(1);
  });

  it.each([
    ['Asset', 'embedded'],
    ['Cross', 'embedded'],
    ['Asset', 'assignment'],
    ['Cross', 'assignment'],
  ] as const)('preserves %s %s display evidence when expanding opaque Control Group members', async (
    field,
    evidence,
  ) => {
    const assetId = `MA${'K'.repeat(16)}`;
    const controlGroupId = `CG${'L'.repeat(16)}`;
    const adapter = createFakeRequestAdapter({
      '/v1/data/visualizations/DV_PRESERVED_EVIDENCE': () => ({}),
      '/v1/data/visualizations/DV_PRESERVED_EVIDENCE/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
      '/v1/marketview/constituents': () => ({
        results: [{
          constituentId: assetId,
          name: assetId,
          controlGroups: [controlGroupId],
        }],
      }),
    });
    const input = widgetValues('PRESERVED_EVIDENCE', {
      title: { embedded: 'Currency pair', fallback: 'Fallback', useEntityTitle: true },
      contextParameter: {
        field,
        type: 'Asset',
        kinds: ['asset'],
        value: assetId,
        options: [assetId, controlGroupId],
      },
      entityLabels: evidence === 'embedded'
        ? [{ identity: assetId, label: 'EURUSD' }]
        : [],
    });
    const result = await renderTestValues(
      createWidgetProductionModule(adapter, {
        controlGroup: createControlGroupModule(adapter),
        entity: createEntityModule(adapter),
      }),
      {
        ...input,
        parameters: evidence === 'assignment'
          ? [{ field, value: assetId, displayValue: 'EURUSD' }]
          : [],
      },
      'full',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        snippet: { parameterLines: [field === 'Asset' ? 'asset=EURUSD' : 'cross=EURUSD'] },
        widget: {
          parameters: [{
            field,
            default: 'EURUSD',
            rawDefault: assetId,
          }],
        },
      },
    });
  });

  it.each(['Asset', 'Cross'] as const)(
    'preserves %s labels through an override and saved Config reload with opaque Control Group names',
    async (field) => {
      const assetId = `MA${'K'.repeat(16)}`;
      const originalAssetId = `MA${'M'.repeat(16)}`;
      const controlGroupId = `CG${'L'.repeat(16)}`;
      const savedConfiguration = {
        id: 'WC_PRESERVED_RELOAD',
        widgetId: 'MW_PRESERVED_RELOAD',
        underlyingChartId: 'DV_PRESERVED_RELOAD',
        parameters: [{ field, value: assetId }],
        metadata: { entityMetadata: { [assetId]: { name: 'EURUSD' } } },
      };
      const adapter = createFakeRequestAdapter((path, init) => {
        if (path === '/v1/marketview/widgets/MW_PRESERVED_RELOAD') {
          return {
            id: 'MW_PRESERVED_RELOAD',
            title: 'Currency pair',
            underlyingChartId: 'DV_PRESERVED_RELOAD',
            visualizationType: 'DataViz',
            useEntityTitle: true,
            contextParameter: {
              field,
              type: 'Asset',
              options: [originalAssetId, controlGroupId],
              values: { default: originalAssetId },
            },
            renderParams: { component: { [field]: originalAssetId }, controls: [] },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          if (init?.method === 'POST') {
            expect(init.body).toMatchObject({ parameters: [{ field, value: assetId }] });
            return savedConfiguration;
          }
          return [savedConfiguration];
        }
        if (path === '/v1/plots/entities') {
          return { assets: [{ id: assetId, name: 'EURUSD' }, { id: originalAssetId, name: 'USDJPY' }] };
        }
        if (path === '/v1/marketview/constituents') {
          return { results: [{
            constituentId: assetId,
            name: init?.query?.query === 'EURUSD' ? 'EURUSD' : assetId,
            controlGroups: [controlGroupId],
          }] };
        }
        if (path === '/v1/data/visualizations/DV_PRESERVED_RELOAD') return {};
        if (path === '/v1/data/visualizations/DV_PRESERVED_RELOAD/render') {
          return { renderData: { data: [], layout: {} } };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      });
      const widget = createWidget(adapter);
      const overridden = await widget.get({
        widgetId: 'MW_PRESERVED_RELOAD' as WidgetId,
        configurationId: null,
        parameters: [{ field: field.toLowerCase(), value: 'EURUSD' }],
        detail: 'full',
      });
      expect(overridden).toMatchObject({
        ok: true,
        value: {
          snippet: { parameterLines: [field === 'Asset' ? 'asset=EURUSD' : 'cross=EURUSD'] },
          widget: {
            configurationId: 'WC_PRESERVED_RELOAD',
            parameters: [{ field, default: 'EURUSD', rawDefault: assetId }],
          },
        },
      });
      if (!overridden.ok) throw new Error(JSON.stringify(overridden.error));
      const reloaded = await createWidget(adapter).get({
        widgetId: 'MW_PRESERVED_RELOAD' as WidgetId,
        configurationId: overridden.value.widget.configurationId,
        parameters: [],
        detail: 'full',
      });
      expect(reloaded).toMatchObject({
        ok: true,
        value: {
          snippet: { parameterLines: [field === 'Asset' ? 'asset=EURUSD' : 'cross=EURUSD'] },
          widget: {
            configurationId: 'WC_PRESERVED_RELOAD',
            parameters: [{ field, default: 'EURUSD', rawDefault: assetId }],
          },
        },
      });
    },
  );

  it('resolves current and remaining full options in one Entity request', async () => {
    const assetId = `MA${'F'.repeat(16)}`;
    const unrelatedAssetId = `MA${'G'.repeat(16)}`;
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/data/visualizations/DV_CURRENT_ENTITY') return {};
      if (path === '/v1/data/visualizations/DV_CURRENT_ENTITY/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      if (path === '/v1/plots/entities') {
        const ids = Array.isArray(init?.query?.ids) ? init.query.ids : [];
        return {
          assets: ids.map((id) => ({
            id,
            name: id === assetId ? 'Current asset' : 'Available asset',
          })),
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const result = await renderTestValues(
      createWidgetProductionModule(adapter, {
        controlGroup: createControlGroupModule(adapter),
        entity: createEntityModule(adapter),
      }),
      {
        ...widgetValues('CURRENT_ENTITY', {
          title: { embedded: 'Current Entity', fallback: 'Fallback', useEntityTitle: true },
          contextParameter: {
            field: 'Asset',
            type: 'Asset',
            kinds: ['asset'],
            value: assetId,
            options: [assetId, unrelatedAssetId],
          },
        }),
        selectedContext: { kind: 'asset', entityId: assetId },
      },
      'full',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
      },
    });
    expect(adapter.calls
      .filter(({ path }) => path === '/v1/plots/entities')
      .map(({ init }) => init?.query?.ids)).toEqual([
        [assetId, unrelatedAssetId],
      ]);
  });

  it('renders a Base Component Widget through the component resource', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/data/components/DV_BASE_COMPONENT': () => ({}),
      '/v1/data/components/DV_BASE_COMPONENT/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });

    const result = await renderTestValues(
      createWidgetProductionModule(adapter, {
        controlGroup: createControlGroupModule(adapter),
        entity: createEntityModule(adapter),
      }),
      widgetValues('BASE_COMPONENT', {
        title: { embedded: 'Base Component', fallback: 'Fallback', useEntityTitle: false },
        target: { family: 'data-viz', targetId: 'DV_BASE_COMPONENT', route: 'component' },
      }),
      'full',
    );

    expect(result).toMatchObject({ ok: true, value: { detail: 'full' } });
    expect(adapter.calls.map(({ path }) => path)).toContain(
      '/v1/data/components/DV_BASE_COMPONENT/render',
    );
  });

  it('drops a not-found option while keeping truthful and delisted labels', async () => {
    const assetId = `MA${'H'.repeat(16)}`;
    const missingAssetId = `MA${'I'.repeat(16)}`;
    const delistedAssetId = `MA${'J'.repeat(16)}`;
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/data/visualizations/DV_MISSING_OPTION') return {};
      if (path === '/v1/data/visualizations/DV_MISSING_OPTION/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') {
        return { results: [] };
      }
      if (path === '/v1/plots/entities') {
        const ids = Array.isArray(init?.query?.ids) ? init.query.ids : [];
        return {
          assets: ids.flatMap((id) => {
            if (id === assetId) return [{ id, name: 'Available asset' }];
            if (id === delistedAssetId) {
              return [{ id, name: 'Delisted asset', delisted: 'yes' }];
            }
            return [];
          }),
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createWidgetProductionModule(adapter, {
      controlGroup: createControlGroupModule(adapter),
      entity: createEntityModule(adapter),
    });
    const contextParameter = {
      field: 'Asset',
      type: 'Asset',
      kinds: ['asset'],
      value: assetId,
      options: [assetId, missingAssetId, delistedAssetId],
    } as const;
    const input = {
      ...widgetValues('MISSING_OPTION', {
        title: { embedded: 'Missing option', fallback: 'Fallback', useEntityTitle: true },
        contextParameter,
      }),
      selectedContext: { kind: 'asset', entityId: assetId },
    } as const;
    const result = await renderTestValues(
      module,
      input,
      'full',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          parameters: [{
            rawValues: [assetId, delistedAssetId],
            options: [
              { rawValue: assetId, label: 'Available asset' },
              { rawValue: delistedAssetId, label: 'Delisted asset' },
            ],
          }],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(missingAssetId);

    const callsBeforeRequiredMiss = adapter.calls.length;
    await expect(renderTestValues(
      module,
      {
        ...input,
        widget: {
          ...input.widget,
          contextParameter: {
            ...contextParameter,
            value: missingAssetId,
          },
        },
        selectedContext: { kind: 'asset', entityId: missingAssetId },
      },
      'full',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'missing-display-evidence',
        identity: { widgetId: 'MW_MISSING_OPTION' as WidgetId },
        field: 'Asset',
        identifier: { kind: 'asset', value: missingAssetId },
      },
    });
    expect(adapter.calls.slice(callsBeforeRequiredMiss)).toEqual([
      expect.objectContaining({
        path: '/v1/data/visualizations/DV_MISSING_OPTION',
      }),
      expect.objectContaining({
        path: '/v1/marketview/dashboards',
      }),
      {
        path: '/v1/plots/entities',
        init: { method: 'GET', query: { ids: [missingAssetId] } },
      },
      expect.objectContaining({
        path: '/v1/data/visualizations/DV_MISSING_OPTION/render',
      }),
    ]);
  });

  it('resolves Dashboard persistence anchors behind the Widget seam', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/configurations': () => ({ underlyingChartId: 'CH_ANCHOR', parameters: [] }),
    });
    const resolveConfiguration = vi.fn(async () => ({
      ok: true as const,
      value: {
        relativeDate: '5y',
      },
    }));

    await expect(createWidgetPersistenceAnchorPort(adapter, { resolveConfiguration }).resolve(' WC_ANCHOR ')).resolves.toEqual({
      ok: true,
      value: {
        parameters: [],
        relativeDate: '5y',
      },
    });
    expect(resolveConfiguration).toHaveBeenCalledWith('CH_ANCHOR');
    expect(adapter.calls).toEqual([
      {
        path: '/v1/marketview/widgets/configurations',
        init: { method: 'GET', query: { id: 'WC_ANCHOR' } },
      },
    ]);
  });

  it('resolves Dashboard persistence anchors through the projection port', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/configurations': () => ({ underlyingChartId: 'CH_PUBLIC_ANCHOR', parameters: [] }),
      '/v1/charts/CH_PUBLIC_ANCHOR': () => ({
        description: 'USD.foo()',
        chartType: 'line',
        expressions: [],
        relativeStartDate: '-1y',
        interval: 'Daily',
      }),
    });

    await expect(createWidgetConfigurationProjectionPort(adapter).resolve('WC_PUBLIC_ANCHOR')).resolves.toEqual({
      ok: true,
      value: {
        parameters: [],
        relativeDate: '1y',
      },
    });
  });

  it.each([
    [
      { kind: 'chart-access-denied' as const, chartId: 'CH_DENIED', message: 'Chart access denied' },
      { kind: 'access-denied' },
    ],
    [
      {
        kind: 'chart-load-failed' as const,
        chartId: 'CH_AUTH',
        failure: { kind: 'authentication-required' as const, realm: 'marquee' as const },
        message: 'Chart authentication required',
      },
      { kind: 'dependency', failure: { kind: 'authentication-required', realm: 'marquee' } },
    ],
    [
      {
        kind: 'chart-load-failed' as const,
        chartId: 'CH_CANCELLED',
        failure: { kind: 'cancelled' as const },
        message: 'Chart request cancelled',
      },
      { kind: 'dependency', failure: { kind: 'cancelled' } },
    ],
  ])('preserves typed PlotTool Pro failure %s for Dashboard persistence anchors', async (error, expected) => {
    const adapter = createFakeRequestAdapter(() => ({
      underlyingChartId: error.chartId,
      parameters: [],
    }));
    const resolveConfiguration = vi.fn(async () => ({ ok: false as const, error }));

    await expect(
      createWidgetPersistenceAnchorPort(adapter, { resolveConfiguration }).resolve('WC_FAILURE'),
    ).resolves.toMatchObject({ ok: false, error: expected });
  });

  it('fails invalid-response on a malformed Dashboard persistence anchor', async () => {
    const projection = createWidgetConfigurationProjectionPort(
      createFakeRequestAdapter(() => ({ modifiedParameters: 'bogus', parameters: [] })),
    );

    await expect(projection.resolve('WC_BAD')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: '' },
        source: 'configuration',
        problem: 'unsupported-payload-shape',
        detail: 'configuration.modifiedParameters is not an array',
      },
    });
  });

  it('preserves contextual defaults for standalone full Widget rendering', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_DEFAULT') {
        return {
          id: 'MW_DEFAULT',
          title: 'Default Widget',
          underlyingChartId: 'CH_DEFAULT',
          contextParameter: {
            field: 'asset',
            values: { default: 'MA_AAPL' },
          },
          renderParams: {
            component: {},
            controls: [],
          },
          parameters: [],
          metadata: { title: 'Default Widget' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        expect(init).toEqual({
          method: 'POST',
          body: {
            widgetId: 'MW_DEFAULT' as WidgetId,
            underlyingChartId: 'CH_DEFAULT',
            parameters: [{ field: 'asset', value: 'MA_AAPL' }],
          },
        });
        return [{ id: 'WC_DEFAULT' }];
      }
      if (path === '/v1/charts/CH_DEFAULT') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/entities') {
        return [{ id: 'MA_AAPL', name: 'Example Corp', type: 'Asset' }];
      }
      if (path === '/v1/marketview/dashboards') {
        return { results: [] };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['USD.foo()'],
          results: [{ type: 'series', values: { '2026-07-28': 1 } }],
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    await createCapabilities(adapter).prepare({
      source: { kind: 'id', id: 'MW_DEFAULT' },
      mode: 'summary',
      data: 'skip',
      canonicalConfiguration: 'required',
    });

    expect(adapter.calls).toContainEqual(expect.objectContaining({
      path: '/v1/marketview/widgets/configurations',
      init: expect.objectContaining({
        body: {
          widgetId: 'MW_DEFAULT' as WidgetId,
          underlyingChartId: 'CH_DEFAULT',
          parameters: [{ field: 'asset', value: 'MA_AAPL' }],
        },
      }),
    }));
  });

  it('applies a saved Config value to its Widget render control', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONFIGURED_CONTROL') {
        return {
          id: 'MW_CONFIGURED_CONTROL',
          title: 'Configured control',
          underlyingChartId: 'DV_CONFIGURED_CONTROL',
          visualizationType: 'DataViz',
          renderParams: {
            component: {},
            controls: [
              { id: 'tenor', type: 'Enum', value: '1M', values: ['1M', '3M'] },
              { id: 'region', type: 'Enum', value: 'US', values: ['US', 'EU'] },
            ],
          },
          parameters: [],
          metadata: { title: 'Configured control' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_CONFIGURED_CONTROL',
          widgetId: 'MW_CONFIGURED_CONTROL' as WidgetId,
          underlyingChartId: 'DV_CONFIGURED_CONTROL',
          parameters: [{ field: 'tenor', value: '3M' }],
        };
      }
      if (path === '/v1/data/visualizations/DV_CONFIGURED_CONTROL') return {};
      if (path === '/v1/data/visualizations/DV_CONFIGURED_CONTROL/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONFIGURED_CONTROL' as WidgetId,
      configurationId: 'WC_CONFIGURED_CONTROL' as ConfigId,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          bindings: [
            { field: 'tenor', value: '3M' },
            { field: 'region', value: 'US' },
          ],
        },
      },
    });
  });

  it.each([
    [
      'reads a Widget parameter default absent from the render component',
      { controls: [] },
      { ok: true, value: { widget: { bindings: [{ field: 'universe', value: 'G10' }] } } },
    ],
    [
      'fails loud on a Widget render control with a null value',
      { controls: [{ id: 'tenor', type: 'Enum', value: null, values: ['1M', '3M'] }] },
      {
        ok: false,
        error: {
          kind: 'invalid-response',
          source: 'widget',
          problem: 'render-control-value-missing',
        },
      },
    ],
  ])('%s', async (_name, renderParams, expected) => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_PARAMETER_DEFAULT') {
        return {
          id: 'MW_PARAMETER_DEFAULT',
          title: 'Parameter default',
          underlyingChartId: 'DV_PARAMETER_DEFAULT',
          visualizationType: 'DataViz',
          renderParams: { component: {}, ...renderParams },
          parameters: [
            { field: 'universe', type: 'Enum', values: { default: 'G10' }, options: ['G10', 'Latam'] },
          ],
          metadata: { title: 'Parameter default' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_PARAMETER_DEFAULT',
          widgetId: 'MW_PARAMETER_DEFAULT' as WidgetId,
          underlyingChartId: 'DV_PARAMETER_DEFAULT',
          parameters: [],
        };
      }
      if (path === '/v1/data/visualizations/DV_PARAMETER_DEFAULT') return {};
      if (path === '/v1/data/visualizations/DV_PARAMETER_DEFAULT/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_PARAMETER_DEFAULT' as WidgetId,
      configurationId: 'WC_PARAMETER_DEFAULT' as ConfigId,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject(expected);
  });

  it('mints the default Widget Config before a full read without one', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_DEFAULT_CONFIG') {
        return {
          id: 'MW_DEFAULT_CONFIG',
          title: 'Default config',
          underlyingChartId: 'DV_DEFAULT_CONFIG',
          visualizationType: 'DataViz',
          renderParams: {
            component: {},
            controls: [{ id: 'tenor', type: 'Enum', value: '1M', values: ['1M', '3M'] }],
          },
          parameters: [],
          metadata: { title: 'Default config' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_DEFAULT_CONFIG',
          widgetId: 'MW_DEFAULT_CONFIG' as WidgetId,
          underlyingChartId: 'DV_DEFAULT_CONFIG',
          parameters: [{ field: 'tenor', value: '3M' }],
        };
      }
      if (path === '/v1/data/visualizations/DV_DEFAULT_CONFIG') return {};
      if (path === '/v1/data/visualizations/DV_DEFAULT_CONFIG/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_DEFAULT_CONFIG' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          configurationId: 'WC_DEFAULT_CONFIG' as ConfigId,
          bindings: [{ field: 'tenor', value: '3M' }],
        },
      },
    });
    expect(adapter.calls[1]).toEqual({
      path: '/v1/marketview/widgets/configurations',
      init: {
        method: 'POST',
        body: { widgetId: 'MW_DEFAULT_CONFIG' as WidgetId, underlyingChartId: 'DV_DEFAULT_CONFIG', parameters: [] },
      },
    });
  });

  it('saves the relative Date option matching the current rule when a Config changes', async () => {
    // A saved value later than every option survives the relative-date refresh.
    const savedToday = { rdate: { rule: '0b' }, value: '2026-09-30' };
    const yesterday = { rdate: { rule: '-1b' }, value: '2026-09-25' };
    const today = { rdate: { rule: '0b' }, value: '2026-09-26' };
    let configurationBody: unknown;
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_RELATIVE_DATE') {
        return {
          id: 'MW_RELATIVE_DATE',
          title: 'Relative date',
          underlyingChartId: 'DV_RELATIVE_DATE',
          visualizationType: 'DataViz',
          renderParams: { component: { pricingDate: savedToday, asOf: '2026-09-01', region: 'US' } },
          parameters: [
            { field: 'pricingDate', type: 'Date', values: { default: savedToday }, options: [yesterday, today] },
            { field: 'asOf', type: 'Date', values: { default: '2026-09-01' }, options: ['2026-08-01', '2026-09-01'] },
            { field: 'region', type: 'Enum', values: { default: 'US' }, options: ['US', 'EU'] },
          ],
          metadata: { title: 'Relative date' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        if (init?.method === 'POST') configurationBody = init.body;
        return {
          id: init?.method === 'POST' ? 'WC_RELATIVE_DATE_NEW' : 'WC_RELATIVE_DATE',
          widgetId: 'MW_RELATIVE_DATE' as WidgetId,
          underlyingChartId: 'DV_RELATIVE_DATE',
          parameters: [],
        };
      }
      if (path === '/v1/data/visualizations/DV_RELATIVE_DATE') return {};
      if (path === '/v1/data/visualizations/DV_RELATIVE_DATE/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_RELATIVE_DATE' as WidgetId,
      configurationId: 'WC_RELATIVE_DATE' as ConfigId,
      parameters: [{ field: 'region', value: 'EU' }],
      detail: 'full',
    });

    expect(result.ok).toBe(true);
    expect(configurationBody).toEqual({
      parameters: [
        { field: 'pricingDate', value: today },
        { field: 'asOf', value: '2026-09-01' },
        { field: 'region', value: 'EU' },
      ],
      widgetId: 'MW_RELATIVE_DATE' as WidgetId,
      underlyingChartId: 'DV_RELATIVE_DATE',
    });
  });

  it('fails loud when configuration detail parameters are malformed', async () => {
    const widget = {
      id: 'MW_MALFORMED_CONFIG_PARAMS',
      title: 'What is the monthly flow for ETFs listed in <countryId:US>?',
      underlyingChartId: 'CH_MALFORMED_CONFIG_PARAMS',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {
        title: 'What is the monthly flow for ETFs listed in Unknown Value?',
      },
    };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_MALFORMED_CONFIG_PARAMS': () => (widget),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_MALFORMED_CONFIG_PARAMS',
        widgetId: 'MW_MALFORMED_CONFIG_PARAMS' as WidgetId,
        underlyingChartId: 'CH_MALFORMED_CONFIG_PARAMS',
        metadata: {
          title: 'What is the monthly flow for ETFs listed in Japan?',
        },
        parameters: { field: 'countryId', value: 'JP' },
      }),
      '/v1/charts/CH_MALFORMED_CONFIG_PARAMS': () => ({
        expressions: [{ label: 'Monthly Flow' }],
        relativeStartDate: '-1y',
        interval: 'Monthly',
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_MALFORMED_CONFIG_PARAMS', configurationId: 'WC_MALFORMED_CONFIG_PARAMS' },
      mode: 'summary',
      data: 'skip',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('malformed configuration detail should fail the widget read');
    expect(result.error).toEqual({
      kind: 'invalid-response',
      identity: { widgetId: 'MW_MALFORMED_CONFIG_PARAMS' as WidgetId },
      source: 'configuration',
      problem: 'parameters-not-array',
    });
    expect(result.error).not.toHaveProperty('message');
  });

  it('fails loud when configuration detail parameter entries are malformed', async () => {
    const widget = {
      id: 'MW_MALFORMED_CONFIG_PARAM_ENTRY',
      title: 'What is the monthly flow for ETFs listed in <countryId:US>?',
      underlyingChartId: 'CH_MALFORMED_CONFIG_PARAM_ENTRY',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {
        title: 'What is the monthly flow for ETFs listed in Unknown Value?',
      },
    };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_MALFORMED_CONFIG_PARAM_ENTRY': () => (widget),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_MALFORMED_CONFIG_PARAM_ENTRY',
        widgetId: 'MW_MALFORMED_CONFIG_PARAM_ENTRY' as WidgetId,
        underlyingChartId: 'CH_MALFORMED_CONFIG_PARAM_ENTRY',
        metadata: {
          title: 'What is the monthly flow for ETFs listed in Japan?',
        },
        parameters: [
          'countryId',
          { field: 'countryId', value: 'JP' },
        ],
      }),
      '/v1/charts/CH_MALFORMED_CONFIG_PARAM_ENTRY': () => ({
        expressions: [{ label: 'Monthly Flow' }],
        relativeStartDate: '-1y',
        interval: 'Monthly',
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_MALFORMED_CONFIG_PARAM_ENTRY', configurationId: 'WC_MALFORMED_CONFIG_PARAM_ENTRY' },
      mode: 'summary',
      data: 'skip',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('malformed configuration parameter entry should fail the widget read');
    expect(result.error).toEqual({
      kind: 'invalid-response',
      identity: { widgetId: 'MW_MALFORMED_CONFIG_PARAM_ENTRY' as WidgetId },
      source: 'configuration',
      problem: 'parameter-not-record',
      index: 0,
    });
    expect(result.error).not.toHaveProperty('message');
  });

  it.each([
    [
      'a configuration parameter has no value',
      { id: 'WC_UNRECORDED', parameters: [{ field: 'countryId' }] },
      { problem: 'parameter-value-missing', index: 0 },
    ],
    [
      'the configuration has no id',
      { parameters: [{ field: 'countryId', value: 'JP' }] },
      { problem: 'configuration-id-missing' },
    ],
    [
      'calculated dates arrive without a relative date',
      {
        id: 'WC_UNRECORDED',
        parameters: [],
        calculatedDates: { startDate: '2026-01-28', endDate: '2026-07-28', interval: '1D' },
      },
      { problem: 'calculated-dates-without-relative-date' },
    ],
  ])('fails loud when %s', async (_name, configuration, expected) => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNRECORDED_CONFIG': () => ({
        id: 'MW_UNRECORDED_CONFIG',
        title: 'Unrecorded Config',
        underlyingChartId: 'CH_UNRECORDED_CONFIG',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: {},
      }),
      '/v1/marketview/widgets/configurations': () => (configuration),
      '/v1/charts/CH_UNRECORDED_CONFIG': () => ({ expressions: [{ label: 'Flow' }], relativeStartDate: '-1y', interval: 'Monthly' }),
    });

    const result = await createCapabilities(adapter).prepare({
      source: { kind: 'id', id: 'MW_UNRECORDED_CONFIG', configurationId: 'WC_UNRECORDED' },
      mode: 'summary',
      data: 'skip',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_UNRECORDED_CONFIG' as WidgetId },
        source: 'configuration',
        ...expected,
      },
    });
  });

  it.each([
    [
      'the widget has no parameters',
      { parameters: undefined },
      [{ field: 'countryId', value: 'JP' }],
      [],
      'parameters-missing',
    ],
    [
      'a widget parameter has no field',
      { parameters: [{ type: 'Enum', values: { default: 'US' } }] },
      [{ field: 'countryId', value: 'JP' }],
      [],
      'parameter-field-missing',
    ],
    [
      'a configured widget parameter has non-record values',
      {
        renderParams: { component: { countryId: 'US' }, controls: [] },
        parameters: [{ field: 'countryId', type: 'Enum', values: 'US' }],
      },
      [{ field: 'countryId', value: 'JP' }],
      [],
      'parameter-values-not-record',
    ],
    [
      'a render control has no value',
      { renderParams: { component: {}, controls: [{ id: 'lookback' }] } },
      [],
      [],
      'render-control-value-missing',
    ],
    [
      'the context parameter names a Control Group',
      {
        contextParameter: {
          field: 'Control Group',
          options: [`CG${'A'.repeat(14)}`],
          values: { default: `CG${'A'.repeat(14)}` },
        },
      },
      [],
      [],
      'context-parameter-control-group',
    ],
    [
      'a Date parameter has no default',
      {
        renderParams: { component: { start: '2026-01-01', countryId: 'US' }, controls: [] },
        parameters: [
          { field: 'start', type: 'Date', values: {} },
          { field: 'countryId', type: 'Enum', options: ['US', 'JP'], values: { default: 'US' } },
        ],
      },
      [],
      [{ field: 'countryId', value: 'JP' }],
      'date-parameter-default-missing',
    ],
  ])('fails invalid-response when %s', async (_name, widgetOverrides, configurationParameters, assignments, problem) => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNRECORDED_WIDGET': () => ({
        id: 'MW_UNRECORDED_WIDGET',
        title: 'Unrecorded Widget',
        underlyingChartId: 'CH_UNRECORDED_WIDGET',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: {},
        ...widgetOverrides,
      }),
      '/v1/marketview/widgets/configurations': () => ({ id: 'WC_UNRECORDED_WIDGET', parameters: configurationParameters }),
      '/v1/charts/CH_UNRECORDED_WIDGET': () => ({ expressions: [{ label: 'Flow' }], relativeStartDate: '-1y', interval: 'Monthly' }),
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_UNRECORDED_WIDGET' as WidgetId,
      configurationId: 'WC_UNRECORDED_WIDGET' as ConfigId,
      parameters: assignments,
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_UNRECORDED_WIDGET' as WidgetId },
        source: 'widget',
        problem,
      },
    });
  });

  it('fails invalid-response with the reason when the Widget Payload shape is unsupported', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_DATA_ENVELOPE': () => ({ data: { id: 'MW_DATA_ENVELOPE' } }),
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_DATA_ENVELOPE' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_DATA_ENVELOPE' as WidgetId },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'widget response uses a data envelope',
      },
    });
  });

  it('fails invalid-response when rendered Widget Definition uses a data envelope', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      throw new Error(`unexpected ${path}`);
    });

    const result = await createWidget(adapter).render(
      { data: { id: 'MW_DATA_ENVELOPE' } },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: '' },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'widget response uses a data envelope',
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('fails invalid-response when rendered Widget Dates carry a malformed Relative Date', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      throw new Error(`unexpected ${path}`);
    });

    const result = await createWidget(adapter).render(
      {
        id: 'MW_MALFORMED_WIDGET_DATES',
        title: 'Malformed Widget Dates',
        underlyingChartId: 'CH_MALFORMED_WIDGET_DATES',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: { title: 'Malformed Widget Dates' },
      },
      [],
      null,
      { startDate: '2026-01-01', endDate: '2026-02-01', interval: '1d', relativeDate: 'SOON' },
      'full',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_MALFORMED_WIDGET_DATES' as WidgetId },
        source: 'widget',
        problem: 'render-input-invalid',
      },
    });
    expect(adapter.calls).toEqual([]);
  });

  it('fails loud when widget render controls are malformed during configuration merge', async () => {
    const widget = {
      id: 'MW_MALFORMED_RENDER_CONTROLS',
      title: 'What is the monthly flow for ETFs listed in <countryId:US>?',
      underlyingChartId: 'CH_MALFORMED_RENDER_CONTROLS',
      renderParams: { component: {}, controls: { id: 'countryId' } },
      parameters: [],
      metadata: {
        title: 'What is the monthly flow for ETFs listed in Unknown Value?',
      },
    };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_MALFORMED_RENDER_CONTROLS': () => (widget),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_MALFORMED_RENDER_CONTROLS',
        widgetId: 'MW_MALFORMED_RENDER_CONTROLS' as WidgetId,
        underlyingChartId: 'CH_MALFORMED_RENDER_CONTROLS',
        metadata: {
          title: 'What is the monthly flow for ETFs listed in Japan?',
        },
        parameters: [
          { field: 'countryId', value: 'JP' },
        ],
      }),
      '/v1/charts/CH_MALFORMED_RENDER_CONTROLS': () => ({
        expressions: [{ label: 'Monthly Flow' }],
        relativeStartDate: '-1y',
        interval: 'Monthly',
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_MALFORMED_RENDER_CONTROLS', configurationId: 'WC_MALFORMED_RENDER_CONTROLS' },
      mode: 'summary',
      data: 'skip',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('malformed render controls should fail the widget read');
    expect(result.error).toEqual({
      kind: 'invalid-response',
      identity: { widgetId: 'MW_MALFORMED_RENDER_CONTROLS' as WidgetId },
      source: 'widget',
      problem: 'render-controls-not-array',
    });
    expect(result.error).not.toHaveProperty('message');
  });

  it('fails loud when widget render params are malformed during configuration merge', async () => {
    const widget = {
      id: 'MW_MALFORMED_RENDER_PARAMS',
      title: 'What is the monthly flow for ETFs listed in <countryId:US>?',
      underlyingChartId: 'CH_MALFORMED_RENDER_PARAMS',
      renderParams: 'bad render params',
      parameters: [],
      metadata: {
        title: 'What is the monthly flow for ETFs listed in Unknown Value?',
      },
    };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_MALFORMED_RENDER_PARAMS': () => (widget),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_MALFORMED_RENDER_PARAMS',
        widgetId: 'MW_MALFORMED_RENDER_PARAMS' as WidgetId,
        underlyingChartId: 'CH_MALFORMED_RENDER_PARAMS',
        metadata: {
          title: 'What is the monthly flow for ETFs listed in Japan?',
        },
        parameters: [
          { field: 'countryId', value: 'JP' },
        ],
      }),
      '/v1/charts/CH_MALFORMED_RENDER_PARAMS': () => ({
        expressions: [{ label: 'Monthly Flow' }],
        relativeStartDate: '-1y',
        interval: 'Monthly',
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_MALFORMED_RENDER_PARAMS', configurationId: 'WC_MALFORMED_RENDER_PARAMS' },
      mode: 'summary',
      data: 'skip',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('malformed render params should fail the widget read');
    expect(result.error).toEqual({
      kind: 'invalid-response',
      identity: { widgetId: 'MW_MALFORMED_RENDER_PARAMS' as WidgetId },
      source: 'widget',
      problem: 'render-params-not-record',
    });
    expect(result.error).not.toHaveProperty('message');
  });

  it('reads editable dashboards with CH widget data without waiting for render to finish', async () => {
    const widget = {
      id: 'MW_CH_DASH',
      title: 'CH Widget with dashboards',
      useEntityTitle: true,
      configurationId: 'WC_CH_DASH' as ConfigId,
      underlyingChartId: 'CH_DASH',
      authors: ['AUTHOR'],
      label: 'external',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'CH Widget with dashboards' },
    };
    const starts = new Map<string, number>();
    const finishes = new Map<string, number>();
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const adapter = createFakeRequestAdapter(async (path, init) => {
      starts.set(path, performance.now());
      try {
        if (path === '/v1/marketview/widgets/MW_CH_DASH') {
          await delay(20);
          return widget;
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return [{
            id: widget.configurationId,
            metadata: { title: 'Stale configuration detail title' },
            parameters: [],
          }];
        }
        if (path === '/v1/users/query') {
          return { totalResults: 1, results: [{ id: 'AUTHOR', name: 'Widget Author' }] };
        }
        if (path === '/v1/marketview/dashboards') {
          await delay(5);
          expect(init?.query).toEqual({ view_as: 'edit', size: 100, page: 1 });
          return {
            total_results: 2,
            results: [
              { id: 'MD_TEMP', title: 'Temp' },
              { id: 'MD_SANDBOX', title: "Example Sandbox" },
            ],
          };
        }
        if (path === '/v1/charts/CH_DASH') {
          await delay(30);
          return {
            description: 'USD.foo()',
            chartType: 'line',
            expressions: [{ label: 'Series' }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/runner') {
          await delay(40);
          return {
            expressions: ['USD.foo()'],
            results: [{ type: 'series', values: { '2026-01-01': 1, '2026-01-02': 2 } }],
          };
        }
        throw new Error(`unexpected ${path}`);
      } finally {
        finishes.set(path, performance.now());
      }
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_DASH', configurationId: 'WC_CH_DASH' },
      mode: 'view',
      data: 'render',
      editableDashboards: 'fetch',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const dashboards = [
      { dashboardId: 'MD_TEMP', title: 'Temp' },
      { dashboardId: 'MD_SANDBOX', title: "Example Sandbox" },
    ];
    expect(viewOf(result.value).widget.dashboards).toEqual(dashboards);
    expect(viewOf(result.value).widget.title).toBe('CH Widget with dashboards');
    expect(viewOf(result.value).snippet.title).toBe('CH Widget with dashboards');
    expect(adapter.calls.map((call) => call.path)).toContain('/v1/marketview/dashboards');
    expect(starts.get('/v1/marketview/dashboards')).toBeGreaterThanOrEqual(finishes.get('/v1/marketview/widgets/MW_CH_DASH') ?? 0);
    expect(starts.get('/v1/marketview/dashboards')).toBeLessThan(starts.get('/v1/plots/runner') ?? 0);
    expect(starts.get('/v1/marketview/dashboards')).toBeLessThan(finishes.get('/v1/plots/runner') ?? 0);
  });

  it('rejects a foreign configuration owner before applying it', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_EXPECTED': () => ({
        id: 'MW_EXPECTED',
        title: 'Expected widget',
        configurationId: 'WC_FOREIGN' as ConfigId,
        underlyingChartId: 'CH_SHARED',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: { title: 'Expected widget' },
      }),
      '/v1/marketview/widgets/configurations': () => ([{
        id: 'WC_FOREIGN',
        widgetId: 'MW_FOREIGN' as WidgetId,
        underlyingChartId: 'CH_SHARED',
        parameters: [],
      }]),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: {
        kind: 'id',
        id: 'MW_EXPECTED',
        configurationId: 'WC_FOREIGN',
      },
      mode: 'view',
      data: 'render',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'configuration-mismatch',
        identity: {
          widgetId: 'MW_EXPECTED' as WidgetId,
          configurationId: 'WC_FOREIGN' as ConfigId,
        },
      },
    });
  });

  it('does not read editable dashboards when widget metadata fails', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_MISSING') {
        throw new MarqueeError('http', 'Marquee returned 404 for /v1/marketview/widgets/MW_MISSING', {
          status: 404,
          path,
        });
      }
      if (path === '/v1/marketview/dashboards') {
        throw new Error('dashboard list should not be requested for missing widgets');
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_MISSING' },
      mode: 'view',
      data: 'render',
      editableDashboards: 'fetch',
    });

    expect(result.ok).toBe(false);
    expect(adapter.calls.map((call) => call.path)).toEqual(['/v1/marketview/widgets/MW_MISSING']);
  });

  it('fails widget reads when editable dashboard lookup fails', async () => {
    const widget = {
      id: 'MW_CH_DASH_FAIL',
      title: 'CH Widget with dashboard failure',
      configurationId: 'WC_CH_DASH_FAIL' as ConfigId,
      underlyingChartId: 'CH_DASH_FAIL',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'CH Widget with dashboard failure' },
    };
    let dashboardInit: RequestCall['init'] | undefined;
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CH_DASH_FAIL') return widget;
      if (path === '/v1/marketview/widgets/configurations') {
        return new Promise((resolve) => {
          setImmediate(() => resolve([{ id: widget.configurationId, metadata: { title: widget.title }, parameters: [] }]));
        });
      }
      if (path === '/v1/marketview/dashboards') {
        dashboardInit = init;
        throw new MarqueeError('timeout', 'Request timed out after 15s', {
          path: '/v1/marketview/dashboards',
        });
      }
      if (path === '/v1/charts/CH_DASH_FAIL') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['USD.foo()'],
          results: [{ type: 'series', values: { '2026-01-01': 1 } }],
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const result = await module.prepare({
        source: { kind: 'id', id: 'MW_CH_DASH_FAIL', configurationId: 'WC_CH_DASH_FAIL' },
        mode: 'view',
        data: 'render',
        editableDashboards: 'fetch',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('dashboard failure should fail the widget read');
      expect(result.error.kind).toBe('widget-load-failure');
      expect(result.error).not.toHaveProperty('message');
      expect(adapter.calls.map((call) => call.path)).toContain('/v1/marketview/dashboards');
      expect(dashboardInit?.timeoutMs).toBe(4000);
      expect(dashboardInit?.hedgeDelaysMs).toEqual([1000]);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('fails loud on an early dashboards failure without an unhandled rejection while essentials are slow', async () => {
    const widget = {
      id: 'MW_CH_DASH_EARLY',
      title: 'CH Widget early dashboard failure',
      configurationId: 'WC_CH_DASH_EARLY' as ConfigId,
      underlyingChartId: 'CH_DASH_EARLY',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'CH Widget early dashboard failure' },
    };
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => { unhandledRejections.push(reason); };
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_DASH_EARLY') return widget;
      if (path === '/v1/marketview/widgets/configurations') return [{ id: widget.configurationId, metadata: { title: widget.title }, parameters: [] }];
      if (path === '/v1/marketview/dashboards') {
        // Rejects immediately — before the deliberately slow chart/render resolve.
        throw new MarqueeError('http', 'Marquee returned 500 for /v1/marketview/dashboards', {
          status: 500,
          path: '/v1/marketview/dashboards',
        });
      }
      if (path === '/v1/charts/CH_DASH_EARLY') {
        return new Promise((resolve) => {
          setImmediate(() => resolve({
            description: 'USD.foo()',
            chartType: 'line',
            expressions: [{ label: 'Series' }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          }));
        });
      }
      if (path === '/v1/plots/runner') {
        return { expressions: ['USD.foo()'], results: [{ type: 'series', values: { '2026-01-01': 1 } }] };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const result = await module.prepare({
        source: { kind: 'id', id: 'MW_CH_DASH_EARLY', configurationId: 'WC_CH_DASH_EARLY' },
        mode: 'view',
        data: 'render',
        editableDashboards: 'fetch',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('early dashboard failure should fail the widget read');
      expect(result.error.kind).toBe('widget-load-failure');
      expect(result.error).not.toHaveProperty('message');
      // Let the slow essential calls settle, then confirm the early failure never leaked.
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('preserves editable dashboard 403 context instead of reporting widget access denied', async () => {
    const widget = {
      id: 'MW_CH_DASH_403',
      title: 'CH Widget with dashboard 403',
      configurationId: 'WC_CH_DASH_403' as ConfigId,
      underlyingChartId: 'CH_DASH_403',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'CH Widget with dashboard 403' },
    };
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_DASH_403') return widget;
      if (path === '/v1/marketview/widgets/configurations') return [{ id: widget.configurationId, metadata: { title: widget.title }, parameters: [] }];
      if (path === '/v1/marketview/dashboards') {
        throw new MarqueeError('http', 'Marquee returned 403 for /v1/marketview/dashboards', {
          status: 403,
          path: '/v1/marketview/dashboards',
          body: '{"message":"dashboard list denied"}',
        });
      }
      if (path === '/v1/charts/CH_DASH_403') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['USD.foo()'],
          results: [{ type: 'series', values: { '2026-01-01': 1 } }],
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_DASH_403', configurationId: 'WC_CH_DASH_403' },
      mode: 'view',
      data: 'render',
      editableDashboards: 'fetch',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('dashboard 403 should fail the widget read');
    expect(result.error.kind).toBe('widget-load-failure');
    expect(result.error).not.toHaveProperty('message');
    expect(JSON.stringify(result.error)).not.toContain('Access denied: widget MW_CH_DASH_403');
  });

  it.each([
    {
      name: 'missing results envelope',
      response: { error: 'temporary upstream issue' },
    },
    {
      name: 'malformed dashboard item',
      response: { results: [{ id: 'MD_MISSING_TITLE' }] },
    },
  ])('fails widget reads when editable dashboard list has $name', async ({ response }) => {
    const widget = {
      id: 'MW_CH_DASH_MALFORMED',
      title: 'CH Widget with malformed dashboards',
      configurationId: 'WC_CH_DASH_MALFORMED' as ConfigId,
      underlyingChartId: 'CH_DASH_MALFORMED',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'CH Widget with malformed dashboards' },
    };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CH_DASH_MALFORMED': () => (widget),
      '/v1/marketview/widgets/configurations': () => ([{ id: widget.configurationId, metadata: { title: widget.title }, parameters: [] }]),
      '/v1/marketview/dashboards': () => (response),
      '/v1/charts/CH_DASH_MALFORMED': () => ({
        description: 'USD.foo()',
        chartType: 'line',
        expressions: [{ label: 'Series' }],
        relativeStartDate: '-1y',
        interval: 'Daily',
      }),
      '/v1/plots/runner': () => ({
        expressions: ['USD.foo()'],
        results: [{ type: 'series', values: { '2026-01-01': 1 } }],
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_DASH_MALFORMED', configurationId: 'WC_CH_DASH_MALFORMED' },
      mode: 'view',
      data: 'render',
      editableDashboards: 'fetch',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('malformed dashboard list should fail the widget read');
    expect(result.error.kind).toBe('widget-load-failure');
    expect(result.error).not.toHaveProperty('message');
    expect(adapter.calls.map((call) => call.path)).toContain('/v1/marketview/dashboards');
  });

  it('treats an empty editable dashboard list as the answer on the first attempt', async () => {
    const widget = {
      id: 'MW_CH_DASH_RETRY',
      title: 'CH Widget with retrying dashboards',
      useEntityTitle: true,
      configurationId: 'WC_CH_DASH_RETRY' as ConfigId,
      underlyingChartId: 'CH_DASH_RETRY',
      authors: ['AUTHOR'],
      label: 'external',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: { title: 'CH Widget with retrying dashboards' },
    };
    let dashboardAttempts = 0;
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_DASH_RETRY') return widget;
      if (path === '/v1/marketview/widgets/configurations') return [{ id: widget.configurationId, metadata: { title: widget.title }, parameters: [] }];
      if (path === '/v1/users/query') {
        return { totalResults: 1, results: [{ id: 'AUTHOR', name: 'Widget Author' }] };
      }
      if (path === '/v1/marketview/dashboards') {
        dashboardAttempts++;
        return { results: [] };
      }
      if (path === '/v1/charts/CH_DASH_RETRY') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['USD.foo()'],
          results: [{ type: 'series', values: { '2026-01-01': 1 } }],
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_DASH_RETRY', configurationId: 'WC_CH_DASH_RETRY' },
      mode: 'view',
      data: 'render',
      editableDashboards: 'fetch',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(viewOf(result.value).widget.dashboards).toEqual([]);
    expect(dashboardAttempts).toBe(1);
  });

  it('fails loud when default configuration creation fails before assembling widget views', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_CONFIG_FAIL') {
        return {
          id: 'MW_CH_CONFIG_FAIL',
          title: 'Configuration failure',
          underlyingChartId: 'CH_CONFIG_FAIL',
          contextParameter: { field: 'asset', options: ['MA1'], value: 'MA1' },
          renderParams: {
            component: { asset: 'MA1' },
            controls: [{ id: 'asset', value: 'MA1', values: ['MA1'] }],
          },
          parameters: [],
          metadata: { title: 'Configuration failure' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        throw new MarqueeError('auth_expired', 'Not authenticated. Run: marquee auth login', {
          path,
        });
      }
      if (path === '/v1/plots/entities') return { assets: [{ id: 'MA1', name: 'EURUSD' }] };
      if (path === '/v1/charts/CH_CONFIG_FAIL') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['USD.foo()'],
          results: [{ type: 'series', values: { '2026-01-01': 1, '2026-01-02': 2 } }],
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_CONFIG_FAIL' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected configuration failure');
    expect(result.error.kind).toBe('widget-load-failure');
    expect(result.error).not.toHaveProperty('message');
    expect(adapter.calls.map((call) => `${call.init?.method ?? 'GET'} ${call.path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_CH_CONFIG_FAIL',
      'POST /v1/marketview/widgets/configurations',
    ]);
  });

  it('keeps a selected-context Widget identity from its minted configuration', async () => {
    const widget = {
      id: 'MW_CONTEXT_REF',
      title: 'Carry for EURUSD',
      useEntityTitle: true,
      underlyingChartId: 'DV_CONTEXT_REF',
      visualizationType: 'DataViz',
      authors: ['AUTHOR'],
      label: 'external',
      contextParameter: {
        field: 'cross',
        type: 'Asset',
        options: ['MA_EURUSD', 'MA_USDMXN'],
        values: { default: 'MA_EURUSD' },
      },
      renderParams: { component: { cross: 'MA_EURUSD' }, controls: [] },
      parameters: [],
      metadata: { title: 'Carry for EURUSD' },
    };
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONTEXT_REF') {
        return init?.query?.context === 'WC_CONTEXT_REF'
          ? {
              ...widget,
              title: 'Carry for USDMXN',
              configurationId: 'WC_CONTEXT_REF' as ConfigId,
              contextParameter: {
                ...widget.contextParameter,
                values: { default: 'MA_USDMXN' },
              },
              renderParams: { component: { cross: 'MA_USDMXN' }, controls: [] },
              metadata: { title: 'Carry for USDMXN' },
            }
          : widget;
      }
      if (path === '/v1/marketview/widgets/configurations') {
        expect(init?.body).toMatchObject({
          widgetId: 'MW_CONTEXT_REF' as WidgetId,
          parameters: [{ field: 'cross', value: 'MA_USDMXN' }],
        });
        return {
          id: 'WC_CONTEXT_REF',
          widgetId: 'MW_CONTEXT_REF' as WidgetId,
          underlyingChartId: 'DV_CONTEXT_REF',
          parameters: [{ field: 'cross', value: 'MA_USDMXN' }],
          metadata: { title: 'Carry for USDMXN' },
        };
      }
      if (path === '/v1/data/visualizations/DV_CONTEXT_REF') return {};
      if (path === '/v1/data/visualizations/DV_CONTEXT_REF/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/users/query') {
        return { totalResults: 1, results: [{ id: 'AUTHOR', name: 'Widget Author' }] };
      }
      if (path === '/v1/plots/entities') {
        return {
          assets: [
            { id: 'MA_EURUSD', name: 'EURUSD' },
            { id: 'MA_USDMXN', name: 'USDMXN' },
          ],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_REF' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_USDMXN',
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) {
      throw new Error(JSON.stringify({ error: result.error, calls: adapter.calls }));
    }
    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: { title: 'Carry for USDMXN' },
        widget: { configurationId: 'WC_CONTEXT_REF' as ConfigId },
      },
    });
    expect(adapter.calls[0]).toMatchObject({
      path: '/v1/marketview/widgets/MW_CONTEXT_REF',
      init: { query: { mergeParams: true } },
    });
    expect(adapter.calls).toContainEqual(expect.objectContaining({
      path: '/v1/marketview/widgets/configurations',
      init: expect.objectContaining({ method: 'POST' }),
    }));
  });

  it('renders a changed Selected Context for a DataViz component without the context field', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CONTEXT_OFF_COMPONENT': () => ({
        id: 'MW_CONTEXT_OFF_COMPONENT',
        title: 'Carry',
        underlyingChartId: 'DV_CONTEXT_OFF_COMPONENT',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          options: ['MA_EURUSD', 'MA_USDMXN'],
          values: { default: 'MA_EURUSD' },
        },
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: { title: 'Carry' },
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_CONTEXT_OFF_COMPONENT',
        widgetId: 'MW_CONTEXT_OFF_COMPONENT' as WidgetId,
        underlyingChartId: 'DV_CONTEXT_OFF_COMPONENT',
        parameters: [{ field: 'cross', value: 'MA_USDMXN' }],
      }),
      '/v1/data/visualizations/DV_CONTEXT_OFF_COMPONENT': () => ({}),
      '/v1/data/visualizations/DV_CONTEXT_OFF_COMPONENT/render': () => ({ renderData: { data: [], layout: {} } }),
      '/v1/plots/entities': () => ({
        assets: [
          { id: 'MA_EURUSD', name: 'EURUSD' },
          { id: 'MA_USDMXN', name: 'USDMXN' },
        ],
      }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_OFF_COMPONENT' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_USDMXN',
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({ ok: true });
    expect(adapter.calls.find(({ path }) => path.endsWith('/render'))?.init?.body)
      .toEqual({
        component: { cross: 'MA_USDMXN' },
        visualization: {},
        references: { configId: 'WC_CONTEXT_OFF_COMPONENT', useTableViz: false },
      });
  });

  it('fails loud when a stored Config omits the current context it would re-save', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONTEXT_UNSAVED') {
        return {
          id: 'MW_CONTEXT_UNSAVED',
          title: 'Spot',
          configurationId: 'WC_CONTEXT_UNSAVED' as ConfigId,
          underlyingChartId: 'CH_CONTEXT_UNSAVED',
          contextParameter: {
            field: 'cross',
            type: 'Asset',
            options: ['MA_EURUSD', 'MA_USDMXN'],
            values: { default: 'MA_EURUSD' },
          },
          renderParams: { component: { cross: 'MA_EURUSD' }, controls: [] },
          parameters: [],
          metadata: { title: 'Spot' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations' && init?.method === 'GET') {
        return [{
          id: 'WC_CONTEXT_UNSAVED',
          widgetId: 'MW_CONTEXT_UNSAVED' as WidgetId,
          underlyingChartId: 'CH_CONTEXT_UNSAVED',
          parameters: [],
        }];
      }
      if (path === '/v1/charts/CH_CONTEXT_UNSAVED') {
        return { relativeStartDate: '-1y', relativeEndDate: '0d' };
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_UNSAVED' as WidgetId,
      configurationId: 'WC_CONTEXT_UNSAVED' as ConfigId,
      parameters: [{ field: 'relativeDate', value: '1Y' }],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_CONTEXT_UNSAVED' as WidgetId },
        source: 'configuration',
        problem: 'configuration-assignment-missing',
      },
    });
  });

  it('rejects relativeDate on a forward-looking PlotTool Pro chart before minting a Config', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_FORWARD') {
        return {
          id: 'MW_FORWARD',
          title: 'Forward curve',
          configurationId: 'WC_FORWARD' as ConfigId,
          underlyingChartId: 'CH_FORWARD',
          contextParameter: {
            field: 'cross',
            type: 'Asset',
            options: ['MA_EURUSD', 'MA_USDMXN'],
            values: { default: 'MA_EURUSD' },
          },
          renderParams: { component: { cross: 'MA_EURUSD' }, controls: [] },
          parameters: [],
          metadata: { title: 'Forward curve' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations' && init?.method === 'GET') {
        return [{
          id: 'WC_FORWARD',
          widgetId: 'MW_FORWARD' as WidgetId,
          underlyingChartId: 'CH_FORWARD',
          parameters: [],
        }];
      }
      if (path === '/v1/charts/CH_FORWARD') {
        return { relativeStartDate: '-1m', relativeEndDate: '+5y' };
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_FORWARD' as WidgetId,
      configurationId: 'WC_FORWARD' as ConfigId,
      parameters: [{ field: 'relativeDate', value: '1Y' }],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'unknown-input',
        identity: { widgetId: 'MW_FORWARD' as WidgetId },
        input: 'relativeDate',
        candidates: ['cross'],
      },
    });
  });

  it('uses reminted configuration labels for selected-context PlotTool Pro data', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONTEXT_LABEL') {
        return {
          id: 'MW_CONTEXT_LABEL',
          title: 'Where is Default Asset trading?',
          underlyingChartId: 'CH_CONTEXT_LABEL',
          authors: ['AUTHOR'],
          label: 'external',
          contextParameter: {
            field: 'Asset',
            type: 'Asset',
            options: ['MA_APPLE', 'MA_SPX'],
            values: { default: 'MA_APPLE' },
          },
          renderParams: { component: {}, controls: [] },
          parameters: [],
          metadata: {
            title: 'Where is Default Asset trading?',
            expressionLabels: ['Default Asset Spot'],
          },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        expect(init?.body).toMatchObject({
          widgetId: 'MW_CONTEXT_LABEL' as WidgetId,
          parameters: [{ field: 'Asset', value: 'MA_SPX' }],
        });
        return {
          id: 'WC_CONTEXT_LABEL',
          widgetId: 'MW_CONTEXT_LABEL' as WidgetId,
          underlyingChartId: 'CH_CONTEXT_LABEL',
          parameters: [{ field: 'Asset', value: 'MA_SPX' }],
          metadata: {
            title: 'Where is Selected Index trading?',
            expressionLabels: ['Selected Index Spot'],
          },
        };
      }
      if (path === '/v1/charts/CH_CONTEXT_LABEL') {
        return {
          description: 'SPX.spot()',
          expressions: [{ label: 'SPX Spot' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['SPX.spot()'],
          results: [{ values: { '2026-08-08': 1234.56 } }],
        };
      }
      if (path === '/v1/users/query') {
        return { totalResults: 1, results: [{ id: 'AUTHOR', name: 'Widget Author' }] };
      }
      if (path === '/v1/plots/entities') {
        return {
          assets: [
            { id: 'MA_APPLE', name: 'Default Asset' },
            { id: 'MA_SPX', name: 'Selected Index' },
          ],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_LABEL' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_SPX',
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) {
      throw new Error(JSON.stringify({ error: result.error, calls: adapter.calls }));
    }
    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: { title: 'Where is Selected Index trading?' },
        execution: {
          family: 'plot',
          value: {
            projection: {
              series: [{ label: 'Selected Index Spot' }],
            },
          },
        },
      },
    });
  });

  it('reads a fresh Config\'s labels from the Widget metadata POST', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_FRESH_LABEL') {
        return {
          id: 'MW_FRESH_LABEL',
          title: 'Where is Default Asset trading?',
          underlyingChartId: 'CH_FRESH_LABEL',
          authors: ['AUTHOR'],
          label: 'external',
          contextParameter: {
            field: 'Asset',
            type: 'Asset',
            options: ['MA_APPLE', 'MA_SPX'],
            values: { default: 'MA_APPLE' },
          },
          renderParams: { component: {}, controls: [] },
          parameters: [],
          metadata: {
            title: 'Where is Default Asset trading?',
            expressionLabels: ['Default Asset Spot'],
          },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_FRESH_LABEL',
          widgetId: 'MW_FRESH_LABEL' as WidgetId,
          underlyingChartId: 'CH_FRESH_LABEL',
          parameters: [{ field: 'Asset', value: 'MA_SPX' }],
        };
      }
      if (path === '/v1/marketview/widgets/MW_FRESH_LABEL/metadata') {
        expect(init).toMatchObject({
          method: 'POST',
          body: { parameters: [{ field: 'Asset', value: 'MA_SPX' }] },
        });
        return {
          metadata: {
            title: 'Where is Selected Index trading?',
            expressionLabels: ['Selected Index Spot'],
          },
        };
      }
      if (path === '/v1/charts/CH_FRESH_LABEL') {
        return {
          description: 'SPX.spot()',
          expressions: [{ label: 'SPX Spot' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['SPX.spot()'],
          results: [{ values: { '2026-08-08': 1234.56 } }],
        };
      }
      if (path === '/v1/users/query') {
        return { totalResults: 1, results: [{ id: 'AUTHOR', name: 'Widget Author' }] };
      }
      if (path === '/v1/plots/entities') {
        return {
          assets: [
            { id: 'MA_APPLE', name: 'Default Asset' },
            { id: 'MA_SPX', name: 'Selected Index' },
          ],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path} ${JSON.stringify(init)}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_FRESH_LABEL' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_SPX',
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        snippet: { title: 'Where is Selected Index trading?' },
        execution: {
          family: 'plot',
          value: {
            projection: {
              series: [{ label: 'Selected Index Spot' }],
            },
          },
        },
      },
    });
    expect(adapter.calls.filter(({ path }) => path === '/v1/marketview/widgets/MW_FRESH_LABEL/metadata'))
      .toHaveLength(1);
  });

  it('resolves a Country-typed parameter code as a country', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_COUNTRY') {
        return {
          id: 'MW_COUNTRY',
          title: 'Flows',
          underlyingChartId: 'DV_COUNTRY',
          visualizationType: 'DataViz',
          renderParams: { component: {}, controls: [] },
          parameters: [{ field: 'market', type: 'Country', values: { default: 'JP' } }],
          metadata: { title: 'Flows' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_COUNTRY',
          widgetId: 'MW_COUNTRY' as WidgetId,
          underlyingChartId: 'DV_COUNTRY',
          parameters: [{ field: 'market', value: 'JP' }],
        };
      }
      if (path === '/v1/plots/entities') {
        expect(init?.query).toEqual({ ids: ['JP'], type: 'Country' });
        return { countries: [{ id: 'JP', name: 'Japan' }] };
      }
      if (path === '/v1/data/visualizations/DV_COUNTRY') return {};
      if (path === '/v1/data/visualizations/DV_COUNTRY/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_COUNTRY' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.snippet.parameterLines).toEqual(['market=Japan']);
  });

  it('keeps an unchanged assignment in its saved Config position', async () => {
    const configurationBodies: unknown[] = [];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_ORDER') {
        return {
          id: 'MW_ORDER',
          title: 'Order',
          underlyingChartId: 'DV_ORDER',
          visualizationType: 'DataViz',
          renderParams: { component: {}, controls: [] },
          parameters: [
            { field: 'universe', type: 'Enum', options: ['G10', 'Latam'], values: { default: 'G10' } },
            { field: 'region', type: 'Enum', options: ['EU', 'US'], values: { default: 'EU' } },
          ],
          metadata: { title: 'Order' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        configurationBodies.push(init?.body);
        return { id: 'WC_ORDER', widgetId: 'MW_ORDER' as WidgetId, underlyingChartId: 'DV_ORDER' };
      }
      if (path === '/v1/data/visualizations/DV_ORDER') return {};
      if (path === '/v1/data/visualizations/DV_ORDER/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_ORDER' as WidgetId,
      configurationId: null,
      parameters: [
        { field: 'region', value: 'US' },
        { field: 'universe', value: 'G10' },
      ],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(configurationBodies).toEqual([{
      widgetId: 'MW_ORDER' as WidgetId,
      underlyingChartId: 'DV_ORDER',
      parameters: [
        { field: 'universe', value: 'G10' },
        { field: 'region', value: 'US' },
      ],
    }]);
  });

  it('saves a Selected Context equal to the default when it mints a Config', async () => {
    const configurationBodies: unknown[] = [];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONTEXT_DEFAULT') {
        return {
          id: 'MW_CONTEXT_DEFAULT',
          title: 'Carry',
          underlyingChartId: 'DV_CONTEXT_DEFAULT',
          visualizationType: 'DataViz',
          contextParameter: {
            field: 'cross',
            type: 'Asset',
            options: ['MA_EURUSD', 'MA_USDMXN'],
            values: { default: 'MA_EURUSD' },
          },
          renderParams: { component: { cross: 'MA_EURUSD' }, controls: [] },
          parameters: [],
          metadata: { title: 'Carry' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        configurationBodies.push(init?.body);
        return {
          id: 'WC_CONTEXT_DEFAULT',
          widgetId: 'MW_CONTEXT_DEFAULT' as WidgetId,
          underlyingChartId: 'DV_CONTEXT_DEFAULT',
          parameters: [{ field: 'cross', value: 'MA_EURUSD' }],
        };
      }
      if (path === '/v1/data/visualizations/DV_CONTEXT_DEFAULT') return {};
      if (path === '/v1/data/visualizations/DV_CONTEXT_DEFAULT/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/plots/entities') {
        return { assets: [{ id: 'MA_EURUSD', name: 'EURUSD' }] };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_DEFAULT' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_EURUSD',
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(configurationBodies).toEqual([{
      widgetId: 'MW_CONTEXT_DEFAULT' as WidgetId,
      underlyingChartId: 'DV_CONTEXT_DEFAULT',
      parameters: [{ field: 'cross', value: 'MA_EURUSD' }],
    }]);
  });

  it('re-saves a stored Config with a changed Selected Context', async () => {
    const configurationBodies: unknown[] = [];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CONTEXT_STORED') {
        return {
          id: 'MW_CONTEXT_STORED',
          title: 'Carry',
          configurationId: 'WC_CONTEXT_STORED' as ConfigId,
          underlyingChartId: 'DV_CONTEXT_STORED',
          visualizationType: 'DataViz',
          contextParameter: {
            field: 'cross',
            type: 'Asset',
            options: ['MA_EURUSD', 'MA_USDMXN'],
            values: { default: 'MA_EURUSD' },
          },
          renderParams: { component: { cross: 'MA_EURUSD' }, controls: [] },
          parameters: [],
          metadata: { title: 'Carry' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations' && init?.method === 'GET') {
        return [{
          id: 'WC_CONTEXT_STORED',
          widgetId: 'MW_CONTEXT_STORED' as WidgetId,
          underlyingChartId: 'DV_CONTEXT_STORED',
          parameters: [{ field: 'cross', value: 'MA_EURUSD' }],
        }];
      }
      if (path === '/v1/marketview/widgets/configurations') {
        configurationBodies.push(init?.body);
        return {
          id: 'WC_CONTEXT_RESAVED',
          widgetId: 'MW_CONTEXT_STORED' as WidgetId,
          underlyingChartId: 'DV_CONTEXT_STORED',
          parameters: [{ field: 'cross', value: 'MA_USDMXN' }],
        };
      }
      if (path === '/v1/data/visualizations/DV_CONTEXT_STORED') return {};
      if (path === '/v1/data/visualizations/DV_CONTEXT_STORED/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/plots/entities') {
        return {
          assets: [
            { id: 'MA_EURUSD', name: 'EURUSD' },
            { id: 'MA_USDMXN', name: 'USDMXN' },
          ],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_STORED' as WidgetId,
      configurationId: 'WC_CONTEXT_STORED' as ConfigId,
      selectedContext: 'MA_USDMXN',
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(configurationBodies).toEqual([{
      widgetId: 'MW_CONTEXT_STORED' as WidgetId,
      underlyingChartId: 'DV_CONTEXT_STORED',
      parameters: [{ field: 'cross', value: 'MA_USDMXN' }],
    }]);
  });

  it('re-saves a requested component input that already matches a stored Config', async () => {
    const configurationBodies: unknown[] = [];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_COMPONENT_STORED') {
        return {
          id: 'MW_COMPONENT_STORED',
          title: 'Carry',
          configurationId: 'WC_COMPONENT_STORED' as ConfigId,
          underlyingChartId: 'DV_COMPONENT_STORED',
          visualizationType: 'DataViz',
          renderParams: { component: { region: 'EU', tenor: '1y' }, controls: [] },
          parameters: [],
          metadata: { title: 'Carry' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations' && init?.method === 'GET') {
        return [{
          id: 'WC_COMPONENT_STORED',
          widgetId: 'MW_COMPONENT_STORED' as WidgetId,
          underlyingChartId: 'DV_COMPONENT_STORED',
          parameters: [],
        }];
      }
      if (path === '/v1/marketview/widgets/configurations') {
        configurationBodies.push(init?.body);
        return {
          id: 'WC_COMPONENT_RESAVED',
          widgetId: 'MW_COMPONENT_STORED' as WidgetId,
          underlyingChartId: 'DV_COMPONENT_STORED',
          parameters: [],
        };
      }
      if (path === '/v1/data/visualizations/DV_COMPONENT_STORED') return {};
      if (path === '/v1/data/visualizations/DV_COMPONENT_STORED/render') {
        return { renderData: { data: [], layout: {} } };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_COMPONENT_STORED' as WidgetId,
      configurationId: 'WC_COMPONENT_STORED' as ConfigId,
      parameters: [
        { field: 'region', value: 'EU' },
        { field: 'tenor', value: '2y' },
      ],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(configurationBodies).toEqual([expect.objectContaining({
      parameters: [
        { field: 'region', value: 'EU' },
        { field: 'tenor', value: '2y' },
      ],
    })]);
  });

  it.each([
    ['ytd', 'YTD'],
    ['MAX', 'MAX'],
  ])('sends Relative Date %s to the provider as %s', async (requested, provider) => {
    const configurationBodies: unknown[] = [];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_DATE') {
        return {
          id: 'MW_DATE',
          title: 'Carry',
          configurationId: 'WC_DATE' as ConfigId,
          underlyingChartId: 'CH_DATE',
          visualizationType: 'Plot',
          renderParams: { component: {}, controls: [] },
          parameters: [],
          metadata: { title: 'Carry' },
        };
      }
      if (path === '/v1/marketview/widgets/configurations' && init?.method === 'GET') {
        return [{
          id: 'WC_DATE',
          widgetId: 'MW_DATE' as WidgetId,
          underlyingChartId: 'CH_DATE',
          parameters: [],
        }];
      }
      if (path === '/v1/marketview/widgets/configurations') {
        configurationBodies.push(init?.body);
        return {
          id: 'WC_DATE_RESAVED',
          widgetId: 'MW_DATE' as WidgetId,
          underlyingChartId: 'CH_DATE',
          parameters: [],
          relativeDate: provider,
        };
      }
      if (path === '/v1/charts/CH_DATE') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [{ label: 'Series' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        return {
          expressions: ['USD.foo()'],
          results: [{ type: 'series', values: { '2026-07-28': 1 } }],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    const result = await createWidget(adapter).get({
      widgetId: 'MW_DATE' as WidgetId,
      configurationId: 'WC_DATE' as ConfigId,
      parameters: [{ field: 'relativeDate', value: requested }],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(configurationBodies).toEqual([expect.objectContaining({ relativeDate: provider })]);
    expect(adapter.calls.filter(({ path }) => path === '/v1/charts/CH_DATE')).toEqual([{
      path: '/v1/charts/CH_DATE',
      init: { headers: { 'X-Dash-AppId': 'MQPLOT', 'X-Support-Reference': 'MW_DATE' }, method: 'GET' },
    }]);
  });

  it.each([
    {
      caseName: 'malformed',
      metadata: { expressionLabels: 'Selected label' },
      problem: 'expression-labels-not-array' as const,
    },
    {
      caseName: 'missing while the Widget has default labels',
      metadata: {},
      problem: 'expression-labels-missing' as const,
    },
  ])('fails loud when reminted configuration labels are $caseName', async ({ metadata, problem }) => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CONTEXT_LABEL_MALFORMED': () => ({
        id: 'MW_CONTEXT_LABEL_MALFORMED',
        title: 'Default title',
        underlyingChartId: 'CH_CONTEXT_LABEL_MALFORMED',
        contextParameter: {
          field: 'Asset',
          type: 'Asset',
          options: ['MA_DEFAULT', 'MA_SELECTED'],
          values: { default: 'MA_DEFAULT' },
        },
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: { expressionLabels: ['Default label'] },
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_CONTEXT_LABEL_MALFORMED',
        widgetId: 'MW_CONTEXT_LABEL_MALFORMED' as WidgetId,
        underlyingChartId: 'CH_CONTEXT_LABEL_MALFORMED',
        parameters: [{ field: 'Asset', value: 'MA_SELECTED' }],
        metadata,
      }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_CONTEXT_LABEL_MALFORMED' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_SELECTED',
      parameters: [],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: {
          widgetId: 'MW_CONTEXT_LABEL_MALFORMED' as WidgetId,
          configurationId: 'WC_CONTEXT_LABEL_MALFORMED' as ConfigId,
        },
        source: 'configuration',
        problem,
      },
    });
    expect(adapter.calls.map(({ path }) => path)).toEqual([
      '/v1/marketview/widgets/MW_CONTEXT_LABEL_MALFORMED',
      '/v1/marketview/widgets/configurations',
    ]);
  });

  it.each([
    [{ widgetId: 'MW_FOREIGN' as WidgetId }, 'MW_FOREIGN'],
    [{ underlyingChartId: 'DV_FOREIGN' }, 'MW_EXPECTED'],
  ])('fails typed when a minted Config returns foreign identity %s', async (conflict, ownerWidgetId) => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_EXPECTED': () => ({
        id: 'MW_EXPECTED',
        title: 'Expected Widget',
        underlyingChartId: 'DV_EXPECTED',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          options: ['MA_EURUSD', 'MA_USDMXN'],
          values: { default: 'MA_EURUSD' },
        },
        renderParams: { component: { cross: 'MA_EURUSD' }, controls: [] },
        parameters: [],
        metadata: { title: 'Expected Widget' },
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_MINTED',
        widgetId: 'MW_EXPECTED' as WidgetId,
        underlyingChartId: 'DV_EXPECTED',
        ...conflict,
      }),
    });

    await expect(createWidget(adapter).get({
      widgetId: 'MW_EXPECTED' as WidgetId,
      configurationId: null,
      selectedContext: 'MA_USDMXN',
      parameters: [],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'configuration-mismatch',
        identity: {
          widgetId: 'MW_EXPECTED' as WidgetId,
          configurationId: 'WC_MINTED' as ConfigId,
        },
        ...(ownerWidgetId ? { ownerWidgetId } : {}),
      },
    });
  });

  it('fails loud when default configuration creation returns no configuration id', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CH_CONFIG_MALFORMED': () => ({
        id: 'MW_CH_CONFIG_MALFORMED',
        title: 'Malformed configuration',
        underlyingChartId: 'CH_CONFIG_MALFORMED',
        contextParameter: { field: 'asset', options: ['MA1'], value: 'MA1' },
        renderParams: {
          component: { asset: 'MA1' },
          controls: [{ id: 'asset', value: 'MA1', values: ['MA1'] }],
        },
        parameters: [],
        metadata: { title: 'Malformed configuration' },
      }),
      '/v1/marketview/widgets/configurations': () => ({}),
      '/v1/plots/entities': () => ({ assets: [{ id: 'MA1', name: 'EURUSD' }] }),
      '/v1/charts/CH_CONFIG_MALFORMED': () => ({
        description: 'USD.foo()',
        chartType: 'line',
        expressions: [{ label: 'Series' }],
        relativeStartDate: '-1y',
        interval: 'Daily',
      }),
      '/v1/plots/runner': () => ({
        expressions: ['USD.foo()'],
        results: [{ type: 'series', values: { '2026-01-01': 1, '2026-01-02': 2 } }],
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_CONFIG_MALFORMED' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected malformed configuration failure');
    expect(result.error.kind).toBe('configuration-mint-failure');
    expect(adapter.calls.map((call) => `${call.init?.method ?? 'GET'} ${call.path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_CH_CONFIG_MALFORMED',
      'POST /v1/marketview/widgets/configurations',
    ]);
  });

  it('fails loud when the CH batch render omits one series', async () => {
    const widget = {
      id: 'MW_CH_PARTIAL',
      title: 'CH Partial Widget',
      configurationId: 'WC_CH' as ConfigId,
      underlyingChartId: 'CH_PARTIAL',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {},
    };
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CH_PARTIAL') return widget;
      if (path === '/v1/charts/CH_PARTIAL') {
        return {
          description: 'USD.current()\nUSD.previous()',
          chartType: 'line',
          expressions: [{ label: 'Current' }, { label: 'Previous close' }],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        // Single batched POST carries both expressions; the server returns no result for the
        // first series (Current) and data for the second (Previous close).
        const expressions = (init?.body as { expressions?: string[] } | undefined)?.expressions ?? [];
        return {
          expressions,
          results: [null, { type: 'series', values: { '2026-01-01': 1, '2026-01-02': 2 } }],
        };
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_CH', parameters: [] };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_PARTIAL' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected malformed CH result failure');
    expect(result.error).not.toHaveProperty('message');
  });

  it('fails loud without retrying when the CH runner returns 503', async () => {
    const widget = {
      id: 'MW_CH_RETRY',
      title: 'CH Retry Widget',
      configurationId: 'WC_CH' as ConfigId,
      underlyingChartId: 'CH_RETRY',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {},
    };
    let runnerCalls = 0;
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CH_RETRY') return widget;
      if (path === '/v1/charts/CH_RETRY') {
        return {
          description: 'HSCEI.optionCost()\nSPX.optionCost()',
          chartType: 'line',
          expressions: [{ label: 'HSCEI hedge cost' }, { label: 'SPX hedge cost' }],
          relativeStartDate: '-6m',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        runnerCalls += 1;
        const expressions = (init?.body as { expressions?: string[] } | undefined)?.expressions ?? [];
        if (runnerCalls <= 1) {
          throw new MarqueeError('http', 'Marquee returned 503 for /v1/plots/runner', {
            status: 503,
            path,
          });
        }
        return {
          expressions,
          results: [
            { type: 'series', values: { '2026-05-01': 0.10, '2026-05-02': 0.11 } },
            { type: 'series', values: { '2026-05-01': 0.05, '2026-05-02': 0.06 } },
          ],
        };
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_CH', parameters: [] };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_RETRY' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected CH runner failure');
    expect(runnerCalls).toBe(1);
    expect(result.error).not.toHaveProperty('message');
  });

  it('does not retry the CH runner batch on deterministic client errors', async () => {
    const widget = {
      id: 'MW_CH_BAD_REQUEST',
      title: 'CH Bad Request Widget',
      configurationId: 'WC_CH' as ConfigId,
      underlyingChartId: 'CH_BAD_REQUEST',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {},
    };
    let runnerCalls = 0;
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_BAD_REQUEST') return widget;
      if (path === '/v1/charts/CH_BAD_REQUEST') {
        return {
          description: 'BRL.spot()\nBRL.carry()',
          chartType: 'line',
          expressions: [{ label: 'Spot' }, { label: 'Carry' }],
          relativeStartDate: '-6m',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        runnerCalls += 1;
        throw new MarqueeError('http', 'Marquee returned 400 for /v1/plots/runner', {
          status: 400,
          path,
        });
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_CH', parameters: [] };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_BAD_REQUEST' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected CH client error');
    expect(runnerCalls).toBe(1);
    expect(result.error).not.toHaveProperty('message');
  });

  it('fails loud without retrying after a CH render timeout', async () => {
    const widget = {
      id: 'MW_CH_TIMEOUT',
      title: 'CH Timeout Widget',
      configurationId: 'WC_CH' as ConfigId,
      underlyingChartId: 'CH_TIMEOUT',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {},
    };
    let runnerCalls = 0;
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_TIMEOUT') return widget;
      if (path === '/v1/charts/CH_TIMEOUT') {
        return {
          description: 'AUDJPY.implied_volatility()\nAUDJPY.realized_volatility()',
          chartType: 'line',
          expressions: [{ label: 'Implied Vol' }, { label: 'Realized Vol' }],
          relativeStartDate: '-6m',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        runnerCalls += 1;
        throw new MarqueeError('timeout', 'Marquee timed out for /v1/plots/runner', {
          path,
        });
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_CH', parameters: [] };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_TIMEOUT' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected CH timeout failure');
    expect(runnerCalls).toBe(1);
    expect(result.error).not.toHaveProperty('message');
  });

  it('fails loud after the first unavailable CH render', async () => {
    const widget = {
      id: 'MW_CH_UNAVAILABLE',
      title: 'CH Unavailable Widget',
      configurationId: 'WC_CH' as ConfigId,
      underlyingChartId: 'CH_UNAVAILABLE',
      renderParams: { component: {}, controls: [] },
      parameters: [],
      metadata: {},
    };
    let runnerCalls = 0;
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_CH_UNAVAILABLE') return widget;
      if (path === '/v1/charts/CH_UNAVAILABLE') {
        return {
          description: 'HSCEI.optionCost()\nSPX.optionCost()',
          chartType: 'line',
          expressions: [{ label: 'HSCEI hedge cost' }, { label: 'SPX hedge cost' }],
          relativeStartDate: '-6m',
          interval: 'Daily',
        };
      }
      if (path === '/v1/plots/runner') {
        runnerCalls += 1;
        throw new MarqueeError('http', 'Marquee returned 503 for /v1/plots/runner', {
          status: 503,
          path,
        });
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_CH', parameters: [] };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_CH_UNAVAILABLE' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected unavailable CH render failure');
    expect(runnerCalls).toBe(1);
    expect(result.error).not.toHaveProperty('message');
  });

  it('fails loud when a DV response would require relative-date restoration', async () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2025-08-18' };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_MACRO': () => ({
        id: 'MW_MACRO',
        title: 'What are the upcoming sample events for PAIR_XY next week?',
        configurationId: 'WC_STALE' as ConfigId,
        underlyingChartId: 'DV_MACRO',
        renderParams: {
          component: { pricingDate: '2025-08-18', region: 'JP' },
          controls: [
            { id: 'pricingDate', type: 'Date', value: '2025-08-18' },
          ],
        },
        parameters: [
          { field: 'pricingDate', type: 'Date', values: { default: relativePricingDate } },
          { field: 'region', type: 'String', values: { default: 'JP' } },
        ],
        metadata: { title: 'What are the upcoming sample events for PAIR_XY next week?' },
      }),
      '/v1/data/visualizations/DV_MACRO': () => ({}),
      '/v1/data/visualizations/DV_MACRO/render': () => ({ renderData: { data: [], layout: {} } }),
    });

    await expect(createCapabilities(adapter).prepare({
      source: { kind: 'id', id: 'MW_MACRO' },
      mode: 'view',
      data: 'render',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_MACRO' as WidgetId },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'relative Date default requires restoration',
      },
    });
  });

  it('fails loud when a CH response would require relative-date restoration', async () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2025-08-18' };
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_CH_MACRO': () => ({
        id: 'MW_CH_MACRO',
        title: 'What are the upcoming sample events for PAIR_XY next week?',
        configurationId: 'WC_STALE_CH' as ConfigId,
        underlyingChartId: 'CH_MACRO',
        renderParams: {
          component: { pricingDate: '2025-08-18', region: 'JP' },
          controls: [
            { id: 'pricingDate', type: 'Date', value: '2025-08-18' },
          ],
        },
        parameters: [
          { field: 'pricingDate', type: 'Date', values: { default: relativePricingDate } },
          { field: 'region', type: 'String', values: { default: 'JP' } },
        ],
        metadata: { title: 'What are the upcoming sample events for PAIR_XY next week?' },
      }),
      '/v1/charts/CH_MACRO': () => ({
        controls: [{ id: 'pricingDate', controlType: 'Date' }],
        description: 'series = macro_events(Control(pricingDate).value())',
        chartType: 'line',
        expressions: [{ label: 'Series' }],
        relativeStartDate: '-1y',
        interval: 'Daily',
      }),
      '/v1/plots/runner': () => ({
        expressions: ['series = macro_events(0b)'],
        results: [{ type: 'series', values: { '2026-01-01': 1, '2026-01-02': 2 } }],
      }),
    });

    await expect(createCapabilities(adapter).prepare({
      source: { kind: 'id', id: 'MW_CH_MACRO' },
      mode: 'view',
      data: 'render',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_CH_MACRO' as WidgetId },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'relative Date default requires restoration',
      },
    });
  });

  it('reads editable dashboards when changing widget params', async () => {
    const widget = {
      id: 'MW_DASH_CHANGE',
      title: 'Positioning',
      useEntityTitle: true,
      configurationId: 'WC_OLD' as ConfigId,
      underlyingChartId: 'DV_DASH_CHANGE',
      visualizationType: 'DataViz',
      authors: ['AUTHOR'],
      label: 'external',
      renderParams: { component: { universe: 'G10' } },
      parameters: [
        {
          field: 'universe',
          type: 'Enum',
          values: { default: 'G10' },
          options: ['G10', 'Latam'],
        },
      ],
      metadata: { title: 'Positioning' },
    };
    const configuredWidget = {
      ...widget,
      configurationId: 'WC_NEW' as ConfigId,
      renderParams: { component: { universe: 'Latam' } },
      parameters: [
        {
          field: 'universe',
          type: 'Enum',
          values: { default: 'Latam' },
          options: ['G10', 'Latam'],
        },
      ],
    };
    const dashboards = [
      { dashboardId: 'MD_TEMP', title: 'Temp' },
      { dashboardId: 'MD_SANDBOX', title: "Example Sandbox" },
    ];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_DASH_CHANGE') {
        return init?.query?.context === 'WC_NEW' ? configuredWidget : widget;
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_NEW' };
      if (path === '/v1/users/query') {
        return { totalResults: 1, results: [{ id: 'AUTHOR', name: 'Widget Author' }] };
      }
      if (path === '/v1/marketview/dashboards') {
        expect(init?.query).toEqual({ view_as: 'edit', size: 100, page: 1 });
        return {
          results: dashboards.map(({ dashboardId, title }) => ({ id: dashboardId, title })),
        };
      }
      if (path === '/v1/data/visualizations/DV_DASH_CHANGE') return {};
      if (path === '/v1/data/visualizations/DV_DASH_CHANGE/render') {
        return { renderData: { data: [], layout: {} } };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_DASH_CHANGE',
      params: [{ field: 'universe', value: 'Latam' }],
      editableDashboards: 'fetch',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.widget.dashboards).toEqual(dashboards);
    expect(adapter.calls.map((call) => call.path)).toContain('/v1/marketview/dashboards');
  });

  it('fails loud when DV render is unavailable', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_SLOW_DV') {
        return {
          id: 'MW_SLOW_DV',
          title: 'Slow DV Widget',
          configurationId: 'WC_OLD' as ConfigId,
          underlyingChartId: 'DV_SLOW',
          visualizationType: 'DataViz',
          renderParams: { component: { asset: 'EURUSD' } },
          parameters: [],
          metadata: { title: 'Slow DV Widget' },
        };
      }
      if (path === '/v1/data/visualizations/DV_SLOW') return {};
      if (path === '/v1/data/visualizations/DV_SLOW/render') {
        throw new MarqueeError('timeout', 'Marquee timed out for /v1/data/visualizations/DV_SLOW/render', {
          path,
        });
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_OLD', parameters: [] };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_SLOW_DV' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected DV timeout failure');
    expect(result.error).not.toHaveProperty('message');
    expect(result.error).toMatchObject({
      kind: 'data-viz-failure',
      problem: { kind: 'render-failure', failure: { kind: 'timeout' } },
    });
  });

  it('rejects QuickPoll surveyDate changes before rendering incoherent dependent question data', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_QUICKPOLL': () => ({
        id: 'MW_QUICKPOLL',
        title: 'QuickPoll Widget',
        configurationId: 'WC_OLD' as ConfigId,
        underlyingChartId: 'DV_QUICKPOLL',
        tags: ['QuickPoll'],
        renderParams: {
          component: {
            surveyDate: '2025-12-01',
            question: 4,
            includeInternal: false,
          },
        },
        parameters: [
          { field: 'surveyDate', type: 'Date', values: { default: '2025-12-01' } },
          { field: 'question', type: 'Integer', values: { default: 4 } },
          { field: 'includeInternal', type: 'Boolean', values: { default: false } },
        ],
        metadata: { title: 'QuickPoll Widget' },
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_QUICKPOLL',
        widgetId: 'MW_QUICKPOLL' as WidgetId,
        underlyingChartId: 'DV_QUICKPOLL',
        parameters: [],
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_QUICKPOLL',
      params: [
        { field: 'question', value: '4' },
        { field: 'includeInternal', value: 'false' },
        { field: 'surveyDate', value: '2026-04-01' },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected QuickPoll surveyDate rejection');
    expect(result.error).toMatchObject({ kind: 'invalid-input', input: 'surveyDate' });
    expect(adapter.calls.map((call) => `${call.init?.method ?? 'GET'} ${call.path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_QUICKPOLL',
    ]);
  });

  it('rejects QuickPoll surveyDate changes even when surveyDate is not the final override', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_QUICKPOLL': () => ({
        id: 'MW_QUICKPOLL',
        title: 'QuickPoll Widget',
        configurationId: 'WC_OLD' as ConfigId,
        underlyingChartId: 'DV_QUICKPOLL',
        tags: ['QuickPoll'],
        renderParams: {
          component: {
            surveyDate: '2025-12-01',
            question: 4,
            includeInternal: false,
          },
        },
        parameters: [
          { field: 'surveyDate', type: 'Date', values: { default: '2025-12-01' } },
          { field: 'question', type: 'Integer', values: { default: 4 } },
          { field: 'includeInternal', type: 'Boolean', values: { default: false } },
        ],
        metadata: { title: 'QuickPoll Widget' },
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_QUICKPOLL',
        widgetId: 'MW_QUICKPOLL' as WidgetId,
        underlyingChartId: 'DV_QUICKPOLL',
        parameters: [],
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_QUICKPOLL',
      params: [
        { field: 'surveyDate', value: '2026-04-01' },
        { field: 'question', value: '4' },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected QuickPoll surveyDate rejection');
    expect(result.error).toMatchObject({ kind: 'invalid-input', input: 'surveyDate' });
    expect(adapter.calls.map((call) => `${call.init?.method ?? 'GET'} ${call.path}`)).toEqual([
      'GET /v1/marketview/widgets/MW_QUICKPOLL',
    ]);
  });

  it('preserves API response body evidence for the Widget presenter', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_DV') {
        return {
          id: 'MW_DV',
          title: 'DV Widget',
          configurationId: 'WC_OLD' as ConfigId,
          underlyingChartId: 'DV_ONE',
          visualizationType: 'DataViz',
          renderParams: { component: { benchmarkIndex: 'SOFR' } },
          parameters: [{
            field: 'benchmarkIndex',
            type: 'String',
            values: { default: 'SOFR' },
          }],
        };
      }
      if (path === '/v1/marketview/widgets/MW_DV/metadata') {
        return { metadata: {} };
      }
      if (path === '/v1/marketview/widgets/configurations') return {
        id: 'WC_NEW',
        widgetId: 'MW_DV' as WidgetId,
        underlyingChartId: 'DV_ONE',
        parameters: [],
      };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      if (path === '/v1/data/visualizations/DV_ONE') return {};
      if (path.includes('/render')) {
        throw new MarqueeError('http', 'Marquee returned 500 for /v1/data/visualizations/DV_ONE/render', {
          status: 500,
          path,
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_DV',
      params: [{ field: 'benchmarkIndex', value: 'SONIA' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected upstream failure');
    expect(result.error.kind).toBe('data-viz-failure');
  });

  it('includes changed parameter context in render-path error when body is empty', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_DV') {
        return {
          id: 'MW_DV',
          title: 'DV Widget',
          configurationId: 'WC_OLD' as ConfigId,
          underlyingChartId: 'DV_ONE',
          visualizationType: 'DataViz',
          renderParams: { component: { tenor: '3m' } },
          parameters: [{
            field: 'tenor',
            type: 'String',
            values: { default: '3m' },
          }],
        };
      }
      if (path === '/v1/marketview/widgets/MW_DV/metadata') {
        return { metadata: {} };
      }
      if (path === '/v1/marketview/widgets/configurations') return {
        id: 'WC_NEW',
        widgetId: 'MW_DV' as WidgetId,
        underlyingChartId: 'DV_ONE',
        parameters: [],
      };
      if (path === '/v1/marketview/dashboards') return { results: [] };
      if (path === '/v1/data/visualizations/DV_ONE') return {};
      if (path.includes('/render')) {
        throw new MarqueeError('http', 'Marquee returned 400 for /v1/data/visualizations/DV_ONE/render', {
          status: 400,
          path,
          body: '',
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_DV',
      params: [{ field: 'tenor', value: '1w' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected render failure');
    expect(result.error.kind).toBe('data-viz-failure');
    expect(result.error).not.toHaveProperty('message');
  });

  it('formats array-valued parameter context without broken JSON fragments on render errors', async () => {
    const opaqueAssetId = `MA${'A'.repeat(16)}`;
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_DV') {
        return {
          id: 'MW_DV',
          title: 'DV Widget',
          configurationId: 'WC_OLD' as ConfigId,
          underlyingChartId: 'DV_ONE',
          visualizationType: 'DataViz',
          renderParams: { component: { assets: [opaqueAssetId, 'EURUSD', 'ES1', 'CL1'] } },
        };
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_NEW' };
      if (path === '/v1/plots/entities') return { assets: [] };
      if (path === '/v1/data/visualizations/DV_ONE') return {};
      if (path.includes('/render')) {
        throw new MarqueeError('http', 'Marquee returned 416 for /v1/data/visualizations/DV_ONE/render', {
          status: 416,
          path,
          body: '',
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_DV',
      params: [
        { field: 'assets', value: `${opaqueAssetId},EURUSD,ES1,CL1` },
        { field: 'event', value: 'Non Farm Payrolls:United States' },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected render failure');
    expect(JSON.stringify(result.error)).not.toContain(',,');
    expect(result.error).not.toHaveProperty('message');
  });

  it('identifies the DV render endpoint when param changes time out', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      if (path === '/v1/marketview/widgets/MW_EARNINGS') {
        return {
          id: 'MW_EARNINGS',
          title: 'Upcoming Earnings',
          configurationId: 'WC_OLD' as ConfigId,
          underlyingChartId: 'DV_EARNINGS',
          visualizationType: 'DataViz',
          renderParams: { component: { index: 'SS Technology Select Sector' } },
          parameters: [{
            field: 'index',
            type: 'String',
            values: { default: 'SS Technology Select Sector' },
          }],
        };
      }
      if (path === '/v1/marketview/widgets/configurations') return { id: 'WC_NEW' };
      if (path === '/v1/data/visualizations/DV_EARNINGS') return {};
      if (path === '/v1/data/visualizations/DV_EARNINGS/render') {
        throw new MarqueeError('timeout', 'Request timed out after 15s', { path });
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_EARNINGS',
      params: [
        { field: 'start', value: '-1b' },
        { field: 'end', value: '+1w' },
        { field: 'index', value: 'SPX' },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected render timeout');
    expect(result.error).not.toHaveProperty('message');
  });

  it('posts raw values in widget param changes', async () => {
    let postedParams: Array<{ field: string; value: unknown }> = [];
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_EARNINGS') {
        return {
          id: 'MW_EARNINGS',
          title: 'Upcoming Earnings',
          configurationId: 'WC_OLD' as ConfigId,
          underlyingChartId: 'DV_EARNINGS',
          visualizationType: 'DataViz',
          renderParams: { component: { index: 'SS Technology Select Sector' } },
          parameters: [{
            field: 'index',
            type: 'String',
            values: { default: 'SS Technology Select Sector' },
          }],
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        postedParams = (init?.body as { parameters?: Array<{ field: string; value: unknown }> }).parameters ?? [];
        return {
          id: 'WC_NEW',
          widgetId: 'MW_EARNINGS' as WidgetId,
          underlyingChartId: 'DV_EARNINGS',
          parameters: [],
        };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      if (path === '/v1/data/visualizations/DV_EARNINGS') return {};
      if (path === '/v1/data/visualizations/DV_EARNINGS/render') {
        throw new MarqueeError('timeout', 'Request timed out after 15s', { path });
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_EARNINGS',
      params: [
        { field: 'index', value: 'MA_SYNTH_011' },
      ],
    });

    expect(postedParams).toEqual([
      { field: 'index', value: 'MA_SYNTH_011' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected render timeout');
  });

  it('change rejects unsupported chart id', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNKNOWN': () => ({
        id: 'MW_UNKNOWN',
        title: 'Unknown Chart',
        configurationId: 'WC_X' as ConfigId,
        underlyingChartId: 'XY_UNSUPPORTED',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: {},
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_UNKNOWN',
      params: [{ field: 'x', value: 'y' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected unsupported chart id error');
    expect(result.error).toEqual({
      kind: 'unsupported-execution-target',
      identity: { widgetId: 'MW_UNKNOWN' as WidgetId },
      targetId: 'XY_UNSUPPORTED',
    });
  });

  it('reads target-less MW Widget chrome without rendering data', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_BLANK': () => ({
        id: 'MW_BLANK',
        title: 'Blank Widget',
        configurationId: 'WC_BLANK' as ConfigId,
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: {},
      }),
      '/v1/marketview/dashboards': () => ({ results: [] }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_BLANK' },
      mode: 'view',
      data: 'render',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        view: {
          widget: { widgetId: 'MW_BLANK' as WidgetId, title: 'Blank Widget' },
          execution: { family: 'blank' },
        },
      },
    });
    expect(adapter.calls.map((call) => call.path)).toEqual([
      '/v1/marketview/widgets/MW_BLANK',
      '/v1/marketview/dashboards',
    ]);
  });

  it('rejects an unsupported execution target before rendering', async () => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_UNKNOWN': () => ({
        id: 'MW_UNKNOWN',
        title: 'Unknown Chart',
        configurationId: 'WC_X' as ConfigId,
        underlyingChartId: 'XY_UNSUPPORTED',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: {},
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_UNKNOWN' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected unsupported execution target error');
    expect(result.error).toEqual({
      kind: 'unsupported-execution-target',
      identity: { widgetId: 'MW_UNKNOWN' as WidgetId },
      targetId: 'XY_UNSUPPORTED',
    });
    expect(adapter.calls.map((call) => call.path)).toEqual(['/v1/marketview/widgets/MW_UNKNOWN']);
  });

  it('change fails when configuration POST returns no id', async () => {
    const adapter = createFakeRequestAdapter((path, init) => {
      if (path === '/v1/marketview/widgets/MW_CH') {
        return {
          id: 'MW_CH',
          title: 'CH Widget',
          configurationId: 'WC_CH' as ConfigId,
          underlyingChartId: 'CH_ONE',
          renderParams: {
            component: { x: 'y' },
            controls: [{ id: 'x', type: 'String', value: 'y' }],
          },
          parameters: [],
          metadata: {},
        };
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return init?.method === 'POST'
          ? {}
          : {
              id: 'WC_CH',
              widgetId: 'MW_CH' as WidgetId,
              underlyingChartId: 'CH_ONE',
              parameters: [{ field: 'x', value: 'y' }],
            };
      }
      if (path === '/v1/charts/CH_ONE') {
        return {
          description: 'USD.foo()',
          chartType: 'line',
          expressions: [],
          relativeStartDate: '-1y',
          interval: 'Daily',
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_CH',
      params: [{ field: 'x', value: 'z' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected missing config id error');
    expect(result.error.kind).toBe('configuration-mint-failure');
  });

  it.each([
    [{ widgetId: 'MW_FOREIGN' as WidgetId }, 'foreign Widget'],
    [{ underlyingChartId: 'DV_FOREIGN' }, 'foreign execution target'],
  ])('rejects minted %s identity drift for a private Snippet', async (conflict, _description) => {
    const adapter = createFakeRequestAdapter({
      '/v1/marketview/widgets/MW_EXPECTED': () => ({
        id: 'MW_EXPECTED',
        title: 'Expected',
        useEntityTitle: true,
        underlyingChartId: 'DV_EXPECTED',
        renderParams: { component: {}, controls: [] },
        parameters: [],
        metadata: {},
      }),
      '/v1/marketview/widgets/configurations': () => ({
        id: 'WC_MINTED',
        widgetId: 'MW_EXPECTED' as WidgetId,
        underlyingChartId: 'DV_EXPECTED',
        ...conflict,
      }),
    });

    const module = createCapabilities(adapter);
    const result = await module.configure({
      widgetId: 'MW_EXPECTED',
      params: [],
      data: 'skip',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected configuration identity failure');
    expect(result.error.kind).toBe('configuration-mismatch');
    expect(adapter.calls.map(({ path }) => path)).toEqual([
      '/v1/marketview/widgets/MW_EXPECTED',
      '/v1/marketview/widgets/configurations',
    ]);
  });

  it('returns a closed failure without presentation evidence when upstream loading fails', async () => {
    const adapter = createFakeRequestAdapter((path) => {
      throw new MarqueeError('http', 'upstream exploded', { status: 500, path });
    });

    const module = createCapabilities(adapter);
    const result = await module.prepare({
      source: { kind: 'id', id: 'MW_FAIL' },
      mode: 'view',
      data: 'render',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected upstream failure');
    expect(result.error.kind).toBe('widget-load-failure');
    expect(result.error).not.toHaveProperty('message');
    expect(adapter.calls.map((call) => call.path)).toEqual(['/v1/marketview/widgets/MW_FAIL']);
    expect(result).not.toHaveProperty('audit');
    expect(result).not.toHaveProperty('apiCalls');
  });

  it('propagates a failure that is not a classified transport error', async () => {
    const adapter = createFakeRequestAdapter(() => {
      throw new Error('in-process port exploded');
    });

    await expect(createCapabilities(adapter).prepare({
      source: { kind: 'id', id: 'MW_PLAIN_THROW' },
      mode: 'view',
      data: 'render',
    })).rejects.toThrow('in-process port exploded');
    expect(adapter.calls.map((call) => call.path)).toEqual(['/v1/marketview/widgets/MW_PLAIN_THROW']);
  });
});
