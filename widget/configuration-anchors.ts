/**
 * Config-anchor extraction helpers used by the Widget production adapter to
 * resolve the relativeDate and parameters Dashboard must echo into its child POST
 * body so the server retains the configurationId.
 */

import { InvalidWidgetResponseError } from './semantic-failure.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRelativeDateField(value: unknown): boolean {
  return typeof value === 'string' && /^relative\s+date$/i.test(value.trim());
}

function assertDashboardConfigShape(condition: unknown, reason: string): asserts condition {
  if (condition) return;
  throw new InvalidWidgetResponseError({ source: 'configuration', problem: 'unsupported-payload-shape', detail: reason });
}

function configRecord(config: unknown): Record<string, unknown> {
  const record = Array.isArray(config) && config.length === 1 ? config[0] : config;
  assertDashboardConfigShape(isRecord(record), 'configuration is not a record');
  return record;
}

function optionalParameterGroup(group: unknown, label: string): unknown[] {
  if (group === undefined || group === null) return [];
  assertDashboardConfigShape(Array.isArray(group), `configuration.${label} is not an array`);
  return group;
}

function relativeDateFromParams(group: unknown, label: string): string | undefined {
  const params = optionalParameterGroup(group, label);
  for (const [index, entry] of params.entries()) {
    assertDashboardConfigShape(isRecord(entry), `configuration.${label}[${index}] is not a record`);
    const value = entry.value;
    if (
      isRelativeDateField(entry.field)
      && (typeof value === 'number' || (typeof value === 'string' && value.length > 0))
    ) {
      return String(value).toLowerCase();
    }
  }
  return undefined;
}

/**
 * The relative-date hint the child POST body must echo. Web-created configs carry it
 * top-level ("5y"); CLI-created configs only carry it inside (modified)parameters as
 * { field: "Relative Date", value: "5Y" }, which the server's add endpoint wants as
 * the lowercased top-level form.
 */
export function configRelativeDate(config: unknown): string | undefined {
  const record = configRecord(config);
  if (typeof record.relativeDate === 'string' && record.relativeDate.length > 0) {
    return record.relativeDate;
  }
  return relativeDateFromParams(record.modifiedParameters, 'modifiedParameters') ?? relativeDateFromParams(record.parameters, 'parameters');
}

/**
 * The config's own parameter overrides (e.g. DataViz `start`/`end`). Echoed in the
 * re-add body so the server keeps the configurationId for param-based configs. Many
 * CH relativeDate configs expose `Relative Date` as a parameter too; Web treats that
 * as the top-level relativeDate hint, so exclude it from parameter echo/verification.
 */
export function configParameters(config: unknown): unknown[] {
  const record = configRecord(config);
  return optionalParameterGroup(record.parameters, 'parameters').filter((param, index) => {
    assertDashboardConfigShape(isRecord(param), `configuration.parameters[${index}] is not a record`);
    return !isRelativeDateField(param.field);
  });
}

/**
 * The config's `underlyingChartId`. When the config carries no explicit relativeDate
 * or parameter anchors, callers can fetch the chart to derive a relativeDate from
 * `chart.relativeStartDate` (see `chartRelativeDate`).
 */
export function configUnderlyingChartId(config: unknown): string {
  const record = configRecord(config);
  assertDashboardConfigShape(
    typeof record.underlyingChartId === 'string' && record.underlyingChartId.length > 0,
    'configuration.underlyingChartId is missing',
  );
  return record.underlyingChartId;
}
