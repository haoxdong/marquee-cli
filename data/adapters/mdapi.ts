import { SearchApi } from '../../api/search/index.js';
import type { Transport } from '../../transport/index.js';
import type { DataClassMatch } from '../types.js';
import {
  field,
  malformed,
  readRows,
  sendSearch,
  totalBelowCap,
  type ClassSearchOutcome,
  type Fields,
} from './search-results.js';

/** MarketCoordinate search returns up to 30 coordinates. */
export const MARKET_COORDINATE_SEARCH_LIMIT_MAXIMUM = 30;

// A description opens with who may use the coordinate, as its own paragraph (memo 0047 §2.1),
// or is empty: FX event coordinates (`FX EVENTS_RISKPE_HL_26OCT26.ADD`) answer `''` (live,
// 2026-10-16).
const INTERNAL_ONLY = '**Internal Users Only.**';
const EXTERNAL = '**Available for External Users.**';

/** MDAPI market coordinates whose name starts with the prefix, typed by who may use them. */
export async function searchMarketCoordinates(
  request: Transport['request'],
  prefix: string,
): Promise<ClassSearchOutcome> {
  const sent = await sendSearch('MarketCoordinate', () => new SearchApi({ request }).searchMarketCoordinates(prefix));
  /* c8 ignore start -- Recording-unreachable: every recorded MarketCoordinate search answers and decodes; focused data search tests pin each typed failure. */
  if (!sent.ok) return sent;
  const results = field(sent.body, 'results');
  if (!Array.isArray(results)) return { ok: false, error: malformed('MarketCoordinate', 'response', 'expected results') };
  const read = readRows('MarketCoordinate', results, coordinateRow);
  if (!read.ok) return read;
  /* c8 ignore stop */
  return { ok: true, value: { rows: read.rows, ...totalBelowCap(read.rows.length, MARKET_COORDINATE_SEARCH_LIMIT_MAXIMUM) } };
}

/** The row for one coordinate, or what is wrong with it. The coordinate must be double-quoted. */
function coordinateRow(item: Fields): DataClassMatch | string {
  const { name, description } = item;
  /* c8 ignore start -- Recording-unreachable: every recorded coordinate is named and marked; focused data search tests pin each typed failure. */
  if (typeof name !== 'string' || typeof description !== 'string') return 'expected name and description text';
  /* c8 ignore stop */
  return {
    class: 'MarketCoordinate',
    classArgs: `MarketCoordinate(${JSON.stringify(name)})`,
    name: description.replace(INTERNAL_ONLY, '').replace(EXTERNAL, '').trim(),
    type: description.startsWith(INTERNAL_ONLY) ? 'internal only' : 'external',
  };
}
