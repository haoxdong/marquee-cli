import { describe, expect, it, vi } from 'vitest';

import {
  createConfiguredWidgetProjection,
} from '../composition.js';
import { MarqueeError } from '../../transport/index.js';

describe('Configured Widget Dashboard projection', () => {
  it('projects Dashboard creation without reading provider records', async () => {
    const request = vi.fn();
    const projection = createConfiguredWidgetProjection({ request });

    await expect(projection.project({
      widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
      purpose: 'create',
    })).resolves.toEqual({
      ok: true,
      value: {
        widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
        bindings: [],
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed before provider access for an invalid execution target', async () => {
    const request = vi.fn();
    const projection = createConfiguredWidgetProjection({ request });

    await expect(projection.project({
      widget: { widgetId: 'CH_ONE', configurationId: 'WC_ONE' },
      purpose: 'add',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-projection',
        problem: 'invalid-identity',
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('owns saved bindings and relative-date projection for Dashboard addition', async () => {
    const request = vi.fn(async () => [{
      parameters: [
        { field: 'tenor', value: '1y' },
        { field: 'Relative Date', value: '5Y' },
      ],
    }]);
    const projection = createConfiguredWidgetProjection({ request });

    await expect(projection.project({
      widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
      purpose: 'add',
    })).resolves.toEqual({
      ok: true,
      value: {
        widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
        bindings: [{ field: 'tenor', value: '1y' }],
        dateRangeOverride: '5y',
      },
    });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/widgets/configurations' }, {
      query: { id: 'WC_ONE' },
    });
  });

  it('fails closed when a saved binding cannot form a semantic field/value pair', async () => {
    const projection = createConfiguredWidgetProjection({
      request: vi.fn(async () => [{ parameters: [{ field: 'tenor' }] }]),
    });

    await expect(projection.project({
      widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
      purpose: 'add',
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-projection',
        problem: 'malformed-binding',
      },
    });
  });

  it('preserves typed dependency failures without exposing Widget errors', async () => {
    const projection = createConfiguredWidgetProjection({
      request: vi.fn(async () => {
        throw new MarqueeError('auth_expired', 'login required');
      }),
    });

    await expect(projection.project({
      widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
      purpose: 'add',
    })).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'dependency',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });
  });

  it.each([403, 404])(
    'preserves Dashboard dependency classification for configuration HTTP %s',
    async (status) => {
      const projection = createConfiguredWidgetProjection({
        request: vi.fn(async () => {
          throw new MarqueeError('http', `request failed with ${status}`, { status });
        }),
      });

      await expect(projection.project({
        widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
        purpose: 'add',
      })).resolves.toMatchObject({
        ok: false,
        error: {
          kind: 'dependency',
          failure: { kind: 'unavailable' },
        },
      });
    },
  );

});
