import type {
  EntityError,
  EntityResolveValue,
  EntityResult,
} from '../entity/index.js';
import type {
  ControlGroupExpansion,
  ControlGroupResult,
} from '../control-group/index.js';
import { WidgetSemanticFailure } from './semantic-failure.js';
import type { WidgetResolveInput } from './types.js';
import { widgetParamRefName } from './param-ref-name.js';
import { identityKind } from './input-resolution.js';

const IMPLICIT_RELATIVE_DATE_FIELD = 'Relative Date';

const OPAQUE_IDENTIFIER = /^(?:(?:MW|WC|MD|CH|DV)[A-Z0-9]{10,}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const MAX_SNIPPET_ARRAY_VALUES = 8;

export function isOpaqueWidgetValue(value: unknown): value is string {
  return typeof value === 'string'
    && (identityKind(value) !== undefined || OPAQUE_IDENTIFIER.test(value));
}

export class WidgetSnippetDisplayError extends Error {
  constructor(
    readonly field: string,
    readonly identifier?: WidgetResolveInput,
  ) {
    super(`Widget Snippet has no display evidence for ${field}`);
  }
}

function failWidgetSnippetEntityResolution(
  widgetId: string,
  field: string,
  error: EntityError,
): never {
  if (error.kind !== 'dependency') {
    throw new WidgetSnippetDisplayError(
      field,
      'identifier' in error ? error.identifier : undefined,
    );
  }
  throw new WidgetSemanticFailure({
    kind: 'widget-load-failure',
    identity: { widgetId },
    failure: error.failure,
  });
}

export function requireWidgetSnippetEntityResolution(
  widgetId: string,
  field: string,
  result: EntityResult<readonly EntityResolveValue[]>,
): readonly EntityResolveValue[] {
  if (!result.ok) failWidgetSnippetEntityResolution(widgetId, field, result.error);
  return result.value;
}

type WidgetControlGroupResolution = Readonly<{
  input: Extract<WidgetResolveInput, { kind: 'control-group' }>;
  field: string;
}>;

export function requireWidgetSnippetControlGroupExpansion(
  widgetId: string,
  pending: readonly [WidgetControlGroupResolution, ...WidgetControlGroupResolution[]],
  result: ControlGroupResult<readonly ControlGroupExpansion[]>,
): readonly ControlGroupExpansion[] {
  if (result.ok) return result.value;
  if (result.error.kind === 'dependency') {
    throw new WidgetSemanticFailure({
      kind: 'widget-load-failure',
      identity: { widgetId },
      failure: result.error.failure,
    });
  }
  const resolution = pending.find(({ input }) => (
    result.error.controlGroupIds.includes(input.value)
  )) ?? pending[0];
  throw new WidgetSnippetDisplayError(resolution.field, resolution.input);
}

export function isWidgetSnippetInteraction(field: string): boolean {
  return /^relative\s*date$/i.test(field);
}

function snippetScalar(field: string, value: unknown): string {
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    const display = String(value);
    if (!isOpaqueWidgetValue(display)) return display;
  }
  throw new WidgetSnippetDisplayError(field);
}

/** A value as `-p` takes it: a list joins its items with commas, capped at eight. */
function snippetValue(field: string, value: unknown): string {
  if (!Array.isArray(value)) return snippetScalar(field, value);
  const values = value.map((item) => snippetScalar(field, item));
  const visible = values.slice(0, MAX_SNIPPET_ARRAY_VALUES);
  const omitted = values.length - visible.length;
  return `${visible.join(',')}${omitted > 0 ? ` (+${omitted} more)` : ''}`;
}

/**
 * A Widget Snippet's params as `name=value`, keyed by the `-p` name; an unset
 * param prints `name=`.
 */
export function widgetSnippetParams(
  parameters: readonly Readonly<{ field: string; value: unknown }>[],
): string[] {
  const params = new Map<string, string>();
  for (const { field, value } of parameters) {
    const name = widgetParamRefName(field);
    if (params.has(name)) continue;
    params.set(
      name,
      `${name}=${value === null || value === undefined ? '' : snippetValue(field, value)}`,
    );
  }
  return [...params.values()];
}

/** Title contains unresolved placeholders or the "Unknown Value" sentinel. */
export function isDegenerateTitle(title: string): boolean {
  return /Unknown Value/i.test(title) || /<\s*[^:<>]+\s*:\s*[^<>]+\s*>/.test(title);
}

// CH (plot-runner) charts always expose Web's relative-date selector, even when
// the widget payload carries no matching control or parameter definition.
function chartHasImplicitRelativeDate(chartId: string | null | undefined): boolean {
  return Boolean(chartId?.startsWith('CH'));
}

