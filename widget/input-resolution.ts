import {
  type Asset,
  type EntityError,
  type EntityMatch,
  type EntityModule,
} from '../entity/index.js';
import type {
  ControlGroupError,
  ControlGroupModule,
} from '../control-group/index.js';
import { soleElement } from '../lib/sole-element.js';
import { WidgetSemanticFailure } from './semantic-failure.js';
import {
  isSlider,
  selectSliderMark,
  sliderMarkLabel,
  unwrapSliderValue,
  type Slider,
} from './slider.js';

export type WidgetEntityModule = Pick<
  EntityModule,
  'resolve' | 'resolveIdentity' | 'resolveMatches'
>;

export type WidgetControlGroupModule = Pick<ControlGroupModule, 'match' | 'expand'>;

export class ParamResolutionError extends Error {
  override readonly name = 'ParamResolutionError';
}

/** The Marquee identity a Widget input value names. */
export type WidgetIdentityKind = 'asset' | 'portfolio' | 'control-group';

const IDENTITY = /^(MA|MP|CG)[A-Z0-9]{10,}$/;
const IDENTITY_KINDS: Readonly<Record<string, WidgetIdentityKind>> = {
  MA: 'asset',
  MP: 'portfolio',
  CG: 'control-group',
};

/** The one Widget test for an Asset, Portfolio, or Control Group id. */
export function identityKind(value: unknown): WidgetIdentityKind | undefined {
  if (typeof value !== 'string') return undefined;
  const prefix = IDENTITY.exec(value)?.[1];
  return prefix === undefined ? undefined : IDENTITY_KINDS[prefix];
}

/** An Asset or Portfolio id, such as a rendered Plot series names. */
export function entityIdentityKind(value: unknown): 'asset' | 'portfolio' | undefined {
  const kind = identityKind(value);
  return kind === 'control-group' ? undefined : kind;
}

type WidgetInputOption = Readonly<{ label: string; value: unknown }>;

/**
 * The values a Widget input accepts, classified once from its definition:
 * literal options, entity-backed (raw Asset ids plus Control Group ids),
 * country, slider marks, or a scalar of the definition's type.
 */
export type WidgetInputDomain =
  | Readonly<{ kind: 'scalar'; type: string }>
  | Readonly<{ kind: 'slider'; slider: Slider }>
  | Readonly<{ kind: 'country'; options: readonly WidgetInputOption[] }>
  | Readonly<{
      kind: 'options';
      list: boolean;
      /** Ids of this kind are taken verbatim. */
      identity?: 'portfolio';
      options: readonly WidgetInputOption[];
      controlGroupIds: readonly string[];
    }>
  | Readonly<{
      kind: 'entity';
      list: boolean;
      options: readonly WidgetInputOption[];
      assetIds: readonly string[];
      controlGroupIds: readonly string[];
    }>;

/** Each option is offered by its raw spelling and by its Entity label. */
function inputOptions(
  options: readonly unknown[],
  entityLabels: ReadonlyMap<string, string>,
): WidgetInputOption[] {
  const rawValues = Object.fromEntries(
    options.map((option) => [entityLabels.get(String(option)) ?? String(option), option]),
  );
  const seen = new Set<string>();
  return [...options.map(String), ...Object.keys(rawValues)].flatMap((label) => {
    // Stryker disable next-line MethodExpression: duplicates are found by one case fold, and folding up finds the same ones
    const folded = label.toLowerCase();
    if (!label || seen.has(folded)) return [];
    seen.add(folded);
    const value = Object.prototype.hasOwnProperty.call(rawValues, label)
      ? unwrapSliderValue(rawValues[label])
      : undefined;
    return [{ label, value: value ?? label }];
  });
}

function identities(options: readonly unknown[], kind: WidgetIdentityKind): string[] {
  return options.filter((option): option is string => identityKind(option) === kind);
}

