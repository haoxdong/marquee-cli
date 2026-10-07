// @format

import {
  formatPlotToolSeriesPoint,
  plotToolRowKeys,
  type PlotToolRowKey,
} from './plottool-presentation-helpers.js';
import type {
  PlotToolProjectedSeries,
  PlotToolProjection,
} from './plottool/index.js';
import type { WidgetPlotToolResult } from './types.js';

function seriesLabel(series: PlotToolProjectedSeries): string {
  return series.legendLabel;
}

function plotToolRow(
  projection: PlotToolProjection,
  series: readonly PlotToolProjectedSeries[],
  keyColumn: string,
  key: PlotToolRowKey,
): Readonly<Record<string, unknown>> {
  const row: Record<string, unknown> = { [keyColumn]: key.rawKey };
  for (const entry of series) {
    const label = seriesLabel(entry);
    const value = formatPlotToolSeriesPoint(projection, entry, key, invalidPresentation)?.value;
    if (!Object.hasOwn(row, label)) {
      row[label] = value;
      continue;
    }
    const existing = row[label];
    row[label] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return row;
}

function invalidPresentation(detail: string): never {
  throw new Error(detail);
}

export function projectWidgetPlotToolResult(projection: PlotToolProjection): WidgetPlotToolResult {
  const keyColumn = projection.isOrdinal ? 'category' : 'date';
  return {
    projection,
    rows: plotToolRowKeys(projection).map((key) => (
      plotToolRow(projection, projection.series, keyColumn, key)
    )),
  };
}
