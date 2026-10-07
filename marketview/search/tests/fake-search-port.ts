import {
  isMarketViewSearchWidgetSelector,
  type MarketViewSearchDiscoveryEntry,
  type MarketViewSearchPort,
} from '../module.js';

type MarketViewSearchInMemoryData = Readonly<{
  results?: readonly MarketViewSearchDiscoveryEntry[];
}>;

export function createInMemoryMarketViewSearchPort(
  data: MarketViewSearchInMemoryData = {},
): MarketViewSearchPort {
  return {
    async discover(input) {
      const dashboardKinds = new Set(input.selectors.filter((selector) => (
        !isMarketViewSearchWidgetSelector(selector)
      )));
      const includesWidgets = input.selectors.some(isMarketViewSearchWidgetSelector);
      const results = (data.results ?? [])
        .filter((entry) => entry.type === 'widget'
          ? includesWidgets
          : dashboardKinds.has(entry.type === 'dashboard' ? 'thematic' : entry.entityKind))
        .slice(0, input.limit);
      return {
        ok: true,
        value: { results },
      };
    },
  };
}
