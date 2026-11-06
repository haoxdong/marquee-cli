import type { Result } from '../lib/result.js';
import type { DependencyFailure } from '../transport/index.js';

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
  expression?: string | undefined;
  axisId: string;
  isOrdinal: boolean;
  points: readonly PlotToolProjectionPoint[];
  color?: string;
  paletteSlot?: number;
  /** The runner's summary of the series' Expression, when it gave one. */
  statistics?: PlotToolSeriesStatistics;
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

/** Expressions to evaluate in one runner call, over absolute dates at a runner interval. */
export type PlotToolEvaluationInput = Readonly<{
  expressions: readonly string[];
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`. */
  endDate: string;
  /** A runner interval such as `1D`, `1W` or `1M`. */
  interval: string;
}>;

export type PlotToolSeriesPoint = Readonly<{
  date: string;
  value: number;
}>;

/** A point on a curve keyed by a number, such as a smile's delta. */
export type PlotToolCurvePoint = Readonly<{
  point: number;
  value: number;
}>;

/** A value and every date it occurs on, oldest first. */
export type PlotToolDatedValue = Readonly<{
  value: number;
  dates: readonly string[];
}>;

/**
 * The runner's summary of a series (`statistics: true`). It covers the window's daily values
 * whatever the interval (live, 2026-10-22: SPX at `7D` and `1M` reports its daily low of
 * 2026-03-30, a date no weekly or monthly point falls on).
 */
export type PlotToolSeriesStatistics = Readonly<{
  low: PlotToolDatedValue;
  high: PlotToolDatedValue;
  first: PlotToolDatedValue;
  last: PlotToolDatedValue;
  median: number;
  average: number;
  /** None for a one-point series. */
  standardDeviation?: number;
  /** The last value's distance from the average in standard deviations; none for a constant or one-point series. */
  zScore?: number;
  percentile: number;
}>;

/** One Expression's outcome; an error never discards its siblings' results. */
export type PlotToolExpressionResult =
  | Readonly<{
      kind: 'series';
      expression: string;
      points: readonly PlotToolSeriesPoint[];
      /**
       * The runner has none for a model method's (live, 2026-10-22: `m.r_squared()` answers
       * `No statistics for non-series object.`).
       */
      statistics?: PlotToolSeriesStatistics;
    }>
  /**
   * A series with no points: an id with no data, a window too short and a Measure called with an
   * argument off its grid answer alike (live, 2026-10-28: `SPX.implied_volatility(13w, forward,
   * 100)`). It names the assets the Expression resolved and the ids of its other Entities, such
   * as the Country `US`.
   */
  | Readonly<{
      kind: 'empty-series';
      expression: string;
      assets: readonly PlotToolResolvedAsset[];
      entityIds: readonly string[];
    }>
  | Readonly<{ kind: 'curve'; expression: string; points: readonly PlotToolCurvePoint[] }>
  | Readonly<{ kind: 'value'; expression: string; value: string }>
  /** A model whose methods give series, such as `<LinearRegression object>`. */
  | Readonly<{ kind: 'object'; expression: string; value: string }>
  | Readonly<{
      kind: 'error';
      expression: string;
      message: string;
      status?: number;
      /** The assets the Expression resolved before it failed. */
      assets: readonly PlotToolResolvedAsset[];
    }>;

/** An asset an Expression named, as the runner resolved it. */
export type PlotToolResolvedAsset = Readonly<{
  /**
   * The name the runner resolved it under: the identifier as written, such as `AAPL UW`, when
   * its error names it, else the entity's name, such as `US Breakeven 10y` for `USGGBE10`.
   */
  identifier: string;
  /** The Marquee asset id (`MA…`). */
  assetId: string;
  name: string;
  assetClass: string;
  assetType: string;
}>;

/** What the runner says answered the batch. */
export type PlotToolProvenance = Readonly<{
  assetIds: readonly string[];
  datasets: readonly string[];
  tsdbSymbols: readonly string[];
}>;

export type PlotToolEvaluation = Readonly<{
  results: readonly PlotToolExpressionResult[];
  provenance: PlotToolProvenance;
}>;

/** The batch failed as a whole: no Expression has a result. */
export type PlotToolEvaluationError =
  | {
      kind: 'execution-failed';
      /** The runner's HTTP status, when it answered one. */
      status?: number;
      reason?: 'access-denied';
      authentication?: 'expired' | 'required';
      failure: DependencyFailure;
      /** Marquee's answer, on one line, when it sent a body. */
      message?: string;
      /** How long the runner was given, when it gave no answer in time. */
      timeoutMs?: number;
    }
  | { kind: 'malformed-results'; location: string; problem: string };

export interface PlotTool {
  /** Runs a Widget's Chart with the Widget's control and date inputs. */
  execute(input: Readonly<{
    widgetId: string;
    chartId: string;
    /** The Chart already read by `readPlotToolChart`, so execute does not read it again. */
    chart?: PlotToolChartRead;
    inputs: PlotToolInputs;
    now: Date;
  }>): Promise<Result<PlotToolResult, PlotToolError>>;
  /** Evaluates raw Expressions, returning each Expression's own result or error. */
  evaluate(input: PlotToolEvaluationInput): Promise<Result<PlotToolEvaluation, PlotToolEvaluationError>>;
}

export type PlotToolDateRangeProblem =
  | 'invalid-clock'
  | 'unsupported-window'
  | 'unsupported-interval'
  | 'invalid-time-settings';

export type PlotToolError =
  | { kind: 'chart-not-found'; chartId: string }
  | { kind: 'chart-access-denied'; chartId: string }
  | {
      kind: 'chart-load-failed';
      chartId: string;
      authentication?: 'expired' | 'required';
      failure: DependencyFailure;
    }
  | {
      kind: 'invalid-chart';
      chartId: string;
      problem: 'malformed-definition' | 'invalid-control' | 'invalid-expressions';
    }
  | {
      kind: 'invalid-date-range';
      chartId: string;
      problem: PlotToolDateRangeProblem;
    }
  | {
      kind: 'execution-failed';
      chartId: string;
      reason?: 'access-denied';
      authentication?: 'expired' | 'required';
      failure?: DependencyFailure;
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
