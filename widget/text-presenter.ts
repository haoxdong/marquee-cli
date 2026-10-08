// @format

import type { TextCell, TextTable } from '../presentation/text.js';
import {
  DATA_VIZ_FIGURE_TRACE_FACTS,
  type DataVizFigureAxis,
  type DataVizFigurePoint,
  type DataVizFigureProjection,
  type DataVizFigureSeries,
  type DataVizFigureTooltipField,
} from './data-viz/figure-types.js';
import type { DataVizTableProjection } from './data-viz/table-lane.js';
import {
  formatPlotToolSeriesPoint,
  requiredPlotToolSeriesAxis,
  plotToolRowKeys,
} from './plottool-presentation-helpers.js';
import type {
  PlotToolProjectedAxis,
  PlotToolProjectedSeries,
  PlotToolProjection,
} from './plottool/index.js';

export type WidgetTextProjection =
  | PlotToolProjection
  | DataVizFigureProjection
  | DataVizTableProjection;

/** A chart table before the widget view names it. */
type ChartTable = Pick<TextTable, 'headers' | 'rows'>;

type TextRows = TextTable['rows'];

/**
 * A chart as ADR 0070 tables: `Axes` and `Series` with only Web-visible
 * traits, the `Data` table, and the chart's empty-state message, if any; an
 * empty `Data` table keeps the header it knows (none when no series exists).
 */
export type WidgetChartText = Readonly<{
  axes?: ChartTable;
  series?: ChartTable;
  data: DataTable;
  message?: string;
}>;

/** A `Data` table; `dateOrdered` marks rows sorted oldest to newest. */
type DataTable = ChartTable & Readonly<{ dateOrdered?: true }>;

type PresentedTooltipField = DataVizFigureTooltipField & Readonly<{ label: string }>;

type FigureColumn = Readonly<{
  header: string;
  values: ReadonlyMap<string, string>;
}>;

type FigurePointRow = Readonly<{
  key: string;
  point: DataVizFigurePoint;
}>;

type FigureCoordinates = Readonly<{
  headers: readonly string[];
  keys: readonly string[];
  values: ReadonlyMap<string, readonly string[]>;
}>;

const AXES_HEADER = ['axis', 'label', 'format', 'min', 'max'] as const;
const PLOT_AXES_HEADER = ['axis', 'label', 'min', 'max'] as const;
const SERIES_HEADER = ['series', 'type', 'axis', 'color', 'line style'] as const;
const PLOT_PALETTE = ['#16B8C8', '#E48A2E', '#7B61C4', '#D9A514'] as const;
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

export class WidgetTextPresenterError extends Error {
  override readonly name = 'WidgetTextPresenterError';
  readonly problem = 'invalid-widget-text-projection' as const;

  constructor(readonly detail: string) {
    super(`Invalid Widget text projection: ${detail}`);
  }
}

export function presentWidgetChart(projection: WidgetTextProjection): WidgetChartText {
  if (projection.kind === 'plot') return presentPlotTool(projection);
  if (projection.kind === 'figure') return presentFigure(projection);
  return presentDataVizTable(projection);
}

function presentPlotTool(projection: PlotToolProjection): WidgetChartText {
  const keys = plotToolRowKeys(projection);
  return {
    axes: { headers: PLOT_AXES_HEADER, rows: projection.axes.flatMap(plotToolAxisRow) },
    series: {
      headers: SERIES_HEADER,
      rows: projection.series.map((series) => [
        series.legendLabel,
        projection.chartType,
        requiredPlotToolSeriesAxis(projection, series, invalidPresentation).axisId,
        plotToolSeriesColor(series),
        undefined,
      ]),
    },
    data: {
      ...(projection.isOrdinal ? {} : { dateOrdered: true }),
      headers: [
        projection.isOrdinal ? 'category' : 'date',
        ...projection.series.map(({ legendLabel }) => legendLabel),
      ],
      rows: keys.map((key) => [
        plotToolRowLabel(projection, key.rawKey),
        ...projection.series.map((series) => formatPlotToolSeriesPoint(projection, series, key, invalidPresentation)?.text),
      ]),
    },
  };
}

function plotToolRowLabel(projection: PlotToolProjection, rawKey: string): string {
  if (projection.isOrdinal || projection.chartType === 'bar') return rawKey;
  if (projection.chartType === 'scatter') return formatPlotToolScatterDate(rawKey);
  return formatPlotToolLineDate(rawKey, projection.timeZone);
}

