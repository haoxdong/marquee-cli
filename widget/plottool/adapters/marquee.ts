import { ControlGroupApi } from '../../../api/control-group/index.js';
import { EntityApi } from '../../../api/entity/index.js';
import { PlotToolApi } from '../../../api/plottool/index.js';
import { WidgetApi } from '../../../api/widget/index.js';
import type { Endpoint } from '../../../transport/index.js';
import {
  cardPayloadHeaders,
  payloadHeaders,
  runnerPostHeaders,
} from './headers.js';
import {
  resolvePlotToolDateRange,
  type PlotToolDateRangeChart,
} from '../date-range.js';
import type { PlotToolWindow, PlotToolWindowEnd, PlotToolWindowStart } from '../types.js';
import { parsePlotToolWindow } from '../window.js';
import {
  readPlotToolRunnerResponse,
  type PlotToolRunnerResponse,
} from './results.js';

type PlotToolRequestInit = Readonly<{
  headers?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string | number | readonly string[]>>;
  body?: unknown;
  isErrorBodyPreserved?: boolean;
}>;

// The lane's provider request, which carries the API Clients' Endpoints (ADR 0072).
type PlotToolProviderRequest = (
  endpoint: Endpoint,
  init?: PlotToolRequestInit,
) => Promise<unknown>;

export type PlotToolControlInput = Readonly<{
  id: string;
  type?: string;
  value: unknown;
}>;

export type PlotToolDefinitionControl = Readonly<{
  id: string;
  internalID?: string;
  type?: string;
  value?: unknown;
  values?: readonly unknown[];
}>;

export type PlotToolMergedControl = Readonly<{
  id: string;
  type: string;
  value: unknown;
}>;

type PlotToolDateRange = Readonly<{
  start: Date | string;
  end: Date | string;
  timeZone?: string;
}>;

export type PlotToolExpressionLine = Readonly<{
  runner: string;
  label: string;
}>;

export type PlotToolRunnerTriggerInput = Readonly<{
  controls: readonly PlotToolControlInput[];
  start?: PlotToolWindowStart | undefined;
  end?: PlotToolWindowEnd | undefined;
  dateOverride?: PlotToolDateRange | undefined;
  timeSettings?: unknown;
  inlineDefinition?: unknown;
}>;

export type PlotToolRunnerBodyInput = Readonly<{
  definition: unknown;
  expressions: readonly PlotToolExpressionLine[];
  controls: readonly PlotToolMergedControl[];
  dates?: PlotToolDateRange | undefined;
  dateOverride?: PlotToolDateRange | undefined;
  statistics?: boolean;
  now: Date;
}>;

export type PlotToolLaneInput = Readonly<{
  widgetId: string;
  targetId: string;
  controls: readonly PlotToolControlInput[];
  /** A Chart definition the caller already read, so the lane does not read it again. */
  definition?: unknown;
  dateOverride?: PlotToolDateRange;
  intervalOverride?: string;
  now: Date;
}>;

export type PlotToolLaneResult = Readonly<{
  definition: Readonly<Record<string, unknown>>;
  window: PlotToolWindow;
  results: PlotToolRunnerResponse;
  displayControls: readonly PlotToolDefinitionControl[];
  expressions: readonly PlotToolExpressionLine[];
  entities: Readonly<Record<string, readonly unknown[]>>;
}>;

type ResolvedPlotToolControls = Readonly<{
  controls: readonly PlotToolControlInput[];
  entities: Readonly<Record<string, readonly unknown[]>>;
}>;

const ENTITY_GET_LIMIT = 40;

export class PlotToolLaneDecodeError extends Error {
  /* c8 ignore next -- data-layer-ignore: plot-lane-error-name-assert */
  override readonly name = 'PlotToolLaneDecodeError';
}

