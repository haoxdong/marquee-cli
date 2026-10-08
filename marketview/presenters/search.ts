import { formatJsonFields, type JsonOutputOptions } from '../../presentation/index.js';
import type { MarketViewErrorPresentation } from './types.js';
import {
  exitCodeForMarketViewSearchError,
  writeMarketViewErrorLine,
} from './failure-semantics.js';
import {
  renderText,
  type TextBlock,
  type TextHint,
  type TextTable,
} from '../../presentation/text.js';
import { WIDGET_SNIPPET_TABLE, widgetSnippetRow } from './widget-snippet.js';
import type {
  MarketView,
  MarketViewProviderEvidence,
  MarketViewSearchError,
  MarketViewSearchValue,
} from '../index.js';
import {
  marketViewSearchDashboardCap,
  type MarketViewSearchEntry,
  type MarketViewSearchSelector,
} from '../search/index.js';
import {
  marketViewSearchHasMultipleWidgetModes,
  marketViewSearchReferableDashboards,
  marketViewSearchWidgetPresentationOrder,
  type MarketViewSearchPresentation,
  type MarketViewSearchPresentationEntry,
  type MarketViewSearchPresentedEntry,
} from './artifact-policy.js';
import { presentWidgetError } from './widget-error.js';
import { parsePositiveInteger } from './command-options.js';

type CliWriter = (text: string) => void;

const MARKETVIEW_SEARCH_TYPES = [
  'widget',
  'widget-semantic',
  'widget-hybrid',
  'thematic-dashboard',
  'asset-dashboard',
  'country-dashboard',
  'portfolio-dashboard',
] as const;

type MarketViewSearchType = typeof MARKETVIEW_SEARCH_TYPES[number];

const SELECTOR_BY_PUBLIC_TYPE: Readonly<Record<MarketViewSearchType, MarketViewSearchSelector>> = {
  widget: 'keyword-widget',
  'widget-semantic': 'semantic-widget',
  'widget-hybrid': 'hybrid-widget',
  'thematic-dashboard': 'thematic',
  'asset-dashboard': 'asset',
  'country-dashboard': 'country',
  'portfolio-dashboard': 'portfolio',
};

interface RunMarketViewSearchInput extends JsonOutputOptions {
  query: string;
  type: string;
  limit: string;
  typeSource: 'default' | 'cli';
}

type MarketViewSearchPresenterDependencies = Readonly<{
  write: CliWriter;
  writeError: CliWriter;
  setExitCode(exitCode: number): void;
  marketView: Pick<MarketView, 'search'>;
}>;

type TextOptions = Readonly<{
  /** The per-call result limit; a group that reaches it may be cut. */
  limit: number;
  /** This search as typed, without `-L`, for the hint when a group is full. */
  command?: string;
  searchNamespace?: string | undefined;
  presentation?: MarketViewSearchPresentation;
  hints?: readonly TextHint[];
}>;

type PublicMarketViewSearch = Extract<MarketViewSearchValue, { kind: 'search' }>['search'];

/** The failure values the provider requester, the search adapter and the artifact policy record. */
type FailureEvidence = Readonly<{
  kind: 'provider-failure' | 'adapter-failure' | 'artifact-policy-failure';
  message: string;
  details?: Readonly<{ body?: string }>;
  selectors?: readonly string[];
}>;

const FAILURE_EVIDENCE_KINDS: readonly unknown[] = [
  'provider-failure',
  'adapter-failure',
  'artifact-policy-failure',
];

function isFailureEvidence(value: unknown): value is FailureEvidence {
  return FAILURE_EVIDENCE_KINDS.includes((value as { kind?: unknown } | undefined)?.kind);
}

/** The latest failure among the matching evidence, with the start of its response body. */
function latestFailureMessage(
  evidence: readonly MarketViewProviderEvidence[],
  matches: (entry: MarketViewProviderEvidence) => boolean,
): string | undefined {
  const failure = evidence
    .filter(matches)
    .map((entry) => entry.value)
    .filter(isFailureEvidence)
    .at(-1);
  if (failure === undefined) return undefined;
  const body = failure.details?.body;
  return body ? `${failure.message} — ${body.slice(0, 200)}` : failure.message;
}

type DiscoveryFailureReference = Readonly<{
  kind: 'discovery-failure-reference';
  providerEvidenceOrder?: number;
  selectors: readonly string[];
}>;

/** Only the MarketView module records this kind, always as `marketview-search` evidence, so the kind alone identifies it. */
function isDiscoveryFailureReference(value: unknown): value is DiscoveryFailureReference {
  return (value as { kind?: unknown } | undefined)?.kind === 'discovery-failure-reference';
}

