import { describe, expect, it, vi } from 'vitest';
import type { ConfigId, WidgetId } from '../../widget/index.js';
import type { Entity } from '../../entity/index.js';
import type { MarketViewWidgetOperations } from '../dashboard-widget-operations.js';
import type { DashboardPresentationWidget } from '../dashboard-presentation.js';
import {
  enrichContextDashboardWidgets,
  prepareContextDashboardWidgets,
} from '../dashboard-hydration.js';
import { createMarketViewWidgetOperations } from '../dashboard-widget-operations.js';

const unexpectedRender: MarketViewWidgetOperations = {
  renderDashboardWidget: async () => {
    throw new Error('unexpected render');
  },
};

function contextWidget(): DashboardPresentationWidget {
  return {
    widgetId: 'MW_CONTEXT' as WidgetId,
    title: 'Context',
    selectedContext: 'MA_EXAMPLE',
    widgetDefinition: { id: 'MW_CONTEXT' },
    widgetParameterOverrides: [{ field: 'asset', value: 'MA_EXAMPLE' }],
  };
}

function renderer() {
  return {
    renderDashboardWidget: vi.fn<MarketViewWidgetOperations['renderDashboardWidget']>(async () => ({
      ok: true as const,
      value: {
        snippet: { title: 'Rendered', isTitleResolved: true, parameterLines: [] },
        configurationId: 'WC_CONTEXT' as ConfigId,
      },
    })),
  };
}

describe('context Dashboard hydration', () => {
  it('supplies the context display value only to Widgets that carry a Widget Definition', async () => {
    const override = { field: 'asset', value: 'MA_EXAMPLE' };
    const snippet = { title: 'Rendered', isTitleResolved: true, parameterLines: [] };
    const widgets: DashboardPresentationWidget[] = [
      {
        widgetId: 'MW_DEFINED' as WidgetId,
        title: 'Defined',
        selectedContext: 'MA_EXAMPLE',
        widgetDefinition: { id: 'MW_DEFINED' },
        widgetParameterOverrides: [override],
        snippet,
      },
      {
        widgetId: 'MW_UNDEFINED' as WidgetId,
        title: 'Undefined',
        selectedContext: 'MA_EXAMPLE',
        widgetParameterOverrides: [override],
        snippet,
      },
    ];
    const operations = createMarketViewWidgetOperations({
      async render() {
        throw new Error('unexpected render');
      },
    });

    await expect(enrichContextDashboardWidgets(widgets, operations, 'Example Asset'))
      .resolves.toBeUndefined();

    expect(widgets.map((widget) => widget.widgetParameterOverrides)).toEqual([
      [{ ...override, displayValue: 'Example Asset' }],
      [override],
    ]);
  });

  it('keeps a display value the Entity Feed already gave an override', async () => {
    const override = { field: 'asset', value: 'MA_EXAMPLE', displayValue: 'Feed Label' };
    const widgets: DashboardPresentationWidget[] = [{
      widgetId: 'MW_DEFINED' as WidgetId,
      title: 'Defined',
      selectedContext: 'MA_EXAMPLE',
      widgetDefinition: { id: 'MW_DEFINED' },
      widgetParameterOverrides: [override, { field: 'tenor', value: '1m' }],
      snippet: { title: 'Rendered', isTitleResolved: true, parameterLines: [] },
    }];

    await enrichContextDashboardWidgets(widgets, unexpectedRender, 'Example Asset');

    expect(widgets[0]?.widgetParameterOverrides).toEqual([override, { field: 'tenor', value: '1m' }]);
  });

  it('leaves Widgets unrendered and unlabeled without a display value', async () => {
    const override = { field: 'asset', value: 'MA_EXAMPLE' };
    const widgets: DashboardPresentationWidget[] = [{
      widgetId: 'MW_DEFINED' as WidgetId,
      title: 'Defined',
      selectedContext: 'MA_EXAMPLE',
      widgetDefinition: { id: 'MW_DEFINED' },
      widgetParameterOverrides: [override],
    }];

    await expect(enrichContextDashboardWidgets(widgets, unexpectedRender, undefined))
      .resolves.toBeUndefined();

    expect(widgets[0]?.widgetParameterOverrides).toEqual([override]);
  });
});