export async function renderPlotToolLane(
  request: PlotToolProviderRequest,
  input: PlotToolLaneInput,
): Promise<PlotToolLaneResult> {
  const payloadRequest: PlotToolProviderRequest = (endpoint, init = {}) => request(endpoint, {
    ...init,
    headers: payloadHeaders({ ...init.headers }),
  });
  const cardRequest: PlotToolProviderRequest = (endpoint, init = {}) => request(endpoint, {
    ...init,
    headers: cardPayloadHeaders(input.widgetId, { ...init.headers }),
  });
  const resolved = await resolvePlotToolControls(payloadRequest, input.controls);
  const rawDefinition = input.definition
    ?? await readPlotToolChartDefinition(request, input.widgetId, input.targetId);
  const decodedDefinition = requiredRecord(rawDefinition, 'Chart definition');
  const definition = input.intervalOverride === undefined
    ? decodedDefinition
    : { ...decodedDefinition, interval: input.intervalOverride };
  const definitionControls = decodeDefinitionControls(definition.controls);
  const expressions = stripPlotToolExpressions(requiredString(
    definition.description,
    'Chart definition description',
  ));
  const controls = mergePlotToolWireControls(
    definitionControls,
    plotToolWireControlInputs(definitionControls, resolved.controls),
  );
  const window = parsePlotToolWindow({
    relativeStartDate: optionalString(definition.relativeStartDate, 'Chart relative start date'),
    relativeEndDate: optionalString(definition.relativeEndDate, 'Chart relative end date'),
    ...(typeof definition.startDate === 'string' ? { startDate: definition.startDate } : {}),
  });
  /* c8 ignore next -- data-layer-ignore: plot-lane-window-assert */
  if (!window.ok) throw new RangeError(window.reason, { cause: 'unsupported-window' });
  const dateWindow = input.dateOverride === undefined ? window.value : undefined;
  const usePost = shouldPostPlotToolRunner({
    controls: input.controls,
    start: dateWindow?.start,
    end: dateWindow?.end,
    dateOverride: input.dateOverride,
    timeSettings: definition.timeSettings,
  });
  const dates = resolvePlotToolLaneDates(definition, dateWindow, input.now);
  const rawResults = usePost
    ? await new PlotToolApi({
        request: (endpoint, init) => request(endpoint, {
          headers: runnerPostHeaders(input.widgetId, input.targetId),
          body: init?.body,
          // A runner failure names each expression's cause in a body often over 1 KB.
          isErrorBodyPreserved: true,
        }),
      }).runPlot(encodePlotToolRunnerBody({
        definition,
        expressions,
        controls,
        dates,
        dateOverride: input.dateOverride,
        now: input.now,
      }))
    : await new PlotToolApi({ request: cardRequest }).getPlotResults(input.targetId);
  const results = readPlotToolRunnerResponse(rawResults);
  return {
    definition,
    window: window.value,
    results,
    displayControls: mergePlotToolDisplayControls(definitionControls, resolved.controls),
    expressions,
    entities: resolved.entities,
  };
}

function plotToolWireControlInputs(
  definitionControls: readonly PlotToolDefinitionControl[],
  controls: readonly PlotToolControlInput[],
): PlotToolControlInput[] {
  const merged = new Map<string, PlotToolControlInput>();
  for (const definition of definitionControls) {
    if (definition.value === undefined) continue;
    merged.set(definition.id, {
      id: definition.id,
      ...(definition.type !== undefined ? { type: definition.type } : {}),
      value: definition.value,
    });
  }
  for (const control of controls) merged.set(control.id, control);
  return [...merged.values()];
}

/** Reads a Chart definition with Web's card headers. */
export function readPlotToolChartDefinition(
  request: PlotToolProviderRequest,
  widgetId: string,
  chartId: string,
): Promise<unknown> {
  return new WidgetApi({
    request: (endpoint) => request(endpoint, { headers: cardPayloadHeaders(widgetId) }),
  }).getChart(chartId);
}

function resolvePlotToolLaneDates(
  definition: Readonly<Record<string, unknown>>,
  window: PlotToolWindow | undefined,
  now: Date,
): PlotToolDateRange | undefined {
  if (!window || (window.start === undefined && window.end === undefined)) return undefined;
  const interval = requiredString(definition.interval, 'Chart interval');
  const timeSettings = optionalTimeSettings(definition.timeSettings);
  const chart: PlotToolDateRangeChart = {
    interval,
    window,
    ...(typeof definition.endDate === 'string' ? { endDate: definition.endDate } : {}),
    ...(typeof definition.realTime === 'boolean' ? { isRealTime: definition.realTime } : {}),
    ...(timeSettings !== undefined ? { timeSettings } : {}),
  };
  const resolved = resolvePlotToolDateRange(chart, now);
  /* c8 ignore next -- data-layer-ignore: plot-lane-date-resolution-assert */
  if (!resolved.ok) throw new RangeError(resolved.error.reason, { cause: resolved.error.problem });
  return {
    start: resolved.value.start,
    end: resolved.value.end,
    ...(resolved.value.kind === 'real-time'
      ? { timeZone: resolved.value.timeFilter.timeZone }
      : {}),
  };
}

