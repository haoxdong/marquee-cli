import type { ConfigId, WidgetId } from '../index.js';
import { describe, expect, it, vi } from 'vitest';
import { createEntityModule, type EntityModule } from '../../entity/index.js';
import { createControlGroupModule } from '../../control-group/index.js';
import { MarqueeError, type HttpRequestInit } from '../../transport/index.js';
import { createWidget as createProductionWidget } from '../index.js';
import type {
  WidgetDates,
  WidgetModule,
  WidgetParameterOverride,
  WidgetValue,
} from '../index.js';

type LegacySelectedContext =
  | Readonly<{ kind: 'asset' | 'country' | 'portfolio'; entityId: string }>
  | Readonly<{ kind: 'control-group'; controlGroupId: string }>;

function createWidget(
  transport: { request(path: string, init?: HttpRequestInit): Promise<unknown> },
  options: { entity?: Partial<EntityModule> } = {},
) {
  const request: Parameters<typeof createProductionWidget>[0]['request'] = async (target, targetInit) => {
    // Fakes answer paths: an Endpoint reaches them as its path and method.
    const path = target.path;
    const init = { ...targetInit, method: target.method };
    if (path === '/v1/users/query') {
      const body = init.body as { where?: { id?: unknown } } | undefined;
      const ids = Array.isArray(body?.where?.id) ? body.where.id : [];
      return {
        totalResults: ids.length,
        results: ids.map((id) => ({ id, name: 'Test Author' })),
      };
    }
    const value = await transport.request(path, init);
    if (
      /^\/v1\/marketview\/widgets\/[^/]+$/.test(path)
      && typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
    ) {
      return {
        ...value,
        authors: 'authors' in value ? value.authors : ['AUTHOR'],
        label: 'label' in value ? value.label : 'external',
      };
    }
    return value;
  };
  const testTransport = { ...transport, request };
  return createProductionWidget(testTransport, {
    controlGroup: createControlGroupModule(testTransport),
    entity: Object.assign(createEntityModule(testTransport), options.entity),
  });
}

type LegacyRenderInput = Readonly<{
  widget: WidgetValue;
  parameters: readonly WidgetParameterOverride[];
  selectedContext: LegacySelectedContext | null;
  relativeDate: string | null;
  widgetDates?: WidgetDates;
}>;

function renderLegacyInput(
  widget: WidgetModule,
  input: LegacyRenderInput,
  detail: 'snippet' | 'full',
) {
  const context = input.selectedContext;
  return widget.render(
    input.widget,
    input.parameters,
    context === null
      ? null
      : context.kind === 'control-group'
        ? context.controlGroupId
        : context.entityId,
    input.widgetDates,
    detail,
  );
}

