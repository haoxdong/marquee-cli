import { utcFormat } from 'd3-time-format';

import { createD3NumberFormatter } from './d3-format.js';
import type {
  DataVizFigurePoint,
  DataVizFigurePointField,
  DataVizFigureRawPoint,
  DataVizFigureTooltip,
  DataVizFigureTooltipField,
  DataVizFigureValue,
} from './figure-types.js';

type Trace = Readonly<Record<string, unknown>>;

type TooltipToken = Readonly<{
  source: string;
  path: string;
  format?: string;
  formatKind?: 'number' | 'date';
}>;

type TooltipParts = Readonly<{
  main: string;
  extra?: string;
}>;

type TooltipTemplate = string | readonly string[];

export type FigureTooltipFormat = Readonly<{
  format: string;
  kind: 'number' | 'date';
}>;

export type FigureTooltipDateContext = Readonly<{
  allowEpoch: boolean;
  inputCalendar?: string;
  outputCalendar?: string;
}>;

export type ProjectFigureTooltipResult = Readonly<{
  tooltip?: DataVizFigureTooltip;
  points: readonly DataVizFigurePoint[];
}>;

const PLACEHOLDER = /%\{([^{}]+)\}/g;
const EXTRA = /<extra>([\s\S]*?)<\/extra>/i;
const PLOTLY_DATE = /^\s*(?<year>-?\d{4}|\d{2})(?:-(?<month>\d{1,2})(?:-(?<day>\d{1,2})(?:[ Tt](?<hour>[01]?\d|2[0-3])(?::(?<minute>[0-5]\d)(?::(?<second>[0-5]\d(?:\.\d+)?))?(?:Z|z|[+-]\d{2}(?::?\d{2})?)?)?)?)?)?\s*$/m;

export function projectFigureTooltip(
  trace: Trace,
  rawPoints: readonly DataVizFigureRawPoint[],
  template: TooltipTemplate | undefined,
  defaultFormat: (path: string) => FigureTooltipFormat | undefined,
  dateContext: (path: string) => FigureTooltipDateContext,
): ProjectFigureTooltipResult {
  const pointParts = rawPoints.map((point) => {
    const pointTemplate = templateForPoint(template, point);
    return pointTemplate === undefined ? undefined : tooltipParts(pointTemplate);
  });
  const pointTokens = pointParts.map((parts) => parts === undefined
    ? []
    : uniqueTokens([...parseTokens(parts.main), ...parseTokens(parts.extra ?? '')]));
  const tokens = uniqueTokens(pointTokens.flat());
  const fields = tokens.map((token) => tooltipField(
    trace,
    rawPoints,
    token,
    pointTokens,
    defaultFormat(token.path),
    dateContext(token.path),
  ));
  const constants = fields.filter(({ values }) => valuesAreConstant(values));
  const pointFields = fields.filter(({ values }) => !valuesAreConstant(values));
  const points = rawPoints.map((point, index) => projectPoint(
    trace,
    point,
    pointTokens[index] ?? [],
    defaultFormat,
    dateContext,
  ));
  return {
    ...(template === undefined ? {} : { tooltip: tooltipDescriptor(
      template,
      pointParts,
      constants,
      pointFields,
    ) }),
    points,
  };
}

function tooltipDescriptor(
  template: TooltipTemplate,
  pointParts: readonly (TooltipParts | undefined)[],
  constants: readonly DataVizFigureTooltipField[],
  pointFields: readonly DataVizFigureTooltipField[],
): DataVizFigureTooltip {
  if (typeof template !== 'string') return { literalIdentity: '', constants, pointFields };
  const parts = pointParts[0] ?? tooltipParts(template);
  return {
    mainTemplate: parts.main,
    literalIdentity: literalIdentity(parts.main),
    constants,
    pointFields,
  };
}

function templateForPoint(
  template: TooltipTemplate | undefined,
  point: DataVizFigureRawPoint,
): string | undefined {
  if (template === undefined || typeof template === 'string') return template;
  const sourceIndices = point.sourceIndices ?? [point.index];
  return sourceIndices.map((index) => template[index]).find((value) => value !== undefined);
}

