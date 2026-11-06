import { SearchApi } from '../../api/search/index.js';
import type { Transport } from '../../transport/index.js';
import type { DataClassMatch } from '../types.js';
import { field, malformed, readRows, sendSearch, type ClassSearchOutcome, type Fields } from './search-results.js';

/** The dataset search's own cap: a larger `limit` is a 400 (live, 2026-10-23). */
export const DATASET_SEARCH_LIMIT_MAXIMUM = 10_000;

/**
 * Datasets matching the text, in Marquee's relevance order. The request is the one PlotTool Web
 * sends inside `Dataset(`; without `limit` Marquee returns its default 10 rows.
 */
export async function searchDatasets(
  request: Transport['request'],
  text: string,
  limit: number | undefined,
): Promise<ClassSearchOutcome> {
  const sent = await sendSearch('Dataset', () => new SearchApi({ request }).searchDatasets({
    q: text,
    ...(limit === undefined ? {} : { limit }),
  }));
  if (!sent.ok) return sent;
  const total = field(sent.body, 'totalResults');
  const results = field(sent.body, 'results');
  /* c8 ignore start -- Recording-unreachable: every recorded answer has both; a focused data search test pins the typed failure. */
  if (typeof total !== 'number' || !Array.isArray(results)) {
    return { ok: false, error: malformed('Dataset', 'response', 'expected totalResults and results') };
  }
  /* c8 ignore stop */
  const read = readRows('Dataset', results, datasetRow);
  /* c8 ignore next -- Recording-unreachable: every recorded row is a dataset; a focused data search test pins the typed failure. */
  if (!read.ok) return read;
  return { ok: true, value: { rows: read.rows, total } };
}

/**
 * The row for one dataset, typed by its vendor, which some datasets do not name, and its
 * frequency, which some leave empty (live: `IR_BASIS`, 2026-10-23).
 */
function datasetRow(item: Fields): DataClassMatch | string {
  const { id, name, vendor } = item;
  const frequency = field(item.parameters, 'frequency');
  /* c8 ignore start -- Recording-unreachable: every recorded dataset carries these; a focused data search test pins the typed failure. */
  if (typeof id !== 'string' || typeof name !== 'string' || typeof frequency !== 'string'
    || (vendor !== undefined && typeof vendor !== 'string')) {
    return 'expected id, name and parameters.frequency text, and vendor text when given';
  }
  /* c8 ignore stop */
  return {
    class: 'Dataset',
    classArgs: `Dataset(${id})`,
    name,
    type: [vendor, frequency].filter((part) => part !== undefined && part !== '').join('; '),
  };
}
