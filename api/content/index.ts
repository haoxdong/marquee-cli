import type { Endpoint } from '../../transport/index.js';
import { post, type ApiRequester } from '../index.js';

// Marquee's research Content search endpoints, in gs-quant's client shape (ADR 0072).
export class ContentApi {
  // GIR advanced search, whose path its decode failures are named with.
  static readonly advancedSearch: Endpoint = post('/research/search/reports/advanced-search');

  constructor(private readonly requester: ApiRequester) {}

  // One page of research reports matching a GIR search.
  searchReports(search: unknown): Promise<unknown> {
    return this.requester.request(ContentApi.advancedSearch, { body: search });
  }
}
