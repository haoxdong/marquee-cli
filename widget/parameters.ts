import type { WidgetParameter } from './types.js';
import { unwrapSliderValue } from './slider.js';
import {
  isRelativeDateObject,
  relativeDateConcreteValue,
  relativeDateRule,
} from '../plottool/relative-date.js';
import type { Chart } from '../plottool/index.js';
import { plotToolWindowRelativeDate } from '../plottool/window.js';
import {
  assertWidgetPayloadShape,
  contextParamDefault,
  controlField,
  controlParamDefault,
  optionalWidgetPayloadArray,
  type WidgetPayload,
} from './payload.js';

export type MutableWidgetParameter = {
  -readonly [Key in keyof WidgetParameter]: WidgetParameter[Key];
};
import { paramTypeFromRecord } from './parameter-type.js';
import {
  toDisplayValue,
  toWidgetParameterDisplayValue,
} from './display-value.js';
import { expandControlGroupValues } from './control-group-values.js';
import { identityKind } from './input-resolution.js';
import type { EntityModule } from '../entity/index.js';
import { isRecord } from '../lib/json-value.js';

export interface BuildWidgetParamsInput {
  entity: Pick<
    EntityModule,
    | 'resolveDeduplicatedValues'
    | 'resolveDisplayKey'
    | 'resolveSelectedValues'
  >;
  widget: WidgetPayload;
  entityMap: Record<string, string>;
  cgMembers: Record<string, string[]>;
  chart: Partial<Chart>;
  isDV: boolean;
}

const DISPLAY_OPTION_LIMIT = 30;
const PRE_RESOLVE_OPTION_LIMIT = 50;
const LARGE_ASSET_OPTION_SUMMARY_THRESHOLD = 1500;
function responseArrayField(record: unknown, field: string, label: string): unknown[] {
  assertWidgetPayloadShape(isRecord(record), `${label} parent is not a record`);
  return optionalWidgetPayloadArray(record[field], label);
}

function recordArrayField(record: unknown, field: string, label: string): Record<string, unknown>[] {
  const entries = responseArrayField(record, field, label);
  assertWidgetPayloadShape(entries.every(isRecord), `${label} contains a non-record`);
  return entries;
}

function widgetControls(widget: WidgetPayload): Record<string, unknown>[] {
  return recordArrayField(widget.renderParams, 'controls', 'renderParams.controls');
}

function widgetParameters(widget: WidgetPayload): Record<string, unknown>[] {
  return recordArrayField(widget, 'parameters', 'parameters');
}

function contextOptions(widget: WidgetPayload): unknown[] {
  return responseArrayField(widget.contextParameter, 'options', 'contextParameter.options');
}

function widgetComponent(widget: WidgetPayload): Record<string, unknown> {
  const component: unknown = widget.renderParams?.component;
  if (component === undefined || component === null) return {};
  assertWidgetPayloadShape(isRecord(component), 'renderParams.component is not a record');
  return component;
}

function parameterField(param: Record<string, unknown>): string {
  /* c8 ignore start -- Recording-unreachable by construction for supported Widgets: parameter definitions carry non-empty string fields; malformed response shapes are pinned by the buildWidgetParams unit tests. */
  assertWidgetPayloadShape(
    typeof param.field === 'string' && param.field.length > 0,
    'parameter field is missing or not a string',
  );
  /* c8 ignore stop */
  return param.field;
}

function requiredControlField(control: Record<string, unknown>): string {
  const field = controlField(control);
  /* c8 ignore start -- Recording-unreachable by construction for supported Widgets: visible controls carry non-empty string fields; malformed response shapes are pinned by the buildWidgetParams unit tests. */
  assertWidgetPayloadShape(
    typeof field === 'string' && field.length > 0,
    'control field is missing',
  );
  /* c8 ignore stop */
  return field;
}

function definitionOptionValues(
  record: Record<string, unknown>,
  label: 'parameter' | 'control',
  field: 'options' | 'values',
): unknown[] {
  assertWidgetPayloadShape(!Object.prototype.hasOwnProperty.call(record, 'enums'), `${label} uses enums fallback`);
  assertWidgetPayloadShape(!Object.prototype.hasOwnProperty.call(record, 'allowedValues'), `${label} uses allowedValues fallback`);
  return responseArrayField(record, field, `${label}.${field}`);
}

function rawOptionValue(value: unknown): unknown {
  assertWidgetPayloadShape(!(isRecord(value) && 'rawValue' in value), 'Date option uses a rawValue wrapper');
  return value;
}

function uniqueWidgetOptionValues(
  entity: Pick<EntityModule, 'resolveDeduplicatedValues' | 'resolveDisplayKey'>,
  values: unknown[],
  entityMap: Record<string, string>,
  type: string,
): unknown[] {
  if (type !== 'Date') {
    return entity.resolveDeduplicatedValues(values, entityMap);
  }

  const seen = new Set<string>();
  const unique: unknown[] = [];
  for (const value of values) {
    const raw = rawOptionValue(value);
    const rule = relativeDateRule(raw);
    const concrete = relativeDateConcreteValue(raw);
    const key = rule && concrete !== undefined
      ? `${entity.resolveDisplayKey(value, entityMap)}\0${rule}\0${JSON.stringify(concrete)}`
      : entity.resolveDisplayKey(value, entityMap);
    assertWidgetPayloadShape(!seen.has(key), 'Date options contain a duplicate value');
    seen.add(key);
    unique.push(raw);
  }
  return unique;
}

