import type { Endpoint } from '../../transport/index.js';
import { get, type ApiRequester } from '../index.js';

// Marquee's MarketView endpoints, in gs-quant's client shape (ADR 0072).
export class MarketViewApi {
  // The user's preferences, whose path their failures are worded with.
  static readonly preferences: Endpoint = get('/v1/marketview/preferences');

  constructor(private readonly requester: ApiRequester) {}

  // The user's MarketView preferences, which hold their pinned Dashboards.
  getPreferences(): Promise<unknown> {
    return this.requester.request(MarketViewApi.preferences);
  }

  // One MarketView search of some result types, uncombined as Web requests it.
  search({ query, types, limit, isNewSchema }: Readonly<{
    query: string;
    types: readonly string[];
    limit?: number | undefined;
    isNewSchema?: boolean | undefined;
  }>): Promise<unknown> {
    return this.requester.request(get('/v1/marketview/search'), {
      query: { query, types, limit, useNewSchema: isNewSchema, combineSearchResults: false },
    });
  }
}
