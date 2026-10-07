import type { WidgetValue } from '../types.js';

export type WidgetRenderTarget =
  | Readonly<{ kind: 'blank' }>
  | Readonly<{ kind: 'plot'; targetId: string }>
  | Readonly<{
      kind: 'data-viz';
      targetId: string;
      resource: 'visualization' | 'component';
    }>;

export function selectWidgetRenderTarget(input: Readonly<{
  sourceId: string;
  underlyingChartId?: string | null;
  visualizationType?: string | null;
}>): WidgetRenderTarget {
  const targetId = input.sourceId.startsWith('MW')
    ? input.underlyingChartId
    : input.sourceId;
  if (!targetId) return { kind: 'blank' };

  switch (targetId.slice(0, 2)) {
    case 'CH':
      return { kind: 'plot', targetId };
    case 'DV':
      return {
        kind: 'data-viz',
        targetId,
        resource: input.visualizationType === 'BaseComponent'
          ? 'component'
          : 'visualization',
      };
    default:
      return { kind: 'blank' };
  }
}

export function widgetRenderTargetMetadata(target: WidgetRenderTarget): Readonly<{
  chartId: string;
  family: 'plot' | 'data-viz';
  isRelativeDateImplicit: boolean;
}> | Readonly<Record<never, never>> {
  if (target.kind === 'blank') return {};
  return {
    chartId: target.targetId,
    family: target.kind,
    isRelativeDateImplicit: target.kind === 'plot',
  };
}

export function widgetValueTargetId(
  target: WidgetValue['target'],
): string | undefined {
  return target.family === 'blank' ? undefined : target.targetId;
}

export function widgetValueTargetPayload(
  target: WidgetValue['target'],
): Readonly<{ underlyingChartId: string }> | Readonly<Record<never, never>> {
  const targetId = widgetValueTargetId(target);
  return targetId === undefined ? {} : { underlyingChartId: targetId };
}

export function widgetValueConfigurationTarget(
  target: WidgetValue['target'],
): Readonly<{ targetId: string }> | Readonly<Record<never, never>> {
  const targetId = widgetValueTargetId(target);
  return targetId === undefined ? {} : { targetId };
}

export function requireWidgetValueTargetId(target: WidgetValue['target']): string {
  const targetId = widgetValueTargetId(target);
  if (targetId === undefined) throw new Error('Blank Widget has no execution target');
  return targetId;
}
