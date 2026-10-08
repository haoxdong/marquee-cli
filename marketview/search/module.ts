import type {
  ConfigId,
  SelectedContext,
  WidgetDefinition,
  WidgetDates,
  WidgetError,
  WidgetModule,
  WidgetParameterOverride,
  WidgetId,
} from '../../widget/index.js';
import type {
  MarketViewSearch,
  MarketViewSearchEntry,
  MarketViewSearchInput,
  MarketViewSearchOutcome,
  MarketViewSearchSelector,
  MarketViewSearchValue,
} from './types.js';

type MarketViewSearchResultMetadata = MarketViewSearchValue['resultMetadata'][number];

export type MarketViewSearchDiscoveryWidget = Readonly<{
  type: 'widget';
  widgetId: WidgetId;
  title: string;
  configurationId: ConfigId | null;
  parameterLines: readonly string[];
  widgetDefinition?: WidgetDefinition;
  parameters?: readonly WidgetParameterOverride[];
  selectedContext?: SelectedContext | null;
  widgetDates?: WidgetDates;
  snippet?: Readonly<{
    title: string;
    isTitleResolved: boolean;
    parameterLines: readonly string[];
  }>;
  searchMode?: 'keyword' | 'semantic' | 'llm-reranked';
}>;

export type MarketViewSearchDiscoveryDashboard = Readonly<{
  type: 'dashboard';
  dashboardId: string;
  title: string;
  category:
    | Readonly<{ kind: 'thematic' }>
    | Readonly<{ kind: 'named'; value: string }>;
  widgetCount: number;
  url: string;
}>;

export type MarketViewSearchDiscoveryEntity = Readonly<{
  type: 'entity';
  entityKind: 'asset' | 'country' | 'portfolio';
  entityId: string;
  label: string;
  qualifiers: readonly string[];
  url?: string;
}>;

export type MarketViewSearchDiscoveryEntry =
  | MarketViewSearchDiscoveryWidget
  | MarketViewSearchDiscoveryDashboard
  | MarketViewSearchDiscoveryEntity;

type WidgetRenderError = Extract<
  MarketViewSearchOutcome<never>,
  { ok: false }
>['error'] & { kind: 'widget-hydration-failed' };

function widgetRenderFailure(
  widgetId: string,
  error: WidgetError,
): WidgetRenderError {
  if (error.kind !== 'widget-load-failure') {
    return {
      kind: 'widget-hydration-failed',
      identity: { widgetId },
      problem: 'widget-error',
      widgetError: error,
    };
  }
  const problem = error.failure.kind === 'authentication-required'
    ? 'authentication'
    : error.failure.kind === 'rate-limited'
      ? 'rate-limit'
      : error.failure.kind === 'unavailable'
        ? 'dependency'
        : error.failure.kind;
  return {
    kind: 'widget-hydration-failed',
    identity: { widgetId },
    problem,
  };
}

function unexpectedWidgetRenderResult(widgetId: string): WidgetRenderError {
  return {
    kind: 'widget-hydration-failed',
    identity: { widgetId },
    problem: 'unexpected-result-mode',
  };
}

type MarketViewSearchDiscoveryInput = Readonly<{
  query: string;
  selectors: readonly MarketViewSearchSelector[];
  limit: number;
  signal?: AbortSignal;
}>;

export interface MarketViewSearchPort {
  discover(input: MarketViewSearchDiscoveryInput): Promise<MarketViewSearchOutcome<Readonly<{
    results: readonly MarketViewSearchDiscoveryEntry[];
  }>>>;
}

type MarketViewSearchDependencies = Readonly<{
  port: MarketViewSearchPort;
  widget: Pick<WidgetModule, 'render'>;
}>;

type TaggedDiscovery = Readonly<{
  mode?: MarketViewSearchDiscoveryWidget['searchMode'];
  input: MarketViewSearchDiscoveryInput;
}>;

const WIDGET_RENDER_CONCURRENCY = 10;
export const MARKET_VIEW_SEARCH_WIDGET_MODES = {
  'keyword-widget': 'keyword',
  'semantic-widget': 'semantic',
  'hybrid-widget': 'llm-reranked',
} as const satisfies Partial<Record<
  MarketViewSearchSelector,
  NonNullable<MarketViewSearchDiscoveryWidget['searchMode']>
>>;

export type MarketViewSearchWidgetSelector = keyof typeof MARKET_VIEW_SEARCH_WIDGET_MODES;

export function isMarketViewSearchWidgetSelector(
  selector: MarketViewSearchSelector,
): selector is MarketViewSearchWidgetSelector {
  return selector in MARKET_VIEW_SEARCH_WIDGET_MODES;
}

function retainedSelectors(values: readonly MarketViewSearchSelector[]): MarketViewSearchSelector[] {
  return [...new Set(values)];
}

