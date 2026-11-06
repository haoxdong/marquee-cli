import type {
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

export function requireWidgetSnippetEntityResolution(
  widgetId: string,
  field: string,
  result: EntityResult<readonly EntityResolveValue[]>,
): readonly EntityResolveValue[] {
  if (result.ok) return result.value;
  const { error } = result;
  if (error.kind !== 'dependency') {
    throw new WidgetSnippetDisplayError(field, 'identifier' in error ? error.identifier : undefined);
  }
  throw new WidgetSemanticFailure({
    kind: 'widget-load-failure',
    identity: { widgetId },
    failure: error.failure,
  });
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
