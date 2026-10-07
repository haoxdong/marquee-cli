import { describe, expect, it } from 'vitest';

import {
  requireWidgetValueTargetId,
  selectWidgetRenderTarget,
  widgetRenderTargetMetadata,
  widgetValueTargetId,
  widgetValueTargetPayload,
} from '../target.js';

describe('Widget render target selection', () => {
  it('leaves an MW Widget data body blank when it has no underlying target', () => {
    expect(selectWidgetRenderTarget({ sourceId: 'MW_WIDGET' })).toEqual({
      kind: 'blank',
    });
  });

  it('selects exactly one lane from the two-character target prefix', () => {
    expect(
      selectWidgetRenderTarget({
        sourceId: 'MW_PLOT',
        underlyingChartId: 'CH_UNDERLIER',
      }),
    ).toEqual({ kind: 'plot', targetId: 'CH_UNDERLIER' });
    expect(
      selectWidgetRenderTarget({
        sourceId: 'MW_DATA_VIZ',
        underlyingChartId: 'DV_UNDERLIER',
      }),
    ).toEqual({
      kind: 'data-viz',
      targetId: 'DV_UNDERLIER',
      resource: 'visualization',
    });
  });

  it('lets the target prefix win over the declared visualization type', () => {
    expect(
      selectWidgetRenderTarget({
        sourceId: 'MW_PLOT',
        underlyingChartId: 'CH_UNDERLIER',
        visualizationType: 'DataViz',
      }),
    ).toEqual({ kind: 'plot', targetId: 'CH_UNDERLIER' });
    expect(
      selectWidgetRenderTarget({
        sourceId: 'MW_DATA_VIZ',
        underlyingChartId: 'DV_UNDERLIER',
        visualizationType: 'Plot',
      }),
    ).toEqual({
      kind: 'data-viz',
      targetId: 'DV_UNDERLIER',
      resource: 'visualization',
    });
  });

  it('uses the DataViz component resource without changing the selected lane', () => {
    expect(
      selectWidgetRenderTarget({
        sourceId: 'MW_COMPONENT',
        underlyingChartId: 'DV_COMPONENT',
        visualizationType: 'BaseComponent',
      }),
    ).toEqual({
      kind: 'data-viz',
      targetId: 'DV_COMPONENT',
      resource: 'component',
    });
  });

  it('renders a bare target from its own id and blanks an unsupported prefix', () => {
    expect(selectWidgetRenderTarget({ sourceId: 'DV_BARE' })).toEqual({
      kind: 'data-viz',
      targetId: 'DV_BARE',
      resource: 'visualization',
    });
    expect(selectWidgetRenderTarget({ sourceId: 'XX_UNKNOWN' })).toEqual({
      kind: 'blank',
    });
  });

  it('projects blank and executable target identities without sentinels', () => {
    const blank = { family: 'blank' } as const;
    const plot = { family: 'plot', targetId: 'CH_TARGET' } as const;

    expect(widgetRenderTargetMetadata({ kind: 'blank' })).toEqual({});
    expect(widgetRenderTargetMetadata({ kind: 'plot', targetId: 'CH_TARGET' })).toEqual({
      chartId: 'CH_TARGET',
      family: 'plot',
      isRelativeDateImplicit: true,
    });
    expect(widgetValueTargetId(blank)).toBeUndefined();
    expect(widgetValueTargetPayload(blank)).toEqual({});
    expect(() => requireWidgetValueTargetId(blank)).toThrow(
      'Blank Widget has no execution target',
    );
    expect(widgetValueTargetId(plot)).toBe('CH_TARGET');
    expect(widgetValueTargetPayload(plot)).toEqual({ underlyingChartId: 'CH_TARGET' });
    expect(requireWidgetValueTargetId(plot)).toBe('CH_TARGET');
  });
});
