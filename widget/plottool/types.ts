type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type PlotToolWindowUnit = 'd' | 'm' | 'y';

type PlotToolWindowOffset = Readonly<{
  kind: 'offset';
  amount: number;
  unit: PlotToolWindowUnit;
}>;

export type PlotToolWindowStart = Readonly<{ token: string }> & (
  | Readonly<{ kind: 'max' | 'year-start' | 'prior-year-end' | 'today' }>
  | (PlotToolWindowOffset & Readonly<{ direction: 'back' | 'forward' }>)
);

export type PlotToolWindowEnd =
  | Readonly<{ kind: 'today' }>
  | PlotToolWindowOffset
  | Readonly<{ kind: 'offset'; amount: -1; unit: 'b' }>;

export type PlotToolWindow = Readonly<{
  start?: PlotToolWindowStart;
  end?: PlotToolWindowEnd;
  startDate?: string;
  isForward: boolean;
}>;

/** A `-p relativeDate` or saved Widget Config window: a start that ends today. */
export type PlotToolWindowOverride = PlotToolWindow & Readonly<{ start: PlotToolWindowStart }>;

export type Chart = Readonly<{
  chartId: string;
  controls: readonly Readonly<{
    field: string;
    type?: string;
    value?: unknown;
    values?: readonly unknown[];
  }>[];
  window: PlotToolWindow;
}>;

/** A Chart a caller read before execute (`readPlotToolChart`), handed back so execute reads it once. */
export type PlotToolChartRead = Readonly<{
  chartId: string;
  definition: unknown;
  isForward: boolean;
}>;

export type PlotToolControl = Readonly<{
  field: string;
  type?: string;
  value: unknown;
}>;

export type PlotToolDateRangeOverride = Readonly<{
  startDate: string;
  endDate: string;
  interval: string;
}>;

type PlotToolInputs = Readonly<{
  controls: readonly PlotToolControl[];
  dateRangeOverride?: PlotToolDateRangeOverride;
}>;

type PlotToolAxisNumberRule = Readonly<{
  labelFormat: string;
  decimals: number;
  precision: 'auto' | 'explicit';
  precisionDomains: readonly [number, number];
}>;

export type PlotToolProjectionChartType = 'line' | 'bar' | 'scatter';

export type PlotToolProjectionPoint = Readonly<{
  rawKey: string;
  value: number;
}>;

export type PlotToolProjectedSeries = Readonly<{
  sourceIndex: number;
  nestedIndex?: number;
  label: string;
  legendLabel: string;
  axisId: string;
  isOrdinal: boolean;
  points: readonly PlotToolProjectionPoint[];
  color?: string;
  paletteSlot?: number;
}>;

export type PlotToolProjectedAxis = Readonly<{
  axisId: string;
  dimension: 'x' | 'y';
  side?: 'left' | 'right';
  label: string;
  labelFormat: string;
  labelFormatAuthored?: true;
  dataDomains: readonly [number, number];
  numberRule: PlotToolAxisNumberRule;
  decimalPrecision?: number;
  minimum?: number;
  maximum?: number;
  isHidden: boolean;
  isInverted: boolean;
  hasGridLines: boolean;
}>;

export type PlotToolProjection = Readonly<{
  kind: 'plot';
  chartType: PlotToolProjectionChartType;
  isOrdinal: boolean;
  timeZone?: string;
  series: readonly PlotToolProjectedSeries[];
  axes: readonly PlotToolProjectedAxis[];
}>;

type PlotToolResult = Readonly<{
  chart: Chart;
  projection: PlotToolProjection;
}>;

export interface PlotTool {
  execute(input: Readonly<{
    chartId: string;
    inputs: PlotToolInputs;
    now: Date;
  }>): Promise<Result<PlotToolResult, PlotToolError>>;
}

type PlotToolDependencyFailure =
  | { kind: 'authentication-required'; realm: 'marquee' | 'research' }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'timeout' }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' };

export type PlotToolError =
  | { kind: 'chart-not-found'; chartId: string }
  | { kind: 'chart-access-denied'; chartId: string }
  | {
      kind: 'chart-load-failed';
      chartId: string;
      authentication?: 'expired' | 'required';
      failure: PlotToolDependencyFailure;
    }
  | {
      kind: 'invalid-chart';
      chartId: string;
      problem: 'malformed-definition' | 'invalid-control' | 'invalid-expressions';
    }
  | {
      kind: 'invalid-date-range';
      chartId: string;
      problem:
        | 'invalid-clock'
        | 'unsupported-window'
        | 'unsupported-interval'
        | 'invalid-time-settings';
    }
  | {
      kind: 'execution-failed';
      chartId: string;
      reason?: 'access-denied';
      authentication?: 'expired' | 'required';
      failure?: PlotToolDependencyFailure;
    }
  | {
      kind: 'malformed-series';
      chartId: string;
      problem: 'invalid-values' | 'empty-series' | 'missing-label';
    }
  | {
      kind: 'cardinality-mismatch';
      chartId: string;
      expressionCount: number;
      resultCount: number;
    };