function isAssetParamType(type: string): boolean {
  return type === 'Asset' || type === 'AssetList';
}

function contextParameterType(
  contextParameter: Record<string, unknown>,
  rawDefault: unknown,
  rawValues: unknown[],
): string {
  const type = paramTypeFromRecord(contextParameter, rawDefault, rawValues);
  const field = cleanText(contextParameter.field).toLowerCase();
  if (field === 'portfolio') {
    assertWidgetPayloadShape(
      !['Asset', 'Enum', 'String'].includes(type),
      'context parameter type requires repair',
    );
  }
  if (/^assets?\d*$/.test(field)) {
    assertWidgetPayloadShape(type !== 'Enum', 'context parameter type requires repair');
  }
  return type;
}

function toOptions(values: unknown[], entityMap: Record<string, string>) {
  return values.map((value) => ({
    label: toDisplayValue(value, entityMap),
    rawValue: value,
  }));
}

export function entityResolvedWidgetOptionValues(
  type: string,
  values: readonly unknown[],
): unknown[] {
  const controlGroups = values.filter((value) => identityKind(value) === 'control-group');
  if (isAssetParamType(type) && values.length > LARGE_ASSET_OPTION_SUMMARY_THRESHOLD && controlGroups.length === 0) {
    return [];
  }
  return [...new Set([...values.slice(0, PRE_RESOLVE_OPTION_LIMIT), ...controlGroups])];
}

function assertRelativeDateDefaultSupported(
  componentValue: unknown,
  candidate: unknown,
): void {
  if (!isRelativeDateObject(candidate)) return;
  const concreteValue = relativeDateConcreteValue(candidate);
  if (concreteValue == null && componentValue != null) return;
  assertWidgetPayloadShape(concreteValue != null, 'relative Date default has no concrete value');
  assertWidgetPayloadShape(
    JSON.stringify(componentValue) !== JSON.stringify(concreteValue),
    'relative Date default requires restoration',
  );
}

export function restoreRelativeDateDefaults(
  widget: WidgetPayload,
): WidgetPayload {
  const component = widgetComponent(widget);

  for (const control of widgetControls(widget)) {
    const field = String(controlField(control));
    assertRelativeDateDefaultSupported(component[field], control.value);
  }

  for (const param of widgetParameters(widget)) {
    if (typeof param.field === 'string' && isRecord(param.values)) {
      assertRelativeDateDefaultSupported(component[param.field], param.values.default);
    }
  }
  return widget;
}

export function cleanText(value: unknown): string {
  return [value].join('').trim();
}

function parameterDefault(param: Record<string, unknown>, componentValue: unknown): unknown {
  assertWidgetPayloadShape(!Object.prototype.hasOwnProperty.call(param, 'value'), 'parameter uses value fallback');
  assertWidgetPayloadShape(!Object.prototype.hasOwnProperty.call(param, 'defaultValue'), 'parameter uses defaultValue fallback');
  assertWidgetPayloadShape(isRecord(param.values), 'parameter.values is not a record');
  return componentValue ?? param.values.default;
}

function optionParameter(
  field: string,
  type: string,
  optionValues: unknown[],
  rawDefault: unknown,
  entityMap: Record<string, string>,
): MutableWidgetParameter {
  return {
    field,
    type,
    values: optionValues.map((value: unknown) => toDisplayValue(value, entityMap)),
    rawValues: optionValues,
    options: toOptions(optionValues, entityMap),
    default: toWidgetParameterDisplayValue(rawDefault, entityMap),
    rawDefault,
  };
}

function contextParameter(
  { entity, entityMap, cgMembers }: BuildWidgetParamsInput,
  type: string,
  rawDefault: string,
  contextValues: string[],
  cpField: string,
): MutableWidgetParameter {
  const cgGroupIds = isAssetParamType(type)
    ? contextValues.filter((value) => identityKind(value) === 'control-group')
    : [];
  const expandedValues = [...new Set(contextValues.flatMap((value) => cgMembers[value] ?? [value]))];
  const optionValues = type === 'Portfolio'
    ? expandedValues.filter((value) => identityKind(value) !== 'control-group')
    : expandedValues;
  const displayValues = contextValues.some((value) => cgMembers[value] !== undefined)
    ? optionValues.flatMap((value) => entity.resolveSelectedValues([value], entityMap)).slice(0, DISPLAY_OPTION_LIMIT)
    : entity.resolveSelectedValues(optionValues, entityMap, DISPLAY_OPTION_LIMIT);
  return {
    ...optionParameter(cpField, type, displayValues, rawDefault, entityMap),
    ...(cgGroupIds.length > 0 ? { isFilterable: true, cgGroupIds } : {}),
    ...(optionValues.length > DISPLAY_OPTION_LIMIT
      ? { totalOptions: optionValues.length, allRawOptions: optionValues }
      : {}),
  };
}