function sameSelectors(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left !== undefined
    && left.length === right.length
    && left.every((selector, index) => selector === right[index]);
}

/** The failed discovery call's own provider failure, else its adapter failure. */
function discoveryFailureMessage(
  evidence: readonly MarketViewProviderEvidence[],
): string | undefined {
  const reference = evidence.map((entry) => entry.value).filter(isDiscoveryFailureReference).at(-1);
  if (reference === undefined) return undefined;
  return latestFailureMessage(evidence, (entry) => entry.order === reference.providerEvidenceOrder)
    // Of the failure evidence, only the search adapter's records the call's selectors.
    ?? latestFailureMessage(evidence, (entry) => (
      isFailureEvidence(entry.value) && sameSelectors(entry.value.selectors, reference.selectors)
    ));
}

function searchFailureMessage(
  error: MarketViewSearchError,
  evidence: readonly MarketViewProviderEvidence[],
): string | undefined {
  switch (error.kind) {
    case 'discovery-failed':
      return discoveryFailureMessage(evidence);
    case 'artifact-policy-failed':
      return latestFailureMessage(evidence, (entry) => entry.operation === 'artifact-policy');
    case 'widget-hydration-failed':
      return latestFailureMessage(evidence, (entry) => (
        entry.owner === 'widget' && entry.operation.includes(error.identity.widgetId)
      ));
    case 'entity-resolution-failed':
      return latestFailureMessage(evidence, (entry) => entry.owner === 'entity');
    default:
      return undefined;
  }
}

function semanticSearchMessage(error: MarketViewSearchError): string {
  switch (error.kind) {
    case 'invalid-query':
      return 'marketview search query must not be empty';
    case 'invalid-selector-set':
      return 'marketview search requires at least one selector';
    case 'invalid-limit':
      return 'marketview search limit must be a positive integer';
    case 'entity-resolution-failed':
      return 'MarketView entity resolution failed';
    case 'artifact-policy-failed':
      return 'MarketView Search artifact policy failed';
    case 'discovery-failed':
      if (error.failure.kind === 'authentication-required') {
        return 'Not authenticated. Run: marquee auth login';
      }
      if (error.failure.kind === 'timeout') return 'MarketView search timed out';
      if (error.failure.kind === 'cancelled') return 'MarketView search cancelled';
      if (error.failure.kind === 'rate-limited') return 'MarketView search rate limited';
      return 'MarketView search unavailable';
    case 'widget-hydration-failed':
      return widgetHydrationMessage(error);
  }
}

function widgetHydrationMessage(
  error: Extract<MarketViewSearchError, { kind: 'widget-hydration-failed' }>,
): string {
  switch (error.problem) {
    case 'authentication':
      return 'Not authenticated. Run: marquee auth login';
    case 'timeout':
      return 'Widget request timed out';
    case 'cancelled':
      return 'Widget request cancelled';
    case 'rate-limit':
      return 'Widget request rate limited';
    case 'invalid-response':
      return 'Widget response was invalid';
    case 'unexpected-result-mode':
      return 'Widget snippet hydration returned an unexpected result mode';
    case 'dependency':
      return 'Widget dependency unavailable';
    case 'widget-error':
      return presentWidgetError(error.widgetError).message;
  }
}

export function presentMarketViewSearchError(
  error: MarketViewSearchError,
  evidence: readonly MarketViewProviderEvidence[] = [],
): MarketViewErrorPresentation {
  const message = searchFailureMessage(error, evidence) || semanticSearchMessage(error);
  return { message, exitCode: exitCodeForMarketViewSearchError(error) };
}

function contentSearchHint(query: string): TextHint | undefined {
  const patterns = [
    /\b(?:article|articles|content|author|authors|publication|publications|published|commentary)\b/i,
    /\b(?:research|macro|economic|economics)\s+(?:note|notes|report|reports)\b/i,
    /\b(?:latest|recent|newest|current)(?:\s+\S+){0,5}\s+(?:view|views|take|takes|note|notes|article|articles|research|insight|insights|report|reports|commentary)\b/i,
    /\b(?:view|views|take|takes|note|notes|article|articles|report|reports)\s+(?:from|by)\b/i,
    /\b(?:gs|gir)\s+(?:view|views|take|takes|note|notes|research|insight|insights|report|reports)\b/i,
    /\b(?:view|views|take|takes|note|notes|research|insight|insights|report|reports)\b.{0,40}\b(?:gs|gir)\b/i,
  ];
  const trimmed = query.trim();
  return patterns.some((pattern) => pattern.test(trimmed))
    ? { action: 'find articles', command: `marquee content search ${JSON.stringify(trimmed)}` }
    : undefined;
}

