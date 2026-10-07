import type { DependencyFailure } from '../transport/index.js';

export type WidgetPersistenceAnchors = Readonly<{
  parameters: readonly unknown[];
  relativeDate?: string;
}>;

type WidgetPersistenceAnchorError =
  | { kind: 'access-denied'; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'dependency'; failure: DependencyFailure; message: string };

export type WidgetPersistenceAnchorResult =
  | { ok: true; value: WidgetPersistenceAnchors }
  | { ok: false; error: WidgetPersistenceAnchorError };

export interface WidgetPersistenceAnchorPort {
  resolve(configurationId: string): Promise<WidgetPersistenceAnchorResult>;
}

type PlotToolPersistenceAnchorError =
  | { kind: 'chart-not-found'; chartId: string; message: string }
  | { kind: 'chart-access-denied'; chartId: string; message: string }
  | {
      kind: 'chart-load-failed';
      chartId: string;
      failure: DependencyFailure;
      message: string;
    };

export type PlotToolPersistenceAnchorResult =
  | { ok: true; value: Readonly<{ relativeDate?: string }> }
  | { ok: false; error: PlotToolPersistenceAnchorError };

export interface PlotToolPersistenceAnchorResolver {
  resolveConfiguration(chartId: string): Promise<PlotToolPersistenceAnchorResult>;
}

const WIDGET_PERSISTENCE_ANCHOR_ERROR_KIND = {
  'chart-not-found': 'not-found',
  'chart-access-denied': 'access-denied',
  'chart-load-failed': 'dependency',
} as const satisfies Record<PlotToolPersistenceAnchorError['kind'], WidgetPersistenceAnchorError['kind']>;

export function widgetPersistenceAnchorResult(
  parameters: readonly unknown[],
  result: PlotToolPersistenceAnchorResult,
): WidgetPersistenceAnchorResult {
  if (!result.ok) {
    return { ok: false, error: widgetPersistenceAnchorFailure(result.error) };
  }
  return {
    ok: true,
    value: {
      parameters,
      ...(result.value.relativeDate ? { relativeDate: result.value.relativeDate } : {}),
    },
  };
}

function widgetPersistenceAnchorFailure(
  error: PlotToolPersistenceAnchorError,
): WidgetPersistenceAnchorError {
  if (error.kind === 'chart-load-failed') {
    return {
      kind: 'dependency',
      failure: error.failure,
      message: error.message,
    };
  }
  return {
    kind: WIDGET_PERSISTENCE_ANCHOR_ERROR_KIND[error.kind],
    message: error.message,
  };
}
