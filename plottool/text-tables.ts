// @format

import {
  formatPlotToolPointNumber,
  formatPlotToolStatistic,
  resolvePlotToolAxisNumberRule,
  type PlotToolStatisticFormat,
} from './number-rules.js';
import {
  formatPlotToolSeriesPoint,
  plotToolRowKeys,
  requiredPlotToolSeriesAxis,
} from './presentation-helpers.js';
import type {
  PlotToolProjectedAxis,
  PlotToolProjectedSeries,
  PlotToolProjection,
  PlotToolSeriesStatistics,
} from './types.js';

/** A table's header and its rows of formatted text; a missing value stays missing. */
export type PlotToolTextTable = Readonly<{
  headers: readonly string[];
  rows: readonly (readonly (string | undefined)[])[];
}>;

/** A Data table; `dateOrdered` marks rows sorted oldest to newest. */
export type PlotToolDataTable = PlotToolTextTable & Readonly<{ dateOrdered?: true }>;

type Fail = (detail: string) => never;

/**
 * A series' row label and column header: `widget view` gives the chart's legend label,
 * `data eval` the Expression as typed (maintainer decision, 2026-10-24).
 */
export type PlotToolSeriesLabel = (series: PlotToolProjectedSeries) => string;

const PLOT_DATE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const PLOT_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Data table: one row per date or category, one column per series, values as the chart prints them. */
export function plotToolDataTable(
  projection: PlotToolProjection,
  label: PlotToolSeriesLabel,
  fail: Fail,
): PlotToolDataTable {
  const keys = plotToolRowKeys(projection);
  return {
    ...(projection.isOrdinal ? {} : { dateOrdered: true }),
    headers: [projection.isOrdinal ? 'category' : 'date', ...projection.series.map(label)],
    rows: keys.map((key) => [
      plotToolRowLabel(projection, key.rawKey),
      ...projection.series.map((series) => formatPlotToolSeriesPoint(projection, series, key, fail)?.text),
    ]),
  };
}

type StatisticColumn = Readonly<{
  header: string;
  value: (statistics: PlotToolSeriesStatistics) => number | undefined;
  format?: PlotToolStatisticFormat;
  /** The value's latest date, printed in a column of its own after it. */
  date?: (statistics: PlotToolSeriesStatistics) => string | undefined;
}>;

// PlotTool Web's statistics grid: a column per runner statistic, in the runner's order, headed
// by its key with the first letter capitalized (live, 2026-10-24).
const STATISTIC_COLUMNS: readonly StatisticColumn[] = [
  { header: 'Low', value: ({ low }) => low.value, date: ({ low }) => low.dates.at(-1) },
  { header: 'High', value: ({ high }) => high.value, date: ({ high }) => high.dates.at(-1) },
  { header: 'First', value: ({ first }) => first.value, date: ({ first }) => first.dates.at(-1) },
  { header: 'Last', value: ({ last }) => last.value, date: ({ last }) => last.dates.at(-1) },
  { header: 'Median', value: ({ median }) => median },
  { header: 'Avg', value: ({ average }) => average },
  { header: 'StdDev', value: ({ standardDeviation }) => standardDeviation, format: 'standard-deviation' },
  { header: 'Zscore', value: ({ zScore }) => zScore, format: 'z-score' },
  { header: 'Percentile', value: ({ percentile }) => percentile, format: 'percentile' },
];

/**
 * PlotTool Web's statistics grid: a row per series the runner summarized. A statistic the
 * runner cannot compute prints empty. Unlike Web, the Low, High, First and Last are each
 * followed by a date column, the latest day it fell on, dated as the Data rows.
 */
export function plotToolStatisticsTable(
  projection: PlotToolProjection,
  label: PlotToolSeriesLabel,
  fail: Fail,
): PlotToolTextTable {
  return {
    headers: ['Expressions', ...STATISTIC_COLUMNS.flatMap(({ header, date }) => (date === undefined ? [header] : [header, `${header} date`]))],
    rows: projection.series.flatMap((series) => {
      const summary = series.statistics;
      if (summary === undefined) return [];
      const axis = requiredPlotToolSeriesAxis(projection, series, fail);
      const format = statisticFormatter(axis, summary, fail);
      return [[
        label(series),
        ...STATISTIC_COLUMNS.flatMap((column) => {
          const value = column.value(summary);
          const text = value === undefined ? undefined
            : column.format === undefined ? format(value) : formatPlotToolStatistic(value, column.format);
          if (column.date === undefined) return [text];
          const date = column.date(summary);
          return [text, date === undefined ? undefined : plotToolRowLabel(projection, date)];
        }),
      ]];
    }),
  };
}

// Web formats the other statistics as the axis's last value, its precision taken over the
// series' own low to high and its format `none` where the axis authors none.
function statisticFormatter(
  axis: PlotToolProjectedAxis,
  { low, high }: PlotToolSeriesStatistics,
  fail: Fail,
): (value: number) => string {
  const rule = resolvePlotToolAxisNumberRule({
    labelFormat: axis.labelFormatAuthored ? axis.labelFormat : 'none',
    ...(axis.decimalPrecision === undefined ? {} : { decimalPrecision: axis.decimalPrecision }),
    dataDomains: [low.value, high.value],
  });
  if (!rule.ok) return fail(rule.error.message);
  return (value) => {
    const formatted = formatPlotToolPointNumber(value, rule.value);
    return formatted.ok ? formatted.value.text : fail(formatted.error.message);
  };
}

function plotToolRowLabel(projection: PlotToolProjection, rawKey: string): string {
  if (projection.isOrdinal || projection.chartType === 'bar') return rawKey;
  if (projection.chartType === 'scatter') return formatPlotToolScatterDate(rawKey);
  return formatPlotToolLineDate(rawKey);
}

function formatPlotToolLineDate(rawKey: string): string {
  const dateOnly = PLOT_DATE_ONLY.exec(rawKey);
  if (dateOnly !== null) {
    return `${dateOnly[3]} ${PLOT_DATE_MONTHS[Number(dateOnly[2]) - 1]} ${dateOnly[1]}`;
  }

  const date = new Date(rawKey);
  const day = date.getDate();
  const month = PLOT_DATE_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
    return `${String(day).padStart(2, '0')} ${month} ${year}`;
  }

  const hours = date.getHours();
  const hour = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hours < 12 ? 'AM' : 'PM';
  return `${day} ${month} ${String(hour).padStart(2, '0')}:${minutes}${meridiem}`;
}

function formatPlotToolScatterDate(rawKey: string): string {
  if (PLOT_DATE_ONLY.test(rawKey)) return rawKey;
  const date = new Date(rawKey);
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
    return rawKey;
  }
  return [
    `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
  ].join(' ');
}