function widgetDiscoveryCalls(
  input: MarketViewSearchInput,
  selectors: readonly MarketViewSearchSelector[],
  signal: AbortSignal,
): TaggedDiscovery[] {
  const query = input.query;
  const calls: TaggedDiscovery[] = [];
  const requestedWidgetModes = selectors.filter(isMarketViewSearchWidgetSelector);
  const hasMultipleWidgetModes = requestedWidgetModes.length > 1;
  if (hasMultipleWidgetModes) {
    for (const mode of requestedWidgetModes) {
      calls.push({
        mode: MARKET_VIEW_SEARCH_WIDGET_MODES[mode],
        input: {
          query,
          selectors: [mode],
          limit: input.limit,
          signal,
        },
      });
    }
  } else {
    const widgetSelector = requestedWidgetModes[0];
    if (widgetSelector) {
      calls.push({
        input: {
          query,
          selectors: [widgetSelector],
          limit: input.limit,
          signal,
        },
      });
    }
  }

  return calls;
}

function discoveryCalls(
  input: MarketViewSearchInput,
  selectors: readonly MarketViewSearchSelector[],
  signal: AbortSignal,
): TaggedDiscovery[] {
  if (selectors.every((selector) => selector !== 'semantic-widget' && selector !== 'hybrid-widget')) {
    return [{ input: { query: input.query, selectors, limit: input.limit, signal } }];
  }
  const calls = widgetDiscoveryCalls(input, selectors, signal);
  for (const selector of selectors.filter((value) => !isMarketViewSearchWidgetSelector(value))) {
    calls.push({
      input: {
        query: input.query,
        selectors: [selector],
        limit: input.limit,
        signal,
      },
    });
  }
  return calls;
}

async function renderSnippet(
  widget: MarketViewSearchDependencies['widget'],
  entry: MarketViewSearchDiscoveryWidget,
): Promise<MarketViewSearchOutcome<MarketViewSearchDiscoveryWidget>> {
  if (
    !entry.widgetDefinition
    || !entry.parameters
    || entry.selectedContext === undefined
  ) {
    return {
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: entry.widgetId },
        problem: 'invalid-response',
      },
    };
  }
  const result = await widget.render(
    entry.widgetDefinition,
    entry.parameters,
    entry.selectedContext,
    entry.widgetDates,
    'snippet',
  );
  if (!result.ok) {
    return {
      ok: false,
      error: widgetRenderFailure(entry.widgetId, result.error),
    };
  }
  if (result.value.detail !== 'snippet') {
    return {
      ok: false,
      error: unexpectedWidgetRenderResult(entry.widgetId),
    };
  }
  if (result.value.widget.configurationId === null) {
    return {
      ok: false,
      error: {
        kind: 'widget-hydration-failed',
        identity: { widgetId: entry.widgetId },
        problem: 'invalid-response',
      },
    };
  }
  const snippet = result.value.snippet;
  return {
    ok: true,
    value: {
      ...entry,
      snippet,
      configurationId: result.value.widget.configurationId,
    },
  };
}

async function renderDiscoveryWidgets(
  widget: MarketViewSearchDependencies['widget'],
  entries: readonly MarketViewSearchDiscoveryEntry[],
): Promise<MarketViewSearchOutcome<readonly MarketViewSearchDiscoveryEntry[]>> {
  const renderIndexes = entries
    .map((entry, index) => ({ entry, index }))
    .filter((item): item is { entry: MarketViewSearchDiscoveryWidget; index: number } => (
      item.entry.type === 'widget'
    ));
  const rendered: Array<readonly [number, MarketViewSearchDiscoveryWidget]> = [];
  try {
    const batches = renderIndexes.flatMap((_, position) => (
      position % WIDGET_RENDER_CONCURRENCY === 0
        ? [renderIndexes.slice(position, position + WIDGET_RENDER_CONCURRENCY)]
        : []
    ));
    for (const batch of batches) {
      // eslint-disable-next-line no-await-in-loop -- bounds concurrency to one batch of renders at a time
      rendered.push(...await Promise.all(batch.map(async ({ entry, index }) => {
        const result = await renderSnippet(widget, entry);
        if (!result.ok) throw result;
        return [index, result.value] as const;
      })));
    }
  } catch (failure) {
    return failure as Extract<Awaited<ReturnType<typeof renderSnippet>>, { ok: false }>;
  }
  const byIndex = new Map(rendered);
  return {
    ok: true,
    value: entries.map((entry, index) => byIndex.get(index) ?? entry),
  };
}

/** Results kept per Dashboard kind: every asset up to `limit`, at most 5 of the others. */
export function dashboardResultCap(
  kind: 'thematic' | 'asset' | 'country' | 'portfolio',
  limit: number,
): number {
  return kind === 'asset' ? limit : Math.min(limit, 5);
}

function capNonWidgetResults(
  entries: readonly MarketViewSearchDiscoveryEntry[],
  limit: number,
): MarketViewSearchDiscoveryEntry[] {
  const counts = new Map<'thematic' | 'asset' | 'country' | 'portfolio', number>();
  return entries.filter((entry) => {
    if (entry.type === 'widget') return true;
    const kind = entry.type === 'dashboard' ? 'thematic' : entry.entityKind;
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return count <= dashboardResultCap(kind, limit);
  });
}

