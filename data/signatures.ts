import type {
  CatalogAllowedValues,
  CatalogFunction,
  CatalogParameter,
} from './types.js';

/** `name(x, w)`: a function, method or measure's name and parameters, after `prefix`. */
export function signatureHead(entry: CatalogFunction, prefix = ''): string {
  const parameters = entry.parameters.map((parameter) => `${parameter.isVariadic ? '*' : ''}${parameter.name}`);
  return `${prefix}${entry.name}(${parameters.join(', ')})`;
}

/**
 * The signature, then one indented line per parameter that has allowed values or a
 * default: `method: intersect | step (default) | nan | zero | time`.
 */
export function signatureLines(entry: CatalogFunction, prefix = ''): string[] {
  return [
    signatureHead(entry, prefix),
    ...entry.parameters.flatMap(parameterLines).map((line) => `  ${line}`),
  ];
}

/** `name: values` for each set of allowed values, or `name: default x`; nothing when neither is known. */
export function parameterLines(parameter: CatalogParameter): string[] {
  if (parameter.allowedValues.length === 0) {
    return parameter.default === undefined ? [] : [`${parameter.name}: default ${parameter.default}`];
  }
  return parameter.allowedValues.map((allowed) => (
    `${parameter.name}${conditionText(allowed)}: ${valuesText(allowed, allowed.default ?? parameter.default)}`
  ));
}

function conditionText(allowed: CatalogAllowedValues): string {
  const conditions = Object.entries(allowed.conditions ?? {});
  return conditions.length === 0
    ? ''
    : ` when ${conditions.map(([name, values]) => (
      values.length === 1 ? `${name}=${values[0]}` : `${name} in (${values.join(', ')})`
    )).join(', ')}`;
}

function valuesText(allowed: CatalogAllowedValues, defaultValue: string | undefined): string {
  if (allowed.values.length === 0) return defaultValue === undefined ? 'any value' : `default ${defaultValue}`;
  const values = allowed.values.map((value) => (value === defaultValue ? `${value} (default)` : value));
  const listed = defaultValue === undefined || allowed.values.includes(defaultValue);
  return `${values.join(' | ')}${listed ? '' : `, default ${defaultValue}`}`;
}

/**
 * Each set of values a parameter allows, `intersect | step | nan`, its conditions first
 * (`when assetClass=FX: 1m | 1y, default 1y`); a set names its own default when it differs
 * from the parameter's.
 */
export function allowedValueSets(parameter: CatalogParameter): string[] {
  return parameter.allowedValues.map((allowed) => {
    const ownDefault = allowed.default !== undefined && allowed.default !== parameter.default
      ? `default ${allowed.default}`
      : '';
    const values = [allowed.values.join(' | '), ownDefault].filter((part) => part !== '').join(', ');
    const condition = conditionText(allowed).trim();
    return condition === '' ? values || 'any value' : `${condition}: ${values || 'any value'}`;
  });
}