type WidgetSnippetParamKind = 'definition' | 'fallback';

export interface WidgetSnippetDiscoveredFields {
  contextParameter: string[];
  controls: string[];
  params: Array<{ field: string; kind: WidgetSnippetParamKind }>;
  component: string[];
}

export interface WidgetSnippetSource {
  widgetId?: string | null;
  title?: string | null;
  metadata?: { title?: string | null } | null;
  contextParameter?: { field?: unknown } | null;
  underlyingChartId?: string | null;
  chartId?: string | null;
  visualizationType?: string | null;
  renderParams?: {
    controls?: Array<{ field?: unknown; id?: unknown; name?: unknown }> | null;
    component?: Record<string, unknown> | null;
  } | null;
  parameters?: Array<{
    field?: unknown;
    type?: unknown;
    options?: unknown;
    enums?: unknown;
    allowedValues?: unknown;
    value?: unknown;
    defaultValue?: unknown;
    offset?: unknown;
    values?: unknown;
  }> | null;
}

export function isParameterDefinition(param: unknown): param is Record<string, unknown> {
  if (typeof param !== 'object' || param === null || Array.isArray(param)) return false;
  const record = param as Record<string, unknown>;
  const values = record.values;
  const hasDefinitionValues = Object.prototype.hasOwnProperty.call(record, 'values')
    && (
      typeof values !== 'object'
      || values === null
      || Array.isArray(values)
      || Object.keys(values).some((key) => key !== 'default')
    );
  return (
    Object.prototype.hasOwnProperty.call(record, 'type')
    || Object.prototype.hasOwnProperty.call(record, 'options')
    || Object.prototype.hasOwnProperty.call(record, 'enums')
    || Object.prototype.hasOwnProperty.call(record, 'allowedValues')
    || Object.prototype.hasOwnProperty.call(record, 'defaultValue')
    || Object.prototype.hasOwnProperty.call(record, 'offset')
    || hasDefinitionValues
  );
}

function pushUniqueField(fields: string[], value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }
  if (!fields.includes(value)) {
    fields.push(value);
  }
}

function pushUniqueParam(
  params: WidgetSnippetDiscoveredFields['params'],
  field: unknown,
  kind: WidgetSnippetParamKind,
): void {
  if (typeof field !== 'string' || field.length === 0) {
    return;
  }
  if (!params.some((param) => param.field === field)) {
    params.push({ field, kind });
  }
}

function chartId(source: WidgetSnippetSource): string {
  return source.underlyingChartId ?? source.chartId ?? '';
}

export function discoverSnippetFields(source: WidgetSnippetSource): WidgetSnippetDiscoveredFields {
  const fields: WidgetSnippetDiscoveredFields = {
    contextParameter: [],
    controls: [],
    params: [],
    component: [],
  };

  pushUniqueField(fields.contextParameter, source.contextParameter?.field);

  const controls = source.renderParams?.controls ?? [];
  for (const control of controls) {
    pushUniqueField(fields.controls, control.field);
    pushUniqueField(fields.controls, control.id);
    pushUniqueField(fields.controls, control.name);
  }

  if (
    controls.length === 0 &&
    chartHasImplicitRelativeDate(chartId(source)) &&
    source.visualizationType === 'Plot'
  ) {
    pushUniqueField(fields.controls, IMPLICIT_RELATIVE_DATE_FIELD);
  }

  for (const param of source.parameters ?? []) {
    pushUniqueParam(fields.params, param.field, isParameterDefinition(param) ? 'definition' : 'fallback');
  }

  for (const field of Object.keys(source.renderParams?.component ?? {})) {
    pushUniqueField(fields.component, field);
  }

  return fields;
}

function appendImplicitRelativeDate(names: string[], source: WidgetSnippetSource): string[] {
  if (chartHasImplicitRelativeDate(chartId(source))) {
    pushUniqueField(names, IMPLICIT_RELATIVE_DATE_FIELD);
  }
  return names;
}

export function assembleWidgetSnippetParamNames(source: WidgetSnippetSource): string[] {
  const discovered = discoverSnippetFields(source);
  const names: string[] = [];
  for (const field of discovered.contextParameter) pushUniqueField(names, field);
  for (const field of discovered.controls) pushUniqueField(names, field);
  for (const param of discovered.params) pushUniqueField(names, param.field);
  for (const field of discovered.component) pushUniqueField(names, field);
  return appendImplicitRelativeDate(names, source);
}
