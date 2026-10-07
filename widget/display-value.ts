import { identityKind } from './input-resolution.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DISPLAY_KEYS = ['label', 'display', 'displayName', 'name', 'title', 'value'];

export function toDisplayValue(value: unknown, entityMap: Record<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toDisplayValue(item, entityMap));
  }
  if (typeof value === 'string') {
    return entityMap[value] || value;
  }
  if (!isRecord(value)) {
    return value;
  }
  if (isRecord(value.rdate)) {
    return value.rdate.rule;
  }
  for (const key of DISPLAY_KEYS) {
    if (!(key in value)) continue;
    const display = toDisplayValue(value[key], entityMap);
    if (display !== undefined && display !== null) {
      return display;
    }
  }
  return value;
}

function unknownControlGroupValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unknownControlGroupValues);
  if (typeof value === 'string') {
    return identityKind(value) === 'control-group' ? 'Unknown' : value;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      unknownControlGroupValues(entry),
    ]),
  );
}

export function toWidgetParameterDisplayValue(
  value: unknown,
  entityMap: Record<string, string>,
): unknown {
  return toDisplayValue(unknownControlGroupValues(value), entityMap);
}

export function defaultOrOnlyOption(value: unknown, options: unknown[]): unknown {
  if ((value === undefined || value === null || value === '') && options.length === 1) {
    return options[0];
  }
  return value;
}
