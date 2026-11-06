import { get, post, type ApiRequester } from '../index.js';

const COORDINATES_QUERY = '/v1/search/coordinates/query';
const DATASETS_SEARCH = '/v1/search/datasets';
const HAVER_SEARCH = '/v1/plots/haversearch';
const MARKET_COORDINATES = '/v1/plots/coordinates';
const TSDB_SEARCH = '/v1/tsdb/search';

/** A coordinate search: `qs` in Marquee's query syntax; `limit` defaults to 10 and caps at 1000. */
export type CoordinateQuery = Readonly<{ qs: string; limit?: number }>;

/**
 * A Haver search: the text and the start date PlotTool Web sends. Marquee rejects text holding
 * anything but word characters and spaces.
 */
export type HaverQuery = Readonly<{ query: string; startDate: string }>;

/**
 * A dataset search: the text PlotTool Web sends inside `Dataset(`; `limit` defaults to 10 and
 * caps at 10000. Marquee rejects text holding `&` or `?`.
 */
export type DatasetQuery = Readonly<{ q: string; limit?: number }>;

/** Haver search's slots, all required (live, 2026-10-16). */
const HAVER_SLOTS = 5;

// The words PlotTool Web leaves out of a Haver search (its bundle, 2026-10-25).
const HAVER_STOP_WORDS: ReadonlySet<string> = new Set([
  'of', 'in', 'on', 'at', 'by', 'the', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'over', 'under', 'again', 'further', 'then',
  'once',
]);

// Marquee's search endpoints (ADR 0072).
export class SearchApi {
  constructor(private readonly requester: ApiRequester) {}

  // Data coordinates matching a query, in Marquee's relevance order; PlotTool Web finds FRED series with it.
  queryCoordinates(query: CoordinateQuery): Promise<unknown> {
    return this.requester.request(post(COORDINATES_QUERY), { body: query });
  }

  // Datasets matching the text, in Marquee's relevance order, with every match counted.
  searchDatasets(query: DatasetQuery): Promise<unknown> {
    return this.requester.request(get(DATASETS_SEARCH), { query });
  }

  // PlotTool Web drops its stop words, then cycles the capitalized rest through five filters,
  // preserving acronyms.
  searchHaver({ query, startDate }: HaverQuery): Promise<unknown> {
    const words = query.split(' ')
      .filter((word) => word !== '' && !HAVER_STOP_WORDS.has(word.toLowerCase()))
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    const slots = Array.from({ length: HAVER_SLOTS }, (_, index) => [`qs${index + 1}`, words[index % words.length]]);
    return this.requester.request(get(HAVER_SEARCH), { query: { ...Object.fromEntries(slots), startDate } });
  }

  // MDAPI market coordinates whose name starts with the prefix, up to 30.
  searchMarketCoordinates(prefix: string): Promise<unknown> {
    return this.requester.request(get(MARKET_COORDINATES), { query: { q: prefix } });
  }

  // TSDB symbols starting with the text, up to 20.
  searchTsdbSymbols(text: string): Promise<unknown> {
    return this.requester.request(post(TSDB_SEARCH), {
      body: { type: 'SearchSymbolsRequest', namespace: 'TSDB', search: text },
    });
  }
}