function formatPlotToolLineDate(rawKey: string, timeZone: string | undefined): string {
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
  const zone = timeZone === undefined ? '' : ` ${plotToolTimeZoneName(date, timeZone)}`;
  return `${day} ${month} ${String(hour).padStart(2, '0')}:${minutes}${meridiem}${zone}`;
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

function plotToolTimeZoneName(date: Date, timeZone: string): string {
  return presentedValue(new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value);
}

function plotToolAxisRow(axis: PlotToolProjectedAxis): TextRows {
  const row = [axis.label || undefined, axis.minimum, axis.maximum];
  return row.every((cell) => cell === undefined) ? [] : [[axis.axisId, ...row]];
}

function plotToolSeriesColor(series: PlotToolProjectedSeries): string {
  if (series.color !== undefined) return series.color;
  if (series.paletteSlot === undefined) {
    return invalidPresentation(`PlotTool Pro series ${series.sourceIndex} has no color`);
  }
  return rotatingColor(PLOT_PALETTE, series.paletteSlot);
}

function presentFigure(projection: DataVizFigureProjection): WidgetChartText {
  // Web's legend lists legend-only series; only visible ones are plotted.
  const legend = projection.series.filter(({ visibility }) => visibility !== 'hidden');
  const visible = legend.filter(({ visibility }) => visibility === 'visible');
  return {
    axes: { headers: AXES_HEADER, rows: projection.axes.flatMap(figureAxisRow) },
    series: {
      headers: SERIES_HEADER,
      rows: legend.map((series) => [
        seriesLabel(series),
        series.traceType,
        Object.values(series.axes),
        figureSeriesColor(projection, series),
        series.style.line?.dash,
      ]),
    },
    data: visible.length > 0 ? figureTable(visible) : emptyFigureTable(projection.series),
  };
}

function figureAxisRow(axis: DataVizFigureAxis): TextRows {
  if (!axis.visible || axis.dimension === 'color') return [];
  const format = `${axis.tickPrefix ?? ''}${axis.tickFormat ?? ''}${axis.tickSuffix ?? ''}`;
  const row: readonly TextCell[] = [
    axis.title === undefined ? undefined : plainTooltipText(axis.title) || undefined,
    format || undefined,
    rangeBound(axis.range?.[0]),
    rangeBound(axis.range?.[1]),
  ];
  return row.every((cell) => cell === undefined) ? [] : [[axis.id, ...row]];
}

function rangeBound(value: unknown): TextCell {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function seriesLabel(series: DataVizFigureSeries): string {
  return plainTooltipText(series.identity);
}

function figureSeriesColor(
  projection: DataVizFigureProjection,
  series: DataVizFigureSeries,
): string | undefined {
  const color = series.style.color;
  if (typeof color === 'string') return color;
  const slot = series.style.paletteSlot;
  const colorWay = projection.chart.colorWay;
  if (color !== undefined || slot === undefined || colorWay.length === 0) return undefined;
  return rotatingColor(colorWay, slot);
}

function figureTable(series: readonly DataVizFigureSeries[]): DataTable {
  const first = presentedValue(series[0]);
  const coordinateSchemas = unique(series.map((entry) => (
    figureCoordinatePaths(entry).join('\u0000')
  )));
  const coordinatePaths = figureCoordinatePaths(first);
  if (
    coordinateSchemas.length > 1
    || !formattedCoordinatesAlign(series, coordinatePaths)
    || hasCoordinateTooltipFields(series, coordinatePaths)
  ) return longFigureTable(series);
  const coordinates = figureCoordinates(first, series);
  const columns = series.flatMap((entry) => figureSeriesColumns(entry, coordinates.keys));
  return {
    ...(coordinates.headers.includes('date') ? { dateOrdered: true } : {}),
    headers: [...coordinates.headers, ...columns.map(({ header }) => header)],
    rows: coordinates.keys.map((key) => [
      ...(coordinates.values.get(key) ?? []),
      ...columns.map(({ values }) => values.get(key)),
    ]),
  };
}

/** No visible series: the key header of the chart's first series, with no rows. */
function emptyFigureTable(series: readonly DataVizFigureSeries[]): ChartTable {
  const first = series.find(({ visibility }) => visibility !== 'hidden') ?? series[0];
  return { headers: first === undefined ? [] : figureCoordinates(first, [first]).headers, rows: [] };
}

function figureCoordinates(
  first: DataVizFigureSeries,
  series: readonly DataVizFigureSeries[],
): FigureCoordinates {
  const paths = figureCoordinatePaths(first);
  const values = new Map<string, readonly string[]>();
  const times = new Map<string, number | undefined>();
  const keys: string[] = [];
  for (const entry of series) {
    for (const { key, point } of figurePointRows(entry, paths)) {
      const cells = paths.map((path) => figurePointText(point, path));
      if (!values.has(key)) {
        keys.push(key);
        values.set(key, cells.length === 0 ? [String(point.index + 1)] : cells);
        times.set(key, figurePointDate(point));
      }
    }
  }
  const dated = [...times.values()].every((time) => time !== undefined);
  const headers = paths.length === 0
    ? ['point']
    : paths.map((path) => figureCoordinateHeader(first, path, dated));
  // A `date` column holds only dates the projection read, so their times sort the rows.
  if (headers.includes('date')) keys.sort((left, right) => (
    presentedValue(times.get(left)) - presentedValue(times.get(right))
  ));
  return { headers, keys, values };
}

function figureCoordinateHeader(series: DataVizFigureSeries, path: string, dated: boolean): string {
  if (path === 'label') return 'category';
  if (path === 'theta') return 'angle';
  if (path === DATA_VIZ_FIGURE_TRACE_FACTS[series.traceType].horizontalCategory) {
    return 'category';
  }
  if (path !== 'x') return path;
  return dated ? 'date' : 'category';
}

function figureSeriesColumns(
  series: DataVizFigureSeries,
  rowKeys: readonly string[],
): readonly FigureColumn[] {
  const coordinatePaths = figureCoordinatePaths(series);
  const tooltipFields = seriesTooltipFields(series);
  const tooltipPaths = excludedFigurePaths(series, tooltipFields);
  const paths = unique(series.points.flatMap(({ fields }) => fields.map(({ path }) => path)))
    .filter((path) => !coordinatePaths.includes(path) && !tooltipPaths.has(path));
  const fields = paths.flatMap((path) => {
    const values = figureColumnValues(series, coordinatePaths, rowKeys, (point) => (
      point.fields.find((candidate) => candidate.path === path)?.text
    ));
    return values.size === 0 ? [] : [{ label: figureFieldLabel(series, path), values }];
  });
  const tooltipColumns = tooltipFields.map((field) => {
    const valuesByPoint = new Map(series.points.map((point, pointIndex) => (
      [point, field.values[pointIndex]?.text] as const
    )));
    return {
      label: tooltipFields.filter(({ path }) => path === field.path).length > 1
        ? tooltipFieldKey(field.path, field.format)
        : field.label,
      values: figureColumnValues(
        series,
        coordinatePaths,
        rowKeys,
        (point) => valuesByPoint.get(point),
      ),
    };
  });
  const columns = [...fields, ...tooltipColumns];
  const label = seriesLabel(series);
  return columns.map(({ label: field, values }) => ({
    header: columns.length === 1 ? label : `${label}: ${field}`,
    values,
  }));
}

/** Tooltip fields as data columns: a constant repeats on every point. */
function seriesTooltipFields(series: DataVizFigureSeries): readonly PresentedTooltipField[] {
  const tooltip = series.tooltip;
  if (tooltip === undefined) return [];
  return [
    ...tooltip.constants.map((field) => ({
      ...field,
      values: series.points.map(() => presentedValue(field.values[0])),
    })),
    ...tooltip.pointFields,
  ].map((field) => {
    const token = tooltip.mainTemplate === undefined
      ? undefined : tooltipToken(tooltip.mainTemplate, field.path, field.format);
    const suffix = token !== undefined
      && tooltip.mainTemplate?.[token.index + token.text.length] === '%' ? '%' : '';
    return {
      ...field,
      label: figureFieldLabel(series, field.path, field.format),
      values: field.values.map((value) => ({ ...value, text: value.text + suffix })),
    };
  });
}

function excludedFigurePaths(
  series: DataVizFigureSeries,
  fields: readonly PresentedTooltipField[],
): ReadonlySet<string> {
  const paths = new Set(fields.map(({ path }) => path));
  if (!paths.has('text') && series.points.length > 0 && fields.some((field) => (
    /^customdata(?:\[|$)/.test(field.path) && series.points.every((point, index) => {
      const text = point.fields.find((candidate) => candidate.path === 'text');
      const value = field.values[index];
      return text !== undefined && text.text !== '' && value !== undefined
        && value.text !== '' && text.raw === value.raw;
    })
  ))) paths.add('text');
  return paths;
}

function figureColumnValues(
  series: DataVizFigureSeries,
  coordinatePaths: readonly string[],
  rowKeys: readonly string[],
  value: (point: DataVizFigurePoint) => string | undefined,
): ReadonlyMap<string, string> {
  const allowed = new Set(rowKeys);
  return new Map(figurePointRows(series, coordinatePaths).flatMap(({ key, point }) => {
    const text = value(point);
    return text === undefined || !allowed.has(key) ? [] : [[key, text] as const];
  }));
}

function longFigureTable(series: readonly DataVizFigureSeries[]): DataTable {
  const tooltipFields = series.flatMap((entry) => (
    seriesTooltipFields(entry).map((field) => ({
      key: tooltipFieldKey(field.path, field.format),
      label: field.label,
      path: field.path,
      field,
      entry,
    }))
  ));
  const tooltipGroups = unique(tooltipFields.map(({ key, label }) => `${key}\0${label}`)).map(
    (identity) => {
      const fields = tooltipFields.filter(({ key, label }) => `${key}\0${label}` === identity);
      return {
        ...presentedValue(fields[0]),
        members: new Map(fields.map(({ entry, field }) => [entry, field])),
      };
    },
  );
  const tooltipPathsBySeries = new Map(series.map((entry) => [
    entry,
    excludedFigurePaths(entry, seriesTooltipFields(entry)),
  ]));
  const tooltipPathCounts = new Map(tooltipGroups.map(({ path }) => [
    path,
    tooltipGroups.filter((field) => field.path === path).length,
  ]));
  const tooltipKeyCounts = new Map(tooltipGroups.map(({ key }) => [
    key,
    tooltipGroups.filter((field) => field.key === key).length,
  ]));
  const paths = unique(series.flatMap((entry) => entry.points.flatMap(({ fields }) => (
    fields.map(({ path }) => path).filter((path) => !tooltipPathsBySeries.get(entry)?.has(path))
  ))));
  // Rows keep provider order; they are date-ordered when their projected `x` dates never go back.
  const times = series.flatMap((entry) => entry.points.map(figurePointDate));
  const dateOrdered = times.every((time, index) => (
    time !== undefined && (index === 0 || presentedValue(times[index - 1]) <= time)
  ));
  return {
    ...(dateOrdered ? { dateOrdered: true } : {}),
    headers: [
      'series',
      ...paths,
      ...tooltipGroups.map((field) => (
        (tooltipKeyCounts.get(field.key) ?? 0) > 1
          ? `${unique([...field.members.keys()].map(seriesLabel)).join(', ')}: ${field.label}`
          : (tooltipPathCounts.get(field.path) ?? 0) > 1
            ? field.key
            : field.label
      )),
    ],
    rows: series.flatMap((entry) => entry.points.map((point, pointIndex) => [
      seriesLabel(entry),
      ...paths.map((path) => (
        tooltipPathsBySeries.get(entry)?.has(path)
          ? undefined
          : point.fields.find((field) => field.path === path)?.text
      )),
      ...tooltipGroups.map(({ members }) => members.get(entry)?.values[pointIndex]?.text),
    ])),
  };
}

function formattedCoordinatesAlign(
  series: readonly DataVizFigureSeries[],
  coordinatePaths: readonly string[],
): boolean {
  const expected = coordinateTextByKey(presentedValue(series[0]), coordinatePaths);
  return series.slice(1).every((entry) => {
    const candidate = coordinateTextByKey(entry, coordinatePaths);
    return expected.size === candidate.size && [...expected].every(([key, cells]) => (
      JSON.stringify(candidate.get(key)) === JSON.stringify(cells)
    ));
  });
}

function coordinateTextByKey(
  series: DataVizFigureSeries,
  coordinatePaths: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  return new Map(figurePointRows(series, coordinatePaths).map(({ key, point }) => [
    key,
    coordinatePaths.map((path) => figurePointText(point, path)),
  ]));
}

function hasCoordinateTooltipFields(
  series: readonly DataVizFigureSeries[],
  coordinatePaths: readonly string[],
): boolean {
  return series.some((entry) => coordinatePaths.some((path) => (
    (entry.tooltip?.pointFields.some((field) => field.path === path) ?? false)
  )));
}

function tooltipFieldKey(path: string, format: string | undefined): string {
  return format === undefined ? path : `${path}:${format}`;
}

function figureFieldLabel(series: DataVizFigureSeries, path: string, format?: string): string {
  const template = series.tooltip?.mainTemplate;
  if (template === undefined) return leafPath(path);
  const token = tooltipToken(template, path, format);
  if (token === undefined) return leafPath(path);
  const preceding = plainTooltipText(template.slice(0, token.index));
  const named = /([A-Za-z][A-Za-z0-9 _/()$-]*)\s*[=:]\s*$/.exec(preceding)?.[1]?.trim();
  if (named) return named;
  const prefix = /(?:^|\n)([A-Za-z][A-Za-z0-9 _/()$-]*)\s+$/.exec(preceding)?.[1]?.trim();
  if (prefix) return prefix;
  const following = plainTooltipText(template.slice(token.index + token.text.length))
    .replace(/^[ \t]*[@:,—-]?[ \t]*/, '')
    .split(/\s*(?:\n|%\{|[|;,()])/, 1)[0]
    ?.trim();
  return following || leafPath(path);
}

function tooltipToken(
  template: string,
  path: string,
  format?: string,
): Readonly<{ index: number; text: string }> | undefined {
  const expression = new RegExp(`%\\{${escapeRegExp(path)}(?:[:|]([^}]*))?\\}`, 'g');
  const matches = [...template.matchAll(expression)];
  const match = matches.find((candidate) => candidate[1] === format)
    ?? matches.find((candidate) => candidate[1] === undefined);
  return match?.index === undefined ? undefined : { index: match.index, text: match[0] };
}

function plainTooltipText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** The `x` date the figure projection read, as epoch milliseconds. */
function figurePointDate(point: DataVizFigurePoint): number | undefined {
  // Stryker disable next-line ConditionalExpression: only x and y carry dates, and a point with y always lists x first
  return point.fields.find((field) => field.path === 'x')?.date;
}

function figurePointText(point: DataVizFigurePoint, path: string): string {
  return point.fields.find((field) => field.path === path)?.text ?? '';
}

function figurePointRows(
  series: DataVizFigureSeries,
  coordinatePaths: readonly string[],
): readonly FigurePointRow[] {
  const occurrences = new Map<string, number>();
  return series.points.map((point) => {
    const base = coordinatePaths.length === 0
      ? 'point'
      : JSON.stringify(coordinatePaths.map((path) => (
          point.fields.find((field) => field.path === path)?.raw
        )));
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { key: `${base}\u0000${occurrence}`, point };
  });
}

function presentDataVizTable(projection: DataVizTableProjection): WidgetChartText {
  return {
    ...(projection.emptyMessage === undefined ? {} : { message: projection.emptyMessage }),
    data: {
      headers: projection.columns.map(({ text }) => text),
      rows: projection.rows.map(({ cells }) => (
        projection.columns.map(({ id }) => (
          cells.find(({ columnId }) => columnId === id)?.text
        ))
      )),
    },
  };
}

function rotatingColor(colors: readonly string[], slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || colors.length === 0) {
    return invalidPresentation(`palette slot ${slot} is invalid`);
  }
  return presentedValue(colors[(slot - 1) % colors.length]);
}

function leafPath(path: string): string {
  return path.split('.').at(-1)?.replace(/\[|\]/g, '') || path;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function invalidPresentation(detail: string): never {
  throw new WidgetTextPresenterError(detail);
}

function presentedValue<T>(value: T | undefined): T {
  // Stryker disable next-line StringLiteral: callers read values their own checks already found, so this never throws
  return value ?? invalidPresentation('a value the presentation already found is missing');
}

function figureCoordinatePaths(series: DataVizFigureSeries): readonly string[] {
  const facts = DATA_VIZ_FIGURE_TRACE_FACTS[series.traceType];
  return series.orientation === 'h' ? facts.horizontalCoordinates ?? facts.coordinates : facts.coordinates;
}
