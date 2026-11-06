import type { Result } from '../lib/result.js';
import type { Transport } from '../transport/index.js';
import { ProductionPlotTool, semanticPlotToolError } from './adapters/production.js';
import { readPlotToolChartDefinition } from './adapters/marquee.js';
import { parsePlotToolWindow } from './window.js';
import { resolvePlotToolDateRange } from './date-range.js';
import type { PlotTool, PlotToolChartRead, PlotToolDateRangeOverride, PlotToolError, PlotToolWindowOverride } from './types.js';
export type {
  Chart,
  PlotToolChartRead,
  PlotToolControl,
  PlotToolDateRangeOverride,
  PlotToolProjectedSeries,
  PlotToolProjectedAxis,
  PlotToolProjection,
  PlotToolWindowOverride,
  PlotTool,
  PlotToolCurvePoint,
  PlotToolError,
  PlotToolEvaluationError,
  PlotToolProvenance,
  PlotToolResolvedAsset,
  PlotToolSeriesPoint,
  PlotToolSeriesStatistics,
} from './types.js';

export function createProductionPlotTool(transport: Pick<Transport, 'request'>): PlotTool {
  return new ProductionPlotTool(transport);
}

export function resolvePlotToolWindowDates(input: Readonly<{
  chartId: string;
  window: PlotToolWindowOverride;
  interval: string;
  now: Date;
}>): Result<PlotToolDateRangeOverride, PlotToolError> {
  const resolved = resolvePlotToolDateRange(input, input.now);
  return resolved.ok
    ? { ok: true, value: {
        startDate: resolved.value.start,
        endDate: resolved.value.end,
        interval: resolved.value.interval,
      } }
    : { ok: false, error: {
        kind: 'invalid-date-range',
        chartId: input.chartId,
        problem: resolved.error.problem,
      } };
}

/**
 * Reads a Chart ahead of execute to learn whether its window runs forward; hand the
 * read to `PlotTool.execute`, which then does not read the Chart again. A failed read is
 * classified as execute classifies its own failures, and anything else throws. A window
 * end this cannot parse is not forward here; execute parses it and fails loud.
 */
export async function readPlotToolChart(
  transport: Pick<Transport, 'request'>,
  options: Readonly<{ widgetId: string; chartId: string }>,
): Promise<Result<PlotToolChartRead, PlotToolError>> {
  let definition: unknown;
  try {
    definition = await readPlotToolChartDefinition(
      transport.request,
      options.widgetId,
      options.chartId,
    );
  } catch (error) {
    const problem = semanticPlotToolError(error, options.chartId);
    if (problem) return { ok: false, error: problem };
    throw error;
  }
  const end = typeof definition === 'object' && definition !== null
    && 'relativeEndDate' in definition && typeof definition.relativeEndDate === 'string'
    ? definition.relativeEndDate
    : undefined;
  const window = parsePlotToolWindow({ relativeEndDate: end });
  return {
    ok: true,
    value: {
      chartId: options.chartId,
      definition,
      isForward: window.ok && window.value.isForward,
    },
  };
}
