import { get, post, type ApiRequester } from '../index.js';

// Marquee's entity lookup endpoints, in gs-quant's client shape (ADR 0072).
export class EntityApi {
  constructor(private readonly requester: ApiRequester) {}

  // Entities by id, optionally of one or several entity types.
  getEntities({ entityIds, type }: Readonly<{
    entityIds: readonly string[];
    type?: string | readonly string[];
  }>): Promise<unknown> {
    return this.requester.request(get('/v1/plots/entities'), {
      query: { ids: entityIds, ...(type === undefined ? {} : { type }) },
    });
  }

  // Entities by id in a request body, for id lists too long for a query string.
  postEntities({ entityIds, types }: Readonly<{
    entityIds: readonly string[];
    types: readonly string[];
  }>): Promise<unknown> {
    return this.requester.request(post('/v1/plots/entities'), { body: { ids: entityIds, types } });
  }

  // Every country and country aggregate, as Web seeds its country lookups.
  getCountries(): Promise<unknown> {
    return this.requester.request(get('/v1/countries'), { query: { limit: 300 } });
  }
}
