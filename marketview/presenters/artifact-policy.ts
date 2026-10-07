import type { ArtifactRef } from '../../artifact-registry/index.js';
import { widgetArtifact } from './widget-tree.js';
import type {
  MarketViewSearchConfiguredWidget,
  MarketViewSearchEntry,
  MarketViewSearchInput,
  MarketViewSearchValue,
} from '../search/index.js';

export type MarketViewSearchPresentationEntry =
  MarketViewSearchValue['resultMetadata'][number];

export type MarketViewSearchPresentation = Readonly<{
  entries: readonly MarketViewSearchPresentationEntry[];
}>;

export function marketViewSearchArtifact(
  input: MarketViewSearchInput,
): Readonly<{ root: ArtifactRef; searchUrl: string }> {
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

function marketViewSearchDashboardProjection(
  item: Exclude<MarketViewSearchEntry, MarketViewSearchConfiguredWidget>,
): ArtifactRef {
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
): Record<string, ArtifactRef> {
  const refs: Record<string, ArtifactRef> = {};
  const widgets = marketViewSearchWidgetPresentationOrder(
    presentation.entries.filter(({ entry }) => entry.kind === 'configured-widget'),
  );
  widgets.forEach(({ entry }, index) => {
    if (entry.kind !== 'configured-widget') return;
    const ref = `${namespace}.w${index + 1}`;
    const artifact = widgetArtifact({
      widgetId: entry.identity.widgetId,
      title: entry.snippet.title,
      configurationId: entry.identity.configurationId,
      params: [],
    });
    if (artifact) refs[ref] = artifact;
  });
  marketViewSearchReferableDashboards(presentation.entries)
    .forEach(({ entry }, index) => {
      if (entry.kind === 'configured-widget') return;
      refs[`${namespace}.d${index + 1}`] = marketViewSearchDashboardProjection(entry);
    });
  return refs;
}

/** Each referable Dashboard's Marquee URL; the Artifact Registry stores them as JSON, which drops a missing one. */
export function marketViewSearchBrowserTargets(
  presentation: MarketViewSearchPresentation,
  namespace: string,
): Record<string, string | undefined> {
  return Object.fromEntries(
    marketViewSearchReferableDashboards(presentation.entries)
      .map(({ url }, index) => [`${namespace}.d${index + 1}`, url]),
  );
}