function projectPoint(
  trace: Trace,
  point: DataVizFigureRawPoint,
  tokens: readonly TooltipToken[],
  defaultFormat: (path: string) => FigureTooltipFormat | undefined,
  dateContext: (path: string) => FigureTooltipDateContext,
): DataVizFigurePoint {
  const tokenByPath = new Map(tokens.map((token) => [token.path, token]));
  const basePaths = Object.keys(point.values).filter((path) => (
    path !== 'customdata' && path !== 'meta'
  ));
  const varyingPaths = tokens
    .map(({ path }) => path)
    .filter((path) => !basePaths.includes(path));
  const paths = [...new Set([...basePaths, ...varyingPaths])];
  const fields = paths.map((path) => pointField(
    trace,
    point,
    path,
    tokenByPath.get(path),
    defaultFormat(path),
    dateContext(path),
  ));
  return {
    index: point.index,
    ...(point.row === undefined ? {} : { row: point.row }),
    ...(point.column === undefined ? {} : { column: point.column }),
    fields,
  };
}

function pointField(
  trace: Trace,
  point: DataVizFigureRawPoint,
  path: string,
  token: TooltipToken | undefined,
  fallbackFormat: FigureTooltipFormat | undefined,
  dateContext: FigureTooltipDateContext,
): DataVizFigurePointField {
  const display = token
    ? resolveToken(trace, point, token)
    : point.displayValues?.[path] ?? point.values[path];
  const raw = Object.hasOwn(point.values, path) ? point.values[path] : display;
  const resolvedFormat = explicitTokenFormat(token) ?? compatibleDefaultFormat(display, fallbackFormat);
  return {
    path,
    raw,
    text: formatValue(
      display,
      resolvedFormat?.format,
      resolvedFormat?.kind,
      path,
      templateDateContext(
        token,
        dateContext,
        Object.hasOwn(point.displayValues ?? {}, path),
      ),
    ),
    ...(resolvedFormat === undefined
      ? {}
      : { format: resolvedFormat.format, formatKind: resolvedFormat.kind }),
    ...(point.dates?.[path] === undefined ? {} : { date: point.dates[path] }),
  };
}

function tooltipField(
  trace: Trace,
  points: readonly DataVizFigureRawPoint[],
  token: TooltipToken,
  pointTokens: readonly (readonly TooltipToken[])[],
  fallbackFormat: FigureTooltipFormat | undefined,
  dateContext: FigureTooltipDateContext,
): DataVizFigureTooltipField {
  const key = tokenKey(token);
  const displayValues = points.map((point, index) => (
    pointTokens[index]?.some((candidate) => tokenKey(candidate) === key)
      ? resolveToken(trace, point, token)
      : undefined
  ));
  const rawValues = points.map((point, index) => (
    Object.hasOwn(point.values, token.path) ? point.values[token.path] : displayValues[index]
  ));
  const resolvedFormat = explicitTokenFormat(token) ?? (
    displayValues.every((raw) => formatAccepts(raw, fallbackFormat)) ? fallbackFormat : undefined
  );
  return {
    path: token.path,
    ...(resolvedFormat === undefined ? {} : { format: resolvedFormat.format }),
    values: rawValues.map((raw, index) => ({
      raw,
      text: formatValue(
        displayValues[index],
        resolvedFormat?.format,
        resolvedFormat?.kind,
        token.path,
        templateDateContext(
          token,
          dateContext,
          points.some((point) => Object.hasOwn(point.displayValues ?? {}, token.path)),
        ),
      ),
    })),
  };
}

function explicitTokenFormat(token: TooltipToken | undefined): FigureTooltipFormat | undefined {
  if (token?.format === undefined) return undefined;
  return { format: token.format, kind: token.formatKind ?? 'number' };
}

function compatibleDefaultFormat(
  raw: unknown,
  fallback: FigureTooltipFormat | undefined,
): FigureTooltipFormat | undefined {
  return formatAccepts(raw, fallback) ? fallback : undefined;
}

function formatAccepts(raw: unknown, format: FigureTooltipFormat | undefined): boolean {
  if (format === undefined) return false;
  if (raw === undefined || raw === null) return true;
  return format.kind === 'date'
    ? typeof raw === 'string' || (typeof raw === 'number' && Number.isFinite(raw))
    : typeof raw === 'number' && Number.isFinite(raw);
}

