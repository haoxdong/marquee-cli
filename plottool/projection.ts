import { resolvePlotToolAxisNumberRule } from './number-rules.js';
import type {
  PlotToolProjectedAxis,
  PlotToolProjectedSeries,
  PlotToolProjection,
  PlotToolProjectionChartType,
  PlotToolProjectionPoint,
  PlotToolSeriesPoint,
  PlotToolSeriesStatistics,
} from './types.js';

const DEFAULT_PLOT_AXIS_IDS = [
  'Right',
  'Right2',
  'Right3',
  'Left',
  'Left2',
  'Left3',
] as const;

export type PlotToolProjectionInput = Readonly<{
  definition: unknown;
  results: readonly unknown[];
  expressions: readonly string[];
  /** The runner's statistics, `statistics[i]` summarizing Expression i. */
  statistics?: readonly (PlotToolSeriesStatistics | undefined)[];
  resolveLabel?: (label: string) => string;
}>;

type ExpressionStyle = Readonly<{
  label?: string;
  axis?: string;
  color?: string;
  hidden: boolean;
}>;

type AxisSetting = Readonly<{
  id: string;
  label: string;
  labelFormat: string;
  labelFormatAuthored: boolean;
  decimalPrecision?: number;
  minimum?: number;
  maximum?: number;
  hidden: boolean;
  inverted: boolean;
  showGridLines: boolean;
}>;

type SeriesCandidate = Readonly<{
  sourceIndex: number;
  nestedIndex?: number;
  style: ExpressionStyle | undefined;
  expression: string | undefined;
  axisId: string;
  ordinal: boolean;
  points: readonly PlotToolProjectionPoint[];
}>;

const DRAWABLE_RESULT_TYPES = new Set(['series', 'sortedSeries', 'frame']);

export class PlotToolProjectionError extends Error {
  override readonly name = 'PlotToolProjectionError';
  readonly problem = 'invalid-plot-projection-payload' as const;

  constructor(readonly detail: string) {
    super(`Invalid PlotTool Pro projection payload: ${detail}`);
  }
}

export class PlotToolCardinalityError extends Error {
  override readonly name = 'PlotToolCardinalityError';

  constructor(
    readonly expressionCount: number,
    readonly resultCount: number,
  ) {
    super(`PlotTool Pro returned ${resultCount} results for ${expressionCount} expressions`);
  }
}

export function projectPlotTool(input: PlotToolProjectionInput): PlotToolProjection {
  if (input.results.length !== input.expressions.length) {
    throw new PlotToolCardinalityError(input.expressions.length, input.results.length);
  }
  const definition = requiredRecord(input.definition, 'definition');
  const chartType = readChartType(definition.chartType);
  const styles = readExpressionStyles(definition.expressions);
  const candidates = buildCandidates(input.results, input.expressions, styles);
  const ordinal = candidates[0]?.ordinal ?? false;
  const series = projectSeriesList(
    candidates.filter((candidate) => candidate.ordinal === ordinal),
    input,
  );
  return {
    kind: 'plot',
    chartType,
    isOrdinal: ordinal,
    ...plotToolTimeZone(definition.timeSettings),
    series,
    axes: electAxes(chartType, definition, candidates),
  };
}

/** Evaluated series with no Chart, as PlotTool Web draws a new chart: a line each on the default axis. */
export function projectPlotToolEvaluation(
  series: readonly Readonly<{
    expression: string;
    points: readonly PlotToolSeriesPoint[];
    statistics?: PlotToolSeriesStatistics;
  }>[],
): PlotToolProjection {
  return projectPlotTool({
    definition: {},
    results: series.map(({ points }) => ({
      type: 'series',
      values: Object.fromEntries(points.map(({ date, value }) => [date, value])),
    })),
    expressions: series.map(({ expression }) => expression),
    statistics: series.map(({ statistics }) => statistics),
  });
}

