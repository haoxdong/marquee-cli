import { SearchApi } from '../../api/search/index.js';
import type { Transport } from '../../transport/index.js';
import type { DataClassMatch } from '../types.js';
import { field, malformed, readRows, sendSearch, type ClassSearchOutcome, type Fields } from './search-results.js';

/** HAVER search returns up to 100 series per request. */
export const HAVER_SEARCH_LIMIT_MAXIMUM = 100;

/**
 * HAVER series matching the query with PlotTool Web's filters, in Haver's order.
 * A failed request fails the search (ADR 0030).
 */
export async function searchHaver(
  request: Transport['request'],
  query: string,
  startDate: string,
): Promise<ClassSearchOutcome> {
  const sent = await sendSearch('HAVER', () => new SearchApi({ request }).searchHaver({ query, startDate }));
  /* c8 ignore start -- Recording-unreachable: every recorded HAVER request answers and decodes; focused data search tests pin each typed failure. */
  if (!sent.ok) return sent;
  const data = field(field(sent.body, 'results'), 'data');
  if (!Array.isArray(data)) return { ok: false, error: malformed('HAVER', 'results', 'expected data') };
  const read = readRows('HAVER', data, haverSeries);
  if (!read.ok) return read;
  /* c8 ignore stop */
  const rows = read.rows;
  return { ok: true, value: { rows, ...(rows.length < HAVER_SEARCH_LIMIT_MAXIMUM ? { total: rows.length } : {}) } };
}

/** One series, or what is wrong with it; its group names its topic and frequency. */
function haverSeries(item: Fields): DataClassMatch | string {
  const { haverid, database, description, groupdescription } = item;
  /* c8 ignore start -- Recording-unreachable: every recorded series carries these; a focused data search test pins the typed failure. */
  if (typeof haverid !== 'string' || typeof database !== 'string' || typeof description !== 'string'
    || typeof groupdescription !== 'string') {
    return 'expected haverid, database, description and groupdescription text';
  }
  /* c8 ignore stop */
  return { class: 'HAVER', classArgs: `HAVER(${haverid}, ${database})`, name: description, type: groupdescription };
}
