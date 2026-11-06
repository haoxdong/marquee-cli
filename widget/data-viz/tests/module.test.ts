import { describe, expect, it, vi } from 'vitest';

import {
  type DataVizResult,
} from '../index.js';
import {
  createDataVizFromAdapter,
  type DataVizAdapter,
} from '../module.js';

const inputs = {
  widget: {
    parameters: [{ field: 'cross', values: { default: 'EURUSD' } }],
    renderParams: { component: { cross: 'EURUSD' } },
  },
  configurationId: 'WC_CONFIGURED' as const,
};

describe('DataViz private assembly', () => {
  it('renders one canonical visualization through the private visualization route', async () => {
    const rendered: DataVizResult = {
      kind: 'visualization',
      projection: {
        kind: 'figure',
        chart: { showLegend: false },
        axes: [],
        series: [],
        notes: [],
        shapes: [],
      },
    };
    const render = vi.fn().mockResolvedValue({ ok: true, value: rendered });
    const adapter: DataVizAdapter = {
      routing: () => ({ isVisualization: true, isComponent: false }),
      render,
    };
    const dataViz = createDataVizFromAdapter(adapter);

    await expect(dataViz.render({ targetId: 'DV_SANKEY', inputs })).resolves.toEqual({
      ok: true,
      value: rendered,
    });
    expect(render).toHaveBeenCalledWith({
      route: 'visualization',
      targetId: 'DV_SANKEY',
      inputs,
    });
  });

  it('normalizes the private component route to a native table result', async () => {
    const rendered: DataVizResult = {
      kind: 'table',
      projection: {
        kind: 'table',
        columns: [
          { id: 'desk', header: 'Desk', text: 'Desk' },
          { id: 'pnl', header: 'PnL', text: 'PnL' },
        ],
        rows: [{
          kind: 'data',
          raw: { desk: 'Rates', pnl: 12 },
          cells: [
            { columnId: 'desk', value: 'Rates', text: 'Rates' },
            { columnId: 'pnl', value: 12, text: '12' },
          ],
        }],
        sourceRowCount: 1,
      },
    };
    const render = vi.fn().mockResolvedValue({ ok: true, value: rendered });
    const adapter: DataVizAdapter = {
      routing: () => ({ isVisualization: false, isComponent: true }),
      render,
    };
    const dataViz = createDataVizFromAdapter(adapter);

    await expect(dataViz.render({ targetId: 'DV_COMPONENT', inputs })).resolves.toEqual({
      ok: true,
      value: rendered,
    });
    expect(render).toHaveBeenCalledWith({
      route: 'component',
      targetId: 'DV_COMPONENT',
      inputs,
    });
  });

  it.each([
    {
      routing: { isVisualization: false, isComponent: false },
      kind: 'routing-metadata-missing',
    },
    {
      routing: { isVisualization: true, isComponent: true },
      kind: 'routing-metadata-contradictory',
    },
  ] as const)('fails before rendering when routing metadata is $kind', async ({ routing, kind }) => {
    const render = vi.fn();
    const adapter: DataVizAdapter = { routing: () => routing, render };
    const dataViz = createDataVizFromAdapter(adapter);

    await expect(dataViz.render({ targetId: 'DV_AMBIGUOUS', inputs })).resolves.toEqual({
      ok: false,
      error: { kind, targetId: 'DV_AMBIGUOUS' },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('propagates an unexpected adapter throw', async () => {
    const cause = new Error('private provider detail');
    const adapter: DataVizAdapter = {
      routing: () => ({ isVisualization: true, isComponent: false }),
      render: async () => { throw cause; },
    };
    const dataViz = createDataVizFromAdapter(adapter);

    await expect(dataViz.render({ targetId: 'DV_FAILURE', inputs })).rejects.toBe(cause);
  });
});