function plotToolTimeZone(value: unknown): Readonly<{ timeZone?: string }> {
  if (value === undefined || value === null) return {};
  const settings = requiredRecord(value, 'definition.timeSettings');
  const timeZone = requiredString(settings.timezone, 'definition.timeSettings.timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    return invalidProjection(`definition.timeSettings.timezone ${timeZone} is unsupported`);
  }
  return { timeZone };
}

function projectSeriesList(
  candidates: readonly SeriesCandidate[],
  input: PlotToolProjectionInput,
): PlotToolProjectedSeries[] {
  const paletteSlots = new Map<number, number>();
  return candidates.map((candidate) => {
    const color = candidate.style?.color;
    if (color) return projectSeries(candidate, { color }, input);
    const paletteSlot = paletteSlots.get(candidate.sourceIndex) ?? paletteSlots.size + 1;
    paletteSlots.set(candidate.sourceIndex, paletteSlot);
    return projectSeries(candidate, { paletteSlot }, input);
  });
}

function buildCandidates(
  results: readonly unknown[],
  expressions: readonly string[],
  styles: readonly ExpressionStyle[],
): SeriesCandidate[] {
  return results.flatMap((rawResult, sourceIndex) => {
    const result = requiredRecord(rawResult, `results[${sourceIndex}]`);
    const style = styles[sourceIndex];
    const resultType = result.type ?? 'series';
    if (
      style?.hidden === true
      || !(typeof resultType === 'string' && DRAWABLE_RESULT_TYPES.has(resultType))
    ) return [];
    const pointSets = readPointSets(result, sourceIndex);
    return pointSets.map((points, nestedIndex) => ({
      sourceIndex,
      ...(pointSets.length > 1 ? { nestedIndex } : {}),
      style,
      expression: expressions[sourceIndex],
      axisId: style?.axis || 'Right',
      ordinal: isOrdinal(points),
      points,
    }));
  });
}

function readPointSets(
  result: Readonly<Record<string, unknown>>,
  sourceIndex: number,
): readonly (readonly PlotToolProjectionPoint[])[] {
  if (result.values === undefined || result.values === null) return [];
  if (result.type === 'sortedSeries') {
    if (!Array.isArray(result.values)) {
      invalidProjection(`results[${sourceIndex}].values is not an array`);
    }
    if (result.values.length === 0) return [];
    return [result.values.map((entry, pointIndex) => (
      sortedSeriesPoint(
        entry,
        sourceIndex,
        pointIndex,
        result.result_type === 'term_structure',
      )
    ))];
  }
  const values = requiredRecord(result.values, `results[${sourceIndex}].values`);
  const entries = Object.entries(values).sort(([left], [right]) => compareKeys(left, right));
  const [firstEntry] = entries;
  if (firstEntry === undefined) return [];
  const [, firstValue] = firstEntry;
  return Array.isArray(firstValue)
    ? nestedPointSets(entries, firstValue.length, sourceIndex)
    : [entries.map(([key, value]) => mapPoint(key, value, sourceIndex))];
}

function nestedPointSets(
  entries: readonly [string, unknown][],
  width: number,
  sourceIndex: number,
): readonly (readonly PlotToolProjectionPoint[])[] {
  const rows = entries.map(([key, value]) => {
    if (!Array.isArray(value) || value.length !== width) {
      invalidProjection(`results[${sourceIndex}].values has ragged nested series`);
    }
    return [key, value] as const;
  });
  return Array.from({ length: width }, (_, nestedIndex) => rows.map(([key, values]) => (
    mapPoint(key, values[nestedIndex], sourceIndex)
  )));
}

function sortedSeriesPoint(
  value: unknown,
  sourceIndex: number,
  pointIndex: number,
  allowNumericKey: boolean,
): PlotToolProjectionPoint {
  if (!Array.isArray(value) || value.length !== 2) {
    return invalidProjection(
      `results[${sourceIndex}].values[${pointIndex}] is not a key/value pair`,
    );
  }
  const [key, pointValue] = value;
  const numericKey = allowNumericKey && typeof key === 'number' && Number.isFinite(key);
  return mapPoint(numericKey ? String(key) : key, pointValue, sourceIndex);
}

