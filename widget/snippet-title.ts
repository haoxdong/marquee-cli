import type {
  EntityError,
  EntityResolveInput,
  EntityResolveValue,
} from '../entity/index.js';
import { isEntityNotFound } from '../entity/index.js';
import { identityKind, type WidgetEntityModule } from './input-resolution.js';
import { cleanText } from './parameters.js';
import { WidgetSemanticFailure } from './semantic-failure.js';
import { isOpaqueWidgetValue, WidgetSnippetDisplayError } from './snippet.js';

const ENTITY_TITLE_PLACEHOLDER = /<([^>]*):([^>]*)>/g;

type WidgetTitleResolution = Readonly<{
  title: string;
  entityLabels: readonly Readonly<{ identity: string; label: string }>[];
}>;

type WidgetTitleWorkflow = Readonly<{
  widgetId: string;
  embeddedTitle: string | null;
  fallbackTitle: string;
  useEntityTitle: boolean;
  entityLabels?: readonly Readonly<{ identity: string; label: string }>[];
  contextualFallbackTitle: () => string | Promise<string>;
  metadataTitle: () => Promise<string | undefined>;
}>;

function hasWidgetTitlePlaceholder(title: string): boolean {
  return /<[^>]*:[^>]*>/.test(title);
}

export function widgetFallbackTitle(title: string, name: string): string {
  return title || name;
}

export function hasWidgetDisplayEvidence(
  assignment: Readonly<{ displayValue?: unknown }>,
): boolean {
  if (assignment.displayValue === undefined) return false;
  return !isOpaqueWidgetValue(assignment.displayValue);
}

export function contextualWidgetTitle(
  input: Readonly<{
    widget: Readonly<{
      contextParameter: Readonly<{ field: string; value: unknown }> | null;
    }>;
    parameters: readonly Readonly<{
      field: string;
      value: unknown;
      displayValue?: unknown;
      titleDisplayValue?: unknown;
    }>[];
  }>,
  title: string,
): string {
  const context = input.widget.contextParameter;
  if (!context || typeof context.value !== 'string') return title;
  const assignment = [...input.parameters]
    .reverse()
    .find(({ field }) => field === context.field);
  const titleDisplayValue = assignment?.titleDisplayValue ?? assignment?.displayValue;
  const displayValue = cleanText(titleDisplayValue);
  const escapedField = context.field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const activeValue = typeof assignment?.value === 'string'
    ? assignment.value
    : context.value;
  const replacement = displayValue || `<${context.field}:${activeValue}>`;
  return title.replace(
    new RegExp(`<${escapedField}:[^>]*>`, 'g'),
    () => replacement,
  );
}

export async function resolvedContextualWidgetTitle(
  entity: WidgetEntityModule | undefined,
  widgetId: string,
  input: Parameters<typeof contextualWidgetTitle>[0],
  title: string,
  selectedContext?: string | null,
): Promise<string> {
  const context = input.widget.contextParameter;
  const parameterOverride = context
    ? [...input.parameters].reverse().find(({ field }) => field === context.field)
    : undefined;
  const assignment = parameterOverride
    ?? (context ? { field: context.field, value: selectedContext } : undefined);
  if (
    !entity
    || !context
    || assignment?.titleDisplayValue !== undefined
    || typeof assignment?.value !== 'string'
    || identityKind(assignment.value) !== 'asset'
    || !contextualWidgetTitlePattern(context.field).test(title)
  ) {
    return contextualWidgetTitle(input, title);
  }
  const result = await entity.resolve([{ kind: 'asset', value: assignment.value }]);
  let titleDisplayValue: unknown;
  if (result.ok) {
    const resolved = result.value[0];
    titleDisplayValue = resolved && !isEntityNotFound(resolved) && resolved.kind === 'asset'
      ? resolved.bbid ?? resolved.label
      : assignment.value;
  } else if (result.error.kind === 'not-found') {
    titleDisplayValue = assignment.value;
  } else {
    return titleResolutionFailure(widgetId, result.error);
  }
  return contextualWidgetTitle({
    ...input,
    parameters: [...input.parameters, { ...assignment, titleDisplayValue }],
  }, title);
}