export async function resolvePlotToolControls(
  request: PlotToolProviderRequest,
  controls: readonly PlotToolControlInput[],
): Promise<ResolvedPlotToolControls> {
  const groupIds = unique(controlValues(
    controls.filter((control) => control.type !== 'Enum'),
  ).filter((value) => value.startsWith('CG')));
  const groupMembers = groupIds.length === 0
    ? new Map<string, readonly string[]>()
    : decodeControlGroupMembers(
        await new ControlGroupApi({ request }).getConstituents({ groupIds, limit: 50 }),
        groupIds,
      );
  const expanded = controls.map((control) => ({
    ...control,
    value: replaceControlGroups(control.value, groupMembers),
  }));
  const lookups = entityLookups(expanded);
  if (lookups.size === 0) return { controls: expanded, entities: {} };

  decodeCountrySeed(await new EntityApi({ request }).getCountries());
  const entities: Record<string, readonly unknown[]> = {};
  for (const [type, ids] of lookups) {
    // eslint-disable-next-line no-await-in-loop -- stops at the first failure without sending the rest
    const response = await requestEntityBatch(request, type, ids);
    const key = entityResponseKey(type);
    const values = requiredArray(requiredRecord(response, 'PlotTool Pro entity response')[key], key);
    entities[key] = [...(entities[key] ?? []), ...values];
  }
  return { controls: expanded, entities };
}

export function mergePlotToolWireControls(
  definitionControls: readonly PlotToolDefinitionControl[],
  controls: readonly PlotToolControlInput[],
): PlotToolMergedControl[] {
  const byId = new Map(controls.map((control) => [control.id, control]));
  const merged: PlotToolMergedControl[] = [];
  for (const definition of definitionControls) {
    const control = byId.get(definition.id);
    if (!control || !control.value) continue;
    const type = control.type ?? inferControlType(control.value);
    merged.push({
      id: definition.id,
      type,
      value: type === 'Enum' ? coerceEnumValue(control.value) : control.value,
    });
  }
  return merged;
}

export function mergePlotToolDisplayControls(
  definitionControls: readonly PlotToolDefinitionControl[],
  controls: readonly PlotToolControlInput[],
): PlotToolDefinitionControl[] {
  const byId = new Map(controls.map((control) => [control.id, control]));
  return definitionControls.map((definition) => {
    const control = byId.get(definition.id);
    return control
      ? { ...definition, value: control.value }
      : { ...definition };
  });
}

export function stripPlotToolExpressions(description: string): PlotToolExpressionLine[] {
  const expressions: PlotToolExpressionLine[] = [];
  for (const line of description.split('\n')) {
    const runner = stripComment(line, false).trimEnd();
    if (runner.trim().length === 0) continue;
    expressions.push({
      runner,
      label: stripComment(line, true).trimEnd(),
    });
  }
  return expressions;
}

export function shouldPostPlotToolRunner(input: PlotToolRunnerTriggerInput): boolean {
  const timeSettings = optionalRecord(input.timeSettings, 'Chart time settings');
  const triggers = [
    input.controls.length > 0,
    input.start !== undefined,
    input.end !== undefined,
    input.dateOverride !== undefined,
    timeSettings?.relativeStart !== undefined,
    timeSettings?.relativeEnd !== undefined,
    input.inlineDefinition !== undefined,
  ];
  return triggers.includes(true);
}

export function encodePlotToolRunnerBody(
  input: PlotToolRunnerBodyInput,
): Readonly<Record<string, unknown>> {
  const definition = requiredRecord(input.definition, 'Chart definition');
  const intervalName = requiredString(definition.interval, 'Chart interval');
  const interval = encodePlotToolInterval(intervalName);
  const realTimeMode = isRealTimeInterval(intervalName);
  const body: Record<string, unknown> = {
    expressions: input.expressions.map(({ runner }) => runner),
    statistics: input.statistics ?? definition.showStatistics === true,
    realTime: definition.realTime === true,
    hints: [],
  };
  if (!realTimeMode) body.variables = {};
  if (interval !== undefined) body.interval = interval;
  if (input.controls.length > 0) body.controls = input.controls;
  addPlotToolDates(body, definition, input, realTimeMode);
  return body;
}