function mapPoint(key: unknown, value: unknown, sourceIndex: number): PlotToolProjectionPoint {
  if (typeof key !== 'string') {
    return invalidProjection(`results[${sourceIndex}] contains a non-string point key`);
  }
  if (typeof value !== 'number') {
    return invalidProjection(`results[${sourceIndex}] value for ${key} is not a number`);
  }
  if (!isPlotToolDateKey(key) && !Number.isFinite(Number(key))) {
    return invalidProjection(`ordinal point key ${key} is not numeric`);
  }
  return { rawKey: key, value };
}

function isPlotToolDateKey(key: string): boolean {
  if (!key.includes('Z') && !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return Number.isFinite(Date.parse(key));
}

function isOrdinal(points: readonly PlotToolProjectionPoint[]): boolean {
  const [first] = points;
  return first !== undefined && !isPlotToolDateKey(first.rawKey);
}

function projectSeries(
  candidate: SeriesCandidate,
  paint: Readonly<{ color: string } | { paletteSlot: number }>,
  input: PlotToolProjectionInput,
): PlotToolProjectedSeries {
  const label = resolveSeriesLabel(candidate, input.resolveLabel);
  const statistics = input.statistics?.[candidate.sourceIndex];
  return {
    sourceIndex: candidate.sourceIndex,
    ...(candidate.nestedIndex !== undefined ? { nestedIndex: candidate.nestedIndex } : {}),
    label,
    legendLabel: label || 'Untitled',
    expression: candidate.expression,
    axisId: candidate.axisId,
    isOrdinal: candidate.ordinal,
    points: candidate.points,
    ...paint,
    ...(statistics === undefined ? {} : { statistics }),
  };
}

function resolveSeriesLabel(
  candidate: SeriesCandidate,
  resolveLabel: ((label: string) => string) | undefined,
): string {
  const generated = candidate.style?.label || fallbackSeriesLabel(
    candidate.expression,
    candidate.sourceIndex,
  );
  return resolveLabel?.(generated) ?? generated;
}

function fallbackSeriesLabel(expression: string | undefined, index: number): string {
  if (expression === undefined) return `series-${index}`;
  const authored = /#\s*@label\(([^)]*)\)/.exec(expression)?.[1];
  if (authored !== undefined) return authored;
  const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(expression)?.[1];
  if (assignment !== undefined) return assignment;
  return sanitiseSeriesLabel(expression);
}

function sanitiseSeriesLabel(expression: string): string {
  return expression
    .replace(/[^0-9A-Za-z.,_() ]/g, '')
    .replace(/[.,_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)([A-Za-z])/g, (_match, prefix: string, letter: string) => (
      `${prefix}${letter.toUpperCase()}`
    ));
}

function electAxes(
  chartType: PlotToolProjectionChartType,
  definition: Readonly<Record<string, unknown>>,
  candidates: readonly SeriesCandidate[],
): PlotToolProjectedAxis[] {
  const settings = axisSettings(chartType, definition);
  if (chartType === 'scatter') {
    const ySetting = settings[3];
    const { x, y } = scatterDomains(candidates);
    if (!ySetting || !x || !y) return [];
    return [
      projectAxis(readScatterXAxisSetting(definition), x, chartType, 'x'),
      projectAxis(ySetting, y, chartType, 'y'),
    ];
  }
  const domains = candidateDomains(candidates);
  return settings.flatMap((setting) => {
    const domain = domains.get(setting.id);
    return domain ? [projectAxis(setting, domain, chartType, 'y')] : [];
  });
}

function scatterDomains(
  candidates: readonly SeriesCandidate[],
): Readonly<{
  x: readonly [number, number] | undefined;
  y: readonly [number, number] | undefined;
}> {
  const xValues: number[] = [];
  const yValues: number[] = [];
  for (const candidate of candidates) {
    const values = candidate.sourceIndex % 2 === 0 ? xValues : yValues;
    values.push(...candidate.points.map(({ value }) => value));
  }
  return { x: domainOf(xValues), y: domainOf(yValues) };
}

function axisSettings(
  chartType: PlotToolProjectionChartType,
  definition: Readonly<Record<string, unknown>>,
): AxisSetting[] {
  if (chartType === 'bar') {
    return readAxisSettings(definition.yAxesSettingsBar ?? definition.yAxesSettings);
  }
  if (chartType === 'scatter') {
    return readAxisSettings(definition.yAxesSettingsScatter ?? definition.yAxesSettings);
  }
  return readAxisSettings(definition.yAxesSettings);
}

function readScatterXAxisSetting(
  definition: Readonly<Record<string, unknown>>,
): AxisSetting {
  const value = definition.xAxisSettingsScatter
    ?? definition.xAxisSettings
    ?? {};
  const setting = requiredRecord(value, 'scatter x axis settings');
  return {
    id: 'x',
    label: optionalString(setting.label, 'scatter x axis settings.label') ?? '',
    labelFormat: optionalString(
      setting.labelFormat,
      'scatter x axis settings.labelFormat',
    ) ?? 'auto',
    labelFormatAuthored: Object.hasOwn(setting, 'labelFormat'),
    ...optionalAxisNumber(
      setting.decimalPrecision,
      'scatter x axis settings.decimalPrecision',
      'decimalPrecision',
    ),
    hidden: false,
    inverted: false,
    showGridLines: optionalBoolean(
      setting.showGridLines,
      'scatter x axis settings.showGridLines',
    ) ?? true,
  };
}

function readAxisSettings(value: unknown): AxisSetting[] {
  if (value === undefined || value === null) return defaultAxisSettings();
  if (!Array.isArray(value)) return invalidProjection('axis settings is not an array');
  return value.map((entry, index) => readAxisSetting(entry, index));
}

function readAxisSetting(value: unknown, index: number): AxisSetting {
  const setting = requiredRecord(value, `axis settings[${index}]`);
  const id = requiredString(setting.id, `axis settings[${index}].id`);
  return {
    id,
    label: optionalString(setting.label, `axis settings[${index}].label`) ?? '',
    labelFormat: optionalString(
      setting.labelFormat,
      `axis settings[${index}].labelFormat`,
    ) ?? 'auto',
    labelFormatAuthored: Object.hasOwn(setting, 'labelFormat'),
    ...optionalNumberProperty(setting, 'decimalPrecision', index, 'decimalPrecision'),
    ...optionalNumberProperty(setting, 'min', index, 'minimum'),
    ...optionalNumberProperty(setting, 'max', index, 'maximum'),
    hidden: optionalBoolean(setting.hide, `axis settings[${index}].hide`) ?? false,
    inverted: optionalBoolean(
      setting.invertAxis,
      `axis settings[${index}].invertAxis`,
    ) ?? false,
    showGridLines: optionalBoolean(
      setting.showGridLines,
      `axis settings[${index}].showGridLines`,
    ) ?? true,
  };
}

function defaultAxisSettings(): AxisSetting[] {
  return DEFAULT_PLOT_AXIS_IDS.map((id) => ({
    id,
    label: '',
    labelFormat: 'auto',
    labelFormatAuthored: false,
    hidden: false,
    inverted: false,
    showGridLines: true,
  }));
}

function candidateDomains(
  candidates: readonly SeriesCandidate[],
): ReadonlyMap<string, readonly [number, number]> {
  const values = new Map<string, number[]>();
  for (const candidate of candidates) {
    const axisValues = values.get(candidate.axisId) ?? [];
    axisValues.push(...candidate.points.map(({ value }) => value));
    values.set(candidate.axisId, axisValues);
  }
  return new Map([...values].flatMap(([axisId, points]) => {
    const domain = domainOf(points);
    return domain ? [[axisId, domain] as const] : [];
  }));
}

function domainOf(values: readonly number[]): readonly [number, number] | undefined {
  if (values.length === 0) return undefined;
  return [Math.min(...values), Math.max(...values)];
}

function projectAxis(
  setting: AxisSetting,
  dataDomain: readonly [number, number],
  chartType: PlotToolProjectionChartType,
  dimension: 'x' | 'y',
): PlotToolProjectedAxis {
  const hidden = chartType === 'line' && setting.hidden;
  const { decimalPrecision } = setting;
  const bounds = chartType === 'scatter' ? {} : axisBounds(setting);
  const numberRule = resolvePlotToolAxisNumberRule({
    labelFormat: setting.labelFormat,
    dataDomains: dataDomain,
    ...(chartType === 'scatter' ? {} : {
      ...(decimalPrecision !== undefined ? { decimalPrecision } : {}),
      isHidden: hidden,
      ...bounds,
    }),
  });
  if (!numberRule.ok) return invalidProjection(numberRule.error.message);
  return {
    axisId: setting.id,
    dimension,
    ...(chartType === 'scatter'
      ? {}
      : { side: setting.id.startsWith('Right') ? 'right' as const : 'left' as const }),
    label: hidden ? '' : setting.label,
    labelFormat: setting.labelFormat,
    ...(setting.labelFormatAuthored ? { labelFormatAuthored: true as const } : {}),
    dataDomains: dataDomain,
    numberRule: numberRule.value,
    ...(decimalPrecision !== undefined ? { decimalPrecision } : {}),
    ...bounds,
    isHidden: hidden,
  };
}

function axisBounds({ minimum, maximum }: AxisSetting): Pick<AxisSetting, 'minimum' | 'maximum'> {
  return {
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
  };
}

function readChartType(value: unknown): PlotToolProjectionChartType {
  if (value === undefined || value === null) return 'line';
  if (value === 'line' || value === 'bar' || value === 'scatter') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return invalidProjection(`chartType ${text} is unsupported`);
}

function readExpressionStyles(value: unknown): ExpressionStyle[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return invalidProjection('definition.expressions is not an array');
  return value.map((entry, index) => {
    const style = requiredRecord(entry, `definition.expressions[${index}]`);
    return {
      ...optionalStyleString(style, 'label', index),
      ...optionalStyleString(style, 'axis', index),
      ...optionalStyleString(style, 'color', index),
      hidden: optionalBoolean(style.hide, `definition.expressions[${index}].hide`) ?? false,
    };
  });
}

function optionalStyleString(
  style: Readonly<Record<string, unknown>>,
  field: 'label' | 'axis' | 'color',
  index: number,
): Partial<Record<typeof field, string>> {
  const value = optionalString(style[field], `definition.expressions[${index}].${field}`);
  return value === undefined ? {} : { [field]: value };
}

function optionalNumberProperty(
  setting: Readonly<Record<string, unknown>>,
  field: 'decimalPrecision' | 'min' | 'max',
  index: number,
  outputField: 'decimalPrecision' | 'minimum' | 'maximum',
): Partial<Record<'decimalPrecision' | 'minimum' | 'maximum', number>> {
  const value = setting[field];
  if (value === undefined) return {};
  if (typeof value !== 'number') {
    return invalidProjection(`axis settings[${index}].${field} is not a number`);
  }
  return { [outputField]: value };
}

function optionalAxisNumber<Field extends 'decimalPrecision' | 'minimum' | 'maximum'>(
  value: unknown,
  label: string,
  outputField: Field,
): Partial<Record<Field, number>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'number') return invalidProjection(`${label} is not a number`);
  return { [outputField]: value } as Partial<Record<Field, number>>;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return invalidProjection(`${label} is not a string`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') return invalidProjection(`${label} is not a boolean`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalidProjection(`${label} is not a non-empty string`);
  }
  return value;
}

function requiredRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidProjection(`${label} is not a record`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function compareKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function invalidProjection(detail: string): never {
  throw new PlotToolProjectionError(detail);
}