function contextualWidgetTitlePattern(field: string): RegExp {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<${escapedField}:[^>]*>`, 'g');
}

function entityKind(
  placeholderKind: string,
): EntityResolveInput['kind'] {
  if (placeholderKind.toLowerCase() === 'country') return 'country';
  if (placeholderKind.toLowerCase() === 'portfolio') return 'portfolio';
  return 'asset';
}

function titleResolutionFailure(widgetId: string, error: EntityError): never {
  throw new WidgetSemanticFailure(error.kind === 'dependency'
    ? {
        kind: 'widget-load-failure',
        identity: { widgetId },
        failure: error.failure,
      }
    : {
        kind: 'invalid-definition',
        identity: { widgetId },
        problem: 'malformed',
      });
}

function resolvedEntityLabel(value: EntityResolveValue): string | undefined {
  return isEntityNotFound(value) ? undefined : value.label;
}

function unresolvedTitleInputs(
  placeholders: readonly RegExpMatchArray[],
  entityLabels: ReadonlyMap<string, string>,
): EntityResolveInput[] {
  const unresolved = placeholders.flatMap((placeholder) => {
    const value = placeholder[2]?.trim();
    if (!value || entityLabels.has(value)) return [];
    return [{
      kind: entityKind(placeholder[1] ?? ''),
      value,
    } satisfies EntityResolveInput];
  });
  return [...new Map(
    unresolved.map((input) => [`${input.kind}:${input.value}`, input]),
  ).values()];
}

async function addResolvedTitleLabels(
  entity: WidgetEntityModule | undefined,
  widgetId: string,
  inputs: readonly EntityResolveInput[],
  entityLabels: Map<string, string>,
): Promise<void> {
  if (inputs.length === 0) return;
  if (!entity) {
    throw new WidgetSemanticFailure({
      kind: 'widget-load-failure',
      identity: { widgetId },
      failure: { kind: 'unavailable' },
    });
  }
  const result = await entity.resolve(inputs);
  if (!result.ok && result.error.kind === 'not-found') return;
  if (!result.ok) return titleResolutionFailure(widgetId, result.error);
  for (const [index, input] of inputs.entries()) {
    const resolved = result.value[index];
    const label = resolved && resolved.kind === input.kind
      ? resolvedEntityLabel(resolved)
      : undefined;
    if (!label) continue;
    entityLabels.set(input.value, label);
  }
}

function titleWithResolvedLabels(
  title: string,
  placeholders: readonly RegExpMatchArray[],
  entityLabels: ReadonlyMap<string, string>,
): string {
  let resolved = title;
  for (const placeholder of placeholders) {
    const value = placeholder[2]?.trim();
    const label = value ? entityLabels.get(value) : undefined;
    const replacement = label ?? value;
    if (replacement === undefined) throw new WidgetSnippetDisplayError('title');
    resolved = resolved.replace(
      new RegExp(`<${placeholder[1]}:[^(>)]*>`, 'g'),
      (matched) => matched === placeholder[0] ? replacement : matched,
    );
  }
  return resolved;
}

export async function resolveWidgetSnippetTitle(
  entity: WidgetEntityModule | undefined,
  widgetId: string,
  title: string,
  labels: readonly Readonly<{ identity: string; label: string }>[] = [],
): Promise<Readonly<{
  title: string;
  entityLabels: readonly Readonly<{ identity: string; label: string }>[];
}>> {
  const placeholders = [...title.matchAll(ENTITY_TITLE_PLACEHOLDER)];
  if (placeholders.length === 0) return { title, entityLabels: [] };
  const entityLabels = new Map(
    labels.map(({ identity, label }) => [identity, label]),
  );
  await addResolvedTitleLabels(
    entity,
    widgetId,
    unresolvedTitleInputs(placeholders, entityLabels),
    entityLabels,
  );
  return {
    title: titleWithResolvedLabels(title, placeholders, entityLabels),
    entityLabels: [...entityLabels]
      .filter(([identity]) => !labels.some((label) => label.identity === identity))
      .map(([identity, label]) => ({ identity, label })),
  };
}

export async function resolveWidgetTitle(
  input: WidgetTitleWorkflow,
  entity: WidgetEntityModule | undefined,
): Promise<WidgetTitleResolution> {
  const {
    embeddedTitle,
    fallbackTitle,
    useEntityTitle,
  } = input;
  if (useEntityTitle && !hasWidgetTitlePlaceholder(fallbackTitle)) {
    return { title: fallbackTitle, entityLabels: [] };
  }

  if (embeddedTitle) {
    return { title: embeddedTitle, entityLabels: [] };
  }

  const dynamicTitle = await input.metadataTitle();
  if (dynamicTitle) {
    return { title: dynamicTitle, entityLabels: [] };
  }

  const resolvedFallbackTitle = input.contextualFallbackTitle();
  return resolveWidgetSnippetTitle(
    entity,
    input.widgetId,
    await resolvedFallbackTitle,
    input.entityLabels ?? [],
  );
}