export function encodePlotToolInterval(interval: string): string | undefined {
  const named = new Map([
    ['Daily', '1D'],
    ['Weekly', '7D'],
    ['Monthly', '1M'],
    ['Quarterly', '3M'],
    ['Yearly', '1Y'],
  ]);
  const namedInterval = named.get(interval);
  if (namedInterval) return namedInterval;
  if (/^(?:1D|7D|1M|3M|1Y|\d+m|1h)$/.test(interval)) return interval;
  if (interval === 'Tick') return undefined;
  const minutes = /^(\d+) min$/.exec(interval)?.[1];
  if (minutes) return minutes === '60' ? '1h' : `${minutes}m`;
  /* c8 ignore start -- data-layer-ignore: plot-interval-shape-assert */
  return unsupportedPlotToolResponse(`Unsupported PlotTool Pro interval: ${interval}`);
}
/* c8 ignore stop */

function entityLookups(
  controls: readonly PlotToolControlInput[],
): Map<string, readonly string[]> {
  const byType = new Map<string, string[]>();
  for (const control of controls) {
    for (const value of valuesOf(control.value)) {
      const type = control.type ?? inferControlType(value);
      if (!isEntityControlType(type)) continue;
      const values = byType.get(type) ?? [];
      if (!values.includes(value)) values.push(value);
      byType.set(type, values);
    }
  }
  return byType;
}

function isEntityControlType(type: string): boolean {
  return type === 'Asset'
    || type === 'Country'
    || type === 'Portfolio'
    || type === 'Control_Group';
}

async function requestEntityBatch(
  request: PlotToolProviderRequest,
  type: string,
  ids: readonly string[],
): Promise<unknown> {
  const types = unique([type, 'Control_Group']);
  const entities = new EntityApi({ request });
  return ids.length > ENTITY_GET_LIMIT
    ? entities.postEntities({ entityIds: ids, types })
    : entities.getEntities({ entityIds: ids, type: types });
}

function decodeControlGroupMembers(
  response: unknown,
  groupIds: readonly string[],
): Map<string, readonly string[]> {
  const results = requiredArray(
    requiredRecord(response, 'Control Group response').results,
    'Control Group results',
  );
  const members = new Map(groupIds.map((groupId) => [groupId, [] as string[]]));
  for (const [index, rawItem] of results.entries()) {
    const item = requiredRecord(rawItem, `Control Group result ${index}`);
    appendControlGroupMember(members, item, groupIds, index);
  }
  return members;
}

function appendControlGroupMember(
  members: Map<string, string[]>,
  item: Readonly<Record<string, unknown>>,
  groupIds: readonly string[],
  index: number,
): void {
  const id = requiredString(
    typeof item.constituentType === 'string' ? item.constituentId : item.id,
    `Control Group result ${index} constituent id`,
  );
  const itemGroups = decodeControlGroupIds(item.controlGroups, groupIds, index);
  for (const groupId of itemGroups) {
    const groupMembers = members.get(groupId);
    if (groupMembers && !groupMembers.includes(id)) groupMembers.push(id);
  }
}

function decodeControlGroupIds(
  value: unknown,
  requestedGroupIds: readonly string[],
  index: number,
): readonly string[] {
  if (value === undefined && requestedGroupIds.length === 1) return requestedGroupIds;
  const groupIds = requiredArray(
    value,
    `Control Group result ${index} controlGroups`,
  );
  return groupIds.map((groupId, groupIndex) => requiredString(
    groupId,
    `Control Group result ${index} controlGroups[${groupIndex}]`,
  ));
}

function replaceControlGroups(
  value: unknown,
  groupMembers: ReadonlyMap<string, readonly string[]>,
): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const replaced = replaceControlGroups(item, groupMembers);
      return Array.isArray(replaced) ? replaced : [replaced];
    });
  }
  const members = typeof value === 'string' ? groupMembers.get(value) : undefined;
  return members ? [...members] : value;
}

function controlValues(controls: readonly PlotToolControlInput[]): string[] {
  return controls.flatMap((control) => valuesOf(control.value));
}

function valuesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valuesOf);
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function inferControlType(value: unknown): string {
  const first = valuesOf(value)[0] ?? String(value);
  if (first.startsWith('MA')) return 'Asset';
  if (first.startsWith('MP')) return 'Portfolio';
  return 'Enum';
}

function coerceEnumValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(coerceEnumValue);
  if (typeof value !== 'string' || value.trim().length === 0) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function stripComment(line: string, preserveLabel: boolean): string {
  const index = line.indexOf('#');
  if (index === -1) return line;
  const tail = line.slice(index);
  return preserveLabel && /^#\s*@label\(/.test(tail)
    ? line
    : line.slice(0, index);
}

function addPlotToolDates(
  body: Record<string, unknown>,
  definition: Readonly<Record<string, unknown>>,
  input: PlotToolRunnerBodyInput,
  realTime: boolean,
): void {
  const range = input.dateOverride ?? input.dates ?? definitionDateRange(definition, realTime);
  if (realTime) {
    addRealTimeDates(body, definition, range, input.now);
    return;
  }
  body.startDate = localDate(range.start);
  body.endDate = localDate(range.end);
}

function definitionDateRange(
  definition: Readonly<Record<string, unknown>>,
  realTime: boolean,
): PlotToolDateRange {
  const startField = realTime ? 'startTime' : 'startDate';
  const endField = realTime ? 'endTime' : 'endDate';
  const start = requiredString(definition[startField], `Chart ${startField}`);
  const end = requiredString(definition[endField], `Chart ${endField}`);
  return { start, end };
}

function addRealTimeDates(
  body: Record<string, unknown>,
  definition: Readonly<Record<string, unknown>>,
  range: PlotToolDateRange,
  now: Date,
): void {
  const timeSettings = requiredRecord(definition.timeSettings, 'Chart time settings');
  const start = dateValue(range.start, 'PlotTool Pro start time');
  const suppliedEnd = dateValue(range.end, 'PlotTool Pro end time');
  const timeZone = range.timeZone
    ?? requiredString(timeSettings.timezone, 'Chart time settings timezone');
  const end = Math.abs(suppliedEnd.getTime() - now.getTime()) <= 86_400_000
    ? now
    : suppliedEnd;
  const effectiveStart = sameMinute(start, suppliedEnd, timeZone)
    ? startOfDay(start, timeZone)
    : start;
  body.startTime = utcSeconds(effectiveStart);
  body.endTime = utcSeconds(end);
  body.timeFilter = {
    start: requiredString(timeSettings.start, 'Chart time settings start'),
    end: requiredString(timeSettings.end, 'Chart time settings end'),
    timeZone,
  };
}

function sameMinute(left: Date, right: Date, timeZone: string): boolean {
  return zonedParts(left, timeZone, true).join('-')
    === zonedParts(right, timeZone, true).join('-');
}

function startOfDay(date: Date, timeZone: string): Date {
  const [year, month, day] = zonedParts(date, timeZone, false);
  const localMillis = Date.UTC(year, month - 1, day);
  let utcMillis = localMillis;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = localMillis - timeZoneOffsetMillis(new Date(utcMillis), timeZone);
    if (next === utcMillis) break;
    utcMillis = next;
  }
  return new Date(utcMillis);
}

function zonedParts(date: Date, timeZone: string, includeTime: boolean): [number, number, number, ...number[]] {
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  };
  const parts = formatZonedParts(date, options, timeZone);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return [value('year'), value('month'), value('day'), ...(includeTime
    ? [value('hour'), value('minute')]
    : [])];
}

function timeZoneOffsetMillis(date: Date, timeZone: string): number {
  const value = formatZonedParts(date, {
    timeZone,
    timeZoneName: 'shortOffset',
  }, timeZone).find((part) => part.type === 'timeZoneName')?.value;
  const normalized = String(value).replace(/^GMT$/, 'GMT+0').replace(/^(GMT[+-]\d{1,2})$/, '$1:00');
  const match = /^GMT([+-])(\d{1,2}):(\d{2})$/.exec(normalized);
  /* c8 ignore start -- data-layer-ignore: plot-time-zone-offset-assert */
  // Stryker disable next-line StringLiteral: Intl's shortOffset is always GMT, GMT±h or GMT±h:mm, so this never throws
  if (!match) return unsupportedPlotToolResponse(`Unsupported PlotTool Pro time zone: ${timeZone}`);
  /* c8 ignore stop */
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -minutes : minutes) * 60_000;
}

