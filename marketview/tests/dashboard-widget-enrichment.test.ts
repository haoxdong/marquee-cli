import type { ConfigId, WidgetId } from '../../widget/index.js';
import { describe, expect, it, vi } from 'vitest';
import type { WidgetModule } from '../../widget/index.js';
import type { DashboardPresentationWidget } from '../dashboard-presentation.js';
import {
  createMarketViewWidgetOperations,
  type MarketViewWidgetOperations,
} from '../dashboard-widget-operations.js';
import { enrichDashboardWidgets } from '../dashboard-widget-enrichment.js';

function snippet(widgetId: string, configurationId: string | null) {
  return {
    ok: true as const,
    value: {
      detail: 'snippet' as const,
      widget: {
        widgetId: widgetId as WidgetId,
        configurationId: configurationId as ConfigId | null,
        title: widgetId,
        bindings: [],
        parameters: [],
      },
      snippet: {
        title: widgetId,
        isTitleResolved: true,
        parameterLines: [],
      },
    },
  };
}

describe('MarketView Dashboard Widget enrichment', () => {
  it('passes the four Product Surface values to Widget.render', async () => {
    const widgetDefinition = {
      id: 'MW_DATED',
      title: 'Dated Widget',
      configurationId: 'WC_DATED' as ConfigId,
      underlyingChartId: 'CH_DATED',
    };
    const parameters = [{ field: 'assetId', value: 'MA_AAPL' }];
    const widgetDates = {
      startDate: '2025-01-01',
      endDate: '2025-02-01',
      interval: '1d',
    };
    const render = vi.fn<WidgetModule['render']>(async () => (
      snippet('MW_DATED', 'WC_DATED')
    ));

    const widgets: DashboardPresentationWidget[] = [{
      widgetId: 'MW_DATED' as WidgetId,
      title: 'Dated Widget',
      configurationId: 'WC_DATED' as ConfigId,
      selectedContext: 'MA_AAPL',
      widgetDefinition,
      widgetParameterOverrides: parameters,
      widgetDates,
    }];

    await expect(enrichDashboardWidgets(
      widgets,
      createMarketViewWidgetOperations({ render }),
    )).resolves.toBeUndefined();
    expect(render).toHaveBeenCalledExactlyOnceWith(
      widgetDefinition,
      parameters,
      'MA_AAPL',
      widgetDates,
      'snippet',
    );
    expect(widgets[0]?.snippet?.title).toBe('MW_DATED');
  });

  it('fails loud when a Dashboard Widget lacks the direct rendering values', async () => {
    const render = vi.fn<WidgetModule['render']>();

    await expect(enrichDashboardWidgets([{
      widgetId: 'MW_MISSING' as WidgetId,
      title: 'Missing values',
    }], createMarketViewWidgetOperations({ render }))).rejects.toThrow(
      'Direct Product Surface Widget rendering is not configured',
    );
    expect(render).not.toHaveBeenCalled();
  });

  it('renders independent Dashboard Widgets concurrently', async () => {
    const started: string[] = [];
    let running = 0;
    let peak = 0;
    const render = vi.fn<WidgetModule['render']>(async (widgetDefinition) => {
      const widgetId = String(widgetDefinition.id);
      started.push(widgetId);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return snippet(widgetId, null);
    });

    await expect(enrichDashboardWidgets([
      { widgetId: 'MW_ONE' as WidgetId, title: 'One', widgetDefinition: { id: 'MW_ONE' } },
      { widgetId: 'MW_TWO' as WidgetId, title: 'Two', widgetDefinition: { id: 'MW_TWO' } },
    ], createMarketViewWidgetOperations({ render }))).resolves.toBeUndefined();
    expect(started).toEqual(['MW_ONE', 'MW_TWO']);
    expect(peak).toBe(2);
  });

  it('renders a Widget without overrides or Selected Context with none, keeping its Config ID', async () => {
    const renderDashboardWidget = vi.fn<MarketViewWidgetOperations['renderDashboardWidget']>(async () => ({
      ok: true,
      value: {
        snippet: { title: 'Plain', isTitleResolved: true, parameterLines: [] },
        configurationId: null,
      },
    }));
    const widgets: DashboardPresentationWidget[] = [{
      widgetId: 'MW_PLAIN' as WidgetId,
      title: 'Plain',
      configurationId: 'WC_SAVED' as ConfigId,
      widgetDefinition: { id: 'MW_PLAIN' },
    }];

    await expect(enrichDashboardWidgets(widgets, { renderDashboardWidget })).resolves.toBeUndefined();

    expect(renderDashboardWidget).toHaveBeenCalledExactlyOnceWith({ id: 'MW_PLAIN' }, [], null, undefined);
    expect(widgets[0]).toMatchObject({
      configurationId: 'WC_SAVED',
      snippet: { title: 'Plain', isTitleResolved: true, parameterLines: [] },
    });
  });

  it('skips a Widget that already has its snippet', async () => {
    const renderDashboardWidget = vi.fn<MarketViewWidgetOperations['renderDashboardWidget']>(async () => ({
      ok: true,
      value: {
        snippet: { title: 'Rendered', isTitleResolved: true, parameterLines: [] },
        configurationId: null,
      },
    }));
    const widgets: DashboardPresentationWidget[] = [{
      widgetId: 'MW_DONE' as WidgetId,
      title: 'Done',
      widgetDefinition: { id: 'MW_DONE' },
      snippet: { title: 'Done', isTitleResolved: true, parameterLines: [] },
    }];

    await expect(enrichDashboardWidgets(widgets, { renderDashboardWidget })).resolves.toBeUndefined();
    expect(widgets[0]?.snippet).toEqual({ title: 'Done', isTitleResolved: true, parameterLines: [] });
    expect(renderDashboardWidget).not.toHaveBeenCalled();
  });

  it('returns a failed render as a Widget snippet error with its presentation', async () => {
    const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_GONE' } } as const;

    await expect(enrichDashboardWidgets([{
      widgetId: 'MW_GONE' as WidgetId,
      title: 'Gone',
      widgetDefinition: { id: 'MW_GONE' },
    }], {
      renderDashboardWidget: async () => ({ ok: false, error, presentation: { message: 'Widget MW_GONE is gone' } }),
    })).resolves.toEqual({
      kind: 'widget',
      action: 'widget-snippet',
      error,
      presentation: { message: 'Widget MW_GONE is gone' },
    });
  });

  it('renders at most twenty Widgets at once', async () => {
    let running = 0;
    let peak = 0;
    const startedWhileRunning: number[] = [];
    const widgets: DashboardPresentationWidget[] = Array.from({ length: 41 }, (_, index) => ({
      widgetId: `MW_${index + 1}` as WidgetId,
      title: `Widget ${index + 1}`,
      widgetDefinition: { id: `MW_${index + 1}` },
    }));

    await expect(enrichDashboardWidgets(widgets, {
      async renderDashboardWidget() {
        startedWhileRunning.push(running);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return {
          ok: true,
          value: { snippet: { title: 'Rendered', isTitleResolved: true, parameterLines: [] }, configurationId: null },
        };
      },
    })).resolves.toBeUndefined();

    expect(peak).toBe(20);
    expect(startedWhileRunning).toEqual([
      ...Array.from({ length: 20 }, (_, index) => index),
      ...Array.from({ length: 20 }, (_, index) => index),
      0,
    ]);
    expect(widgets.filter((widget) => widget.snippet)).toHaveLength(41);
  });

  it.each(['typed', 'thrown'] as const)(
    'reports a %s failure without waiting for a sibling or starting the next batch',
    async (failureKind) => {
      const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_1' } } as const;
      const presentation = { message: 'Widget MW_1 is gone' };
      const thrown = new Error('Unexpected rendering failure');
      const started: string[] = [];
      let releaseSibling = () => {};
      let siblingCompleted = false;
      const sibling = new Promise<void>((resolve) => { releaseSibling = resolve; });
      const widgets: DashboardPresentationWidget[] = Array.from({ length: 21 }, (_, index) => ({
        widgetId: `MW_${index + 1}` as WidgetId,
        title: `Widget ${index + 1}`,
        widgetDefinition: { id: `MW_${index + 1}` },
      }));

      const operation = enrichDashboardWidgets(widgets, {
        async renderDashboardWidget(definition) {
          const id = String(definition.id);
          started.push(id);
          if (id === 'MW_1') {
            if (failureKind === 'thrown') throw thrown;
            return { ok: false, error, presentation };
          }
          if (id === 'MW_2') {
            await sibling;
            siblingCompleted = true;
          }
          return {
            ok: true,
            value: {
              snippet: { title: id, isTitleResolved: true, parameterLines: [] },
              configurationId: null,
            },
          };
        },
      });
      const settled = operation.then(
        (result) => ({ kind: 'returned' as const, result }),
        (cause: unknown) => ({ kind: 'thrown' as const, cause }),
      );
      const nextTurn = new Promise<{ kind: 'pending' }>((resolve) => {
        setImmediate(() => resolve({ kind: 'pending' }));
      });

      try {
        // A held sibling must not delay the failure beyond this event-loop turn.
        const outcome = await Promise.race([settled, nextTurn]);
        expect(siblingCompleted).toBe(false);
        expect(started).toHaveLength(20);
        expect(started).not.toContain('MW_21');
        if (failureKind === 'typed') {
          expect(outcome.kind).toBe('returned');
          if (outcome.kind !== 'returned') throw new Error('Typed failure did not return promptly');
          expect(outcome.result).toEqual({ kind: 'widget', action: 'widget-snippet', error, presentation });
          expect(outcome.result?.error).toBe(error);
          expect(outcome.result?.presentation).toBe(presentation);
        } else {
          expect(outcome.kind).toBe('thrown');
          if (outcome.kind !== 'thrown') throw new Error('Unexpected failure did not propagate promptly');
          expect(outcome.cause).toBe(thrown);
        }
      } finally {
        releaseSibling();
        await settled;
        await sibling;
        await nextTurn;
      }
    },
  );
});