function dashboardDetails(presentation: MarketViewSearchPresentationEntry): readonly string[] {
  const { detail } = presentation;
  if (detail?.kind === 'entity') return detail.qualifiers;
  if (detail?.kind !== 'dashboard') return [];
  const category = detail.category.kind === 'thematic'
    ? 'Thematic'
    : capitalized(detail.category.value);
  return [category, `${detail.widgetCount} widgets`];
}

/** Sentence case for a one-word label: `semantic` becomes `Semantic`. */
function capitalized(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

type PresentedWidget = MarketViewSearchPresentedEntry & Readonly<{
  entry: Extract<MarketViewSearchEntry, { kind: 'configured-widget' }>;
}>;
type PresentedDashboard = MarketViewSearchPresentedEntry & Readonly<{
  entry: Exclude<MarketViewSearchEntry, { kind: 'configured-widget' }>;
}>;

function isPresentedWidget(presented: MarketViewSearchPresentedEntry): presented is PresentedWidget {
  return presented.entry.kind === 'configured-widget';
}

function isPresentedDashboard(
  presented: MarketViewSearchPresentedEntry,
): presented is PresentedDashboard {
  return presented.entry.kind !== 'configured-widget';
}

type WidgetGroup = Readonly<{
  title: string;
  entries: readonly PresentedWidget[];
}>;

function widgetGroups(widgets: readonly PresentedWidget[]): WidgetGroup[] {
  if (!marketViewSearchHasMultipleWidgetModes(widgets)) {
    return widgets.length > 0 ? [{ title: 'Widgets', entries: widgets }] : [];
  }
  const entriesByMode = new Map<string, PresentedWidget[]>();
  for (const widget of marketViewSearchWidgetPresentationOrder(widgets)) {
    const mode = widget.widgetMode ?? 'keyword';
    const entries = entriesByMode.get(mode) ?? [];
    entries.push(widget);
    entriesByMode.set(mode, entries);
  }
  return [...entriesByMode].map(([mode, entries]) => ({
    title: `${capitalized(mode)} widgets`,
    entries,
  }));
}

function scopedRef(namespace: string | undefined, localRef: string): string {
  return namespace ? `${namespace}.${localRef}` : localRef;
}

// The provider's totalResults echoes the returned count for a capped group, so
// a group that reaches its cap has no known total: its title says `(N shown)`.
function cutCount(rows: number, isComplete: boolean): Pick<TextTable, 'count'> {
  return isComplete ? {} : { count: { shown: rows } };
}

function widgetTables(
  groups: readonly WidgetGroup[],
  namespace: string | undefined,
  limit: number,
): TextBlock[] {
  let widgetIndex = 0;
  return groups.map((group) => {
    const rows = group.entries.map(({ entry }) => {
      widgetIndex += 1;
      const ref = scopedRef(namespace, `w${widgetIndex}`);
      return widgetSnippetRow(ref, entry.snippet);
    });
    // Each widget mode is its own call, capped at the limit.
    return {
      type: 'table',
      title: group.title,
      ...WIDGET_SNIPPET_TABLE,
      ...cutCount(rows.length, rows.length < limit),
      rows,
    };
  });
}

type DashboardKind = Parameters<typeof marketViewSearchDashboardCap>[0];

function dashboardCounts(
  dashboards: readonly PresentedDashboard[],
): Map<DashboardKind, number> {
  const counts = new Map<DashboardKind, number>();
  for (const { entry } of dashboards) {
    const kind = entry.kind === 'dashboard' ? 'thematic' : entry.identity.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

function dashboardTable(
  dashboards: readonly PresentedDashboard[],
  namespace: string | undefined,
  limit: number,
): TextBlock {
  const isComplete = [...dashboardCounts(dashboards)].every(([kind, count]) => (
    count < marketViewSearchDashboardCap(kind, limit)
  ));
  const referable = marketViewSearchReferableDashboards(dashboards);
  const rows = dashboards.map((presentation) => {
    const { entry } = presentation;
    const index = referable.indexOf(presentation);
    const ref = index < 0 ? undefined : `@${scopedRef(namespace, `d${index + 1}`)}`;
    const title = entry.kind === 'dashboard' ? entry.title : entry.label;
    return [ref, title, dashboardDetails(presentation)];
  });
  return {
    type: 'table',
    title: 'Dashboards',
    // Stryker disable next-line StringLiteral: the table is built only with rows and its count never has a total, so the noun never prints
    noun: 'dashboards',
    ...cutCount(rows.length, isComplete),
    headers: ['ref', 'title', 'details'],
    rows,
  };
}

/** Hints at a higher `-L` when a group is full and `-L` can raise its cap. */
function moreResultsHint(
  groups: readonly WidgetGroup[],
  dashboards: readonly PresentedDashboard[],
  options: TextOptions,
): TextHint[] {
  if (options.command === undefined) return [];
  // No total is known at the cap, so the hint doubles the limit.
  const next = options.limit * 2;
  const widgetsFull = groups.some((group) => group.entries.length >= options.limit);
  const dashboardsFull = [...dashboardCounts(dashboards)].some(([kind, count]) => (
    count >= marketViewSearchDashboardCap(kind, options.limit)
    && marketViewSearchDashboardCap(kind, next) > count
  ));
  const nouns = [
    ...(widgetsFull ? ['widgets'] : []),
    ...(dashboardsFull ? ['dashboards'] : []),
  ];
  return nouns.length === 0
    ? []
    : [{ action: `see more ${nouns.join(' and ')}`, command: `${options.command} -L ${next}` }];
}

/** Renders search results as ADR 0070 text; an empty search renders nothing. */
export function formatMarketViewSearchEntries(
  results: readonly MarketViewSearchEntry[],
  options: TextOptions,
): string {
  const namespace = options.searchNamespace;
  const presented = options.presentation?.entries
    ?? results.map((entry) => ({ entry }));
  const widgets = presented.filter(isPresentedWidget);
  const dashboards = presented.filter(isPresentedDashboard);
  if (widgets.length === 0 && dashboards.length === 0) return '';
  const groups = widgetGroups(widgets);
  const hints: TextHint[] = [
    ...moreResultsHint(groups, dashboards, options),
    ...(widgets.length > 0
      ? [{
        action: 'see all params, chart and data for a widget',
        command: 'marquee marketview widget view <ref>',
      }]
      : []),
    ...(marketViewSearchReferableDashboards(dashboards).length > 0
      ? [{
        action: "see a dashboard's widgets",
        command: 'marquee marketview dashboard view <ref>',
      }]
      : []),
    ...(options.hints ?? []),
  ];
  return renderText([
    ...widgetTables(groups, namespace, options.limit),
    ...(dashboards.length > 0 ? [dashboardTable(dashboards, namespace, options.limit)] : []),
    { type: 'hints', hints },
  ]);
}


/** `marquee marketview search --json` fields, one record per result. */
export const MARKETVIEW_SEARCH_JSON_FIELDS = [
  'details',
  'group',
  'id',
  'params',
  'ref',
  'title',
  'type',
  'url',
] as const;

type SearchRecord = Record<(typeof MARKETVIEW_SEARCH_JSON_FIELDS)[number], unknown>;

/** The results as the text prints them: widget groups, then Dashboards, with the same refs. */
function searchRecords(
  presentation: MarketViewSearchPresentation,
  namespace: string | undefined,
): SearchRecord[] {
  const widgets = presentation.entries.filter(isPresentedWidget);
  const dashboards = presentation.entries.filter(isPresentedDashboard);
  const referable = marketViewSearchReferableDashboards(dashboards);
  const widgetRecords = widgetGroups(widgets)
    .flatMap((group) => group.entries.map((presented) => ({ group: group.title, presented })))
    .map(({ group, presented }, index): SearchRecord => {
      const { entry } = presented;
      return {
        details: undefined,
        group,
        id: entry.identity.widgetId,
        params: entry.snippet.parameterLines,
        ref: `@${scopedRef(namespace, `w${index + 1}`)}`,
        title: entry.snippet.title,
        type: 'widget',
        url: presented.url,
      };
    });
  const dashboardRecords = dashboards.map((presented): SearchRecord => {
    const { entry } = presented;
    const index = referable.indexOf(presented);
    return {
      details: dashboardDetails(presented),
      group: 'Dashboards',
      id: entry.kind === 'dashboard' ? entry.identity.dashboardId : entry.identity.entityId,
      params: undefined,
      ref: index < 0 ? undefined : `@${scopedRef(namespace, `d${index + 1}`)}`,
      title: entry.kind === 'dashboard' ? entry.title : entry.label,
      type: entry.kind === 'dashboard' ? 'dashboard' : entry.identity.kind,
      url: presented.url,
    };
  });
  return [...widgetRecords, ...dashboardRecords];
}

async function writeJsonSearch(
  input: RunMarketViewSearchInput,
  dependencies: MarketViewSearchPresenterDependencies,
  records: readonly SearchRecord[],
): Promise<void> {
  const formatted = await formatJsonFields(records, input);
  if (!formatted.ok) {
    writeMarketViewErrorLine(dependencies, `Error: ${formatted.error}`);
    return;
  }
  dependencies.write(`${formatted.output}\n`);
}

type ParsedSearch = Readonly<{
  types: readonly string[];
  selectors: readonly MarketViewSearchSelector[];
  limit: number;
}>;

function writeTextSearch(
  input: RunMarketViewSearchInput,
  parsed: ParsedSearch,
  dependencies: MarketViewSearchPresenterDependencies,
  value: PublicMarketViewSearch,
  presentation: MarketViewSearchPresentation,
  namespace: string,
): void {
  if (presentation.entries.length === 0) {
    const hasWidgets = parsed.types.some((type) => type.startsWith('widget'));
    const hasDashboards = parsed.types.some((type) => !type.startsWith('widget'));
    const noun = hasWidgets && hasDashboards ? 'results' : hasWidgets ? 'widgets' : 'dashboards';
    dependencies.writeError(`no ${noun} match ${JSON.stringify(input.query)}\n`);
    return;
  }
  const hint = contentSearchHint(input.query);
  const typeFlag = input.typeSource === 'cli' ? ` --type ${parsed.types.join(',')}` : '';
  dependencies.write(formatMarketViewSearchEntries(value.page.results, {
    limit: value.page.continuation.limit,
    command: `marquee marketview search ${JSON.stringify(input.query)}${typeFlag}`,
    searchNamespace: namespace,
    presentation,
    hints: hint ? [hint] : [],
  }));
}

function parsedPublicTypes(input: RunMarketViewSearchInput):
  | Readonly<{ ok: true } & ParsedSearch>
  | Readonly<{ ok: false; message: string }> {
  if (!input.query.trim()) {
    return { ok: false, message: 'marketview search query must not be empty' };
  }
  const requestedTypes = [...new Set(
    input.type.split(',').map((type) => type.trim()).filter(Boolean),
  )];
  if (requestedTypes.length === 0) {
    return { ok: false, message: 'marketview search requires at least one --type value' };
  }
  const invalidTypes = requestedTypes.filter((type) => !(
    MARKETVIEW_SEARCH_TYPES as readonly string[]
  ).includes(type));
  if (invalidTypes.length > 0) {
    const label = invalidTypes.length === 1 ? 'type' : 'types';
    const names = invalidTypes.map((type) => `"${type}"`).join(', ');
    return {
      ok: false,
      message: `Unknown marketview search ${label} ${names}. Supported types: ${MARKETVIEW_SEARCH_TYPES.join(', ')}`,
    };
  }
  const limit = parsePositiveInteger(input.limit);
  if (limit === undefined) return { ok: false, message: '--limit must be a positive integer' };
  return {
    ok: true,
    types: requestedTypes,
    selectors: requestedTypes.map((type) => {
      const selector = SELECTOR_BY_PUBLIC_TYPE[type as MarketViewSearchType];
      // Marquee Web recommends Dashboards from the Dashboard LLM pool.
      return selector === 'thematic' && input.typeSource === 'default'
        ? 'web-dashboard'
        : selector;
    }),
    limit,
  };
}

export async function runMarketViewSearch(
  input: RunMarketViewSearchInput,
  dependencies: MarketViewSearchPresenterDependencies,
): Promise<void> {
  const parsed = parsedPublicTypes(input);
  if (!parsed.ok) {
    writeMarketViewErrorLine(dependencies, `Error: ${parsed.message}`);
    return;
  }
  const outcome = await dependencies.marketView.search({
    query: input.query,
    selectors: parsed.selectors,
    limit: parsed.limit,
  });
  if (!outcome.result.ok) {
    const { message, exitCode } = presentMarketViewSearchError(
      outcome.result.error,
      outcome.evidence,
    );
    writeMarketViewErrorLine(dependencies, `Error: ${message}`, exitCode);
    return;
  }
  const value = outcome.result.value;
  // The MarketView module records the presentation of every successful search.
  const presentation = outcome.evidence.find((entry) => entry.operation === 'presentation')
    ?.value as MarketViewSearchPresentation | undefined;
  const namespace = value.search.artifact?.namespace;
  if (presentation === undefined || namespace === undefined) {
    throw new Error('MarketView Search outcome is missing its presentation or Artifact');
  }
  if (input.json !== undefined) {
    await writeJsonSearch(input, dependencies, searchRecords(presentation, namespace));
    return;
  }
  writeTextSearch(input, parsed, dependencies, value.search, presentation, namespace);
}