function localDate(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = dateValue(value, 'PlotTool Pro date');
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function dateValue(value: Date | string, label: string): Date {
  const date = new Date(value);
  /* c8 ignore next -- data-layer-ignore: plot-date-shape-assert */
  if (Number.isNaN(date.getTime())) return unsupportedPlotToolResponse(`${label} is invalid`);
  return date;
}

function formatZonedParts(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormatPart[] {
  try {
    return new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  /* c8 ignore next -- data-layer-ignore: plot-time-zone-shape-assert */
  } catch {
    /* c8 ignore start -- data-layer-ignore: plot-time-zone-error-body */
    return unsupportedPlotToolResponse(`Unsupported PlotTool Pro time zone: ${timeZone}`);
  }
}
/* c8 ignore stop */

function utcSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isRealTimeInterval(interval: string): boolean {
  return interval === 'Tick' || /^\d+ min$/.test(interval);
}

function decodeDefinitionControls(value: unknown): PlotToolDefinitionControl[] {
  if (value === undefined || value === null) return [];
  const controls = requiredArray(value, 'Chart controls');
  return controls.flatMap((rawControl, index) => {
    const control = requiredRecord(rawControl, `Chart control ${index}`);
    if (control.id === '') return [];
    const id = requiredString(control.id, `Chart control ${index} id`);
    const type = control.controlType ?? control.type;
    const decodedType = optionalString(type, `Chart control ${index} type`);
    return [{
      id,
      ...(typeof control.internalID === 'string'
        ? { internalID: control.internalID }
        : {}),
      ...(decodedType !== undefined ? { type: decodedType } : {}),
      ...(control.value !== undefined ? { value: control.value } : {}),
      ...(Array.isArray(control.values) ? { values: control.values } : {}),
    }];
  });
}

function decodeCountrySeed(response: unknown): void {
  requiredArray(requiredRecord(response, 'Country seed response').results, 'Country seed results');
}

function entityResponseKey(type: string): string {
  const keys: Readonly<Record<string, string>> = {
    Asset: 'assets',
    Country: 'countries',
    Portfolio: 'portfolios',
    Control_Group: 'control_groups',
  };
  const key = keys[type];
  /* c8 ignore start -- data-layer-ignore: plot-entity-type-assert */
  // Stryker disable next-line StringLiteral: entity lookups hold only the four types keyed above, so this never throws
  if (!key) return unsupportedPlotToolResponse(`Unsupported PlotTool Pro entity type: ${type}`);
  /* c8 ignore stop */
  return key;
}

function optionalRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredRecord(value, label);
}

function requiredRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  /* c8 ignore start -- data-layer-ignore: plot-required-record-shape-assert */
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return unsupportedPlotToolResponse(`${label} is not a record`);
  }
  /* c8 ignore stop */
  return value as Readonly<Record<string, unknown>>;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  /* c8 ignore start -- data-layer-ignore: plot-required-array-shape-assert */
  if (!Array.isArray(value)) return unsupportedPlotToolResponse(`${label} is not an array`);
  /* c8 ignore stop */
  return value;
}

function requiredString(value: unknown, label: string): string {
  /* c8 ignore start -- data-layer-ignore: plot-required-string-shape-assert */
  if (typeof value !== 'string' || value.length === 0) {
    return unsupportedPlotToolResponse(`${label} is not a string`);
  }
  /* c8 ignore stop */
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  /* c8 ignore start -- data-layer-ignore: plot-optional-string-shape-assert */
  if (typeof value !== 'string') {
    return unsupportedPlotToolResponse(`${label} is not a string`);
  }
  /* c8 ignore stop */
  return value;
}

function optionalTimeSettings(value: unknown): PlotToolDateRangeChart['timeSettings'] {
  if (value === undefined || value === null) return undefined;
  const settings = requiredRecord(value, 'Chart time settings');
  return {
    start: requiredString(settings.start, 'Chart time settings start'),
    end: requiredString(settings.end, 'Chart time settings end'),
    timezone: requiredString(settings.timezone, 'Chart time settings timezone'),
  };
}

/* c8 ignore start -- data-layer-ignore: plot-unsupported-response-assert */
function unsupportedPlotToolResponse(reason: string): never {
  throw new PlotToolLaneDecodeError(
    `Unsupported PlotTool Pro response shape: ${reason}; record a Scenario before accepting this fallback.`,
  );
}
/* c8 ignore stop */

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
