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

/** TSDB symbol search returns up to 20 symbols. */
export const TSDB_SEARCH_LIMIT_MAXIMUM = 20;

/** TSDB symbols starting with the text, typed by who supplies them and marked when intraday. */
export async function searchTsdb(
  request: Transport['request'],
  text: string,
): Promise<ClassSearchOutcome> {
  const sent = await sendSearch('TSDB', () => new SearchApi({ request }).searchTsdbSymbols(text));
  /* c8 ignore start -- Recording-unreachable: every recorded TSDB search answers and decodes; focused data search tests pin each typed failure. */
  if (!sent.ok) return sent;
  const descriptors = field(sent.body, 'descriptors');
  if (!Array.isArray(descriptors)) return { ok: false, error: malformed('TSDB', 'response', 'expected descriptors') };
  const read = readRows('TSDB', descriptors, symbolRow);
  if (!read.ok) return read;
  /* c8 ignore stop */
  return { ok: true, value: { rows: read.rows, ...totalBelowCap(read.rows.length, TSDB_SEARCH_LIMIT_MAXIMUM) } };
}

/** The row for one symbol, or what is wrong with it. */
function symbolRow(item: Fields): DataClassMatch | string {
  const { key, source: provider, description, isIntraday } = item;
  const symbol = field(key, 'symbol');
  /* c8 ignore start -- Recording-unreachable: every recorded symbol carries these; focused data search tests pin each typed failure. */
  if (typeof symbol !== 'string') return 'expected key.symbol text';
  if (typeof provider !== 'string' || typeof description !== 'string' || typeof isIntraday !== 'boolean') {
    return 'expected source and description text and isIntraday';
  }
  /* c8 ignore stop */
  return {
    class: 'TSDB',
    classArgs: `TSDB(${symbol})`,
    name: description,
    type: isIntraday ? `${provider}; intraday` : provider,
  };
}
