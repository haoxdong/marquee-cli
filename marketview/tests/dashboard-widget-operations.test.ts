import type { ConfigId, WidgetId, WidgetModule } from '../../widget/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createMarketViewWidgetOperations } from '../dashboard-widget-operations.js';

const widgetDefinition = { id: 'MW_CARRY' };
const parameters = [{ field: 'cross', value: 'MA_EURUSD' }];
const widgetDates = { startDate: '2025-01-01', endDate: '2025-02-01', interval: '1d' };

describe('MarketView Dashboard Widget operations', () => {
  it('renders a Dashboard Widget as a snippet with its Config ID', async () => {
    const render = vi.fn<WidgetModule['render']>(async () => ({
      ok: true,
      value: {
        detail: 'snippet',
        widget: {
          widgetId: 'MW_CARRY' as WidgetId,
          configurationId: 'WC_CARRY' as ConfigId,
          title: 'Carry',
          bindings: [],
          parameters: [],
        },
        snippet: { title: 'EURUSD carry', isTitleResolved: true, parameterLines: ['cross=EURUSD'] },
      },
    }));

    await expect(createMarketViewWidgetOperations({ render }).renderDashboardWidget(
      widgetDefinition,
      parameters,
      'MA_EURUSD',
      widgetDates,
    )).resolves.toEqual({
      ok: true,
      value: {
        snippet: { title: 'EURUSD carry', isTitleResolved: true, parameterLines: ['cross=EURUSD'] },
        configurationId: 'WC_CARRY',
      },
    });
    expect(render).toHaveBeenCalledExactlyOnceWith(
      widgetDefinition,
      parameters,
      'MA_EURUSD',
      widgetDates,
      'snippet',
    );
  });

  it('returns the Widget error of a failed render', async () => {
    const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_CARRY' } } as const;
    const render = vi.fn<WidgetModule['render']>(async () => ({ ok: false, error }));

    await expect(createMarketViewWidgetOperations({ render }).renderDashboardWidget(
      widgetDefinition,
      parameters,
      null,
      undefined,
    )).resolves.toEqual({ ok: false, error });
  });

  it('fails loud when Widget render answers a snippet request with a full Widget', async () => {
    const render = vi.fn<WidgetModule['render']>(async () => ({
      ok: true,
      value: { detail: 'full' } as never,
    }));

    await expect(createMarketViewWidgetOperations({ render }).renderDashboardWidget(
      widgetDefinition,
      parameters,
      null,
      undefined,
    )).rejects.toThrow('Widget render returned a non-snippet result');
  });
});
