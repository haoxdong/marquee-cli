import { get, post, type ApiRequester } from '../index.js';

const ENTITIES = '/v1/plots/entities';

/** One entity type's search: for assets, `where` filters by type and class and `limit` caps at 1000. */
export type EntityTypeQuery = Readonly<{
  q: string;
  limit: number;
  where?: Readonly<Record<string, readonly string[]>>;
  fields?: readonly string[];
}>;

/** The entity types `/v1/plots/entities` searches, each under its own key (memo 0047 §2.1). */
export type EntitiesQuery = Readonly<Partial<Record<
  'asset' | 'backtest' | 'country' | 'kpi' | 'portfolio' | 'riskModel' | 'subdivision',
  EntityTypeQuery
>>>;

// Marquee's entity lookup endpoints, in gs-quant's client shape (ADR 0072).
export class EntityApi {
  constructor(private readonly requester: ApiRequester) {}

  // Entities by id, optionally of one or several entity types.
  getEntities({ entityIds, type }: Readonly<{
    entityIds: readonly string[];
    type?: string | readonly string[];
  }>): Promise<unknown> {
    return this.requester.request(get(ENTITIES), {
      query: { ids: entityIds, ...(type === undefined ? {} : { type }) },
    });
  }

  // Entities by id in a request body, for id lists too long for a query string.
  postEntities({ entityIds, types }: Readonly<{
    entityIds: readonly string[];
    types: readonly string[];
  }>): Promise<unknown> {
    return this.requester.request(post(ENTITIES), { body: { ids: entityIds, types } });
  }

  // Entities of each queried type matching a name or identifier, in Marquee's ranking, as
  // PlotTool Web searches them.
  searchEntities(query: EntitiesQuery): Promise<unknown> {
    return this.requester.request(post(ENTITIES), { body: query });
  }

  // The assets whose id, Bloomberg ID or name is exactly `identifier`, as PlotTool Web resolves
  // a typed token (memo 0047 §1).
  getAssetsBy({ key, identifier, fields }: Readonly<{
    key: 'id' | 'bbid' | 'name';
    identifier: string;
    fields: readonly string[];
  }>): Promise<unknown> {
    return this.requester.request(get('/v1/assets/data'), { query: { [key]: identifier, field: fields } });
  }

  // Every country and country aggregate, as Web seeds its country lookups.
  getCountries(): Promise<unknown> {
    return this.requester.request(get('/v1/countries'), { query: { limit: 300 } });
  }
}
