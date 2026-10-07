import { type WidgetArtifact, type WidgetPresentation } from './widget-types.js';
import { type WidgetParameter } from '../../widget/index.js';
import { parseConfigId, parseWidgetId } from '../../widget/identifiers.js';
import { requiredGroup } from '../../lib/regex-group.js';

const SHOW_OPTIONS_TYPES = new Set(['Asset', 'AssetList', 'Enum', 'EnumList', 'Context', 'Portfolio', 'RelativeDate']);
const MAX_DISPLAY_OPTIONS = 30;
const MAX_DISPLAY_DEFAULT_VALUES = 8;
const LARGE_ASSET_OPTION_SUMMARY_THRESHOLD = 1500;
export const OPAQUE_ID_RE = /^[A-Z0-9]{15,}$/;

export function widgetPresentationUrl(
  id: string,
  configurationId?: string | null,
  selectedContext?: string | null,
): string {
  const query = new URLSearchParams();
  if (configurationId) query.set('config', configurationId);
  if (selectedContext) query.set('selectedContext', selectedContext);
  const encoded = query.toString();
  return `https://marquee.gs.com/s/marketview/widget/${id}${encoded ? `?${encoded}` : ''}`;
}

function toScalarString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => toScalarString(item)).join(', ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.rdate && typeof record.rdate === 'object') {
      return String((record.rdate as { rule?: string }).rule ?? '');
    }
    return JSON.stringify(value);
  }
  // Scalars come from JSON, so the rest are its primitives.
  const primitive = value as string | number | boolean;
  return String(primitive);
}

function toDefaultDisplayString(value: unknown): string {
  if (!Array.isArray(value)) {
    return toScalarString(value);
  }

  const values = value.map((item) => toScalarString(item)).filter(Boolean);
  const visible = values.slice(0, MAX_DISPLAY_DEFAULT_VALUES);
  const more = values.length - visible.length;
  return `${visible.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
}

function relativeDateConcrete(raw: unknown): { rule: string; concrete: string } | undefined {
  const { rdate, value } = Object(raw) as Readonly<{ rdate?: Readonly<{ rule?: unknown }> | null; value?: unknown }>;
  const rule = rdate?.rule;
  if (typeof rule !== 'string' || rule === '' || (typeof value !== 'string' && typeof value !== 'number')) {
    return undefined;
  }
  return { rule, concrete: String(value) };
}

function parseConcreteDateMs(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The freshest option date later than the default's, among options with the default's rule. */
function currentConcreteDateOption(param: WidgetParameter, rawDefault: { rule: string; concrete: string }): string | undefined {
  let current: { concrete: string; ms: number } | undefined;
  for (const option of param.options) {
    const candidate = relativeDateConcrete(option.rawValue);
    if (candidate?.rule !== rawDefault.rule) continue;
    const ms = parseConcreteDateMs(candidate.concrete);
    if (ms === undefined || ms <= (current?.ms ?? parseConcreteDateMs(rawDefault.concrete) ?? Infinity)) continue;
    current = { concrete: candidate.concrete, ms };
  }
  return current?.concrete;
}

export function formatDefaultDisplay(param: WidgetParameter): string {
  const defaultDisplay = toDefaultDisplayString(param.default);
  if (param.type !== 'Date') {
    return defaultDisplay;
  }

  const rawDefault = relativeDateConcrete(param.rawDefault);
  if (!rawDefault) {
    return defaultDisplay;
  }

  const baseDisplay = defaultDisplay || rawDefault.rule;
  if (baseDisplay.includes(rawDefault.concrete)) {
    return baseDisplay;
  }
  // Show the rule with the date it currently resolves to (the freshest same-rule
  // option, which matches what the widget actually renders — see the relative
  // `Date` default note in docs/api/marquee-rest-api-reference.md). The stale
  // metadata concrete is non-behavioral, so it is not surfaced.
  const concreteDisplay = currentConcreteDateOption(param, rawDefault) ?? rawDefault.concrete;
  return `${baseDisplay} [${concreteDisplay}]`;
}

function effectiveType(type: string): string {
  return type === 'Context' ? 'Asset' : type === 'RelativeDate' ? 'Enum' : type;
}

/**
 * A param's type and options sized to what fits: every enum or small-list
 * option (capped at 30, then `+N more`), only a count for a large asset list,
 * and nothing for an open param.
 */
export function sizedParamOptions(param: WidgetParameter): Readonly<{
  type: string;
  options: readonly string[] | Readonly<{ count: number }>;
}> {
  const type = effectiveType(param.type);
  const options = (param.display ?? []).map((value) => toScalarString(value)).filter(Boolean);
  const visibleOptions = options.slice(0, MAX_DISPLAY_OPTIONS);
  if (!SHOW_OPTIONS_TYPES.has(param.type) || visibleOptions.length === 0) {
    return { type, options: [] };
  }

  const totalOptions = Math.max(param.totalOptions ?? options.length, options.length);
  if ((type === 'Asset' || type === 'AssetList') && totalOptions > LARGE_ASSET_OPTION_SUMMARY_THRESHOLD) {
    return { type, options: { count: totalOptions } };
  }
  const more = totalOptions - visibleOptions.length;
  return { type, options: [...visibleOptions, ...(more > 0 ? [`+${more} more`] : [])] };
}

export function widgetArtifact(
  widget: WidgetPresentation,
): WidgetArtifact | undefined {
  const widgetId = parseWidgetId(widget.widgetId);
  if (!widgetId) return undefined;
  const configurationId = parseConfigId(widget.configurationId ?? '');
  return {
    type: 'widget',
    widgetId,
    ...(configurationId ? { configurationId } : {}),
  };
}

export function formatWidgetAuthor(author: string): string {
  const match = /^([^,]+),([^,]+)$/.exec(author);
  if (!match) return author;
  const familyName = requiredGroup(match, 1).trim();
  const givenName = requiredGroup(match, 2).trim();
  return familyName && givenName ? `${givenName} ${familyName}` : author;
}
