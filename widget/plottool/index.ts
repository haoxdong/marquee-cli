import type { Transport } from '../../transport/index.js';
import { ProductionPlotTool } from './adapters/production.js';
import { readPlotToolChartDefinition } from './adapters/marquee.js';
import { parsePlotToolWindow } from './window.js';
import type { PlotTool, PlotToolChartRead } from './types.js';
export type {
  Chart,
  PlotToolChartRead,
  PlotToolControl,
  PlotToolDateRangeOverride,
  PlotToolProjectionPoint,
  PlotToolProjectedSeries,
  PlotToolProjectedAxis,
  PlotToolProjection,
  PlotToolWindowOverride,
  PlotTool,
  PlotToolError,
} from './types.js';

export function createProductionPlotTool(
  transport: Pick<Transport, 'request'>,
  options: Readonly<{ widgetId: string; chart?: PlotToolChartRead }>,
): PlotTool {
  return new ProductionPlotTool(transport, options);
}

/**
 * Reads a Chart ahead of execute to learn whether its window runs forward; hand the
 * read to `createProductionPlotTool` so execute does not read the Chart again. A window
 * end this cannot parse is not forward here; execute parses it and fails loud.
 */
export async function readPlotToolChart(
  transport: Pick<Transport, 'request'>,
  options: Readonly<{ widgetId: string; chartId: string }>,
): Promise<PlotToolChartRead> {
  const definition = await readPlotToolChartDefinition(
    transport.request,
    options.widgetId,
    options.chartId,
  );
  const end = typeof definition === 'object' && definition !== null
    && 'relativeEndDate' in definition && typeof definition.relativeEndDate === 'string'
    ? definition.relativeEndDate
    : undefined;
  const window = parsePlotToolWindow({ relativeEndDate: end });
  return {
    chartId: options.chartId,
    definition,
    isForward: window.ok && window.value.isForward,
  };
}
