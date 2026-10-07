import { get, type ApiRequester } from '../index.js';

// Marquee's Control Group endpoints, in gs-quant's client shape (ADR 0072).
export class ControlGroupApi {
  constructor(private readonly requester: ApiRequester) {}

  // Members of the Control Groups, optionally only those matching a query.
  getConstituents({ groupIds, query, limit }: Readonly<{
    groupIds: readonly string[];
    query?: string | undefined;
    limit: number;
  }>): Promise<unknown> {
    return this.requester.request(get('/v1/marketview/constituents'), {
      query: { groupIds, ...(query === undefined ? {} : { query }), limit },
    });
  }
}