function tooltipParts(template: string): TooltipParts {
  const match = EXTRA.exec(template);
  if (!match) return { main: template };
  return {
    main: template.slice(0, match.index) + template.slice(match.index + match[0].length),
    extra: match[1] ?? '',
  };
}

function parseTokens(template: string): TooltipToken[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => parseToken(match[0], match[1] ?? ''));
}

function parseToken(source: string, expression: string): TooltipToken {
  const dateSeparator = expression.indexOf('|');
  if (dateSeparator >= 0) {
    return token(source, expression, dateSeparator, 'date');
  }
  const numberSeparator = expression.indexOf(':');
  return numberSeparator >= 0
    ? token(source, expression, numberSeparator, 'number')
    : { source, path: expression };
}

function token(
  source: string,
  expression: string,
  separator: number,
  formatKind: 'number' | 'date',
): TooltipToken {
  const path = expression.slice(0, separator);
  const format = expression.slice(separator + 1);
  if (!path || !format) throw new Error(`invalid tooltip placeholder ${source}`);
  return { source, path, format, formatKind };
}

function uniqueTokens(tokens: readonly TooltipToken[]): readonly TooltipToken[] {
  const byKey = new Map<string, TooltipToken>();
  for (const value of tokens) byKey.set(tokenKey(value), value);
  return [...byKey.values()];
}

function tokenKey(token: TooltipToken): string {
  return `${token.path}\u0000${token.format ?? ''}`;
}

function templateDateContext(
  token: TooltipToken | undefined,
  context: FigureTooltipDateContext,
  displayCalendarValue: boolean,
): FigureTooltipDateContext {
  if (token?.formatKind === 'date') return { allowEpoch: context.allowEpoch };
  return displayCalendarValue && context.outputCalendar !== undefined
    ? { ...context, inputCalendar: context.outputCalendar }
    : context;
}

function resolveToken(
  trace: Trace,
  point: DataVizFigureRawPoint,
  token: TooltipToken,
): unknown {
  if (Object.hasOwn(point.displayValues ?? {}, token.path) && token.formatKind !== 'number') {
    return point.displayValues?.[token.path];
  }
  if (Object.hasOwn(point.values, token.path)) return point.values[token.path];
  const path = parsePath(token.path);
  const [root, ...tail] = path;
  let value: unknown;
  if (root === 'fullData') {
    value = trace;
  } else if (root === 'meta' && tail.length > 0) {
    value = nestedValue(point.values.meta, tail);
    if (value === undefined) value = nestedValue(trace.meta, tail);
    return value;
  } else if (root !== undefined && Object.hasOwn(point.values, root)) {
    value = point.values[root];
  } else {
    value = root === undefined ? undefined : trace[root];
  }
  for (const key of tail) value = childValue(value, key);
  return value;
}

function nestedValue(value: unknown, path: readonly (string | number)[]): unknown {
  for (const key of path) value = childValue(value, key);
  return value;
}

function parsePath(path: string): readonly (string | number)[] {
  const tokens: (string | number)[] = [];
  const pattern = /(?:^|\.)([A-Za-z_$][\w$]*)|\[(\d+)\]|\["([^"]+)"\]|\['([^']+)'\]/g;
  let consumed = 0;
  for (const match of path.matchAll(pattern)) {
    if (match.index !== consumed) throw new Error(`unsupported tooltip path ${path}`);
    const value = match[1] ?? match[3] ?? match[4];
    tokens.push(value === undefined ? Number(match[2]) : value);
    consumed = match.index + match[0].length;
  }
  if (consumed !== path.length || tokens.length === 0) {
    throw new Error(`unsupported tooltip path ${path}`);
  }
  return tokens;
}

function childValue(value: unknown, key: string | number): unknown {
  if (typeof key === 'number') return Array.isArray(value) ? value[key] : undefined;
  return isRecord(value) ? value[key] : undefined;
}