type ContextParameterClaim = Readonly<{
  field: string;
  parameter?: MutableWidgetParameter;
}>;

function contextParameterClaim(input: BuildWidgetParamsInput): ContextParameterClaim | undefined {
  const { widget, isDV } = input;
  if (!widget.contextParameter || contextOptions(widget).length === 0) return undefined;
  const contextValues = contextOptions(widget).map((value) => {
    assertWidgetPayloadShape(typeof value === 'string', 'contextParameter.options contain a non-string value');
    return value;
  });
  const cpField = widget.contextParameter.field || 'context';
  const rawDefault = contextParamDefault(widget, cpField, contextValues);
  if (!isDV && !widget.contextParameter.field) return { field: cpField };
  assertWidgetPayloadShape(typeof rawDefault === 'string', 'contextParameter default is not a string');
  const type = contextParameterType(widget.contextParameter, rawDefault, contextValues);
  return {
    field: cpField,
    parameter: contextParameter(input, type, rawDefault, contextValues, cpField),
  };
}

function controlParameters(
  { entity, widget, entityMap, cgMembers, chart }: BuildWidgetParamsInput,
  component: Record<string, unknown>,
  claimed: ReadonlySet<string | undefined>,
): MutableWidgetParameter[] {
  const plotToolControls = chart.controls ?? [];
  const params: MutableWidgetParameter[] = [];
  for (const control of widgetControls(widget)) {
    const field = requiredControlField(control);
    if (claimed.has(field) || params.some((param) => param.field === field)) continue;
    let rawValues = definitionOptionValues(control, 'control', 'values');
    if (rawValues.length === 0) {
      const chartControl = plotToolControls.find((candidate) => candidate.field === field);
      rawValues = expandControlGroupValues(
        responseArrayField(chartControl, 'values', 'chart control.values'),
        cgMembers,
      );
    }
    const rawDefault = controlParamDefault(control, component[field]);
    assertWidgetPayloadShape(rawDefault !== null, 'render control default is null');
    const type = paramTypeFromRecord(control, rawDefault, rawValues);
    const optionValues = uniqueWidgetOptionValues(
      entity,
      rawValues.map(unwrapSliderValue),
      entityMap,
      type,
    );
    params.push(optionParameter(field, type, optionValues, rawDefault, entityMap));
  }
  return params;
}

function relativeDateParameter(
  { entityMap, chart, isDV }: BuildWidgetParamsInput,
): MutableWidgetParameter | undefined {
  const relativeDate = !isDV && chart.window
    ? plotToolWindowRelativeDate(chart.window)
    : undefined;
  if (!relativeDate) return undefined;
  return {
    field: 'Relative Date',
    type: 'Enum',
    values: [],
    rawValues: [],
    options: toOptions([...relativeDate.options], entityMap),
    display: [...relativeDate.options],
    default: relativeDate.display,
    rawDefault: relativeDate.raw,
  };
}

function definedParameters(
  { entity, widget, entityMap, isDV }: BuildWidgetParamsInput,
  component: Record<string, unknown>,
  claimed: ReadonlySet<string | undefined>,
): MutableWidgetParameter[] {
  const hasControls = widgetControls(widget).length > 0;
  const params: MutableWidgetParameter[] = [];
  for (const param of widgetParameters(widget)) {
    const field = parameterField(param);
    if (claimed.has(field) || params.some((defined) => defined.field === field)) continue;
    /* c8 ignore next -- Recording-unreachable by construction: the call throws only for the unsupported CH asset-number shape that the Replay corpus and live scan never emit. */
    assertWidgetPayloadShape(isDV || !hasControls || !/^asset\d+$/i.test(field), 'CH asset# parameter requires suppression');
    const rawValues = definitionOptionValues(param, 'parameter', 'options');
    const rawDefault = parameterDefault(param, component[field]);
    const type = paramTypeFromRecord(param, rawDefault, rawValues);
    const optionValues = uniqueWidgetOptionValues(entity, rawValues, entityMap, type);
    params.push(optionParameter(field, type, optionValues, rawDefault, entityMap));
  }
  return params;
}

export function buildWidgetParams(input: BuildWidgetParamsInput): MutableWidgetParameter[] {
  const component = widgetComponent(input.widget);
  const context = contextParameterClaim(input);
  const controls = controlParameters(input, component, new Set([context?.field]));
  const relativeDate = relativeDateParameter(input);
  const defined = definedParameters(
    input,
    component,
    new Set([context?.field, ...controls.map((param) => param.field)]),
  );
  return [
    ...(context?.parameter ? [context.parameter] : []),
    ...controls,
    ...(relativeDate ? [relativeDate] : []),
    ...defined,
  ].map((param) => (
    param.display
      ? param
      : { ...param, display: param.options.map((option) => String(option.label)) }
  ));
}