describe('Widget interface', () => {
  const basketId = `MA${'B'.repeat(14)}`;
  it('exposes only the final ratified operations', () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    expect(Object.keys(widget)).toEqual(['get', 'render']);
  });

  it('decodes a Widget Definition that has a target record but no Widget ID', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_TARGETED',
        title: 'Targeted title',
        metadata: { title: 'Targeted title' },
        useEntityTitle: false,
        underlyingChartId: 'CH_TARGETED',
        target: { family: 'plot', targetId: 'CH_TARGETED' },
        parameters: [],
        renderParams: { component: {}, controls: [] },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: { widget: { widgetId: 'MW_TARGETED' } },
    });
  });

  it('renders a static Widget Snippet from four semantic values without persistence', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_SEMANTIC',
        title: 'Fallback title',
        metadata: { title: 'Semantic title' },
        useEntityTitle: false,
        underlyingChartId: 'CH_SEMANTIC',
        parameters: [{
          field: 'tenor',
          type: 'Enum',
          value: '1y',
          options: ['1y', '2y'],
        }],
        renderParams: { component: { tenor: '1y' }, controls: [] },
      },
      [],
      null,
      {
        startDate: '2026-01-01',
        endDate: '2026-07-01',
        interval: '1d',
      },
      'snippet',
    )).resolves.toEqual({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: 'MW_SEMANTIC',
          configurationId: null,
          selectedContext: null,
          title: 'Semantic title',
          chartId: 'CH_SEMANTIC',
          family: 'plot',
          bindings: [],
          parameters: [
            {
              field: 'tenor',
              refKey: 'tenor',
              type: 'unknown',
              default: undefined,
              options: [],
            },
            {
              field: 'Relative Date',
              refKey: 'relativeDate',
              type: 'unknown',
              default: undefined,
              options: [],
            },
          ],
        },
        snippet: {
          title: 'Semantic title',
          isTitleResolved: true,
          parameterLines: ['tenor=1y', 'relativeDate='],
        },
      },
    });
  });

  it('renders a target-less stale Widget Snippet from surface values', async () => {
    const request = vi.fn(async () => {
      throw new Error('unexpected request');
    });
    const widget = createWidget({ request });

    const result = await widget.render(
      {
        id: 'MW_STALE',
        title: 'Stale Widget',
        useEntityTitle: true,
        parameters: [],
      },
      [],
      null,
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: 'MW_STALE',
          title: 'Stale Widget',
        },
        snippet: {
          title: 'Stale Widget',
          isTitleResolved: true,
          parameterLines: [],
        },
      },
    });
    if (!result.ok) throw new Error('expected stale Widget snippet to render');
    expect(result.value.widget).not.toHaveProperty('chartId');
    expect(result.value.widget).not.toHaveProperty('family');
    expect(request).not.toHaveBeenCalled();
  });

  it('renders target-less MW Widget chrome with a blank full data body', async () => {
    // Unit stand-in for a target-less Widget: broad authenticated searches on 2026-08-22
    // found no live Widget without an underlying target that could be recorded.
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/marketview/widgets/MW_BLANK') {
        return {
          id: 'MW_BLANK',
          title: 'Blank Widget',
          useEntityTitle: false,
          renderParams: { component: { tenor: '1y' }, controls: [] },
          parameters: [{
            field: 'tenor',
            type: 'Enum',
            values: { default: '1y' },
            options: ['1y', '2y'],
          }],
        };
      }
      if (path === '/v1/marketview/widgets/MW_BLANK/metadata') {
        return { metadata: {} };
      }
      if (path === '/v1/marketview/dashboards') return { results: [] };
      throw new Error('unexpected request');
    });
    const widget = createWidget({ request });

    const result = await widget.get({
      widgetId: 'MW_BLANK' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        widget: {
          widgetId: 'MW_BLANK',
          title: 'Blank Widget',
        },
        snippet: {
          title: 'Blank Widget',
          isTitleResolved: true,
          parameterLines: ['tenor=1y'],
        },
      },
    });
    if (!result.ok || result.value.detail !== 'full') {
      throw new Error('expected target-less Widget chrome to render');
    }
    expect(result.value.widget).not.toHaveProperty('chartId');
    expect(result.value.widget).not.toHaveProperty('family');
    expect(result.value.execution).toEqual({ family: 'blank' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/v1/marketview/widgets/MW_BLANK',
      '/v1/marketview/widgets/MW_BLANK/metadata',
      '/v1/marketview/dashboards',
    ]);
  });

  it('fails loud on a surface Widget whose Widget ID is a Config ID', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'WC_SWAPPED',
        title: 'Swapped Widget',
        underlyingChartId: 'CH_SWAPPED',
        parameters: [],
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'invalid-response',
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'widget id WC_SWAPPED is malformed',
      },
    });
  });

  it('fails loud on a surface Widget without a Widget ID', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      { title: 'Anonymous Widget', underlyingChartId: 'CH_ANONYMOUS', parameters: [] },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-definition',
        identity: { widgetId: '' },
        problem: 'missing-identity',
      },
    });
  });

  it('rejects an unsupported target on a surface Widget Snippet', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_UNSUPPORTED',
        title: 'Unsupported Widget',
        underlyingChartId: 'XX_UNKNOWN',
        parameters: [],
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'unsupported-execution-target',
        identity: { widgetId: 'MW_UNSUPPORTED' },
        targetId: 'XX_UNKNOWN',
      },
    });
  });

  it('prints stored array and provider values, unset ones as name=, without Config-only assignments', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    const result = await widget.render(
      {
        id: 'MW_STORED_VALUES',
        title: 'Stored values',
        metadata: { title: 'Stored values' },
        underlyingChartId: 'DV_STORED_VALUES',
        visualizationType: 'DataViz',
        parameters: [
          {
            field: 'universe',
            type: 'EnumList',
            value: ['G10', 'EM'],
          },
          {
            field: 'providerStatus',
            type: 'String',
            value: 'Unknown Value',
          },
          {
            field: 'unset',
            type: 'String',
          },
          {
            field: 'nullish',
            type: 'String',
            value: null,
          },
          {
            field: 'disabled',
            type: 'Boolean',
            value: false,
          },
          {
            field: 'threshold',
            type: 'Float',
            value: 0,
          },
          {
            field: 'emptyLabel',
            type: 'String',
            value: '',
          },
        ],
        renderParams: {
          component: {
            universe: ['G10', 'EM'],
            providerStatus: 'Unknown Value',
            nullish: null,
            disabled: false,
            threshold: 0,
            emptyLabel: '',
            configOnly: 'excluded',
          },
          controls: [],
        },
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
          parameterLines: [
            'universe=G10,EM',
            'providerStatus=Unknown Value',
            'unset=',
            'nullish=',
            'disabled=false',
            'threshold=0',
            'emptyLabel=',
          ],
        },
      },
    });
  });

  it('uses supplied provider display evidence for an opaque Widget Parameter', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });
    const assetId = basketId;

    await expect(widget.render(
      {
        id: 'MW_DISPLAY_EVIDENCE',
        title: 'Display evidence',
        metadata: {
          title: 'Display evidence',
          entityMetadata: {
            [assetId]: { name: 'EURUSD' },
          },
        },
        underlyingChartId: 'DV_DISPLAY_EVIDENCE',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'cross',
          type: 'Asset',
          values: { default: assetId },
        },
        parameters: [],
        renderParams: { component: { cross: assetId }, controls: [] },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: ['cross=EURUSD'],
        },
      },
    });
  });

  it('preserves supplied assignment display evidence for an opaque Widget Parameter', async () => {
    const request = vi.fn(async () => {
      throw new Error('unexpected request');
    });
    const widget = createWidget({ request });
    const assetId = `MA${'A'.repeat(16)}`;

    await expect(widget.render(
      {
        id: 'MW_SURFACE_DISPLAY_EVIDENCE',
        title: 'Surface display evidence',
        metadata: { title: 'Surface display evidence' },
        underlyingChartId: 'DV_SURFACE_DISPLAY_EVIDENCE',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'asset',
          type: 'Asset',
          values: { default: assetId },
        },
        parameters: [{ field: 'asset', type: 'Asset', value: assetId }],
        renderParams: {
          component: { asset: assetId },
          controls: [],
        },
      },
      [{ field: 'asset', value: assetId, displayValue: 'Surface Asset' }],
      assetId,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: ['asset=Surface Asset'],
        },
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('resolves an echoed opaque assignment label through Entity', async () => {
    const assetId = `MA${'A'.repeat(14)}`;
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: [{
        kind: 'asset' as const,
        entityId: assetId,
        label: 'Example Technologies Inc',
        aliases: [assetId],
      }],
    }));
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    }, { entity: { resolve } });

    await expect(widget.render(
      {
        id: 'MW_ECHOED_OPAQUE_DISPLAY',
        title: 'Echoed opaque display',
        useEntityTitle: true,
        underlyingChartId: 'DV_ECHOED_OPAQUE_DISPLAY',
        visualizationType: 'DataViz',
        parameters: [{ field: 'asset2', type: 'Asset', value: assetId }],
        renderParams: {
          component: { asset2: assetId },
          controls: [],
        },
      },
      [{ field: 'asset2', value: assetId }],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: ['asset2=Example Technologies Inc'],
        },
      },
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith([{ kind: 'asset', value: assetId }]);
  });

  it('resolves an opaque assignment display value before rendering a Widget Snippet', async () => {
    const request = vi.fn(async () => {
      throw new Error('unexpected request');
    });
    const assetId = `MA${'P'.repeat(14)}`;
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: [{
        kind: 'asset' as const,
        entityId: assetId,
        label: 'AUDUSD',
        aliases: [],
      }],
    }));
    const widget = createWidget({ request }, { entity: { resolve } });

    await expect(widget.render(
      {
        id: 'MW_OPAQUE_DISPLAY_VALUE',
        title: 'AUDUSD curve',
        metadata: { title: 'AUDUSD curve' },
        underlyingChartId: 'DV_OPAQUE_DISPLAY_VALUE',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'country',
          type: 'Asset',
          values: { default: assetId },
        },
        parameters: [],
        renderParams: { component: { country: assetId }, controls: [] },
      },
      [{ field: 'country', value: assetId, displayValue: assetId }],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: ['country=AUDUSD'],
        },
      },
    });
    expect(resolve).toHaveBeenCalledWith([{ kind: 'asset', value: assetId }]);
    expect(request).not.toHaveBeenCalled();
  });

  it('trusts the dynamic metadata title computed for the Product Surface context', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const activeAssetId = `MA${'A'.repeat(16)}`;
    const staleAssetId = `MA${'B'.repeat(16)}`;
    const widget = createWidget({
      async request(path, init) {
        requests.push({ path, body: init?.body });
        if (path === '/v1/marketview/widgets/MW_SURFACE_DYNAMIC_TITLE/metadata') {
          return {
            metadata: {
              title: 'Retail flows for Surface $& Asset',
            },
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    });

    await expect(widget.render(
      {
        id: 'MW_SURFACE_DYNAMIC_TITLE',
        title: `Retail flows for <asset:${staleAssetId}>`,
        underlyingChartId: 'DV_SURFACE_DYNAMIC_TITLE',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'asset',
          type: 'Asset',
          values: { default: staleAssetId },
        },
        parameters: [],
        renderParams: {
          component: { asset: staleAssetId },
          controls: [],
        },
      },
      [{ field: 'asset', value: activeAssetId, displayValue: 'Surface $& Asset' }],
      activeAssetId,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Retail flows for Surface $& Asset',
        },
      },
    });
    expect(requests).toEqual([{
      path: '/v1/marketview/widgets/MW_SURFACE_DYNAMIC_TITLE/metadata',
      body: {
        parameters: [{ field: 'asset', value: activeAssetId }],
      },
    }]);
  });

  it('pre-substitutes the active context on every Widget surface', async () => {
    const activeAssetId = `MA${'A'.repeat(16)}`;
    const staleAssetId = `MA${'B'.repeat(16)}`;
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/marketview/widgets/MW_SHARED_CONTEXT_TITLE/metadata') {
        return { metadata: {} };
      }
      throw new Error(`unexpected ${path}`);
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
    const widget = createWidget({ request }, { entity: { resolve } });

    await expect(widget.render(
      {
        id: 'MW_SHARED_CONTEXT_TITLE',
        title: `Retail flows for <asset:${staleAssetId}>`,
        useEntityTitle: true,
        underlyingChartId: 'DV_SHARED_CONTEXT_TITLE',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'asset',
          type: 'Asset',
          values: { default: staleAssetId },
        },
        parameters: [],
        renderParams: {
          component: { asset: staleAssetId },
          controls: [],
        },
      },
      [{ field: 'asset', value: activeAssetId, displayValue: 'Active Asset' }],
      activeAssetId,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: { snippet: { title: 'Retail flows for ACTIVE UW' } },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith([{ kind: 'asset', value: activeAssetId }]);
  });

  it('keeps a static saved title ahead of embedded metadata', async () => {
    const request = vi.fn(async () => {
      throw new Error('unexpected request');
    });
    const widget = createWidget({ request });
    const assetId = `MA${'A'.repeat(16)}`;

    await expect(widget.render(
      {
        id: 'MW_SURFACE_LITERAL_TITLE',
        title: 'Surface Asset retail flows',
        metadata: { title: 'Embedded Surface Asset flow title' },
        useEntityTitle: true,
        underlyingChartId: 'DV_SURFACE_LITERAL_TITLE',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'asset',
          type: 'Asset',
          values: { default: assetId },
        },
        parameters: [],
        renderParams: {
          component: { asset: assetId },
          controls: [],
        },
      },
      [{ field: 'asset', value: assetId, displayValue: 'Surface Asset' }],
      assetId,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Surface Asset retail flows',
        },
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps dynamic-TRUE metadata terminal without Entity fall-through', async () => {
    const opaqueAssetId = `MA${'C'.repeat(16)}`;
    const request = vi.fn(async () => {
      throw new Error('unexpected request');
    });
    const resolve = vi.fn(async () => {
      throw new Error('unexpected Entity resolution');
    });
    const widget = createWidget({ request }, { entity: { resolve } });

    await expect(widget.render(
      {
        id: 'MW_RULE_ZERO_TERMINAL',
        title: `Saved <Asset:${opaqueAssetId}>`,
        metadata: { title: `Provider <Asset:${opaqueAssetId}>` },
        useEntityTitle: true,
        underlyingChartId: 'DV_RULE_ZERO_TERMINAL',
        visualizationType: 'DataViz',
        renderParams: { component: {}, controls: [] },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: `Provider <Asset:${opaqueAssetId}>`,
          isTitleResolved: false,
        },
      },
    });
    expect(request).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('treats a META title as terminal without Entity fall-through', async () => {
    const opaqueAssetId = `MA${'D'.repeat(16)}`;
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/marketview/widgets/MW_META_TERMINAL/metadata') {
        return { metadata: { title: `META <Asset:${opaqueAssetId}>` } };
      }
      throw new Error(`unexpected ${path}`);
    });
    const resolve = vi.fn(async () => {
      throw new Error('unexpected Entity resolution');
    });
    const resolveIdentity = vi.fn(async () => {
      throw new Error('unexpected Entity identity resolution');
    });
    const widget = createWidget({ request }, { entity: { resolve, resolveIdentity } });

    await expect(widget.render(
      {
        id: 'MW_META_TERMINAL',
        title: `Saved <Asset:${opaqueAssetId}>`,
        useEntityTitle: true,
        underlyingChartId: 'DV_META_TERMINAL',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'Asset',
          type: 'Asset',
          value: opaqueAssetId,
        },
        renderParams: {
          component: {},
          controls: [{ id: 'Asset', type: 'Asset', value: opaqueAssetId }],
        },
      },
      [{ field: 'Asset', value: opaqueAssetId, displayValue: 'Readable Asset' }],
      opaqueAssetId,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: `META <Asset:${opaqueAssetId}>`,
          isTitleResolved: false,
        },
      },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it('prints long provider values that are not entity identifiers', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_LONG_VALUES',
        title: 'Long values',
        metadata: { title: 'Long values' },
        underlyingChartId: 'DV_LONG_VALUES',
        visualizationType: 'DataViz',
        parameters: [
          { field: 'workflowId', type: 'String', value: 'Q_TEST_WORKFLOW' },
          { field: 'xaxis', type: 'Enum', value: 'modifiedDuration' },
        ],
        renderParams: {
          component: {
            workflowId: 'Q_TEST_WORKFLOW',
            xaxis: 'modifiedDuration',
          },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: [
            'workflowId=Q_TEST_WORKFLOW',
            'xaxis=modifiedDuration',
          ],
        },
      },
    });
  });

  it('fails the whole Widget when opaque parameter Entity resolution is unavailable', async () => {
    const request = vi.fn(async () => {
        throw new Error('unexpected request');
    });
    const widget = createWidget({ request });

    await expect(widget.render(
      {
        id: 'MW_MISSING_DISPLAY',
        title: 'Missing display',
        metadata: { title: 'Missing display' },
        underlyingChartId: 'DV_MISSING_DISPLAY',
        visualizationType: 'DataViz',
        parameters: [{
          field: 'asset',
          type: 'Asset',
          value: basketId,
        }],
        renderParams: {
          component: { asset: basketId },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW_MISSING_DISPLAY' },
        failure: { kind: 'unavailable' },
      },
    });
    expect(request).toHaveBeenCalledWith('/v1/plots/entities', {
      method: 'GET',
      query: { ids: [basketId] },
    });
  });

  it('resolves opaque title and parameter values through the injected Entity module', async () => {
    const portfolioAssetId = `MA${'A'.repeat(14)}`;
    const request = vi.fn(async (path: string, _init?: HttpRequestInit) => {
      if (path === '/v1/marketview/widgets/MW_ENTITY_RESOLUTION/metadata') {
        return { metadata: {} };
      }
      if (path === '/v1/plots/entities') {
        return {
          assets: [
            { id: basketId, name: 'Global Growth Basket' },
            { id: portfolioAssetId, name: 'Growth Portfolio' },
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const entity = createEntityModule({
      request: (target, init) => request(target.path, { ...init, method: target.method }),
    });
    const widget = createWidget({ request }, {
      entity,
    });

    await expect(widget.render(
      {
        id: 'MW_ENTITY_RESOLUTION',
        title: `Exposure to <Asset:${basketId}>`,
        useEntityTitle: true,
        underlyingChartId: 'DV_ENTITY_RESOLUTION',
        visualizationType: 'DataViz',
        parameters: [{
          field: 'portfolio',
          type: 'Asset',
          value: portfolioAssetId,
        }],
        renderParams: {
          component: { portfolio: portfolioAssetId },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Exposure to Global Growth Basket',
          parameterLines: ['portfolio=Growth Portfolio'],
        },
      },
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith('/v1/plots/entities', expect.objectContaining({
      method: 'GET',
      query: { ids: [portfolioAssetId] },
    }));
    expect(request).toHaveBeenCalledWith('/v1/plots/entities', expect.objectContaining({
      method: 'GET',
      query: { ids: [basketId] },
    }));
  });

  it("renders an unresolvable Control Group value as Web's Unknown", async () => {
    const controlGroupId = `CG${'A'.repeat(14)}`;
    const literalIssuer = 'CGX Energy Inc';
    const firstMemberId = `MA${'B'.repeat(14)}`;
    const secondMemberId = `MA${'C'.repeat(14)}`;
    const request = vi.fn(async (path: string) => {
      if (path !== '/v1/marketview/constituents') {
        throw new Error(`unexpected ${path}`);
      }
      return {
        results: [
          {
            constituentId: firstMemberId,
            name: 'First Basket',
            controlGroups: [controlGroupId],
          },
          {
            constituentId: secondMemberId,
            name: 'Second Basket',
            controlGroups: [controlGroupId],
          },
        ],
      };
    });
    const resolve = vi.fn(async () => {
      throw new Error('Widget must not route Control Group expansion through Entity');
    });
    const widget = createWidget({ request }, { entity: { resolve } });

    await expect(widget.render(
      {
        id: 'MW_RESOLVED_CONTROL_GROUP',
        title: 'Resolved Control Group',
        metadata: {
          entityMetadata: {
            [controlGroupId]: { name: 'Forbidden group label' },
          },
        },
        useEntityTitle: true,
        underlyingChartId: 'DV_RESOLVED_CONTROL_GROUP',
        visualizationType: 'DataViz',
        parameters: [
          { field: 'basket', type: 'Asset', value: controlGroupId },
          { field: 'issuer', type: 'String', value: literalIssuer },
          {
            field: 'wrappedBasket',
            type: 'String',
            value: { value: controlGroupId },
          },
        ],
        renderParams: {
          component: {
            basket: controlGroupId,
            issuer: literalIssuer,
            wrappedBasket: { value: controlGroupId },
          },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: [
            'basket=Unknown',
            'issuer=CGX Energy Inc',
            'wrappedBasket=Unknown',
          ],
        },
      },
    });
    expect(request).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('uses embedded Entity labels after META returns no title', async () => {
    const resolve = vi.fn();
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/marketview/widgets/MW_EMBEDDED_ENTITY/metadata') {
        return { metadata: {} };
      }
      throw new Error(`unexpected ${path}`);
    });
    const widget = createWidget({ request }, { entity: { resolve } });

    await expect(widget.render(
      {
        id: 'MW_EMBEDDED_ENTITY',
        title: `Exposure to <Asset:${basketId}>`,
        useEntityTitle: true,
        metadata: {
          entityMetadata: {
            [basketId]: { name: 'Global Growth Basket' },
          },
        },
        underlyingChartId: 'DV_EMBEDDED_ENTITY',
        visualizationType: 'DataViz',
        parameters: [{ field: 'asset', type: 'Asset', value: basketId }],
        renderParams: {
          component: { asset: basketId },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Exposure to Global Growth Basket',
          parameterLines: ['asset=Global Growth Basket'],
        },
      },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', {
      ok: true,
      value: [{ kind: 'asset', value: basketId, status: 'not-found' }],
    }],
    ['partial', { ok: true, value: [] }],
    ['malformed', {
      ok: false,
      error: {
        kind: 'malformed-entity',
        identifier: { kind: 'asset', value: basketId },
      },
    }],
  ] as const)('fails the whole Widget on %s Entity resolution', async (failure, resolution) => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    }, {
      entity: {
        async resolve() {
          return resolution;
        },
      },
    });

    await expect(widget.render(
      {
        id: 'MW_ENTITY_RESULT_FAILURE',
        title: 'Entity result failure',
        useEntityTitle: true,
        underlyingChartId: 'DV_ENTITY_RESULT_FAILURE',
        visualizationType: 'DataViz',
        parameters: [{ field: 'asset', type: 'Asset', value: basketId }],
        renderParams: {
          component: { asset: basketId },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'missing-display-evidence',
        identity: { widgetId: 'MW_ENTITY_RESULT_FAILURE' },
        field: 'asset',
        ...(failure === 'partial'
          ? {}
          : { identifier: { kind: 'asset', value: basketId } }),
      },
    });
  });

  it.each([
    ['missing', {
      ok: true,
      value: [{ kind: 'asset', value: basketId, status: 'not-found' }],
    }],
    ['malformed', {
      ok: false,
      error: {
        kind: 'malformed-entity',
        identifier: { kind: 'asset', value: basketId },
      },
    }],
  ] as const)('handles %s title Entity resolution per the chart', async (kind, resolution) => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_TITLE_ENTITY_RESULT_FAILURE/metadata') {
          return { metadata: {} };
        }
        throw new Error(`unexpected ${path}`);
      },
    }, {
      entity: {
        async resolve() {
          return resolution;
        },
      },
    });

    const result = await widget.render(
      {
        id: 'MW_TITLE_ENTITY_RESULT_FAILURE',
        title: `Exposure to <Asset:${basketId}>`,
        useEntityTitle: true,
        underlyingChartId: 'DV_TITLE_ENTITY_RESULT_FAILURE',
        visualizationType: 'DataViz',
        renderParams: { component: {} },
      },
      [],
      null,
      undefined,
      'snippet',
    );

    if (kind === 'missing') {
      expect(result).toMatchObject({
        ok: true,
        value: { snippet: { title: `Exposure to ${basketId}` } },
      });
      return;
    }
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-definition',
        identity: { widgetId: 'MW_TITLE_ENTITY_RESULT_FAILURE' },
        problem: 'malformed',
      },
    });
  });

  it('keeps the raw title value on partial Entity resolution', async () => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_PARTIAL_TITLE_ENTITY/metadata') {
          return { metadata: {} };
        }
        throw new Error(`unexpected ${path}`);
      },
    }, {
      entity: {
        async resolve() {
          return { ok: true, value: [] };
        },
      },
    });

    await expect(widget.render(
      {
        id: 'MW_PARTIAL_TITLE_ENTITY',
        title: `Exposure to <Asset:${basketId}>`,
        useEntityTitle: true,
        underlyingChartId: 'DV_PARTIAL_TITLE_ENTITY',
        visualizationType: 'DataViz',
        renderParams: { component: {} },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: { title: `Exposure to ${basketId}` },
      },
    });
  });

  it('lets parameter resolution dispatch before a dynamic title resolves later', async () => {
    const portfolioId = `MP${'A'.repeat(14)}`;
    let releaseMetadata!: (value: unknown) => void;
    const metadata = new Promise<unknown>((resolve) => {
      releaseMetadata = resolve;
    });
    const resolve = vi.fn(async (inputs: readonly Readonly<{
      kind: 'asset' | 'country' | 'portfolio' | 'control-group';
      value: string;
    }>[]) => ({
      ok: true as const,
      value: inputs.map((input) => input.kind === 'portfolio'
        ? {
            kind: 'portfolio' as const,
            entityId: portfolioId,
            label: 'Growth Portfolio',
            aliases: [],
          }
        : {
            kind: 'asset' as const,
            entityId: basketId,
            label: 'Global Growth Basket',
            aliases: [],
          }),
    }));
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/marketview/widgets/MW_DELAYED_TITLE') {
        return {
          id: 'MW_DELAYED_TITLE',
          title: `Fallback title for <Asset:${basketId}>`,
          useEntityTitle: true,
          underlyingChartId: 'DV_DELAYED_TITLE',
          visualizationType: 'DataViz',
          parameters: [{
            field: 'portfolio',
            type: 'Portfolio',
            value: portfolioId,
          }],
          renderParams: {
            component: { portfolio: portfolioId },
            controls: [],
          },
        };
      }
      if (path === '/v1/marketview/widgets/MW_DELAYED_TITLE/metadata') {
        return metadata;
      }
      if (path === '/v1/marketview/widgets/configurations') {
        return {
          id: 'WC_DELAYED_TITLE',
          widgetId: 'MW_DELAYED_TITLE',
          underlyingChartId: 'DV_DELAYED_TITLE',
          parameters: [],
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const widget = createWidget({ request }, {
      entity: {
        resolve,
        async resolveIdentity() {
          throw new Error('unexpected legacy Entity resolution');
        },
        async resolveMatches() {
          return { ok: true, value: [] };
        },
      },
    });

    const result = widget.get({
      widgetId: 'MW_DELAYED_TITLE' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'snippet',
    });
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenNthCalledWith(1, [{
      kind: 'portfolio',
      value: portfolioId,
    }]);

    releaseMetadata({
      metadata: {},
    });
    await expect(result).resolves.toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        snippet: {
          title: 'Fallback title for Global Growth Basket',
          parameterLines: ['portfolio=Growth Portfolio'],
        },
      },
    });
    expect(resolve).toHaveBeenNthCalledWith(2, [{
      kind: 'asset',
      value: basketId,
    }]);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/v1/marketview/widgets/MW_DELAYED_TITLE',
      '/v1/marketview/widgets/configurations',
      '/v1/marketview/widgets/MW_DELAYED_TITLE/metadata',
    ]);
  });

  it('fails the whole Widget when opaque parameter resolution times out', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    }, {
      entity: {
        async resolve() {
          return {
            ok: false,
            error: {
              kind: 'dependency',
              failure: { kind: 'timeout' },
            },
          };
        },
        async resolveIdentity() {
          throw new Error('unexpected legacy Entity resolution');
        },
        async resolveMatches() {
          return { ok: true, value: [] };
        },
      },
    });

    await expect(widget.render(
      {
        id: 'MW_ENTITY_TIMEOUT',
        title: 'Entity timeout',
        metadata: { title: 'Entity timeout' },
        underlyingChartId: 'DV_ENTITY_TIMEOUT',
        visualizationType: 'DataViz',
        parameters: [{
          field: 'asset',
          type: 'Asset',
          value: basketId,
        }],
        renderParams: {
          component: { asset: basketId },
          controls: [],
        },
      },
      [],
      null,
      undefined,
      'snippet',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW_ENTITY_TIMEOUT' },
        failure: { kind: 'timeout' },
      },
    });
  });

  it.each([
    ['Boolean', ['true', 'false'], 'yes'],
    ['Enum', ['one', 'only'], 'o'],
    ['Enum', ['one', 'two'], 'missing'],
  ])('uses provider-supplied %s assignments without user-input matching', async (
    type,
    options,
    value,
  ) => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_SURFACE_ASSIGNMENT',
        title: 'Surface assignment',
        metadata: { title: 'Surface assignment' },
        underlyingChartId: 'DV_SURFACE_ASSIGNMENT',
        visualizationType: 'DataViz',
        parameters: [{
          field: 'choice',
          type,
          value: options[0],
          options,
        }],
        renderParams: { component: { choice: options[0] }, controls: [] },
      },
      [{ field: 'choice', value }],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          parameterLines: [`choice=${value}`],
        },
      },
    });
  });

  it('fails invalid-response for an unknown assignment in rendered Widget Definition before dispatch', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_UNKNOWN_FULL',
        title: 'Unknown full assignment',
        metadata: { title: 'Unknown full assignment' },
        underlyingChartId: 'CH_UNKNOWN_FULL',
        parameters: [],
        renderParams: { component: {}, controls: [] },
      },
      [{ field: 'configOnly', value: 'unexpected' }],
      null,
      undefined,
      'full',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_UNKNOWN_FULL' },
        source: 'widget',
        problem: 'render-assignment-invalid',
      },
    });
  });

  // Dashboard-saved values are trusted, as Marquee Web does.
  it.each([
    [['JPY', 'USD']],
    [['CGCURRENCY01']],
  ])('keeps a Dashboard Enum assignment outside the options %j', async (options) => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_CONTROL_GROUP_ENUM',
        title: 'What is the <swap_tenor: 1y> <currency:JPY> swap rate?',
        metadata: { title: 'What is the <swap_tenor: 1y> <currency:JPY> swap rate?' },
        underlyingChartId: 'CH_CONTROL_GROUP_ENUM',
        parameters: [{
          field: 'currency',
          type: 'Enum',
          value: 'JPY',
          options,
        }],
        renderParams: { component: {}, controls: [] },
      },
      [{ field: 'currency', value: 'TRY' }],
      null,
      undefined,
      'snippet',
    )).resolves.toMatchObject({
      ok: true,
      value: { snippet: { parameterLines: ['currency=TRY', 'relativeDate='] } },
    });
  });

  it('fails invalid-response for a Selected Context on a Widget without a context parameter', async () => {
    const widget = createWidget({
      async request() {
        throw new Error('unexpected request');
      },
    });

    await expect(widget.render(
      {
        id: 'MW_NO_CONTEXT',
        title: 'No context',
        metadata: { title: 'No context' },
        underlyingChartId: 'CH_NO_CONTEXT',
        parameters: [],
        renderParams: { component: {}, controls: [] },
      },
      [],
      'MA123',
      undefined,
      'full',
    )).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_NO_CONTEXT' },
        source: 'widget',
        problem: 'render-input-invalid',
      },
    });
  });

  it('renders a full PlotTool Pro from canonical values without reloading the Widget', async () => {
    const calls: string[] = [];
    const widget = createWidget({
      async request(path, init) {
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        if (path === '/v1/charts/CH_SEMANTIC_FULL') {
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
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await renderLegacyInput(widget, {
      widget: {
        widgetId: 'MW_SEMANTIC_FULL' as WidgetId,
        configurationId: 'WC_SEMANTIC_FULL' as ConfigId,
        configuration: {
          configurationId: 'WC_SEMANTIC_FULL' as ConfigId,
          widgetId: 'MW_SEMANTIC_FULL' as WidgetId,
          targetId: 'CH_SEMANTIC_FULL',
          relativeDate: null,
        },
        projection: { kind: 'complete' },
        title: {
          embedded: 'Semantic full title',
          fallback: 'Fallback title',
          useEntityTitle: true,
        },
        target: { family: 'plot', targetId: 'CH_SEMANTIC_FULL' },
        parameters: [],
        contextParameter: null,
        controls: [],
        componentInputs: [],
        entityLabels: [],
        tags: [],
        sources: [],
      },
      parameters: [],
      selectedContext: null,
      relativeDate: null,
    }, 'full');

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        widget: {
          widgetId: 'MW_SEMANTIC_FULL',
          configurationId: 'WC_SEMANTIC_FULL',
          title: 'Fallback title',
        },
        execution: {
          family: 'plot',
          value: {
            projection: {
              chartType: 'line',
              series: [{ label: 'Series' }],
            },
          },
        },
      },
    });
    expect(calls).not.toContain('GET /v1/marketview/widgets/MW_SEMANTIC_FULL');
    expect(calls).not.toContain('GET /v1/marketview/widgets/configurations');
  });

  it('passes exact Widget Dates to PlotTool Pro without creating a Widget Config', async () => {
    const previousNow = process.env.MARQUEE_NOW;
    process.env.MARQUEE_NOW = '2026-07-28T00:00:00.000Z';
    let runnerBody: unknown;
    try {
      const widget = createWidget({
        async request(path, init) {
          if (path === '/v1/charts/CH_RANGE') {
            return {
              description: 'USD.foo()',
              chartType: 'line',
              expressions: [{ label: 'Series' }],
              relativeStartDate: '-1y',
              interval: 'Daily',
            };
          }
          if (path === '/v1/plots/runner') {
            runnerBody = init?.body;
            return {
              expressions: ['USD.foo()'],
              results: [{ type: 'series', values: { '2026-07-01': 1 } }],
            };
          }
          if (path === '/v1/marketview/dashboards') return { results: [] };
          throw new Error(`unexpected ${path}`);
        },
      });

      const result = await widget.render(
        {
          id: 'MW_RANGE',
          title: 'Range',
          metadata: { title: 'Range' },
          underlyingChartId: 'CH_RANGE',
          parameters: [],
          renderParams: { component: {}, controls: [] },
        },
        [],
        null,
        {
          startDate: '2026-01-28',
          endDate: '2026-07-28',
          interval: '1D',
          relativeDate: '6M',
        },
        'full',
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          widget: { configurationId: null },
          execution: { family: 'plot' },
        },
      });
      expect(runnerBody).toMatchObject({
        startDate: '2026-01-28',
        endDate: '2026-07-28',
      });
    } finally {
      if (previousNow === undefined) delete process.env.MARQUEE_NOW;
      else process.env.MARQUEE_NOW = previousNow;
    }
  });

  it('carries the applied Relative Date into the full render parameter states', async () => {
    const previousNow = process.env.MARQUEE_NOW;
    process.env.MARQUEE_NOW = '2026-07-28T00:00:00.000Z';
    try {
      const widget = createWidget({
        async request(path) {
          if (path === '/v1/charts/CH_RANGE') {
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
              results: [{ type: 'series', values: { '2026-07-01': 1 } }],
            };
          }
          if (path === '/v1/marketview/dashboards') return { results: [] };
          throw new Error(`unexpected ${path}`);
        },
      });

      const result = await widget.render(
        {
          id: 'MW_RANGE',
          title: 'Range',
          metadata: { title: 'Range' },
          underlyingChartId: 'CH_RANGE',
          parameters: [],
          renderParams: { component: {}, controls: [] },
        },
        [],
        null,
        {
          startDate: '2026-01-28',
          endDate: '2026-07-28',
          interval: '1D',
          relativeDate: '6M',
        },
        'full',
      );

      if (!result.ok || result.value.detail !== 'full') {
        throw new Error(JSON.stringify(result));
      }
      expect(result.value.widget.parameterStates).toContainEqual([
        'relativeDate',
        expect.objectContaining({ field: 'Relative Date', value: '6M' }),
      ]);
    } finally {
      if (previousNow === undefined) delete process.env.MARQUEE_NOW;
      else process.env.MARQUEE_NOW = previousNow;
    }
  });

  it('preempts DataViz parameter rebuilding with caller-saved render params', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const widget = createWidget({
      async request(path, init) {
        calls.push({ path, body: init?.body });
        if (path === '/v1/data/visualizations/DV_SEMANTIC_FULL') {
          return { parameters: {} };
        }
        if (path === '/v1/data/visualizations/DV_SEMANTIC_FULL/render') {
          return {
            renderData: {
              data: [{ type: 'bar', x: ['A'], y: [1] }],
              layout: {},
            },
          };
        }
        if (path === '/v1/plots/entities') {
          return { assets: [{ id: 'MA_SELECTED', name: 'Selected Asset' }] };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.render(
      {
        id: 'MW_SEMANTIC_DV',
        configurationId: 'WC_SEMANTIC_DV',
        title: 'Fallback title',
        metadata: { title: 'Semantic DataViz title' },
        useEntityTitle: false,
        underlyingChartId: 'DV_SEMANTIC_FULL',
        visualizationType: 'DataViz',
        contextParameter: {
          field: 'context',
          type: 'Asset',
          values: { default: 'MA_DEFAULT' },
          options: ['MA_DEFAULT', 'MA_SELECTED'],
        },
        parameters: [{
          field: 'currency',
          type: 'String',
          values: { default: 'USD' },
        }],
        renderParams: {
          component: { context: 'MA_DEFAULT', currency: 'USD' },
          visualization: { layout: { showlegend: false } },
          controls: [],
        },
      },
      [{ field: 'currency', value: 'EUR' }],
      'MA_SELECTED',
      undefined,
      'full',
    );

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        widget: {
          widgetId: 'MW_SEMANTIC_DV',
          configurationId: 'WC_SEMANTIC_DV',
          title: 'Semantic DataViz title',
        },
        execution: {
          family: 'data-viz',
          value: {
            kind: 'visualization',
            projection: {
              kind: 'figure',
              series: [
                {
                  traceType: 'bar',
                  points: [{ fields: expect.arrayContaining([
                    expect.objectContaining({ path: 'x', raw: 'A' }),
                    expect.objectContaining({ path: 'y', raw: 1 }),
                  ]) }],
                },
              ],
            },
          },
        },
      },
    });
    expect(calls).not.toContainEqual({
      path: '/v1/marketview/widgets/MW_SEMANTIC_DV',
    });
    expect(calls).not.toContainEqual({
      path: '/v1/marketview/widgets/configurations',
    });
    expect(calls).toContainEqual({
      path: '/v1/data/visualizations/DV_SEMANTIC_FULL',
    });
    expect(calls).toContainEqual({
      path: '/v1/data/visualizations/DV_SEMANTIC_FULL/render',
      body: {
        component: { context: 'MA_DEFAULT', currency: 'USD' },
        visualization: { layout: { showlegend: false } },
        references: { configId: 'WC_SEMANTIC_DV', useTableViz: false },
      },
    });
  });

  it('applies Widget defaults, Selected Context, then ordered assignments', async () => {
    const widget = createWidget({
      async request(path) {
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.render(
      {
        id: 'MW_CONTEXT',
        title: 'Context',
        useEntityTitle: true,
        metadata: {},
        underlyingChartId: 'DV_CONTEXT',
        visualizationType: 'BaseComponent',
        contextParameter: {
          field: 'Context',
          type: 'Asset',
          value: 'MA_DEFAULT',
          values: { default: 'MA_DEFAULT' },
          options: ['MA_DEFAULT', 'MA_SELECTED', 'MA_EXPLICIT'],
        },
        parameters: [{
          field: 'tenor',
          type: 'Enum',
          value: '1y',
          options: ['1y', '2y'],
        }],
        renderParams: {
          component: {
            Context: 'MA_DEFAULT',
            tenor: '1y',
          },
          controls: [],
        },
      },
      [
        { field: 'tenor', value: '2y' },
        { field: 'Context', value: 'MA_EXPLICIT' },
      ],
      'MA_SELECTED',
      undefined,
      'snippet',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          configurationId: null,
          selectedContext: 'MA_EXPLICIT',
        },
      },
    });
  });

  it('dereferences a supplied Widget Config before rendering', async () => {
    const defaultAssetId = `MA${'4'.repeat(16)}`;
    const configuredAssetId = `MA${'5'.repeat(16)}`;
    const calls: Array<{
      path: string;
      method: string;
      query?: Record<string, unknown>;
    }> = [];
    let renderBody: unknown;
    const widget = createWidget({
      async request(path, init) {
        calls.push({
          path,
          method: init?.method ?? 'GET',
          ...(init?.query ? { query: init.query } : {}),
        });
        if (path === '/v1/marketview/widgets/MW_GET_CONFIGURED') {
          return {
            id: 'MW_GET_CONFIGURED',
            title: 'Configured',
            useEntityTitle: true,
            metadata: { title: 'Configured' },
            underlyingChartId: 'DV_GET_CONFIGURED',
            visualizationType: 'DataViz',
            contextParameter: {
              field: 'cross',
              type: 'Asset',
              values: { default: defaultAssetId },
              options: [defaultAssetId],
            },
            parameters: [{
              field: 'tenor',
              type: 'Enum',
              value: '1y',
              values: { default: '1y' },
              options: ['1y', '2y'],
            }],
            renderParams: {
              component: {
                cross: configuredAssetId,
                tenor: '2y',
              },
              controls: [],
            },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return [{
            id: 'WC_GET_CONFIGURED',
            widgetId: 'MW_GET_CONFIGURED',
            underlyingChartId: 'DV_GET_CONFIGURED',
            parameters: [
              { field: 'cross', value: configuredAssetId },
              { field: 'tenor', value: '2y' },
            ],
            relativeDate: '6m',
            calculatedDates: {
              startDate: '2026-01-28',
              endDate: '2026-07-28',
              interval: '1D',
            },
          }];
        }
        if (path === '/v1/data/visualizations/DV_GET_CONFIGURED') return {};
        if (path === '/v1/data/visualizations/DV_GET_CONFIGURED/render') {
          renderBody = init?.body;
          return {
            renderData: {
              data: [{ type: 'bar', x: ['A'], y: [1] }],
              layout: {},
            },
          };
        }
        if (path === '/v1/plots/entities') {
          const ids = Array.isArray(init?.query?.ids) ? init.query.ids : [];
          return {
            assets: ids.map((id) => ({
              id,
              name: id === configuredAssetId ? 'Configured Asset' : 'Default Asset',
            })),
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_GET_CONFIGURED' as WidgetId,
      configurationId: 'WC_GET_CONFIGURED' as ConfigId,
      selectedContext: null,
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          widgetId: 'MW_GET_CONFIGURED',
          configurationId: 'WC_GET_CONFIGURED',
          selectedContext: configuredAssetId,
        },
      },
    });
    expect(calls.slice(0, 2)).toEqual([
      {
        path: '/v1/marketview/widgets/MW_GET_CONFIGURED',
        method: 'GET',
        query: { mergeParams: true, context: 'WC_GET_CONFIGURED' },
      },
      {
        path: '/v1/marketview/widgets/configurations',
        method: 'GET',
        query: { id: 'WC_GET_CONFIGURED' },
      },
    ]);
    expect(calls.slice(2)).toEqual(expect.arrayContaining([
      {
        path: '/v1/plots/entities',
        method: 'GET',
        query: { ids: [defaultAssetId, configuredAssetId] },
      },
      {
        path: '/v1/data/visualizations/DV_GET_CONFIGURED/render',
        method: 'POST',
      },
      {
        path: '/v1/marketview/dashboards',
        method: 'GET',
        query: { view_as: 'edit', size: 100, page: 1 },
      },
    ]));
    expect(renderBody).toMatchObject({
      component: {
        cross: configuredAssetId,
        tenor: '2y',
      },
      references: { configId: 'WC_GET_CONFIGURED' },
    });
    expect(result.value.widget.parameters).toContainEqual(
      expect.objectContaining({
        field: 'cross',
        default: 'Configured Asset',
      }),
    );
  });

  it('uses Config metadata as the full-read title for unchanged config-only state', async () => {
    const calls: string[] = [];
    const widget = createWidget({
      async request(path, init) {
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        if (path === '/v1/marketview/widgets/MW_CONFIG_TITLE') {
          return {
            id: 'MW_CONFIG_TITLE',
            title: 'Flows listed in <countryId:US>',
            useEntityTitle: true,
            metadata: { title: 'Flows listed in Unknown Value' },
            underlyingChartId: 'DV_CONFIG_TITLE',
            visualizationType: 'DataViz',
            parameters: [],
            renderParams: { component: {}, controls: [] },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return [{
            id: 'WC_CONFIG_TITLE',
            widgetId: 'MW_CONFIG_TITLE',
            underlyingChartId: 'DV_CONFIG_TITLE',
            parameters: [{ field: 'countryId', value: 'JP' }],
            metadata: { title: 'Flows listed in Japan' },
          }];
        }
        if (path === '/v1/data/visualizations/DV_CONFIG_TITLE') return {};
        if (path === '/v1/data/visualizations/DV_CONFIG_TITLE/render') {
          return {
            renderData: {
              data: [{ type: 'bar', x: ['A'], y: [1] }],
              layout: {},
            },
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_CONFIG_TITLE' as WidgetId,
      configurationId: 'WC_CONFIG_TITLE' as ConfigId,
      selectedContext: null,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: { title: 'Flows listed in Japan' },
      },
    });
    expect(calls).not.toContain('POST /v1/marketview/widgets/MW_CONFIG_TITLE/metadata');
  });

  it('recomputes a Config title after an explicit assignment changes saved state', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    const widget = createWidget({
      async request(path, init) {
        calls.push({
          path,
          method: init?.method ?? 'GET',
          ...(init?.body === undefined ? {} : { body: init.body }),
        });
        if (path === '/v1/marketview/widgets/MW_CONFIG_OVERRIDE') {
          return {
            id: 'MW_CONFIG_OVERRIDE',
            title: 'Price to Book of <Basket:SAVED>',
            useEntityTitle: false,
            metadata: {},
            underlyingChartId: 'DV_CONFIG_OVERRIDE',
            visualizationType: 'DataViz',
            parameters: [{
              field: 'Basket',
              type: 'Enum',
              value: 'SAVED',
              values: { default: 'SAVED' },
              options: ['SAVED', 'OVERRIDE'],
            }],
            renderParams: {
              component: { Basket: 'SAVED' },
              controls: [],
            },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          if (init?.method === 'POST') {
            return {
            id: 'WC_CONFIG_OVERRIDE_NEW',
            widgetId: 'MW_CONFIG_OVERRIDE',
            underlyingChartId: 'DV_CONFIG_OVERRIDE',
            parameters: [{ field: 'Basket', value: 'OVERRIDE' }],
          };
          }
          return [{
            id: 'WC_CONFIG_OVERRIDE',
            widgetId: 'MW_CONFIG_OVERRIDE',
            underlyingChartId: 'DV_CONFIG_OVERRIDE',
            parameters: [{ field: 'Basket', value: 'SAVED' }],
            metadata: { title: 'Price to Book of Saved Basket' },
          }];
        }
        if (path === '/v1/marketview/widgets/MW_CONFIG_OVERRIDE/metadata') {
          return { metadata: { title: 'Price to Book of Override Basket' } };
        }
        if (path === '/v1/data/visualizations/DV_CONFIG_OVERRIDE') return {};
        if (path === '/v1/data/visualizations/DV_CONFIG_OVERRIDE/render') {
          return {
            renderData: {
              data: [{ type: 'bar', x: ['A'], y: [1] }],
              layout: {},
            },
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_CONFIG_OVERRIDE' as WidgetId,
      configurationId: 'WC_CONFIG_OVERRIDE' as ConfigId,
      selectedContext: null,
      parameters: [{ field: 'basket', value: 'OVERRIDE' }],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: { title: 'Price to Book of Override Basket' },
      },
    });
    expect(calls).toContainEqual({
      path: '/v1/marketview/widgets/MW_CONFIG_OVERRIDE/metadata',
      method: 'POST',
      body: { parameters: [{ field: 'Basket', value: 'OVERRIDE' }] },
    });
  });

  it('matches each EnumList item against the options', async () => {
    const widget = createWidget({
      async request(path, init) {
        if (path === '/v1/marketview/widgets/MW_ENUM_LIST') {
          return {
            id: 'MW_ENUM_LIST',
            title: 'Volumes',
            metadata: {},
            underlyingChartId: 'DV_ENUM_LIST',
            visualizationType: 'DataViz',
            parameters: [{
              field: 'ccys',
              type: 'EnumList',
              value: ['EURUSD'],
              values: { default: ['EURUSD'] },
              options: ['EURUSD', 'AUDUSD', 'GBPUSD'],
            }, {
              field: 'frequency',
              type: 'Enum',
              value: 'Daily',
              values: { default: 'Daily' },
              options: ['Daily', 'Weekly'],
            }],
            renderParams: { component: {}, controls: [] },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          if (init?.method === 'POST') {
            return {
              id: 'WC_ENUM_LIST_NEW',
              widgetId: 'MW_ENUM_LIST',
              underlyingChartId: 'DV_ENUM_LIST',
              parameters: [],
            };
          }
          return [{
            id: 'WC_ENUM_LIST',
            widgetId: 'MW_ENUM_LIST',
            underlyingChartId: 'DV_ENUM_LIST',
            parameters: [],
          }];
        }
        if (path === '/v1/data/visualizations/DV_ENUM_LIST') return {};
        if (path === '/v1/data/visualizations/DV_ENUM_LIST/render') {
          return { renderData: { data: [{ type: 'bar', x: ['A'], y: [1] }], layout: {} } };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });
    const get = (field: string, value: string) => widget.get({
      widgetId: 'MW_ENUM_LIST' as WidgetId,
      configurationId: 'WC_ENUM_LIST' as ConfigId,
      selectedContext: null,
      parameters: [{ field, value }],
      detail: 'full',
    });
    const unmatched = (input: string, requested: string, candidates: string[]) => ({
      ok: false,
      error: {
        kind: 'unmatched-input',
        identity: { widgetId: 'MW_ENUM_LIST' },
        input,
        requested,
        candidates,
      },
    });

    const ccys = ['EURUSD', 'AUDUSD', 'GBPUSD'];
    await expect(get('ccys', 'AUDUSD,GBPUSD')).resolves.toMatchObject({ ok: true });
    await expect(get('ccys', 'AUDUSD,NOPE')).resolves.toEqual(unmatched('ccys', 'NOPE', ccys));
    await expect(get('frequency', '7')).resolves.toEqual(unmatched('frequency', '7', ['Daily', 'Weekly']));
  });

  it('preserves all labeled Asset options in full Widget detail', async () => {
    const selectedAssetId = `MA${'6'.repeat(16)}`;
    const availableAssetId = `MA${'7'.repeat(16)}`;
    const widget = createWidget({
      async request(path, init) {
        if (path === '/v1/marketview/widgets/MW_FULL_OPTIONS') {
          return {
            id: 'MW_FULL_OPTIONS',
            title: 'Full options',
            metadata: { title: 'Full options' },
            underlyingChartId: 'DV_FULL_OPTIONS',
            visualizationType: 'DataViz',
            contextParameter: {
              field: 'asset',
              type: 'Asset',
              values: { default: selectedAssetId },
              options: [selectedAssetId, availableAssetId],
            },
            parameters: [],
            renderParams: {
              component: { asset: selectedAssetId },
              controls: [],
            },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return [{
            id: 'WC_FULL_OPTIONS',
            widgetId: 'MW_FULL_OPTIONS',
            underlyingChartId: 'DV_FULL_OPTIONS',
            parameters: [{ field: 'asset', value: selectedAssetId }],
          }];
        }
        if (path === '/v1/data/visualizations/DV_FULL_OPTIONS') return {};
        if (path === '/v1/data/visualizations/DV_FULL_OPTIONS/render') {
          return {
            renderData: {
              data: [{ type: 'bar', x: ['A'], y: [1] }],
              layout: {},
            },
          };
        }
        if (path === '/v1/plots/entities') {
          const ids = Array.isArray(init?.query?.ids) ? init.query.ids : [];
          return {
            assets: ids.map((id) => ({
              id,
              name: id === selectedAssetId ? 'Selected Asset' : 'Available Asset',
            })),
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_FULL_OPTIONS' as WidgetId,
      configurationId: 'WC_FULL_OPTIONS' as ConfigId,
      selectedContext: null,
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.widget.parameters).toContainEqual(
      expect.objectContaining({
        field: 'asset',
        default: 'Selected Asset',
        options: [
          { label: 'Selected Asset', rawValue: selectedAssetId },
          { label: 'Available Asset', rawValue: availableAssetId },
        ],
      }),
    );
  });

  it('resolves the default Widget Config before rendering a private Widget Snippet', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    const widget = createWidget({
      async request(path, init) {
        calls.push({
          path,
          method: init?.method ?? 'GET',
          ...(init?.body !== undefined ? { body: init.body } : {}),
        });
        if (path === '/v1/marketview/widgets/MW_GET_DEFAULT') {
          return {
            id: 'MW_GET_DEFAULT',
            title: 'Default',
            useEntityTitle: true,
            metadata: { title: 'Default' },
            underlyingChartId: 'CH_GET_DEFAULT',
            parameters: [],
            renderParams: { component: {}, controls: [] },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_GET_DEFAULT',
            widgetId: 'MW_GET_DEFAULT',
            underlyingChartId: 'CH_GET_DEFAULT',
            parameters: [],
            relativeDate: '6m',
            calculatedDates: {
              startDate: '2026-01-28',
              endDate: '2026-07-28',
              interval: '1D',
            },
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_GET_DEFAULT' as WidgetId,
      configurationId: null,
      selectedContext: null,
      parameters: [],
      detail: 'snippet',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          widgetId: 'MW_GET_DEFAULT',
          configurationId: 'WC_GET_DEFAULT',
        },
      },
    });
    expect(calls).toEqual([
      {
        path: '/v1/marketview/widgets/MW_GET_DEFAULT',
        method: 'GET',
      },
      {
        path: '/v1/marketview/widgets/configurations',
        method: 'POST',
        body: {
          widgetId: 'MW_GET_DEFAULT',
          underlyingChartId: 'CH_GET_DEFAULT',
          parameters: [],
        },
      },
    ]);
  });

  it('resolves private Widget Snippet assignments before the public render seam', async () => {
    const assetId = ['MASYNTHD', 'EFAULT01'].join('');
    const resolveIdentity = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: 'asset' as const,
        entityId: assetId,
        label: 'Synthetic Asset',
        aliases: ['Synthetic'],
      },
    }));
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_SNIPPET_ASSIGNMENT') {
          return {
            id: 'MW_SNIPPET_ASSIGNMENT',
            title: 'Assignment',
            metadata: { title: 'Assignment' },
            underlyingChartId: 'CH_SNIPPET_ASSIGNMENT',
            parameters: [],
            renderParams: {
              component: { asset: assetId },
              controls: [{ id: 'asset', type: 'Asset', value: assetId }],
            },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_SNIPPET_ASSIGNMENT',
            widgetId: 'MW_SNIPPET_ASSIGNMENT',
            underlyingChartId: 'CH_SNIPPET_ASSIGNMENT',
            parameters: [{ field: 'asset', value: assetId }],
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    }, { entity: { resolveIdentity } });

    const result = await widget.get({
      widgetId: 'MW_SNIPPET_ASSIGNMENT' as WidgetId,
      configurationId: null,
      selectedContext: null,
      parameters: [{ field: 'asset', value: 'Synthetic' }],
      detail: 'snippet',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          configurationId: 'WC_SNIPPET_ASSIGNMENT',
        },
        snippet: { parameterLines: ['asset=Synthetic Asset', 'relativeDate='] },
      },
    });
    expect(resolveIdentity).toHaveBeenCalledWith({ kind: 'asset', value: 'Synthetic' });
  });

  it('keeps provider relative-date spelling behind the public Widget boundary', async () => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_GET_PLOT') {
          return {
            id: 'MW_GET_PLOT',
            title: 'Configured Plot',
            useEntityTitle: true,
            metadata: { title: 'Configured Plot' },
            underlyingChartId: 'CH_GET_PLOT',
            parameters: [],
            renderParams: { component: {}, controls: [] },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return [{
            id: 'WC_GET_PLOT',
            widgetId: 'MW_GET_PLOT',
            underlyingChartId: 'CH_GET_PLOT',
            parameters: [],
            relativeDate: '1y',
            calculatedDates: {
              startDate: '2025-07-29',
              endDate: '2026-07-29',
              interval: '1D',
            },
          }];
        }
        if (path === '/v1/charts/CH_GET_PLOT') {
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
            results: [{ type: 'series', values: { '2026-07-29': 1 } }],
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_GET_PLOT' as WidgetId,
      configurationId: 'WC_GET_PLOT' as ConfigId,
      selectedContext: null,
      parameters: [],
      detail: 'full',
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.widget.parameters).toContainEqual(
      expect.objectContaining({
        field: 'Relative Date',
        default: '1Y',
      }),
    );
  });

  it('dereferences Config values without replacing Widget title evidence for a private Widget Snippet', async () => {
    const calls: Array<{
      path: string;
      method?: string | undefined;
      query?: Record<string, unknown> | undefined;
      body?: unknown;
    }> = [];
    const widget = createWidget({
      async request(path, init) {
        calls.push({
          path,
          method: init?.method,
          query: init?.query,
          body: init?.body,
        });
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_ONE',
            widgetId: 'MW_ONE',
            underlyingChartId: 'CH_ONE',
            metadata: { title: 'Config title must not win' },
            parameters: [
              { field: 'Asset', value: 'MSFT' },
              { field: 'tenor', value: '6m' },
              { field: 'currency', value: 'EUR' },
            ],
          };
        }
        return {
          id: 'MW_ONE',
          title: 'Provider default',
          useEntityTitle: false,
          metadata: { title: 'Widget title evidence' },
          underlyingChartId: 'CH_ONE',
          contextParameter: {
            field: 'Asset',
            type: 'String',
            values: { default: 'AAPL' },
          },
          renderParams: {
            component: { Asset: 'AAPL', tenor: '3m', currency: 'USD' },
            controls: [{ id: 'tenor', value: '3m' }],
          },
          parameters: [{
            field: 'currency',
            type: 'String',
            values: { default: 'USD' },
          }],
        };
      },
    });

    const result = await widget.get({
      widgetId: 'MW_ONE' as WidgetId,
      configurationId: 'WC_ONE' as ConfigId,
      selectedContext: null,
      parameters: [],
      detail: 'snippet',
    });
    if (!result.ok) throw new Error(JSON.stringify({ error: result.error, calls }));
    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: 'MW_ONE',
          configurationId: 'WC_ONE',
          title: 'Widget title evidence',
          chartId: 'CH_ONE',
          family: 'plot',
          selectedContext: 'MSFT',
          bindings: [],
          parameters: [
            { field: 'Asset', refKey: 'asset', type: 'unknown', default: undefined, options: [] },
            { field: 'tenor', refKey: 'tenor', type: 'unknown', default: undefined, options: [] },
            { field: 'currency', refKey: 'currency', type: 'unknown', default: undefined, options: [] },
            { field: 'Relative Date', refKey: 'relativeDate', type: 'unknown', default: undefined, options: [] },
          ],
        },
        snippet: {
          title: 'Widget title evidence',
          isTitleResolved: true,
          parameterLines: [
            'asset=MSFT',
            'tenor=6m',
            'currency=EUR',
            'relativeDate=',
          ],
        },
      },
    });
    expect(calls).toEqual([
      {
        path: '/v1/marketview/widgets/MW_ONE',
        method: 'GET',
        query: { context: 'WC_ONE' },
        body: undefined,
      },
      {
        path: '/v1/marketview/widgets/configurations',
        method: 'GET',
        query: { id: 'WC_ONE' },
        body: undefined,
      },
    ]);
  });

  it('resolves fallback placeholders after contextual META has no title', async () => {
    let resolutionCalls = 0;
    const widget = createWidget({
      async request(path) {
        if (path.endsWith('/configurations')) {
          return {
            id: 'WC_PLOT_20',
            widgetId: 'MW_PLOT_20',
            underlyingChartId: 'CH_PLOT_20',
            parameters: [],
          };
        }
        return {
          id: 'MW_PLOT_20',
          title: `Rates <Basket:${basketId}>`,
          useEntityTitle: true,
          metadata: {
            entityMetadata: {
              [basketId]: { name: 'Global Growth Basket' },
            },
          },
          configurationId: 'WC_PLOT_20',
          underlyingChartId: 'CH_PLOT_20',
          contextParameter: {
            field: 'Basket',
            type: 'Asset',
            values: { default: basketId },
            options: [],
          },
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    }, {
      entity: {
        async resolve(inputs) {
          return {
            ok: true,
            value: inputs.map(() => ({
              kind: 'asset' as const,
              entityId: basketId,
              label: 'Global Growth Basket',
              aliases: [],
            })),
          };
        },
        async resolveIdentity(identifier) {
          resolutionCalls += 1;
          expect(identifier).toEqual({
            kind: 'asset',
            value: basketId,
          });
          return {
            ok: true,
            value: {
              kind: 'asset',
              entityId: basketId,
              label: 'Global Growth Basket',
              aliases: [],
            },
          };
        },
        async resolveMatches() {
          return { ok: true, value: [] };
        },
      },
    });

    await expect(widget.get({
      widgetId: 'MW_PLOT_20' as WidgetId,
      configurationId: 'WC_PLOT_20' as ConfigId,
      parameters: [],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        snippet: {
          title: 'Rates Global Growth Basket',
          isTitleResolved: true,
          parameterLines: [
            'basket=Global Growth Basket',
            'relativeDate=',
          ],
        },
      },
    });
    expect(resolutionCalls).toBe(0);
  });

  it('pre-substitutes an explicit Selected Context BBID before generic title labels', async () => {
    const selectedId = `MA${'J'.repeat(15)}`;
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/configurations') {
          return { id: 'WC_SELECTED_TITLE', widgetId: 'MW_SELECTED_TITLE', underlyingChartId: 'CH_SELECTED_TITLE', parameters: [] };
        }
        return {
          id: 'MW_SELECTED_TITLE',
          title: `Rates <Basket:${basketId}>`,
          useEntityTitle: false,
          metadata: {},
          configurationId: 'WC_SELECTED_TITLE',
          underlyingChartId: 'CH_SELECTED_TITLE',
          contextParameter: {
            field: 'Basket',
            type: 'Asset',
            values: { default: basketId },
            options: [],
          },
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    }, {
      entity: {
        async resolve(inputs) {
          expect(inputs).toEqual([{ kind: 'asset', value: selectedId }]);
          return {
            ok: true,
            value: [{
              kind: 'asset',
              entityId: selectedId,
              label: 'Selected Basket',
              bbid: 'SELECTED BBID',
              aliases: [],
            }],
          };
        },
      },
    });

    await expect(widget.get({
      widgetId: 'MW_SELECTED_TITLE' as WidgetId,
      configurationId: null,
      selectedContext: selectedId,
      parameters: [],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Rates SELECTED BBID',
        },
      },
    });
  });

  it('pre-substitutes an explicit non-Asset Selected Context before generic title labels', async () => {
    const selectedId = 'MP_SELECTED';
    let resolveCalls = 0;
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/configurations') {
          return { id: 'WC_SELECTED_PORTFOLIO_TITLE', widgetId: 'MW_SELECTED_PORTFOLIO_TITLE', underlyingChartId: 'CH_SELECTED_PORTFOLIO_TITLE', parameters: [] };
        }
        return {
          id: 'MW_SELECTED_PORTFOLIO_TITLE',
          title: 'Exposure for <Portfolio:MP_STALE>',
          useEntityTitle: false,
          metadata: {},
          configurationId: 'WC_SELECTED_PORTFOLIO_TITLE',
          underlyingChartId: 'CH_SELECTED_PORTFOLIO_TITLE',
          contextParameter: {
            field: 'Portfolio',
            type: 'Portfolio',
            values: { default: 'MP_STALE' },
            options: [],
          },
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    }, {
      entity: {
        async resolve(inputs) {
          resolveCalls += 1;
          expect(inputs).toEqual([{ kind: 'portfolio', value: selectedId }]);
          return {
            ok: true,
            value: [{
              kind: 'portfolio',
              entityId: selectedId,
              label: 'Selected Portfolio',
              aliases: [],
            }],
          };
        },
      },
    });

    await expect(widget.get({
      widgetId: 'MW_SELECTED_PORTFOLIO_TITLE' as WidgetId,
      configurationId: null,
      selectedContext: selectedId,
      parameters: [],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        snippet: {
          title: 'Exposure for Selected Portfolio',
        },
      },
    });
    expect(resolveCalls).toBe(1);
  });

  it.each([
    ['entity-metadata-not-record', []],
    ['entity-metadata-entry-not-record', { MA_BAD: 'opaque' }],
    ['entity-metadata-name-missing', { MA_BAD: { short_name: 'Unrecorded alias' } }],
  ] as const)('fails loud on %s', async (problem, entityMetadata) => {
    const widget = createWidget({
      async request() {
        return {
          id: 'MW_BAD_METADATA',
          title: 'Bad metadata',
          metadata: { entityMetadata },
          underlyingChartId: 'CH_BAD_METADATA',
          visualizationType: 'Plot',
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_BAD_METADATA' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD_METADATA' },
        source: 'widget',
        problem,
      },
    });
  });

  it.each([
    ['o', { kind: 'ambiguous-input', requested: 'o', candidates: ['one', 'only'] }],
    ['missing', { kind: 'unmatched-input', requested: 'missing', candidates: ['one', 'only'] }],
  ] as const)('rejects Enum input %s that does not match exactly one option', async (value, error) => {
    const widget = createWidget({
      async request(path) {
        if (path.endsWith('/configurations')) {
          return { id: 'WC_CHOICE', widgetId: 'MW_CHOICE', underlyingChartId: 'DV_CHOICE', parameters: [] };
        }
        return {
          id: 'MW_CHOICE',
          title: 'Choice',
          configurationId: 'WC_CHOICE',
          underlyingChartId: 'DV_CHOICE',
          visualizationType: 'DataViz',
          renderParams: { component: {}, controls: [] },
          parameters: [{ field: 'choice', type: 'Enum', values: { default: 'one' }, options: ['one', 'only'] }],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_CHOICE' as WidgetId,
      configurationId: 'WC_CHOICE' as ConfigId,
      parameters: [{ field: 'choice', value }],
      detail: 'snippet',
    })).resolves.toEqual({
      ok: false,
      error: { ...error, identity: { widgetId: 'MW_CHOICE' }, input: 'choice' },
    });
  });

  it('rejects a QuickPoll surveyDate change in full Widget input', async () => {
    const widget = createWidget({
      async request(path) {
        if (path.endsWith('/configurations')) {
          return { id: 'WC_POLL', widgetId: 'MW_POLL', underlyingChartId: 'DV_POLL', parameters: [] };
        }
        return {
          id: 'MW_POLL',
          title: 'Poll',
          configurationId: 'WC_POLL',
          underlyingChartId: 'DV_POLL',
          visualizationType: 'DataViz',
          tags: ['QuickPoll'],
          renderParams: { component: { surveyDate: '2025-12-01' }, controls: [] },
          parameters: [{ field: 'surveyDate', type: 'Date', values: { default: '2025-12-01' } }],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_POLL' as WidgetId,
      configurationId: 'WC_POLL' as ConfigId,
      parameters: [{ field: 'surveyDate', value: '2026-04-01' }],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        identity: { widgetId: 'MW_POLL' },
        input: 'surveyDate',
        problem: 'incompatible-dependent-input',
      },
    });
  });

  it.each([
    ['a malformed', 'soon'],
    ['a prefixed', 'x1M'],
    ['a suffixed', '1Mx'],
    ['a forward-signed', '+1m'],
  ])('rejects %s Relative Date in private snippet input', async (_name, value) => {
    const widget = createWidget({
      async request() {
        return {
          id: 'MW_BAD_RELATIVE_DATE',
          title: 'Bad relative date',
          underlyingChartId: 'CH_BAD_RELATIVE_DATE',
          visualizationType: 'Plot',
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_BAD_RELATIVE_DATE' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'relativeDate', value }],
      detail: 'snippet',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        identity: { widgetId: 'MW_BAD_RELATIVE_DATE' },
        input: 'Relative Date',
        problem: 'malformed',
      },
    });
  });

  it('keeps display and HTTP evidence out of closed Widget errors', async () => {
    const widget = createWidget({
      async request(path) {
        throw new MarqueeError('http', `Marquee returned 429 for ${path}`, {
          path,
          status: 429,
          retryAfterMs: 2_000,
          body: '{"detail":"slow down"}',
        });
      },
    });

    const result = await widget.get({
      widgetId: 'MW_RATE_LIMITED' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'snippet',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW_RATE_LIMITED' },
        failure: { kind: 'rate-limited', retryAfterMs: 2_000 },
      },
    });
    expect(result).not.toHaveProperty('warnings');
    if (!result.ok) {
      expect(result.error).not.toHaveProperty('message');
      expect(result.error).not.toHaveProperty('status');
    }
  });

  it.each([
    [undefined, {
      kind: 'invalid-definition',
      identity: { widgetId: 'MW_TARGET' },
      problem: 'missing-target',
    }],
    ['XX_UNKNOWN', {
      kind: 'unsupported-execution-target',
      identity: { widgetId: 'MW_TARGET' },
      targetId: 'XX_UNKNOWN',
    }],
  ])('fails closed for snippet execution target %s', async (targetId, error) => {
    const widget = createWidget({
      async request(path) {
        if (path.endsWith('/configurations')) {
          return {
            id: 'WC_TARGET',
            widgetId: 'MW_TARGET',
            ...(targetId ? { underlyingChartId: targetId } : {}),
            parameters: [],
          };
        }
        return {
          id: 'MW_TARGET',
          title: 'Target',
          configurationId: 'WC_TARGET',
          ...(targetId ? { underlyingChartId: targetId } : {}),
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_TARGET' as WidgetId,
      configurationId: 'WC_TARGET' as ConfigId,
      parameters: [],
      detail: 'snippet',
    })).resolves.toEqual({ ok: false, error });
  });

  it('returns the Web-parity PlotTool Pro presentation for full detail', async () => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_PLOT') {
          return {
            id: 'MW_PLOT',
            title: 'Plot',
            useEntityTitle: true,
            configurationId: 'WC_PLOT',
            underlyingChartId: 'CH_PLOT',
            renderParams: { component: {}, controls: [] },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_PLOT',
            widgetId: 'MW_PLOT',
            underlyingChartId: 'CH_PLOT',
            parameters: [],
          };
        }
        if (path === '/v1/charts/CH_PLOT') {
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
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_PLOT' as WidgetId,
      configurationId: 'WC_PLOT' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        execution: {
          family: 'plot',
          value: {
            rows: [{ date: '2026-01-01', Series: 1 }],
            projection: {
              chartType: 'line',
              series: [{
                label: 'Series',
                points: [{ rawKey: '2026-01-01', value: 1 }],
              }],
            },
          },
        },
      },
    });
  });

  it('keeps duplicate PlotTool Pro values under their verbatim machine label', async () => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_DUPLICATE_LABELS') {
          return {
            id: 'MW_DUPLICATE_LABELS',
            title: 'Duplicate labels',
            configurationId: 'WC_DUPLICATE_LABELS',
            underlyingChartId: 'CH_DUPLICATE_LABELS',
            renderParams: { component: {}, controls: [] },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_DUPLICATE_LABELS',
            widgetId: 'MW_DUPLICATE_LABELS',
            underlyingChartId: 'CH_DUPLICATE_LABELS',
            parameters: [],
          };
        }
        if (path === '/v1/charts/CH_DUPLICATE_LABELS') {
          return {
            description: 'USD.one()\nUSD.two()',
            chartType: 'line',
            expressions: [{ label: 'Shared label' }, { label: 'Shared label' }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/runner') {
          return {
            results: [
              { type: 'series', values: { '2026-01-01': 1 } },
              { type: 'series', values: { '2026-01-01': 2 } },
            ],
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_DUPLICATE_LABELS' as WidgetId,
      configurationId: 'WC_DUPLICATE_LABELS' as ConfigId,
      parameters: [],
      detail: 'full',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        execution: {
          value: {
            rows: [{
              date: '2026-01-01',
              'Shared label': [1, 2],
            }],
          },
        },
      },
    });
  });

  it('returns owner-resolved PlotTool Pro labels without presentation evidence', async () => {
    const firstAssetId = `MA${'1'.repeat(16)}`;
    const secondAssetId = `MA${'2'.repeat(16)}`;
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_LABELS') {
          return {
            id: 'MW_LABELS',
            title: 'Resolved labels',
            configurationId: 'WC_LABELS',
            underlyingChartId: 'CH_LABELS',
            contextParameter: {
              field: '',
              options: [firstAssetId, secondAssetId],
              value: firstAssetId,
            },
            renderParams: { component: {}, controls: [] },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/MW_LABELS/metadata') {
          return { metadata: {} };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_LABELS',
            widgetId: 'MW_LABELS',
            underlyingChartId: 'CH_LABELS',
            parameters: [],
          };
        }
        if (path === '/v1/charts/CH_LABELS') {
          return {
            description: 'USD.one()\nUSD.two()',
            chartType: 'line',
            expressions: [{ label: 'Raw one' }, { label: 'Raw two' }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/entities') {
          return {
            assets: [
              { id: firstAssetId, name: 'Semantic one' },
              { id: secondAssetId, name: 'Semantic two' },
            ],
          };
        }
        if (path === '/v1/plots/runner') {
          return {
            results: [
              { type: 'series', values: { '2026-01-01': 1 } },
              { type: 'series', values: { '2026-01-01': 2 } },
            ],
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_LABELS' as WidgetId,
      configurationId: 'WC_LABELS' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        execution: {
          family: 'plot',
          value: {
            projection: { series: [
              { label: 'Raw one' },
              { label: 'Raw two' },
            ] },
          },
        },
      },
    });
  });

  it('uses complete Widget expression labels without resolving raw PlotTool Pro series identities', async () => {
    const assetId = `MA${'4'.repeat(16)}`;
    const entityResolve = vi.fn(async () => {
      throw new Error('complete expression labels must suppress Entity resolution');
    });
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_EXPRESSION_LABELS') {
          return {
            id: 'MW_EXPRESSION_LABELS',
            title: 'Expression labels',
            configurationId: 'WC_EXPRESSION_LABELS',
            underlyingChartId: 'CH_EXPRESSION_LABELS',
            renderParams: { component: {}, controls: [] },
            parameters: [],
            metadata: { expressionLabels: ['Human label'] },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_EXPRESSION_LABELS',
            widgetId: 'MW_EXPRESSION_LABELS',
            underlyingChartId: 'CH_EXPRESSION_LABELS',
            parameters: [],
          };
        }
        if (path === '/v1/charts/CH_EXPRESSION_LABELS') {
          return {
            description: 'USD.one()',
            chartType: 'line',
            expressions: [{ label: assetId }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/runner') {
          return {
            results: [{ type: 'series', values: { '2026-01-01': 1 } }],
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    }, {
      entity: { resolve: entityResolve },
    });

    const result = await widget.get({
      widgetId: 'MW_EXPRESSION_LABELS' as WidgetId,
      configurationId: 'WC_EXPRESSION_LABELS' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value).toMatchObject({
      detail: 'full',
      execution: {
        family: 'plot',
        value: {
          projection: { series: [{ label: 'Human label' }] },
        },
      },
    });
    expect(entityResolve).not.toHaveBeenCalled();
  });

  it('resolves raw Plot series identities when a Widget expression label names one', async () => {
    const assetId = `MA${'4'.repeat(16)}`;
    const entityResolve = vi.fn(async () => ({
      ok: true as const,
      value: [{ kind: 'asset' as const, entityId: assetId, label: 'Resolved asset', aliases: [] }],
    }));
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_EXPRESSION_IDENTITY') {
          return {
            id: 'MW_EXPRESSION_IDENTITY',
            title: 'Expression identity',
            configurationId: 'WC_EXPRESSION_IDENTITY',
            underlyingChartId: 'CH_EXPRESSION_IDENTITY',
            renderParams: { component: {}, controls: [] },
            parameters: [],
            metadata: { expressionLabels: [`Spot of ${assetId}`] },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_EXPRESSION_IDENTITY',
            widgetId: 'MW_EXPRESSION_IDENTITY',
            underlyingChartId: 'CH_EXPRESSION_IDENTITY',
            parameters: [],
          };
        }
        if (path === '/v1/charts/CH_EXPRESSION_IDENTITY') {
          return {
            description: 'USD.one()',
            chartType: 'line',
            expressions: [{ label: assetId }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/runner') {
          return {
            results: [{ type: 'series', values: { '2026-01-01': 1 } }],
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    }, {
      entity: { resolve: entityResolve },
    });

    const result = await widget.get({
      widgetId: 'MW_EXPRESSION_IDENTITY' as WidgetId,
      configurationId: 'WC_EXPRESSION_IDENTITY' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(entityResolve).toHaveBeenCalledWith([{ kind: 'asset', value: assetId }]);
  });


  const renderedSeriesAssetId = `MA${'3'.repeat(16)}`;

  it.each([
    ['dependency', {
      ok: false,
      error: {
        kind: 'dependency',
        failure: { kind: 'timeout' },
      },
    }, {
      kind: 'widget-load-failure',
      identity: { widgetId: 'MW_SERIES_ENTITY_FAILURE' },
      failure: { kind: 'timeout' },
    }],
    ['not-found', {
      ok: true,
      value: [{
        kind: 'asset',
        value: renderedSeriesAssetId,
        status: 'not-found',
      }],
    }, {
      kind: 'invalid-definition',
      identity: { widgetId: 'MW_SERIES_ENTITY_FAILURE' },
      problem: 'malformed',
    }],
    ['wrong-kind', {
      ok: true,
      value: [{
        kind: 'country',
        entityId: 'US',
        label: 'United States',
        aliases: [],
      }],
    }, {
      kind: 'invalid-definition',
      identity: { widgetId: 'MW_SERIES_ENTITY_FAILURE' },
      problem: 'malformed',
    }],
  ] as const)('preserves a rendered-series Entity %s failure', async (
    _kind,
    resolution,
    expectedError,
  ) => {
    const assetId = renderedSeriesAssetId;
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_SERIES_ENTITY_FAILURE') {
          return {
            id: 'MW_SERIES_ENTITY_FAILURE',
            title: 'Series Entity failure',
            configurationId: 'WC_SERIES_ENTITY_FAILURE',
            underlyingChartId: 'CH_SERIES_ENTITY_FAILURE',
            contextParameter: {
              field: '',
              options: [assetId],
              value: assetId,
            },
            renderParams: { component: {}, controls: [] },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/MW_SERIES_ENTITY_FAILURE/metadata') {
          return { metadata: {} };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_SERIES_ENTITY_FAILURE',
            widgetId: 'MW_SERIES_ENTITY_FAILURE',
            underlyingChartId: 'CH_SERIES_ENTITY_FAILURE',
            parameters: [],
          };
        }
        if (path === '/v1/charts/CH_SERIES_ENTITY_FAILURE') {
          return {
            description: 'USD.one()',
            chartType: 'line',
            expressions: [{ label: 'Raw series' }],
            relativeStartDate: '-1y',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/runner') {
          return { results: [{ type: 'series', values: { '2026-01-01': 1 } }] };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    }, {
      entity: {
        resolve: async () => resolution,
      },
    });

    await expect(widget.get({
      widgetId: 'MW_SERIES_ENTITY_FAILURE' as WidgetId,
      configurationId: 'WC_SERIES_ENTITY_FAILURE' as ConfigId,
      parameters: [],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: expectedError,
    });
  });

  it('returns the family-specific DataViz result for full detail', async () => {
    const metadataBodies: unknown[] = [];
    const widget = createWidget({
      async request(path, init) {
        if (path === '/v1/marketview/widgets/MW_DATA_VIZ') {
          return {
            id: 'MW_DATA_VIZ',
            title: 'DataViz',
            useEntityTitle: false,
            configurationId: 'WC_DATA_VIZ',
            underlyingChartId: 'DV_DATA_VIZ',
            visualizationType: 'DataViz',
            renderParams: { component: { currency: 'USD' }, controls: [] },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/MW_DATA_VIZ/metadata') {
          metadataBodies.push(init?.body);
          return { metadata: { title: 'Dynamic DataViz title' } };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_DATA_VIZ',
            widgetId: 'MW_DATA_VIZ',
            underlyingChartId: 'DV_DATA_VIZ',
            parameters: [],
          };
        }
        if (path === '/v1/data/visualizations/DV_DATA_VIZ') return {};
        if (path === '/v1/data/visualizations/DV_DATA_VIZ/render') {
          return {
            renderData: {
              data: [{ type: 'bar', x: ['A'], y: [1] }],
              layout: {},
            },
          };
        }
        if (path === '/v1/marketview/dashboards') return { results: [] };
        throw new Error(`unexpected ${path}`);
      },
    });

    await expect(widget.get({
      widgetId: 'MW_DATA_VIZ' as WidgetId,
      configurationId: 'WC_DATA_VIZ' as ConfigId,
      parameters: [],
      detail: 'full',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        widget: {
          title: 'Dynamic DataViz title',
        },
        execution: {
          family: 'data-viz',
          value: {
            kind: 'visualization',
            projection: { kind: 'figure' },
          },
        },
      },
    });
    expect(metadataBodies).toEqual([{
      parameters: [{ field: 'currency', value: 'USD' }],
    }]);
  });

  it('applies ordered parameters in memory for a private Widget Snippet', async () => {
    const requests: Array<{
      path: string;
      method: string;
      query?: Record<string, unknown>;
      body?: unknown;
    }> = [];
    const widget = createWidget({
      async request(path, init) {
        requests.push({
          path,
          method: init?.method ?? 'GET',
          ...(init?.query ? { query: init.query } : {}),
          ...(init?.body !== undefined ? { body: init.body } : {}),
        });
        if (path === '/v1/marketview/widgets/MW_BOUND') {
          const currency = typeof init?.query?.context === 'string'
            ? 'EUR'
            : 'USD';
          return {
            id: 'MW_BOUND',
            title: 'Bound',
            useEntityTitle: true,
            ...(typeof init?.query?.context === 'string'
              ? { configurationId: init.query.context }
              : {}),
            underlyingChartId: 'DV_BOUND',
            renderParams: {
              component: { currency },
              controls: [{
                id: 'currency',
                type: 'Enum',
                value: currency,
                values: ['USD', 'EUR'],
              }],
            },
            parameters: [],
            metadata: { title: 'Bound' },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return {
            id: 'WC_BOUND',
            widgetId: 'MW_BOUND',
            underlyingChartId: 'DV_BOUND',
            parameters: [{ field: 'currency', value: 'EUR' }],
          };
        }
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_BOUND' as WidgetId,
      configurationId: null,
      parameters: [
        { field: 'currency', value: 'USD' },
        { field: 'currency', value: 'EUR' },
      ],
      detail: 'snippet',
    });
    if (!result.ok) {
      throw new Error(JSON.stringify({ error: result.error, requests }));
    }
    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: 'MW_BOUND',
          configurationId: 'WC_BOUND',
          chartId: 'DV_BOUND',
          family: 'data-viz',
        },
        snippet: {
          parameterLines: ['currency=EUR'],
        },
      },
    });
    expect(requests).toEqual([
      { path: '/v1/marketview/widgets/MW_BOUND', method: 'GET' },
      {
        path: '/v1/marketview/widgets/configurations',
        method: 'POST',
        body: {
          widgetId: 'MW_BOUND',
          underlyingChartId: 'DV_BOUND',
          parameters: [],
        },
      },
    ]);
  });

  it.each([
    ['1M', '1M'],
    ['10Y', '10Y'],
  ])('accepts the CLI relativeDate alias %s in memory for a private PlotTool Pro Snippet', async (value, shown) => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/configurations') {
          return { id: 'WC_DATE', widgetId: 'MW_DATE', underlyingChartId: 'CH_DATE', parameters: [] };
        }
        return {
          id: 'MW_DATE',
          title: 'Dated Plot',
          underlyingChartId: 'CH_DATE',
          visualizationType: 'Plot',
          renderParams: { controls: [] },
          parameters: [],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_DATE' as WidgetId,
      configurationId: null,
      parameters: [{ field: 'relativeDate', value }],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        detail: 'snippet',
        snippet: { parameterLines: [`relativeDate=${shown}`] },
      },
    });
  });

  it('accepts omitted redundant ownership fields in configuration detail', async () => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/configurations') {
          return { id: 'WC_OMITTED', parameters: [] };
        }
        return {
          id: 'MW_OMITTED',
          title: 'Omitted identities',
          configurationId: 'WC_OMITTED',
          underlyingChartId: 'DV_OMITTED',
          visualizationType: 'DataViz',
          renderParams: { controls: [], component: {} },
          parameters: [],
        };
      },
    });

    const result = await widget.get({
      widgetId: 'MW_OMITTED' as WidgetId,
      configurationId: 'WC_OMITTED' as ConfigId,
      parameters: [],
      detail: 'snippet',
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: {
        widget: {
          widgetId: 'MW_OMITTED',
          configurationId: 'WC_OMITTED',
          chartId: 'DV_OMITTED',
        },
      },
    });
  });

  it('preserves provider MAX range while applying ordered parameters once', async () => {
    const posted: unknown[] = [];
    const runnerBodies: unknown[] = [];
    const requests: Array<{ path: string; method?: string | undefined }> = [];
    let chartReads = 0;
    let configurationReads = 0;
    const configurationResponse = (method: string | undefined, body: unknown) => {
      if (method === 'POST') {
        posted.push(body);
        return {
          id: 'WC_NEW',
          relativeDate: 'MAX',
          calculatedDates: {
            startDate: '1926-01-02',
            endDate: '2026-01-02',
            interval: '1D',
          },
        };
      }
      configurationReads += 1;
      return {
        id: 'WC_BASE',
        widgetId: 'MW_OVERRIDE',
        underlyingChartId: 'CH_OVERRIDE',
        parameters: [{ field: 'limit', value: 0 }],
      };
    };
    const widget = createWidget({
      async request(path, init) {
        requests.push({ path, method: init?.method });
        if (path === '/v1/marketview/widgets/MW_OVERRIDE') {
          const context = init?.query?.context;
          return {
            id: 'MW_OVERRIDE',
            title: 'Override',
            configurationId: context === 'WC_NEW' ? 'WC_NEW' : 'WC_BASE',
            underlyingChartId: 'CH_OVERRIDE',
            renderParams: {
              component: { limit: context === 'WC_NEW' ? 2 : 0 },
              controls: [{
                id: 'limit',
                type: 'Integer',
                value: context === 'WC_NEW' ? 2 : 0,
                defaultValue: context === 'WC_NEW' ? 2 : 0,
              }],
            },
            parameters: [],
            metadata: {},
          };
        }
        if (path === '/v1/marketview/widgets/MW_OVERRIDE/metadata') {
          return { metadata: {} };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return configurationResponse(init?.method, init?.body);
        }
        if (path === '/v1/charts/CH_OVERRIDE') {
          chartReads += 1;
          return {
            description: 'USD.foo()',
            chartType: 'line',
            expressions: [{ label: 'Series' }],
            controls: [{ id: 'limit', type: 'Integer', value: 0 }],
            relativeStartDate: '-max',
            relativeEndDate: '0d',
            interval: 'Daily',
          };
        }
        if (path === '/v1/plots/entities') {
          return { assets: [] };
        }
        if (path === '/v1/marketview/dashboards') {
          return { results: [] };
        }
        if (path === '/v1/plots/runner') {
          runnerBodies.push(init?.body);
          return { results: [{ type: 'series', values: { '2026-01-01': 1 } }] };
        }
        throw new Error(`unexpected ${path}`);
      },
    });

    const result = await widget.get({
      widgetId: 'MW_OVERRIDE' as WidgetId,
      configurationId: 'WC_BASE' as ConfigId,
      parameters: [
        { field: 'limit', value: '1' },
        { field: 'limit', value: '2' },
      ],
      detail: 'full',
    });
    if (!result.ok) throw new Error(JSON.stringify({ error: result.error, requests }));

    expect(result).toMatchObject({
      ok: true,
      value: {
        detail: 'full',
        widget: { configurationId: 'WC_NEW' },
      },
    });
    expect(posted).toHaveLength(1);
    expect(chartReads).toBe(1);
    expect(configurationReads).toBe(1);
    expect(runnerBodies).toHaveLength(1);
    expect(requests.slice(0, 4)).toEqual([
      { path: '/v1/marketview/widgets/MW_OVERRIDE', method: 'GET' },
      { path: '/v1/marketview/widgets/configurations', method: 'GET' },
      { path: '/v1/marketview/widgets/configurations', method: 'POST' },
      { path: '/v1/marketview/dashboards', method: 'GET' },
    ]);
    const runnerBody = runnerBodies[0] as {
      startDate: string;
      endDate: string;
    };
    expect(runnerBody).toMatchObject({
      startDate: '1926-01-02',
      endDate: '2026-01-02',
    });
  });

  it('preserves configuration ownership while resolving overrides', async () => {
    const widget = createWidget({
      async request(path) {
        if (path === '/v1/marketview/widgets/MW_EXPECTED') {
          return {
            id: 'MW_EXPECTED',
            title: 'Expected widget',
            configurationId: 'WC_FOREIGN',
            underlyingChartId: 'CH_SHARED',
            renderParams: {
              component: { limit: 1 },
              controls: [{ id: 'limit', type: 'Integer', value: 1 }],
            },
            parameters: [],
            metadata: { title: 'Expected widget' },
          };
        }
        if (path === '/v1/marketview/widgets/configurations') {
          return [{
            id: 'WC_FOREIGN',
            widgetId: 'MW_FOREIGN',
            underlyingChartId: 'CH_SHARED',
            parameters: [{ field: 'limit', value: 1 }],
          }];
        }
        throw new Error(`unexpected ${path}`);
      },
    });

    await expect(widget.get({
      widgetId: 'MW_EXPECTED' as WidgetId,
      configurationId: 'WC_FOREIGN' as ConfigId,
      parameters: [{ field: 'limit', value: '2' }],
      detail: 'full',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'configuration-mismatch',
        identity: {
          widgetId: 'MW_EXPECTED',
          configurationId: 'WC_FOREIGN',
        },
      },
    });
  });

  it('fails closed when the contextual target conflicts with the Widget definition', async () => {
    const widget = createWidget({
      async request() {
        return {
        id: 'MW_INVARIANT',
        title: 'Target mismatch',
        configurationId: 'WC_INVARIANT',
        underlyingChartId: 'CH_INVARIANT',
        configuration: { underlyingChartId: 'DV_FOREIGN' },
        renderParams: { controls: [] },
        parameters: [],
        };
      },
    });

    await expect(widget.get({
      widgetId: 'MW_INVARIANT' as WidgetId,
      configurationId: 'WC_INVARIANT' as ConfigId,
      parameters: [],
      detail: 'snippet',
    })).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'configuration-mismatch',
        identity: {
          widgetId: 'MW_INVARIANT',
          configurationId: 'WC_INVARIANT',
        },
      },
    });
  });
});
