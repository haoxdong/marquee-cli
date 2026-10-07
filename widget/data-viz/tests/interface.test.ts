import { describe, expect, it, vi } from 'vitest';

import { createDataViz } from '../index.js';

const inputs = {
  widget: {
    parameters: [{ field: 'cross', values: { default: 'EURUSD' } }],
    renderParams: { component: { cross: 'EURUSD' } },
  },
  configurationId: 'WC_CONFIGURED' as const,
};

describe('DataViz public interface', () => {
  it('renders a semantic visualization through the composition factory', async () => {
    const request = vi.fn().mockResolvedValue({
      renderData: {
        data: [{ type: 'bar', x: ['EURUSD'], y: [1] }],
        layout: {},
      },
    });
    const dataViz = createDataViz({
      request,
      target: { visualizationType: 'DataViz' },
    });

    const outcome = await dataViz.render({
      targetId: 'DV_PUBLIC',
      inputs,
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        kind: 'visualization',
        projection: { kind: 'figure' },
      },
    });
    expect(outcome).not.toHaveProperty('value.tableProjection');
    expect(request).toHaveBeenCalledWith(
      { method: 'POST', path: '/v1/data/visualizations/DV_PUBLIC/render' },
      expect.any(Object),
    );
  });

  it('rejects a non-DataViz target before issuing a provider request', async () => {
    const request = vi.fn();
    const dataViz = createDataViz({
      request,
      target: {},
    });

    await expect(dataViz.render({
      targetId: 'CH_NOT_DATA_VIZ',
      inputs,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'routing-metadata-missing',
        targetId: 'CH_NOT_DATA_VIZ',
      },
    });
    expect(request).not.toHaveBeenCalled();
  });
});
