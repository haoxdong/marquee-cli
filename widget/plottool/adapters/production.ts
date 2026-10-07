import { WidgetApi } from '../../../api/widget/index.js';
import { MarqueeError, type Transport } from '../../../transport/index.js';
import type {
  Chart,
  PlotToolChartRead,
  PlotToolDateRangeOverride,
  PlotToolError,
  PlotTool,
} from '../types.js';
import {
  PlotToolResultDecodeError,
  PlotToolResultItemError,
} from './results.js';
import {
  PlotToolLaneDecodeError,
  renderPlotToolLane,
} from './marquee.js';
import type { PlotToolDateRangeProblem } from '../date-range.js';
import {
  PlotToolCardinalityError,
  PlotToolProjectionError,
  projectPlotTool,
} from '../projection.js';
import { resolveTaggedLabel } from '../tags.js';

export class ProductionPlotTool implements PlotTool {
  constructor(
    private readonly transport: Pick<Transport, 'request'>,
    private readonly options: Readonly<{ widgetId: string; chart?: PlotToolChartRead }>,
  ) {}

  async execute(input: Parameters<PlotTool['execute']>[0]) {
    try {
      const chart = this.options.chart;
      const lane = await renderPlotToolLane(this.transport.request, {
        widgetId: this.options.widgetId,
        targetId: input.chartId,
        ...(chart?.chartId === input.chartId ? { definition: chart.definition } : {}),
        controls: input.inputs.controls.map((control) => ({
          id: control.field,
          ...(control.type !== undefined ? { type: control.type } : {}),
          value: control.value,
        })),
        ...plotToolDateInput(input.inputs.dateRangeOverride),
        now: input.now,
      });
      return {
        ok: true as const,
        value: {
          chart: semanticChart(input.chartId, lane),
          projection: projectPlotTool({
            definition: lane.definition,
            results: lane.results.results,
            expressions: lane.expressions.map(({ label }) => label),
            resolveLabel: (label) => resolveTaggedLabel(
              label,
              lane.displayControls,
              lane.entities,
              { surface: 'legend' },
            ),
          }),
        },
      };
    } catch (error) {
      const semantic = semanticPlotToolError(error, input.chartId);
      if (semantic) return { ok: false as const, error: semantic };
      throw error;
    }
  }
}

type PlotToolLaneValue = Awaited<ReturnType<typeof renderPlotToolLane>>;

function semanticChart(chartId: string, lane: PlotToolLaneValue): Chart {
  return {
    chartId,
    controls: lane.displayControls.map((control) => ({
      field: control.id,
      ...(control.type !== undefined ? { type: control.type } : {}),
      ...(control.value !== undefined ? { value: control.value } : {}),
      ...(control.values !== undefined ? { values: [...control.values] } : {}),
    })),
    window: lane.window,
  };
}

function plotToolDateInput(
  override: PlotToolDateRangeOverride | undefined,
): Readonly<{
  dateOverride?: Readonly<{ start: string; end: string }>;
  intervalOverride?: string;
}> {
  if (override === undefined) return {};
  return {
    dateOverride: { start: override.startDate, end: override.endDate },
    intervalOverride: override.interval,
  };
}

function semanticPlotToolError(error: unknown, chartId: string): PlotToolError | undefined {
  if (error instanceof PlotToolCardinalityError) {
    return {
      kind: 'cardinality-mismatch',
      chartId,
      expressionCount: error.expressionCount,
      resultCount: error.resultCount,
    };
  }
  if (error instanceof PlotToolResultItemError) {
    return {
      kind: 'execution-failed',
      chartId,
      ...(error.isAccessDenied ? { reason: 'access-denied' } : {}),
    };
  }
  if (error instanceof PlotToolProjectionError || error instanceof PlotToolResultDecodeError) {
    return { kind: 'malformed-series', chartId, problem: 'invalid-values' };
  }
  if (error instanceof RangeError && isPlotToolDateRangeProblem(error.cause)) {
    return { kind: 'invalid-date-range', chartId, problem: error.cause };
  }
  if (error instanceof PlotToolLaneDecodeError) {
    return { kind: 'invalid-chart', chartId, problem: 'malformed-definition' };
  }
  if (error instanceof MarqueeError) return providerPlotToolError(error, chartId);
  return undefined;
}

function isPlotToolDateRangeProblem(value: unknown): value is PlotToolDateRangeProblem {
  return value === 'invalid-clock'
    || value === 'unsupported-window'
    || value === 'unsupported-interval'
    || value === 'invalid-time-settings';
}

function providerPlotToolError(error: MarqueeError, chartId: string): PlotToolError {
  const isChartRequest = WidgetApi.isChart(error.details?.path);
  const status = error.details?.status;
  if (isChartRequest && status === 404) return { kind: 'chart-not-found', chartId };
  if (isChartRequest && status === 403) return { kind: 'chart-access-denied', chartId };
  const authentication = error.code === 'auth_expired'
    ? 'expired' as const
    : status === 401
      ? 'required' as const
      : undefined;
  if (isChartRequest) {
    return {
      kind: 'chart-load-failed',
      chartId,
      ...(authentication ? { authentication } : {}),
      failure: error.dependencyFailure(),
    };
  }
  return {
    kind: 'execution-failed',
    chartId,
    ...(status === 403 ? { reason: 'access-denied' as const } : {}),
    ...(authentication ? { authentication } : {}),
    failure: error.dependencyFailure(),
  };
}
