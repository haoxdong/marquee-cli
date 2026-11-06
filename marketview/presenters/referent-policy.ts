import type { ReferentRef } from '../../referent-registry/index.js';
import { widgetReferent } from './widget-tree.js';
import type {
  MarketViewSearchConfiguredWidget,
  MarketViewSearchEntry,
  MarketViewSearchFailedWidget,
  MarketViewSearchInput,
  MarketViewSearchValue,
} from '../search/index.js';

export type MarketViewSearchPresentationEntry =
  MarketViewSearchValue['resultMetadata'][number];

export type MarketViewSearchPresentation = Readonly<{
  entries: readonly MarketViewSearchPresentationEntry[];
}>;

export function marketViewSearchReferent(
  input: MarketViewSearchInput,
): Readonly<{ root: ReferentRef; searchUrl: string }> {
  const surface = ['market', 'view'].join('');
  const searchUrl = `https://marquee.gs.com/s/${surface}/search?query=${encodeURIComponent(input.query)}`;
  return {
    searchUrl,
    root: {
      type: 'search',
      searchKind: 'market-data',
    },
  };
}

type MarketViewSearchWidgetEntry = MarketViewSearchConfiguredWidget | MarketViewSearchFailedWidget;

/** A Widget row, rendered or failed: both take a `w` ref. */
export function isMarketViewSearchWidgetEntry(
  entry: MarketViewSearchEntry,
): entry is MarketViewSearchWidgetEntry {
  return entry.kind === 'configured-widget' || entry.kind === 'failed-widget';
}

/** A Widget row's title: its snippet title, or the saved title of a failed row. */
export function marketViewSearchWidgetTitle(entry: MarketViewSearchWidgetEntry): string {
  return entry.kind === 'failed-widget' ? entry.title : entry.snippet.title;
}

function marketViewSearchDashboardProjection(
  item: Exclude<MarketViewSearchEntry, MarketViewSearchWidgetEntry>,
): ReferentRef {
  if (item.kind === 'dashboard') {
    return {
      type: 'dashboard',
      dashboardId: item.identity.dashboardId,
    };
  }
  return {
    type: 'entity-feed',
    entityId: item.identity.entityId,
    entityKind: item.identity.kind,
  };
}

export type MarketViewSearchPresentedEntry = MarketViewSearchPresentationEntry;

/** Dashboard-section entries that get a `d` ref; an untitled Asset gets none. */
export function marketViewSearchReferableDashboards(
  entries: readonly MarketViewSearchPresentedEntry[],
): MarketViewSearchPresentedEntry[] {
  return entries.filter(({ entry }) => (
    entry.kind === 'dashboard' || (entry.kind === 'entity' && entry.label !== '')
  ));
}

export function marketViewSearchHasMultipleWidgetModes(
  widgets: readonly MarketViewSearchPresentedEntry[],
): boolean {
  return new Set(widgets.map(({ widgetMode }) => widgetMode).filter(Boolean)).size > 1;
}

export function marketViewSearchWidgetPresentationOrder<T extends MarketViewSearchPresentedEntry>(
  widgets: readonly T[],
): T[] {
  if (!marketViewSearchHasMultipleWidgetModes(widgets)) return [...widgets];
  return ['keyword', 'semantic', 'llm-reranked'].flatMap((mode) => (
    widgets.filter(({ widgetMode }) => (
      (widgetMode ?? 'keyword') === mode
    ))
  ));
}

export function marketViewSearchRefs(
  presentation: MarketViewSearchPresentation,
  namespace: string,
): Record<string, ReferentRef> {
  const refs: Record<string, ReferentRef> = {};
  const widgets = marketViewSearchWidgetPresentationOrder(
    presentation.entries.filter(({ entry }) => isMarketViewSearchWidgetEntry(entry)),
  );
  widgets.forEach(({ entry }, index) => {
    if (!isMarketViewSearchWidgetEntry(entry)) return;
    const ref = `${namespace}.w${index + 1}`;
    // A failed row keeps its ref: `widget view` on it reports the same Widget error.
    const referent = widgetReferent({
      widgetId: entry.identity.widgetId,
      title: marketViewSearchWidgetTitle(entry),
      configurationId: entry.identity.configurationId ?? undefined,
      params: [],
    });
    if (referent) refs[ref] = referent;
  });
  marketViewSearchReferableDashboards(presentation.entries)
    .forEach(({ entry }, index) => {
      if (isMarketViewSearchWidgetEntry(entry)) return;
      refs[`${namespace}.d${index + 1}`] = marketViewSearchDashboardProjection(entry);
    });
  return refs;
}

/** Each referable Dashboard's Marquee URL; the Referent Registry stores them as JSON, which drops a missing one. */
export function marketViewSearchBrowserTargets(
  presentation: MarketViewSearchPresentation,
  namespace: string,
): Record<string, string | undefined> {
  return Object.fromEntries(
    marketViewSearchReferableDashboards(presentation.entries)
      .map(({ url }, index) => [`${namespace}.d${index + 1}`, url]),
  );
}
