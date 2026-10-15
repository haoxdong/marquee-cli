import { describe, expect, it, vi, type Mock } from 'vitest';

import { DataVizApi } from '../../../api/data-viz/index.js';
import { renderDataVizLane } from '../data-viz.js';

// The client over a mock that records each request as its path, then its method and body.
function dataVizApi(request: Mock): DataVizApi {
  return new DataVizApi({
    request: (endpoint, init) => (init === undefined
      ? request(endpoint.path)
      : request(endpoint.path, { method: endpoint.method, body: init.body })),
  });
}

const rendered = { renderData: { data: [], layout: {} } };

describe('Widget render pipeline DataViz lane', () => {
  it('fetches the visualization spec and renders a Widget', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ parameters: {} })
      .mockResolvedValueOnce(rendered);

    await expect(
      renderDataVizLane(dataVizApi(request), {
        mode: 'widget',
        targetId: 'DV_RENDER',
        widget: { parameters: [] },
      }),
    ).resolves.toBe(rendered);

    expect(request.mock.calls).toEqual([
      ['/v1/data/visualizations/DV_RENDER'],
      [
        '/v1/data/visualizations/DV_RENDER/render',
        {
          method: 'POST',
          body: {
            component: {},
            visualization: {},
            references: { useTableViz: false },
          },
        },
      ],
    ]);
  });

  it.each(['widget', 'base-component'] as const)(
    'renders %s while its spec response is pending and propagates spec failure',
    async (mode) => {
      let rejectSpec!: (reason: Error) => void;
      const spec = new Promise<never>((_, reject) => { rejectSpec = reject; });
      const request = vi.fn().mockReturnValueOnce(spec).mockResolvedValueOnce(rendered);
      const result = renderDataVizLane(dataVizApi(request), mode === 'widget'
        ? { mode, targetId: 'DV_RENDER', widget: { parameters: [] } }
        : { mode, targetId: 'DV_COMPONENT' });
      const failure = new Error('spec unavailable');
      const assertion = expect(result).rejects.toBe(failure);
      expect(request.mock.calls).toHaveLength(2);
      rejectSpec(failure);
      await assertion;
    },
  );

  it('propagates a render failure even while the spec response is pending', async () => {
    let resolveSpec!: (value: unknown) => void;
    const spec = new Promise((resolve) => { resolveSpec = resolve; });
    const failure = new Error('render unavailable');
    const request = vi.fn().mockReturnValueOnce(spec).mockRejectedValueOnce(failure);
    try {
      await expect(renderDataVizLane(dataVizApi(request), {
        mode: 'widget', targetId: 'DV_RENDER', widget: { parameters: [] },
      })).rejects.toBe(failure);
    } finally {
      resolveSpec({});
    }
  });

  it('lets saved render params preempt the entire Widget body cascade', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_SAVED',
      useSavedRenderParams: true,
      activeEntity: 'MA_ACTIVE',
      dashboardOverrides: [{ field: 'cross', value: 'MA_OVERRIDE' }],
      widget: {
        contextParameter: { field: 'context' },
        parameters: [{
          field: 'cross',
          value: 'MA_VALUE',
          values: { MA_ACTIVE: 'MA_ENTITY', default: 'MA_DEFAULT' },
        }],
        renderParams: {
          component: { saved: 'component' },
          visualization: { saved: 'visualization' },
        },
      },
      configurationId: 'WC_SAVED',
    });

    expect(request).toHaveBeenLastCalledWith('/v1/data/visualizations/DV_SAVED/render', {
      method: 'POST',
      body: {
        component: { saved: 'component' },
        visualization: { saved: 'visualization' },
        references: {
          configId: 'WC_SAVED',
          useTableViz: false,
        },
      },
    });
  });

  it('seeds context before parameters and lets the matching parameter overwrite it', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_CONTEXT',
      activeEntity: 'MA_ACTIVE',
      widget: {
        contextParameter: { field: 'asset' },
        parameters: [{ field: 'asset', value: 'MA_PARAMETER' }],
      },
    });

    expect(request).toHaveBeenLastCalledWith('/v1/data/visualizations/DV_CONTEXT/render', {
      method: 'POST',
      body: {
        component: { asset: 'MA_PARAMETER' },
        visualization: {},
        references: { useTableViz: false },
      },
    });
  });

  it('skips the context seed when only unrelated dashboard overrides exist', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_CONTEXT_SKIP',
      activeEntity: 'MA_ACTIVE',
      dashboardOverrides: [{ field: 'currency', value: 'USD' }],
      widget: {
        contextParameter: { field: 'asset' },
        parameters: [],
      },
    });

    expect(request).toHaveBeenLastCalledWith(
      '/v1/data/visualizations/DV_CONTEXT_SKIP/render',
      {
        method: 'POST',
        body: {
          component: { currency: 'USD' },
          visualization: {},
          references: { useTableViz: false },
        },
      },
    );
  });

  it('discards a dashboard id before applying active-entity parameter values', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_DASHBOARD_CONTEXT',
      activeEntity: 'MD_DASHBOARD',
      widget: {
        contextParameter: { field: 'asset' },
        parameters: [{
          field: 'cross',
          value: 'VALUE_REQUIRES_ACTIVE_ENTITY',
          values: { MD_DASHBOARD: 'DASHBOARD_VALUE', default: 'DEFAULT_VALUE' },
        }],
      },
    });

    expect(request).toHaveBeenLastCalledWith(
      '/v1/data/visualizations/DV_DASHBOARD_CONTEXT/render',
      {
        method: 'POST',
        body: {
          component: { cross: 'DEFAULT_VALUE' },
          visualization: {},
          references: { useTableViz: false },
        },
      },
    );
  });

  it('applies every per-key cascade test with Web\'s exact precedence', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_CASCADE',
      activeEntity: 'MA_ACTIVE',
      dashboardOverrides: [{ field: 'override', value: 'OVERRIDE' }],
      widget: {
        parameters: [
          {
            field: 'override',
            value: 'VALUE',
            values: { MA_ACTIVE: 'ENTITY', default: 'DEFAULT' },
          },
          {
            field: 'value',
            value: false,
            values: { MA_ACTIVE: 'ENTITY', default: 'DEFAULT' },
          },
          {
            field: 'entity',
            values: { MA_ACTIVE: 'ENTITY', default: 'DEFAULT' },
          },
          {
            field: 'falsyEntity',
            values: { MA_ACTIVE: 0, default: false },
          },
          { field: 'default', values: { default: [] } },
          { field: 'omitted', values: {} },
        ],
      },
    });

    expect(request).toHaveBeenLastCalledWith('/v1/data/visualizations/DV_CASCADE/render', {
      method: 'POST',
      body: {
        component: {
          override: 'OVERRIDE',
          value: false,
          entity: 'ENTITY',
          falsyEntity: false,
          default: [],
        },
        visualization: {},
        references: { useTableViz: false },
      },
    });
  });

  it('requires an active entity before using param.value', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_NO_ACTIVE_ENTITY',
      widget: {
        parameters: [{
          field: 'cross',
          value: 'VALUE',
          values: { default: 'DEFAULT' },
        }],
      },
    });

    expect(request).toHaveBeenLastCalledWith(
      '/v1/data/visualizations/DV_NO_ACTIVE_ENTITY/render',
      {
        method: 'POST',
        body: {
          component: { cross: 'DEFAULT' },
          visualization: {},
          references: { useTableViz: false },
        },
      },
    );
  });

  it('rewrites every override after the cascade and drops undefined on the wire', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'widget',
      targetId: 'DV_OVERRIDE_REWRITE',
      activeEntity: 'MA_ACTIVE',
      dashboardOverrides: [
        { field: 'known', value: 'FIRST' },
        { field: 'newField', value: 'ADDED' },
        { field: 'known', value: 'LAST' },
        { field: 'undefinedField', value: undefined },
      ],
      widget: {
        parameters: [{ field: 'known', values: { default: 'DEFAULT' } }],
      },
    });

    expect(request).toHaveBeenLastCalledWith(
      '/v1/data/visualizations/DV_OVERRIDE_REWRITE/render',
      {
        method: 'POST',
        body: {
          component: { known: 'LAST', newField: 'ADDED' },
          visualization: {},
          references: { useTableViz: false },
        },
      },
    );
  });

  it.each([
    { params: undefined, expected: {} },
    { params: null, expected: null },
    {
      params: { component: { cross: 'EURUSD' }, opaque: { preserved: true } },
      expected: { component: { cross: 'EURUSD' }, opaque: { preserved: true } },
    },
  ])('sends base-component params verbatim ($params)', async ({ params, expected }) => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(rendered);

    await renderDataVizLane(dataVizApi(request), {
      mode: 'base-component',
      targetId: 'DV_COMPONENT',
      ...(params === undefined ? {} : { params }),
    });

    expect(request.mock.calls).toEqual([
      ['/v1/data/components/DV_COMPONENT'],
      [
        '/v1/data/components/DV_COMPONENT/render',
        { method: 'POST', body: expected },
      ],
    ]);
  });

});