describe('context Dashboard preparation', () => {
  const asset: Entity = {
    kind: 'asset',
    entityId: 'MA_EXAMPLE',
    label: 'Example Corp',
    aliases: [],
    ticker: 'EXM',
    assetClass: 'Equity',
    assetType: 'Single Stock',
    exchange: 'NYSE',
    currency: 'USD',
  };

  it('titles an asset Dashboard by its label and renders its Widgets with the label as context display', async () => {
    const operations = renderer();

    await expect(prepareContextDashboardWidgets([contextWidget()], {
      identifier: 'exm',
      entity: asset,
      operations,
      enrich: true,
    })).resolves.toMatchObject({
      ok: true,
      prepared: {
        title: 'Example Corp',
        identityLine: 'EXM · Equity · Single Stock · NYSE · USD',
        widgets: [{ snippet: { title: 'Rendered' }, configurationId: 'WC_CONTEXT' }],
      },
    });
    expect(operations.renderDashboardWidget).toHaveBeenCalledExactlyOnceWith(
      { id: 'MW_CONTEXT' },
      [{ field: 'asset', value: 'MA_EXAMPLE', displayValue: 'Example Corp' }],
      'MA_EXAMPLE',
      undefined,
    );
  });

  it('falls back to the uppercased identifier for an asset without a ticker and skips absent attributes', async () => {
    await expect(prepareContextDashboardWidgets([], {
      identifier: 'exm',
      entity: { kind: 'asset', entityId: 'MA_EXAMPLE', label: 'Example Corp', aliases: [], currency: 'USD' },
      operations: unexpectedRender,
      enrich: true,
    })).resolves.toMatchObject({ ok: true, prepared: { identityLine: 'EXM · USD' } });
  });

  it('describes a portfolio by its currency and a country by nothing', async () => {
    await expect(prepareContextDashboardWidgets([], {
      identifier: 'MP_BOOK',
      entity: { kind: 'portfolio', entityId: 'MP_BOOK', label: 'Book', aliases: [], currency: 'EUR' },
      operations: unexpectedRender,
      enrich: true,
    })).resolves.toEqual({
      ok: true,
      prepared: { widgets: [], title: 'Book', identityLine: 'Portfolio · EUR' },
    });
    await expect(prepareContextDashboardWidgets([], {
      identifier: 'MP_BOOK',
      entity: { kind: 'portfolio', entityId: 'MP_BOOK', label: 'Book', aliases: [] },
      operations: unexpectedRender,
      enrich: true,
    })).resolves.toMatchObject({ ok: true, prepared: { identityLine: 'Portfolio' } });
    await expect(prepareContextDashboardWidgets([], {
      identifier: 'US',
      entity: { kind: 'country', entityId: 'US', label: 'United States', aliases: [], region: 'Americas' },
      operations: unexpectedRender,
      enrich: true,
    })).resolves.toEqual({
      ok: true,
      prepared: { widgets: [], title: 'United States', identityLine: '' },
    });
  });

  it('leaves raw Widgets unrendered', async () => {
    const widget = contextWidget();

    await expect(prepareContextDashboardWidgets([widget], {
      identifier: 'US',
      entity: { kind: 'country', entityId: 'US', label: 'United States', aliases: [] },
      operations: unexpectedRender,
      enrich: false,
    })).resolves.toMatchObject({ ok: true, prepared: { title: 'United States' } });
    expect(widget).toEqual(contextWidget());
  });

  it('returns the Widget error of a failed render', async () => {
    const error = { kind: 'widget-not-found', identity: { widgetId: 'MW_CONTEXT' } } as const;

    await expect(prepareContextDashboardWidgets([contextWidget()], {
      identifier: 'US',
      entity: { kind: 'country', entityId: 'US', label: 'United States', aliases: [] },
      operations: { renderDashboardWidget: async () => ({ ok: false, error }) },
      enrich: true,
    })).resolves.toEqual({
      ok: false,
      error: { kind: 'widget', action: 'widget-snippet', error },
    });
  });
});
