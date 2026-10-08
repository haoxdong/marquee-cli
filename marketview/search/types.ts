import type {
  ConfiguredWidgetIdentity,
  WidgetError,
} from '../../widget/index.js';

export type MarketViewSearchSelector =
  | 'keyword-widget'
  | 'semantic-widget'
  | 'hybrid-widget'
  | 'thematic'
  | 'asset'
  | 'country'
  | 'portfolio';

type MarketViewSearchWidgetSnippet = Readonly<{
  title: string;
  isTitleResolved: boolean;
  parameterLines: readonly string[];
}>;

export type MarketViewSearchConfiguredWidget = Readonly<{
  kind: 'configured-widget';
  identity: ConfiguredWidgetIdentity;
  snippet: MarketViewSearchWidgetSnippet;
}>;

type MarketViewSearchDashboard = Readonly<{
  kind: 'dashboard';
  identity: Readonly<{ dashboardId: string }>;
  title: string;
}>;

type MarketViewSearchEntity = Readonly<{
  kind: 'entity';
  identity: Readonly<{
    kind: 'asset' | 'country' | 'portfolio';
    entityId: string;
  }>;
  label: string;
}>;

export type MarketViewSearchEntry =
  | MarketViewSearchConfiguredWidget
  | MarketViewSearchDashboard
  | MarketViewSearchEntity;

type MarketViewSearchResultMetadata = Readonly<{
  entry: MarketViewSearchEntry;
  detail?:
    | Readonly<{
        kind: 'dashboard';
        category:
          | Readonly<{ kind: 'thematic' }>
          | Readonly<{ kind: 'named'; value: string }>;
        widgetCount: number;
      }>
    | Readonly<{ kind: 'entity'; qualifiers: readonly string[] }>;
  url?: string;
  widgetMode?: 'keyword' | 'semantic' | 'llm-reranked';
}>;

type MarketViewSearchContinuation = Readonly<{
  query: string;
  selectors: readonly MarketViewSearchSelector[];
  limit: number;
}>;

export type MarketViewSearchPage = Readonly<{
  type: 'marketview-search';
  query: string;
  results: readonly MarketViewSearchEntry[];
  continuation: MarketViewSearchContinuation;
}>;

export type MarketViewSearchValue = Readonly<{
  page: MarketViewSearchPage;
  resultMetadata: readonly MarketViewSearchResultMetadata[];
}>;

export type MarketViewSearchInput = Readonly<{
  query: string;
  selectors: readonly MarketViewSearchSelector[];
  limit: number;
}>;

type MarketViewSearchWidgetHydrationError = Readonly<{
  kind: 'widget-hydration-failed';
  identity: Readonly<{ widgetId: string }>;
}> & (
  | Readonly<{
      problem:
        | 'authentication'
        | 'timeout'
        | 'cancelled'
        | 'dependency'
        | 'rate-limit'
        | 'invalid-response'
        | 'unexpected-result-mode';
    }>
  | Readonly<{
      problem: 'widget-error';
      widgetError: Exclude<WidgetError, { kind: 'widget-load-failure' }>;
    }>
);

export type MarketViewSearchError =
  | Readonly<{ kind: 'invalid-query' }>
  | Readonly<{ kind: 'invalid-selector-set' }>
  | Readonly<{ kind: 'invalid-limit' }>
  | Readonly<{
      kind: 'discovery-failed';
      failure:
        | Readonly<{ kind: 'authentication-required'; realm: 'marquee' }>
        | Readonly<{ kind: 'timeout' }>
        | Readonly<{ kind: 'cancelled' }>
        | Readonly<{ kind: 'rate-limited' }>
        | Readonly<{ kind: 'unavailable' }>;
  }>
  | Readonly<{ kind: 'entity-resolution-failed' }>
  | MarketViewSearchWidgetHydrationError
  | Readonly<{ kind: 'artifact-policy-failed' }>;

export type MarketViewSearchOutcome<T> =
  | Readonly<{ ok: true; value: T; evidence?: unknown }>
  | Readonly<{
      ok: false;
      error: MarketViewSearchError;
      evidence?: Readonly<{
        kind: 'discovery-call';
        index: number;
        selectors: readonly MarketViewSearchSelector[];
      }>;
    }>;

export interface MarketViewSearch {
  search(input: MarketViewSearchInput): Promise<MarketViewSearchOutcome<MarketViewSearchValue>>;
}
