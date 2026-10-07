import type { Transport } from '../../transport/index.js';
import type { WidgetModule } from '../../widget/index.js';
import { createMarketViewSearchProductionPort } from './adapters/production.js';
import { createMarketViewSearchModule, dashboardResultCap } from './module.js';
import type { MarketViewSearch } from './types.js';
export type {
  MarketViewSearchSelector,
  MarketViewSearchConfiguredWidget,
  MarketViewSearchEntry,
  MarketViewSearchPage,
  MarketViewSearchValue,
  MarketViewSearchInput,
  MarketViewSearchError,
  MarketViewSearchOutcome,
  MarketViewSearch,
} from './types.js';

type MarketViewSearchWidgetRenderer = Pick<WidgetModule, 'render'>;

export function createMarketViewSearch(
  dependencies: Readonly<{
    requester: ReturnType<Transport['provider']>;
    widget: MarketViewSearchWidgetRenderer;
    recordAdapterFailure?(operation: 'discover', value: unknown): void;
  }>,
): MarketViewSearch {
  return createMarketViewSearchModule({
    port: createMarketViewSearchProductionPort(
      dependencies.requester,
      dependencies.recordAdapterFailure,
    ),
    widget: dependencies.widget,
  });
}

/** Results a search keeps per Dashboard kind; a kind that reaches it may be cut. */
export function marketViewSearchDashboardCap(
  kind: 'thematic' | 'asset' | 'country' | 'portfolio',
  limit: number,
): number {
  return dashboardResultCap(kind, limit);
}
