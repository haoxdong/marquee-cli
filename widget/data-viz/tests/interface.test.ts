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
