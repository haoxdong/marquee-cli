import { SearchApi } from '../../api/search/index.js';
import type { Transport } from '../../transport/index.js';
import type { DataClassMatch } from '../types.js';
import { field, malformed, readRows, sendSearch, type ClassSearchOutcome, type Fields } from './search-results.js';

// Coordinate search ids are `DCFRED<FRED id>`; every row seen was FRED (memo 0047 §2.1).
const FRED_ID_PREFIX = 'DCFRED';

/** The coordinate search's own cap: a larger `limit` is a 400. */
export const FRED_SEARCH_LIMIT_MAXIMUM = 1000;

/**
 * FRED series matching a query, in Marquee's ranking. The request is the one PlotTool Web
 * sends inside `FRED(`; without `limit` Marquee returns its default 10 rows, as Web shows.
 */
export async function searchFred(
  request: Transport['request'],
  query: string,
  limit: number | undefined,
): Promise<ClassSearchOutcome> {
  const sent = await sendSearch('FRED', () => new SearchApi({ request }).queryCoordinates({
    // Web sends a query already naming a coordinate id as typed.
    qs: query.startsWith(FRED_ID_PREFIX) ? query : `${query} OR ${FRED_ID_PREFIX}${query.toUpperCase()}`,
    ...(limit === undefined ? {} : { limit }),
  }));
  if (!sent.ok) return sent;
  const total = field(sent.body, 'totalResults');
  const results = field(sent.body, 'results');
  /* c8 ignore start -- Recording-unreachable: every recorded answer has both; a focused data search test pins the typed failure. */
  if (typeof total !== 'number' || !Array.isArray(results)) {
    return { ok: false, error: malformed('FRED', 'response', 'expected totalResults and results') };
  }
  /* c8 ignore stop */
  const read = readRows('FRED', results, fredRow);
  /* c8 ignore next -- Recording-unreachable: every recorded row is a FRED series; focused data search tests pin the typed failure. */
  if (!read.ok) return read;
  return { ok: true, value: { rows: read.rows, total } };
}

/** The row for one search result, or what is wrong with it. */
function fredRow(item: Fields): DataClassMatch | string {
  const { id, title, frequency, units, seasonalAdjustmentShort } = item;
  /* c8 ignore start -- Recording-unreachable: every recorded row is a FRED series; focused data search tests pin each typed failure. */
  if (typeof id !== 'string' || !id.startsWith(FRED_ID_PREFIX)) return `expected an id starting ${FRED_ID_PREFIX}`;
  if (typeof title !== 'string' || typeof frequency !== 'string' || typeof units !== 'string'
    || typeof seasonalAdjustmentShort !== 'string') {
    return 'expected title, frequency, units and seasonalAdjustmentShort text';
  }
  /* c8 ignore stop */
  return {
    class: 'FRED',
    classArgs: `FRED(${id.slice(FRED_ID_PREFIX.length)})`,
    name: title,
    type: `${frequency}; ${units}; ${seasonalAdjustmentShort}`,
  };
}