export function widgetInputDomain(
  type: string,
  options: readonly unknown[],
  entityLabels: ReadonlyMap<string, string>,
): WidgetInputDomain {
  const list = type === 'EnumList' || type === 'AssetList';
  if (type === 'Asset' || type === 'AssetList') {
    return {
      kind: 'entity',
      list,
      options: inputOptions(options, entityLabels),
      assetIds: identities(options, 'asset'),
      controlGroupIds: identities(options, 'control-group'),
    };
  }
  if (type === 'Enum' || type === 'EnumList' || type === 'Portfolio') {
    return {
      kind: 'options',
      list,
      ...(type === 'Portfolio' ? { identity: 'portfolio' as const } : {}),
      options: inputOptions(options, entityLabels),
      controlGroupIds: identities(options, 'control-group'),
    };
  }
  if (type === 'Country') {
    return { kind: 'country', options: inputOptions(options, entityLabels) };
  }
  const [slider] = options;
  if (type === 'Slider' && isSlider(slider)) return { kind: 'slider', slider };
  return { kind: 'scalar', type };
}

/** Remote candidates fetched per lookup. */
const MATCH_LIMIT = 30;

function splitListValue(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function failEntityResolution(error: EntityError): never {
  throw new ParamResolutionError(`Entity resolution failed: ${error.kind}`);
}

function failControlGroupResolution(error: ControlGroupError, widgetId: string): never {
  throw new WidgetSemanticFailure({
    kind: 'control-group-resolution-failure',
    identity: { widgetId },
    failure: error,
  });
}

type WidgetInputCandidate = {
  label: string;
  value: unknown;
  aliases?: readonly string[];
  selection?: string;
};

function entityMatchCandidates(matches: readonly EntityMatch[]): WidgetInputCandidate[] {
  return matches.map((match) => ({
    label: match.display,
    value: match.entityId,
    aliases: match.aliases,
  }));
}

function controlGroupMatchCandidates(matches: readonly Asset[]): WidgetInputCandidate[] {
  const labelCounts = new Map<string, number>();
  for (const { label } of matches) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return matches.map((match) => {
    const selection = match.aliases[0] ?? match.entityId;
    return {
      label: match.label,
      value: match.entityId,
      aliases: match.aliases,
      ...((labelCounts.get(match.label) ?? 0) > 1 && selection !== match.label ? { selection } : {}),
    };
  });
}

type WidgetInputFailure =
  | { kind: 'unsafe-integer'; requested: string }
  | { kind: 'invalid'; problem: 'empty' | 'boolean-required' | 'date-required' | 'integer-required' | 'malformed' }
  | { kind: 'unknown'; requested: string; candidates: readonly string[] }
  | { kind: 'ambiguous'; requested: string; candidates: readonly string[] };

export type WidgetInputResolution =
  | { ok: true; value: unknown; label: string; displayValue?: unknown; echo?: string }
  | { ok: false; error: WidgetInputFailure };

/** Where a `-p` value is resolved: its Widget, input, and lookup modules. */
export type WidgetInputContext = Readonly<{
  widgetId: string;
  field: string;
  entity: WidgetEntityModule;
  controlGroup: WidgetControlGroupModule;
}>;

function isValidDateParamValue(value: string): boolean {
  if (/^[+-]?\d+(?:bd|[bdwm]|y(?:\+A)?)$/i.test(value)) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function resolveScalarInput(type: string, requested: string): WidgetInputResolution {
  if (type === 'Boolean') {
    return /^(true|false)$/i.test(requested)
      ? { ok: true, value: requested.toLowerCase() === 'true', label: requested.toLowerCase() }
      : { ok: false, error: { kind: 'invalid', problem: 'boolean-required' } };
  }
  if (type === 'Date' && !isValidDateParamValue(requested)) {
    return { ok: false, error: { kind: 'invalid', problem: 'date-required' } };
  }
  if (type === 'Integer') {
    if (!/^[+-]?\d+$/.test(requested)) {
      return { ok: false, error: { kind: 'invalid', problem: 'integer-required' } };
    }
    const value = Number(requested);
    return Number.isSafeInteger(value)
      ? { ok: true, value, label: String(value) }
      : { ok: false, error: { kind: 'unsafe-integer', requested } };
  }
  return { ok: true, value: requested, label: requested };
}

function resolveSliderInput(slider: Slider, requested: string): WidgetInputResolution {
  const marks = Object.values(slider.marks);
  const label = requested.trim();
  const mark = marks.find((candidate) => sliderMarkLabel(candidate) === label);
  return mark === undefined
    ? { ok: false, error: { kind: 'unknown', requested, candidates: marks.map(sliderMarkLabel) } }
    : { ok: true, value: selectSliderMark(slider, mark), label };
}

async function controlGroupCandidates(
  context: WidgetInputContext,
  controlGroupIds: readonly string[],
  requested: string,
): Promise<WidgetInputCandidate[]> {
  const result = await context.controlGroup.match(controlGroupIds, requested.trim(), MATCH_LIMIT);
  if (!result.ok) return failControlGroupResolution(result.error, context.widgetId);
  return controlGroupMatchCandidates(result.value);
}

async function assetCandidates(
  context: WidgetInputContext,
  domain: Extract<WidgetInputDomain, { kind: 'entity' }>,
  requested: string,
): Promise<WidgetInputCandidate[]> {
  if (domain.controlGroupIds.length > 0) {
    return controlGroupCandidates(context, domain.controlGroupIds, requested);
  }
  if (domain.assetIds.length > 0) {
    const result = await context.entity.resolveMatches(domain.assetIds, requested.trim(), MATCH_LIMIT);
    if (!result.ok) return failEntityResolution(result.error);
    return entityMatchCandidates(result.value);
  }
  const result = await context.entity.resolveIdentity({ kind: 'asset', value: requested.trim() });
  if (!result.ok) return failEntityResolution(result.error);
  return result.value?.kind === 'asset'
    ? [{ label: result.value.label, value: result.value.entityId, aliases: result.value.aliases }]
    : [];
}

function matchInputCandidate(
  field: string,
  requested: string,
  candidates: readonly WidgetInputCandidate[],
): WidgetInputResolution {
  const folded = requested.trim().toLowerCase();
  const named = (candidate: WidgetInputCandidate, test: (name: string) => boolean) => (
    test(candidate.label) || candidate.aliases?.some(test) === true
  );
  const exact = candidates.filter((candidate) => named(candidate, (name) => name.toLowerCase() === folded));
  const exactMatch = soleElement(exact);
  if (exactMatch) return { ok: true, value: exactMatch.value, label: exactMatch.label };
  if (exact.length > 0) return ambiguousInputCandidates(requested, exact);
  const prefixes = candidates.filter((candidate) => named(candidate, (name) => name.toLowerCase().startsWith(folded)));
  const match = soleElement(prefixes);
  if (match) {
    return {
      ok: true,
      value: match.value,
      label: match.label,
      echo: `${field} = ${match.label} (matched "${requested}")`,
    };
  }
  if (prefixes.length > 0) return ambiguousInputCandidates(requested, prefixes);
  return {
    ok: false,
    error: {
      kind: 'unknown',
      requested,
      candidates: candidates.map((candidate) => candidate.label),
    },
  };
}

function ambiguousInputCandidates(
  requested: string,
  candidates: readonly WidgetInputCandidate[],
): WidgetInputResolution {
  const visible = candidates.slice(0, 10);
  const remainder = candidates.length - visible.length;
  return {
    ok: false,
    error: {
      kind: 'ambiguous',
      requested,
      candidates: [
        ...visible.map((candidate) => candidate.selection
          ? `${candidate.label} — use "${candidate.selection}"`
          : candidate.label),
        ...(remainder > 0 ? [`…and ${remainder} more — narrow the value`] : []),
      ],
    },
  };
}

type ItemDomain = Extract<WidgetInputDomain, { kind: 'options' | 'entity' }>;

async function resolveInputItem(
  domain: ItemDomain,
  requested: string,
  context: WidgetInputContext,
): Promise<WidgetInputResolution> {
  const verbatim = domain.kind === 'entity' ? 'asset' : domain.identity;
  if (verbatim !== undefined && identityKind(requested) === verbatim) {
    return { ok: true, value: requested, label: requested };
  }
  if (domain.kind === 'entity') {
    return matchInputCandidate(context.field, requested, await assetCandidates(context, domain, requested));
  }
  const folded = requested.trim().toLowerCase();
  const exact = domain.options.find((option) => option.label.toLowerCase() === folded);
  if (exact) return { ok: true, value: exact.value, label: exact.label };
  return matchInputCandidate(
    context.field,
    requested,
    domain.controlGroupIds.length > 0
      ? await controlGroupCandidates(context, domain.controlGroupIds, requested)
      : domain.options,
  );
}

async function resolveListInput(
  domain: ItemDomain,
  requested: string,
  context: WidgetInputContext,
): Promise<WidgetInputResolution> {
  const items = splitListValue(requested);
  const resolved: Array<Extract<WidgetInputResolution, { ok: true }>> = [];
  let pairedWithPrevious = false;
  for (const [index, item] of items.entries()) {
    if (pairedWithPrevious) {
      pairedWithPrevious = false;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- an item can combine with the next one, so items resolve in order
    const outcome = await resolveInputItem(domain, item, context);
    if (!outcome.ok) return outcome;
    const nextItem = items[index + 1];
    // An Asset label may itself contain the list separator.
    if (domain.kind === 'entity' && outcome.echo && nextItem) {
      // eslint-disable-next-line no-await-in-loop -- an item can combine with the next one, so items resolve in order
      const complete = await resolveInputItem(domain, `${item}, ${nextItem}`, context);
      if (complete.ok && complete.echo === undefined) {
        resolved.push(complete);
        pairedWithPrevious = true;
        continue;
      }
    }
    resolved.push(outcome);
  }
  const labels = resolved.map(({ label }) => label);
  return {
    ok: true,
    value: resolved.map(({ value }) => value),
    label: labels.join(', '),
    displayValue: labels,
    ...(resolved.some(({ echo }) => echo)
      ? { echo: `${context.field} = ${labels.join(', ')} (matched "${requested}")` }
      : {}),
  };
}

/** Applies an advertised code or label, else matches the advertised codes' country names. */
async function resolveCountryInput(
  options: readonly WidgetInputOption[],
  requested: string,
  context: WidgetInputContext,
): Promise<WidgetInputResolution> {
  const folded = requested.trim().toLowerCase();
  const advertised = options.find(({ label }) => label.toLowerCase() === folded);
  if (advertised) return { ok: true, value: advertised.value, label: advertised.label };
  const codes = [...new Set(options.map(({ value }) => String(value)))];
  const controlGroupIds = codes.filter((code) => identityKind(code) === 'control-group');
  if (controlGroupIds.length > 0) {
    // The typeahead query matches names only, so codes resolve against the whole group.
    const expanded = await context.controlGroup.expand(controlGroupIds);
    if (!expanded.ok) return failControlGroupResolution(expanded.error, context.widgetId);
    // A group lists one country under several constituent types (Country and Enum) with the same id.
    const members = new Map(expanded.value.flatMap(({ members }) => members).map((member) => [member.entityId, member]));
    const coded = members.get(requested.trim().toUpperCase());
    if (coded) return { ok: true, value: coded.entityId, label: coded.label };
    return matchInputCandidate(context.field, requested, [...members.values()].map(({ entityId, label }) => ({ label, value: entityId })));
  }
  const result = await context.entity.resolve(codes.map((value) => ({ kind: 'country' as const, value })));
  if (!result.ok) return failEntityResolution(result.error);
  return matchInputCandidate(context.field, requested, codes.map((value, index) => {
    const entity = result.value[index];
    return { label: entity && 'label' in entity ? entity.label : value, value };
  }));
}

/** Resolves a value typed with `-p` against its input's domain. */
export async function resolveWidgetInput(
  domain: WidgetInputDomain,
  requested: string,
  context: WidgetInputContext,
): Promise<WidgetInputResolution> {
  if (requested === '' && !(domain.kind === 'scalar' && domain.type === 'String')) {
    return { ok: false, error: { kind: 'invalid', problem: 'empty' } };
  }
  if (domain.kind === 'scalar') return resolveScalarInput(domain.type, requested);
  if (domain.kind === 'slider') return resolveSliderInput(domain.slider, requested);
  if (domain.kind === 'country') return resolveCountryInput(domain.options, requested, context);
  return domain.list
    ? resolveListInput(domain, requested, context)
    : resolveInputItem(domain, requested, context);
}
