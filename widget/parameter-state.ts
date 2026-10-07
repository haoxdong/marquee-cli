import type { WidgetParameterState, WidgetParameterOverride } from './types.js';
import type { MutableWidgetParameter } from './parameters.js';
import { widgetParamRefName } from './param-ref-name.js';

export type WidgetParameterSource = Readonly<{
  widgetId: string;
  configurationId?: string | undefined;
  chartId?: string | undefined;
  params: readonly MutableWidgetParameter[];
  appliedParams?: readonly WidgetParameterOverride[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toScalarString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(toScalarString).join(', ');
  if (isRecord(value) && isRecord(value.rdate)) {
    return toScalarString(value.rdate.rule);
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function scalarRawValue(value: unknown): string | number | boolean | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

function refRawValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const values = value.map(refRawValue);
    return values.every((item) => item !== undefined) ? values : undefined;
  }
  const scalar = scalarRawValue(value);
  if (scalar !== undefined) return scalar;
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, entryValue]) => [key, refRawValue(entryValue)] as const);
    if (entries.every(([, entryValue]) => entryValue !== undefined)) {
      return Object.fromEntries(entries);
    }
  }
  return undefined;
}

function relativeDateConcrete(value: unknown): { rule: string; concrete: string } | undefined {
  if (!isRecord(value) || !isRecord(value.rdate)) return undefined;
  const rule = value.rdate.rule;
  const concrete = value.value;
  return typeof rule === 'string'
    && rule.length > 0
    && (typeof concrete === 'string' || typeof concrete === 'number')
    ? { rule, concrete: String(concrete) }
    : undefined;
}

function fresherConcreteDateMs(
  candidate: { rule: string; concrete: string },
  rawDefault: { rule: string; concrete: string },
): number | undefined {
  if (candidate.rule !== rawDefault.rule || candidate.concrete === rawDefault.concrete) return undefined;
  const candidateMs = Date.parse(candidate.concrete);
  const defaultMs = Date.parse(rawDefault.concrete);
  return Number.isFinite(candidateMs) && Number.isFinite(defaultMs) && candidateMs > defaultMs
    ? candidateMs
    : undefined;
}

function refDefaultRawValue(param: MutableWidgetParameter): unknown {
  const rawDefault = relativeDateConcrete(param.rawDefault);
  if (param.type !== 'Date' || !rawDefault) return param.rawDefault;
  let current: { rawValue: unknown; ms: number } | undefined;
  for (const option of param.options) {
    const candidate = relativeDateConcrete(option.rawValue);
    if (!candidate) continue;
    const ms = fresherConcreteDateMs(candidate, rawDefault);
    if (ms !== undefined && (!current || ms > current.ms)) {
      current = { rawValue: option.rawValue, ms };
    }
  }
  return current?.rawValue ?? param.rawDefault;
}

function effectiveType(type: string): string {
  return type === 'Context' ? 'Asset' : type === 'RelativeDate' ? 'Enum' : type;
}

function shouldReplaceDuplicateOptionRawValue(param: MutableWidgetParameter, previous: unknown, next: unknown): boolean {
  if (param.type !== 'Date') return true;
  const rawDefault = relativeDateConcrete(param.rawDefault);
  const previousDate = relativeDateConcrete(previous);
  const nextDate = relativeDateConcrete(next);
  if (!rawDefault || !nextDate) return true;
  const previousMs = previousDate ? fresherConcreteDateMs(previousDate, rawDefault) : undefined;
  const nextMs = fresherConcreteDateMs(nextDate, rawDefault);
  if (nextMs !== undefined) return previousMs === undefined || nextMs > previousMs;
  if (previousMs !== undefined) return false;
  const previousIsDefault = previousDate?.rule === rawDefault.rule && previousDate.concrete === rawDefault.concrete;
  const nextIsDefault = nextDate.rule === rawDefault.rule && nextDate.concrete === rawDefault.concrete;
  if (previousIsDefault && !nextIsDefault) return false;
  if (nextIsDefault && !previousIsDefault) return true;
  return true;
}

function optionRawValues(param: MutableWidgetParameter): Record<string, unknown> | undefined {
  const values: Record<string, unknown> = {};
  const type = effectiveType(param.type);
  for (const option of param.options) {
    const label = scalarRawValue(option.label);
    const rawValue = refRawValue(option.rawValue);
    if (label === undefined || rawValue === undefined) continue;
    if (label === rawValue && type !== 'Asset' && type !== 'AssetList' && !option.isRawExplicit) continue;
    const key = String(label);
    if (Object.prototype.hasOwnProperty.call(values, key)
      && !shouldReplaceDuplicateOptionRawValue(param, values[key], rawValue)) continue;
    values[key] = rawValue;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function normalizeStateParam(param: MutableWidgetParameter): MutableWidgetParameter {
  const options = param.options.map((option) => ({
    label: option.label,
    rawValue: option.rawValue,
    isRawExplicit: true,
  }));
  return {
    ...param,
    options,
    display: param.display?.length
      ? param.display
      : options.map((option) => option.label),
  };
}

function applyParameterStateOverrides(
  params: readonly MutableWidgetParameter[],
  appliedParams: WidgetParameterSource['appliedParams'],
): readonly MutableWidgetParameter[] {
  if (!appliedParams?.length) return params;
  const appliedByField = new Map(
    appliedParams.map((param) => [param.field, param]),
  );
  return params.map((param) => {
    if (!appliedByField.has(param.field)) return param;
    const applied = appliedByField.get(param.field);
    const rawDefault = applied?.value;
    const selectedOption = param.options.find(
      (option) => JSON.stringify(option.rawValue) === JSON.stringify(rawDefault),
    );
    return {
      ...param,
      default: selectedOption?.label ?? applied?.displayValue ?? rawDefault,
      rawDefault,
    };
  });
}

export function widgetParameterStates(widget: WidgetParameterSource): Array<[string, WidgetParameterState]> {
  return applyParameterStateOverrides(widget.params, widget.appliedParams)
    .map(normalizeStateParam)
    .filter((param) => !param.isNotParam)
    .map((param) => {
      const displayOptions = (Array.isArray(param.display) && param.display.length > 0 ? param.display : param.options)
        .map(toScalarString)
        .filter(Boolean);
      const rawValue = refRawValue(refDefaultRawValue(param));
      const rawOptions = optionRawValues(param);
      const state: WidgetParameterState = {
        field: param.field,
        value: param.default,
        paramType: effectiveType(param.type),
        options: displayOptions,
        widgetId: widget.widgetId,
        ...(widget.configurationId
          ? { configurationId: widget.configurationId }
          : {}),
        ...(rawValue !== undefined ? { rawValue } : {}),
        ...(rawOptions ? { optionRawValues: rawOptions } : {}),
        ...(widget.chartId ? { chartId: widget.chartId } : {}),
        ...(param.isFilterable && param.cgGroupIds ? { cgGroupIds: param.cgGroupIds } : {}),
        ...(param.allRawOptions?.length ? { rawOptions: param.allRawOptions } : {}),
        ...(param.fillBlocked ? { fillBlocked: param.fillBlocked } : {}),
      };
      return [widgetParamRefName(param.field), state] as const;
    });
}