function semanticSearchEntry(entry: MarketViewSearchDiscoveryEntry): MarketViewSearchEntry {
  if (entry.type === 'widget') {
    if (!entry.snippet || !entry.configurationId) {
      throw new Error(`Search Widget ${entry.widgetId} was not semantically hydrated`);
    }
    return {
      kind: 'configured-widget',
      identity: {
        widgetId: entry.widgetId,
        configurationId: entry.configurationId,
      },
      snippet: entry.snippet,
    };
  }
  if (entry.type === 'dashboard') {
    return {
      kind: 'dashboard',
      identity: { dashboardId: entry.dashboardId },
      title: entry.title,
    };
  }
  return {
    kind: 'entity',
    identity: {
      kind: entry.entityKind,
      entityId: entry.entityId,
    },
    label: entry.label,
  };
}

function searchResultMetadata(
  entry: MarketViewSearchDiscoveryEntry,
): MarketViewSearchResultMetadata {
  const semantic = semanticSearchEntry(entry);
  if (entry.type === 'widget') {
    return {
      entry: semantic,
      ...(entry.searchMode ? { widgetMode: entry.searchMode } : {}),
    };
  }
  if (entry.type === 'dashboard') {
    return {
      entry: semantic,
      detail: {
        kind: 'dashboard',
        category: entry.category,
        widgetCount: entry.widgetCount,
      },
      url: entry.url,
    };
  }
  return {
    entry: semantic,
    detail: { kind: 'entity', qualifiers: entry.qualifiers },
    ...(entry.url ? { url: entry.url } : {}),
  };
}

function searchValue(
  input: MarketViewSearchInput,
  selectors: readonly MarketViewSearchSelector[],
  entries: readonly MarketViewSearchDiscoveryEntry[],
): MarketViewSearchValue {
  return {
    page: {
      type: 'marketview-search',
      query: input.query,
      results: entries.map(semanticSearchEntry),
      continuation: {
        query: input.query,
        selectors,
        limit: input.limit,
      },
    },
    resultMetadata: entries.map(searchResultMetadata),
  };
}

function validateInput(input: MarketViewSearchInput): MarketViewSearchOutcome<readonly MarketViewSearchSelector[]> {
  if (!input.query.trim()) {
    return {
      ok: false,
      error: { kind: 'invalid-query' },
    };
  }
  const selectors = retainedSelectors(input.selectors);
  if (selectors.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'invalid-selector-set',
      },
    };
  }
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    return {
      ok: false,
      error: { kind: 'invalid-limit' },
    };
  }
  return { ok: true, value: selectors };
}

function discoveryFailure(
  result: Extract<MarketViewSearchOutcome<never>, { ok: false }>,
  index: number,
  selectors: readonly MarketViewSearchSelector[],
): Extract<MarketViewSearchOutcome<never>, { ok: false }> {
  return {
    ...result,
    evidence: {
      kind: 'discovery-call',
      index,
      selectors: [...selectors],
    },
  };
}

export function createMarketViewSearchModule(
  dependencies: MarketViewSearchDependencies,
): MarketViewSearch {
  return {
    async search(input) {
      const validated = validateInput(input);
      if (!validated.ok) return validated;
      const selectors = validated.value;
      const controller = new AbortController();
      const calls = discoveryCalls(input, selectors, controller.signal);
      let successful: Array<Readonly<{
        mode: TaggedDiscovery['mode'];
        results: readonly MarketViewSearchDiscoveryEntry[];
      }>>;
      try {
        successful = await Promise.all(calls.map(async (call, index) => {
          const result = await dependencies.port.discover(call.input);
          if (!result.ok) throw discoveryFailure(result, index, call.input.selectors);
          return { mode: call.mode, results: result.value.results };
        }));
      } catch (failure) {
        controller.abort();
        return failure as Extract<MarketViewSearchOutcome<never>, { ok: false }>;
      }
      const hasMultipleWidgetModes = selectors.filter((selector) => (
        isMarketViewSearchWidgetSelector(selector)
      )).length > 1;
      let entries = successful.flatMap(({ mode, results }) => results.map((entry) => (
        mode
          ? { ...entry, searchMode: mode }
          : entry
      )));
      if (!hasMultipleWidgetModes) {
        const seen = new Set<string>();
        entries = entries.filter((entry) => {
          const identity = entry.type === 'widget'
            ? entry.widgetId
            : entry.type === 'dashboard'
              ? entry.dashboardId
              : entry.entityId;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
      }
      entries = capNonWidgetResults(entries, input.limit);
      const rendered = await renderDiscoveryWidgets(dependencies.widget, entries);
      if (!rendered.ok) return rendered;
      entries = [...rendered.value];
      return {
        ok: true,
        value: searchValue(input, selectors, entries),
      };
    },
  };
}
