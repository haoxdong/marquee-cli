// @format

import {
  formatPlotToolAxisNumber,
  formatPlotToolPointNumber,
  type FormattedPlotToolNumber,
} from './plottool/number-rules.js';

import type {
  PlotToolProjectedAxis,
  PlotToolProjectedSeries,
  PlotToolProjection,
  PlotToolProjectionPoint,
} from './plottool/index.js';

export type PlotToolRowKey = Readonly<{
  rawKey: string;
  occurrence: number;
}>;

/** Row keys across series; date-keyed rows sort by raw date, categories keep first appearance. */
export function plotToolRowKeys(projection: PlotToolProjection): readonly PlotToolRowKey[] {
  const identities = new Set<string>();
  const rows: PlotToolRowKey[] = [];
  for (const entry of projection.series) {
    const occurrences = new Map<string, number>();
    for (const { rawKey } of entry.points) {
      const occurrence = occurrences.get(rawKey) ?? 0;
      occurrences.set(rawKey, occurrence + 1);
      const identity = `${rawKey}\0${occurrence}`;
      if (identities.has(identity)) continue;
      identities.add(identity);
      rows.push({ rawKey, occurrence });
    }
  }
  if (projection.isOrdinal) return rows;
  return rows
    .map((row) => ({ row, time: dateKeyTime(row.rawKey) }))
    .sort((left, right) => left.time - right.time)
    .map(({ row }) => row);
}

/** Epoch milliseconds of a raw date key; an unreadable one fails loud rather than misplacing its row. */
export function dateKeyTime(value: unknown): number {
  const time = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : Number.NaN;
  if (Number.isNaN(time)) throw new Error(`unreadable date key ${JSON.stringify(value)}`);
  return time;
}

function findPlotToolSeriesAxis(
  projection: PlotToolProjection,
  series: PlotToolProjectedSeries,
): PlotToolProjectedAxis | undefined {
  return projection.chartType === 'scatter'
    ? projection.axes.find(({ dimension }) => (
        dimension === (series.sourceIndex % 2 === 0 ? 'x' : 'y')
      ))
    : projection.axes.find(({ axisId }) => axisId === series.axisId);
}

// Each series' points by raw key, indexed once, so a table's rows cost linear time.
const seriesPointsByKey = new WeakMap<PlotToolProjectedSeries, ReadonlyMap<string, readonly PlotToolProjectionPoint[]>>();

function findPlotToolSeriesPoint(
  series: PlotToolProjectedSeries,
  key: PlotToolRowKey,
): PlotToolProjectionPoint | undefined {
  let pointsByKey = seriesPointsByKey.get(series);
  if (pointsByKey === undefined) {
    const index = new Map<string, PlotToolProjectionPoint[]>();
    for (const point of series.points) {
      const points = index.get(point.rawKey);
      if (points === undefined) index.set(point.rawKey, [point]);
      else points.push(point);
    }
    pointsByKey = index;
    seriesPointsByKey.set(series, pointsByKey);
  }
  return pointsByKey.get(key.rawKey)?.[key.occurrence];
}

export function requiredPlotToolSeriesAxis(
  projection: PlotToolProjection,
  series: PlotToolProjectedSeries,
  fail: (detail: string) => never,
): PlotToolProjectedAxis {
  return findPlotToolSeriesAxis(projection, series)
    ?? fail(`PlotTool Pro series ${series.sourceIndex} has no elected axis`);
}

/** The same formatter supplies the numeric data channel and the text channel. */
export function formatPlotToolSeriesPoint(
  projection: PlotToolProjection,
  series: PlotToolProjectedSeries,
  key: PlotToolRowKey,
  fail: (detail: string) => never,
): FormattedPlotToolNumber | undefined {
  const point = findPlotToolSeriesPoint(series, key);
  if (point === undefined) return undefined;
  const axis = requiredPlotToolSeriesAxis(projection, series, fail);
  const formatted = projection.chartType === 'scatter'
    ? formatPlotToolAxisNumber(point.value, axis.numberRule)
    : formatPlotToolPointNumber(point.value, axis.numberRule);
  if (!formatted.ok) return fail(formatted.error.message);
  return formatted.value;
}
