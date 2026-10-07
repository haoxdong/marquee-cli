import { describe, expect, it, vi } from 'vitest';

import { createTransport, MarqueeError } from '../../../../transport/index.js';
import { createDataVizFromAdapter } from '../../module.js';
import { createMarqueeDataVizAdapter } from '../marquee.js';

const inputs = {
  widget: {
    parameters: [{ field: 'cross', values: { default: 'EURUSD' } }],
    renderParams: { component: { cross: 'EURUSD' } },
  },
  configurationId: 'WC_CONFIGURED' as const,
};

describe('Marquee DataViz adapter', () => {
  it('fetches, renders, and projects a supported visualization', async () => {
    const request = vi.fn().mockResolvedValue({
      renderData: {
        data: [{ type: 'bar', x: ['Assets'], y: [1] }],
        layout: { title: { text: 'Balance sheet' } },
      },
    });
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request,
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_BAR', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'visualization',
        projection: { kind: 'figure' },
      },
    });
    expect(request.mock.calls).toEqual([
      [{ method: 'GET', path: '/v1/data/visualizations/DV_BAR' }, undefined],
      [{ method: 'POST', path: '/v1/data/visualizations/DV_BAR/render' }, {
      body: {
        component: { cross: 'EURUSD' },
        visualization: {},
        references: { configId: 'WC_CONFIGURED', useTableViz: false },
      },
      timeoutMs: 60_000,
      }],
    ]);
  });

  it('lets the DV prefix win over a stale declared Plot type', async () => {
    const request = vi.fn().mockResolvedValue({
      renderData: {
        data: [{ type: 'bar', x: ['Assets'], y: [1] }],
        layout: {},
      },
    });
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request,
      target: { visualizationType: 'Plot' },
    }));

    await expect(dataViz.render({ targetId: 'DV_PREFIX_WINS', inputs })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'visualization' },
    });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/data/visualizations/DV_PREFIX_WINS' }, undefined);
  });

  it('exposes saved render-param preemption through the DataViz interface', async () => {
    const request = vi.fn().mockResolvedValue({
      renderData: {
        data: [{ type: 'bar', x: ['Assets'], y: [1] }],
        layout: {},
      },
    });
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request,
      target: { visualizationType: 'DataViz' },
    }));

    await dataViz.render({
      targetId: 'DV_SAVED',
      inputs: {
        widget: {
          parameters: [{ field: 'cross', values: { default: 'EURUSD' } }],
          renderParams: {
            component: { saved: 'component' },
            visualization: { saved: 'visualization' },
          },
        },
        dashboardOverrides: [{ field: 'cross', value: 'GBPUSD' }],
        hasSavedRenderParams: true,
      },
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/data/visualizations/DV_SAVED/render' }, {
      body: {
        component: { saved: 'component' },
        visualization: { saved: 'visualization' },
        references: { useTableViz: false },
      },
      timeoutMs: 60_000,
    });
  });

  it('projects Plotly polar traces as a figure', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{ type: 'scatterpolar', r: [1, 2], theta: ['a', 'b'] }],
          layout: {},
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_RADAR', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'visualization',
        projection: { kind: 'figure' },
      },
    });
  });

  it('renders a count-based sunburst without optional values', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{ type: 'sunburst', labels: ['Americas'], parents: [''] }],
          layout: {},
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_SUNBURST', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'visualization',
        projection: { kind: 'figure' },
      },
    });
  });

  it('renders provider-owned pie labels and values as donut rows', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{
            type: 'pie',
            labels: ['Overlap (12 holdings)', 'Non-Overlap'],
            values: [62.5, 37.5],
            hole: 0.55,
          }],
          layout: { title: { text: 'EXAM vs TEST – Holdings Overlap' } },
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_PIE', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'visualization',
        projection: { kind: 'figure' },
      },
    });
  });

  it('routes a private component target and normalizes a Plotly table trace', async () => {
    const request = vi.fn().mockResolvedValue({
      renderData: {
        data: [{
          type: 'table',
          header: { values: ['<b>desk</b>', '<b>pnl</b>'] },
          cells: { values: [['<b>Rates</b>', 'Credit'], [12, -4]] },
        }],
        layout: {},
      },
    });
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request,
      target: { visualizationType: 'BaseComponent' },
    }));

    await expect(dataViz.render({ targetId: 'DV_COMPONENT', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'table',
        projection: {
          kind: 'table',
          rows: [
            { kind: 'data', raw: { 'column-0': '<b>Rates</b>', 'column-1': 12 } },
            { kind: 'data', raw: { 'column-0': 'Credit', 'column-1': -4 } },
          ],
        },
      },
    });
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/v1/data/components/DV_COMPONENT/render' }, expect.any(Object));
  });

  it('projects the detailed table of a single-table response, as Web draws it', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{
            type: 'table',
            header: { values: ['ETF Ticker', 'Holdings Value'] },
            cells: { values: [['EXAM'], ['$12.3M']] },
          }],
          layout: {},
        },
        detailedRenderData: {
          data: [{
            type: 'table',
            header: { values: ['ETF Ticker', 'ETF Name', 'Holdings Value'] },
            cells: { values: [['EXAM'], ['Example Equity ETF'], ['$12.3M']] },
          }],
          layout: {},
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_DETAILED_TABLE', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'table',
        projection: {
          kind: 'table',
          rows: [{
            kind: 'data',
            raw: { 'column-0': 'EXAM', 'column-1': 'Example Equity ETF', 'column-2': '$12.3M' },
          }],
        },
      },
    });
  });

  it('projects the detailed tables of a grouped response, one row per titled table', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [
            { type: 'table', header: { values: ['<b>08-10 (Mon)</b>'] }, cells: { values: [['RPAY', '', '']] } },
            { type: 'table', header: { values: ['<b>08-11 (Tue)</b>'] }, cells: { values: [['ETOR', 'HRB', '']] } },
          ],
          layout: {},
        },
        detailedRenderData: {
          data: [
            {
              type: 'table',
              header: { values: ['<b>Pre</b>', '<b>During</b>', '<b>Post</b>'] },
              cells: { values: [[''], [''], ['RPAY']] },
              domain: { x: [0, 0.4] },
            },
            {
              type: 'table',
              header: { values: ['<b>Pre</b>', '<b>During</b>', '<b>Post</b>'] },
              cells: { values: [['ETOR'], [''], ['HRB']] },
              domain: { x: [0.6, 1] },
            },
          ],
          layout: {
            annotations: [
              { text: '08-10 (Mon)', showarrow: false, x: 0.2, xref: 'paper', yref: 'paper' },
              { text: '08-11 (Tue)', showarrow: false, x: 0.8, xref: 'paper', yref: 'paper' },
            ],
          },
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_GROUPED_TABLE', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'table',
        projection: {
          columns: [{ text: '' }, { text: 'Pre' }, { text: 'During' }, { text: 'Post' }],
          rows: [
            {
              kind: 'data',
              raw: { 'column-0': '08-10 (Mon)', 'column-1': '', 'column-2': '', 'column-3': 'RPAY' },
            },
            {
              kind: 'data',
              raw: { 'column-0': '08-11 (Tue)', 'column-1': 'ETOR', 'column-2': '', 'column-3': 'HRB' },
            },
          ],
        },
      },
    });
  });

  it('fails loud when a grouped response has fewer detailed tables than rendered tables', async () => {
    const trace = { type: 'table', header: { values: ['Pre'] }, cells: { values: [['ETOR']] } };
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: { data: [trace, trace], layout: {} },
        detailedRenderData: { data: [trace], layout: {} },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_GROUPED_TABLE', inputs })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'malformed-result',
        targetId: 'DV_GROUPED_TABLE',
        problem: 'invalid-visualization-data',
      },
    });
  });

  it('fails loud when a grouped response has a detailed render that mixes tables and other traces', async () => {
    const trace = { type: 'table', header: { values: ['Pre'] }, cells: { values: [['ETOR']] } };
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: { data: [trace, trace], layout: {} },
        detailedRenderData: { data: [trace, { type: 'bar', x: ['ETOR'], y: [1] }], layout: {} },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_GROUPED_TABLE', inputs })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'malformed-result',
        targetId: 'DV_GROUPED_TABLE',
        problem: 'invalid-visualization-data',
      },
    });
  });

  it('fails loud when a single-table response has a detailed render that is not one table', async () => {
    const trace = { type: 'table', header: { values: ['ETF Ticker'] }, cells: { values: [['EXAM']] } };
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: { data: [trace], layout: {} },
        detailedRenderData: { data: [{ type: 'bar', x: ['EXAM'], y: [1] }], layout: {} },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_DETAILED_TABLE', inputs })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'malformed-result',
        targetId: 'DV_DETAILED_TABLE',
        problem: 'invalid-visualization-data',
      },
    });
  });

  it.each([
    { status: 404, kind: 'target-not-found' },
    { status: 403, kind: 'target-access-denied' },
    { status: 500, kind: 'render-failure' },
  ] as const)('maps HTTP $status to $kind', async ({ status, kind }) => {
    const cause = new MarqueeError('http', `HTTP ${status}`, { status });
    const onVisualizationFailureEvidence = vi.fn();
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockRejectedValue(cause),
      target: { visualizationType: 'DataViz' },
      onVisualizationFailureEvidence,
    }));

    const outcome = await dataViz.render({ targetId: 'DV_FAILURE', inputs });

    expect(outcome).toMatchObject({
      ok: false,
      error: { kind, targetId: 'DV_FAILURE' },
    });
    if (outcome.ok) throw new Error('expected DataViz error');
    expect(outcome.error).not.toHaveProperty('cause');
    if (kind === 'render-failure') {
      expect(outcome.error).toMatchObject({ failure: { kind: 'unavailable' } });
    }
    expect(onVisualizationFailureEvidence).toHaveBeenCalledWith(cause);
  });

  it.each([
    ['Not entitled to this visualization', { kind: 'unavailable' }],
    ['Error getting entity', { kind: 'unavailable' }],
    ['Unauthorized', { kind: 'authentication-required', realm: 'marquee' }],
  ])('classifies a proxied DataViz render 401: %s', async (message, failure) => {
    const transport = createTransport({
      execution: 'proxy',
      baseUrl: 'https://credential-service.internal/marquee',
      accountId: 'account-1',
      sessionId: 'session-1',
      invocationToken: 'invocation-token',
      fetchFn: async (_url, init) => init?.method === 'POST'
        ? new Response(JSON.stringify({ message }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
        : new Response('{}', { headers: { 'content-type': 'application/json' } }),
    });
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: (target, init) => transport.request(target, init),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_FAILURE', inputs })).resolves.toEqual({
      ok: false,
      error: { kind: 'render-failure', targetId: 'DV_FAILURE', failure },
    });
  });

  it('preserves the rate-limit retry hint', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockRejectedValue(new MarqueeError('http', 'Rate limited', {
        status: 429,
        retryAfterMs: 1250,
      })),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_RATE_LIMITED', inputs })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'render-failure',
        targetId: 'DV_RATE_LIMITED',
        failure: { kind: 'rate-limited', retryAfterMs: 1250 },
      },
    });
  });

  it.each(['DataViz', 'BaseComponent'])('propagates unexpected %s request errors unchanged', async (visualizationType) => {
    const cause = new Error('unexpected request failure');
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockRejectedValue(cause),
      target: { visualizationType },
    }));

    await expect(dataViz.render({ targetId: 'DV_UNEXPECTED', inputs })).rejects.toBe(cause);
  });

  it('does not expose private component failure evidence to the Widget presenter', async () => {
    const onVisualizationFailureEvidence = vi.fn();
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockRejectedValue(new MarqueeError('http', 'private component failure')),
      target: { visualizationType: 'BaseComponent' },
      onVisualizationFailureEvidence,
    }));

    await expect(dataViz.render({ targetId: 'DV_COMPONENT', inputs })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'render-failure', targetId: 'DV_COMPONENT' },
    });
    expect(onVisualizationFailureEvidence).not.toHaveBeenCalled();
  });

  it('classifies malformed provider-derived render inputs as a typed decode failure', async () => {
    const request = vi.fn();
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request,
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({
      targetId: 'DV_MALFORMED_INPUT',
      inputs: {
        widget: {
          parameters: { field: 'cross' },
        },
      },
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'malformed-result',
        targetId: 'DV_MALFORMED_INPUT',
        problem: 'invalid-visualization-data',
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/data/visualizations/DV_MALFORMED_INPUT' }, undefined);
  });

  it('classifies an invalid provider table format as a typed decode failure', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{
            type: 'table',
            header: { values: ['Value'] },
            cells: { values: [[1]], format: ['.2q'] },
          }],
          layout: {},
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_MALFORMED_RESPONSE', inputs })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'malformed-result',
        targetId: 'DV_MALFORMED_RESPONSE',
        problem: 'invalid-display-format',
      },
    });
  });

  it('preserves the provider message instead of projecting a DataViz empty-result placeholder', async () => {
    const message = 'No index composition for Example Index on 2026-08-07.';
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{ type: 'bar', x: [0, 0], y: [0, 0] }],
          layout: {
            annotations: [
              { text: message, showarrow: false, xref: 'x domain', yref: 'y domain' },
              { text: message, showarrow: false, xref: 'x domain', yref: 'y domain' },
            ],
            xaxis: { showticklabels: false, showgrid: false, title: { text: 'x' } },
            yaxis: { showticklabels: false, showgrid: false, title: { text: 'y' } },
          },
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_EMPTY', inputs })).resolves.toEqual({
      ok: true,
      value: {
        kind: 'empty',
        message,
      },
    });
  });

  it('shows Web\'s no-data message when the render answers 416', async () => {
    const cause = new MarqueeError('http', 'HTTP 416', { status: 416 });
    const onVisualizationFailureEvidence = vi.fn();
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(cause),
      target: { visualizationType: 'DataViz' },
      onVisualizationFailureEvidence,
    }));

    await expect(dataViz.render({ targetId: 'DV_NO_DATA', inputs })).resolves.toEqual({
      ok: true,
      value: {
        kind: 'empty',
        message: 'There is no data available for this chart',
      },
    });
    expect(onVisualizationFailureEvidence).not.toHaveBeenCalled();
  });

  it('fails loud on a 416 outside the visualization render', async () => {
    const cause = new MarqueeError('http', 'HTTP 416', { status: 416 });
    const specFailure = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockRejectedValueOnce(cause),
      target: { visualizationType: 'DataViz' },
    }));
    const componentRenderFailure = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(cause),
      target: { visualizationType: 'BaseComponent' },
    }));

    await expect(specFailure.render({ targetId: 'DV_SPEC_416', inputs })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'render-failure', targetId: 'DV_SPEC_416' },
    });
    await expect(componentRenderFailure.render({ targetId: 'DV_COMPONENT_416', inputs })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'render-failure', targetId: 'DV_COMPONENT_416' },
    });
  });

  it('keeps adjacent zero-valued DataViz bars as data when they are not the empty-result placeholder', async () => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue({
        renderData: {
          data: [{ type: 'bar', x: ['Current', 'Previous'], y: [0, 0] }],
          layout: {
            annotations: [{ text: 'Values rounded to the nearest whole number.' }],
          },
        },
      }),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_ZERO_BAR', inputs })).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'visualization',
        projection: { kind: 'figure' },
      },
    });
  });

  it.each([
    {
      response: {},
      problem: 'missing-render-data',
    },
    {
      response: { renderData: { data: {}, layout: {} } },
      problem: 'invalid-visualization-data',
    },
    {
      response: { renderData: { data: [], layout: [] } },
      problem: 'invalid-visualization-layout',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'sunburst', labels: ['Americas'], parents: [], values: [42.86] }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'pie', labels: ['Overlap'], values: [] }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'pie', labels: ['Overlap'], values: ['62.5'] }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'sunburst', labels: ['Americas'], parents: [''], values: ['42.86'] }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'sunburst', labels: [null], parents: [''], values: [42.86] }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'sunburst', labels: ['Americas'], parents: [{}], values: [42.86] }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'table', header: { values: ['desk'] }, cells: { values: [['Rates'], [12]] } }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
    {
      response: {
        renderData: {
          data: [{ type: 'table', header: { values: ['desk', 'pnl'] }, cells: { values: [['Rates', 'Credit'], [12]] } }],
          layout: {},
        },
      },
      problem: 'invalid-display-format',
    },
  ] as const)('fails loud for malformed result: $problem', async ({ response, problem }) => {
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({
      request: vi.fn().mockResolvedValue(response),
      target: { visualizationType: 'DataViz' },
    }));

    await expect(dataViz.render({ targetId: 'DV_MALFORMED', inputs })).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'malformed-result',
        targetId: 'DV_MALFORMED',
        problem,
      },
    });
  });

  it('routes a DV prefix when provider routing metadata is absent', async () => {
    const request = vi.fn().mockResolvedValue({
      renderData: {
        data: [{ type: 'bar', x: ['Assets'], y: [1] }],
        layout: {},
      },
    });
    const dataViz = createDataVizFromAdapter(createMarqueeDataVizAdapter({ request, target: {} }));

    await expect(dataViz.render({ targetId: 'DV_UNROUTED', inputs })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'visualization' },
    });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/data/visualizations/DV_UNROUTED' }, undefined);
  });

});