function formatValue(
  value: unknown,
  format: string | undefined,
  kind: TooltipToken['formatKind'],
  path: string,
  dateContext: FigureTooltipDateContext,
): string {
  if (value === undefined) return '';
  if (value === null && coordinatePath(path)) return '';
  if (format === undefined) return unformattedValue(value);
  if (kind === 'date') return formatDate(value, format, dateContext);
  if (value === null) return createD3NumberFormatter(format)(0);
  // Plotly hands raw (non-coordinate) strings to d3-format, which coerces them:
  // customdata '(?)' renders NaN on Web.
  if (typeof value === 'string' && !coordinatePath(path)) return createD3NumberFormatter(format)(Number(value));
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`d3 numeric format ${format} received a non-finite number`);
  }
  return createD3NumberFormatter(format)(value);
}

function coordinatePath(path: string): boolean {
  return ['x', 'y', 'z', 'r', 'theta'].includes(path);
}

// Plotly's text renderer draws `<a ...>` markup as its link text.
function unformattedValue(value: unknown): string {
  return String(value).replace(/<a\s[^<>]*>|<\/a>/g, '');
}

function formatDate(
  value: unknown,
  format: string,
  context: FigureTooltipDateContext,
): string {
  const milliseconds = plotlyDateMilliseconds(
    value,
    context.allowEpoch,
    context.inputCalendar,
  ) ?? Number.NaN;
  const prepared = format
    .replace(/%\d?f/g, (directive) => fractionalSeconds(milliseconds, directive))
    .replaceAll('%h', Number.isFinite(milliseconds)
      ? new Date(milliseconds).getUTCMonth() < 6 ? '1' : '2'
      : '1');
  const date = new Date(Math.floor(milliseconds + 0.05));
  return utcFormat(prepared)(date);
}

function fractionalSeconds(milliseconds: number, directive: string): string {
  const digits = Math.min(Number(directive[1]) || 6, 6);
  return ((milliseconds / 1000 % 1) + 2)
    .toFixed(digits)
    .slice(2)
    .replace(/0+$/, '') || '0';
}

export function plotlyDateMilliseconds(
  value: unknown,
  allowEpoch: boolean,
  _calendar?: string,
): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number' && allowEpoch) {
    return Number.isFinite(new Date(value).valueOf()) ? value : undefined;
  }
  const groups = PLOTLY_DATE.exec(String(value))?.groups;
  if (groups?.year === undefined) return undefined;
  const yearText = groups.year;
  const yearFirst = new Date().getFullYear() - 70;
  const year = yearText.length === 2
    ? (Number(yearText) + 2000 - yearFirst) % 100 + yearFirst
    : Number(yearText);
  const month = Number(groups.month ?? 1) - 1;
  const day = Number(groups.day ?? 1);
  const hour = Number(groups.hour ?? 0);
  const minute = Number(groups.minute ?? 0);
  const second = Number(groups.second ?? 0);
  const date = new Date(Date.UTC(2000, month, day, hour, minute));
  date.setUTCFullYear(year);
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  return date.getTime() + second * 1000;
}

export function isPlotlyCalendar(value: unknown): value is string {
  return value === 'gregorian';
}

export function plotlyCalendarCoordinateText(
  milliseconds: number,
  _calendar: string | undefined,
): string {
  const millisecondTenths = Math.floor(mod(milliseconds + 0.05, 1) * 10);
  const rounded = Math.round(milliseconds - millisecondTenths / 10);
  const date = new Date(rounded);
  return includePlotlyTime(
    utcFormat('%Y-%m-%d')(date),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds() * 10 + millisecondTenths,
  );
}

function includePlotlyTime(
  date: string,
  hour: number,
  minute: number,
  second: number,
  millisecondTenths: number,
): string {
  if (!(hour || minute || second || millisecondTenths)) return date;
  const minutes = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (!(second || millisecondTenths)) return `${date} ${minutes}`;
  const seconds = `${date} ${minutes}:${String(second).padStart(2, '0')}`;
  if (!millisecondTenths) return seconds;
  return `${seconds}.${String(millisecondTenths).padStart(4, '0').replace(/0+$/, '')}`;
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function literalIdentity(template: string): string {
  return decodeHtml(template)
    .replace(PLACEHOLDER, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function valuesAreConstant(values: readonly DataVizFigureValue[]): boolean {
  if (values.length === 0) return false;
  const expected = JSON.stringify(values[0]?.raw);
  return values.every(({ raw }) => JSON.stringify(raw) === expected);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
