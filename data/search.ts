import { allOk, type Result } from '../lib/result.js';
import type { Transport } from '../transport/index.js';
import {
  ENTITY_CLASSES,
  ENTITY_SEARCH_LIMIT_MAXIMUM,
  isEntityClass,
  searchEntityClasses,
  WEB_LIMITS,
  type EntityClass,
} from './adapters/asset.js';
import { DATASET_SEARCH_LIMIT_MAXIMUM, searchDatasets } from './adapters/dataset.js';
import { FRED_SEARCH_LIMIT_MAXIMUM, searchFred } from './adapters/fred.js';
import { HAVER_SEARCH_LIMIT_MAXIMUM, searchHaver } from './adapters/haver.js';
import { MARKET_COORDINATE_SEARCH_LIMIT_MAXIMUM, searchMarketCoordinates } from './adapters/mdapi.js';
import { TSDB_SEARCH_LIMIT_MAXIMUM, searchTsdb } from './adapters/tsdb.js';
import { cachedFunctionLibrary } from './catalog-cache.js';
import { findFunction } from './catalog.js';
import type {
  DataClassMatch,
  DataClassSearch,
  DataClassSearchError,
  DataSearchClass,
  DataSearchInput,
  DataSearchOutcome,
  FunctionLibrary,
} from './types.js';

/** The `--class` values `data search` takes, in the order a search of every Class prints them. */
export const DATA_SEARCH_CLASSES: readonly DataSearchClass[] = [...ENTITY_CLASSES, 'FRED', 'HAVER', 'MarketCoordinate', 'TSDB', 'Dataset'];

/** Classes whose Measures vary by instance: their rows have none, and their search needs no library. */
const INSTANCE_MEASURE_CLASSES: ReadonlySet<DataSearchClass> = new Set([...ENTITY_CLASSES, 'Dataset']);

/** Rows a search of one Class shows without `--limit` (ADR 0084). */
export const DEFAULT_LIMIT = 10;

/** Rows each Class shows when every Class is searched (ADR 0084). */
export const EVERY_CLASS_LIMIT = 5;

/** How long a search of every Class waits for each Class before reporting it (ADR 0084). */
export const EVERY_CLASS_DEADLINE_MS = 10_000;

/** The largest `--limit` each Class's search takes. */
export const LIMIT_MAXIMUM: Readonly<Record<DataSearchClass, number>> = {
  Asset: ENTITY_SEARCH_LIMIT_MAXIMUM,
  Country: ENTITY_SEARCH_LIMIT_MAXIMUM,
  RiskModel: ENTITY_SEARCH_LIMIT_MAXIMUM,
  Subdivision: ENTITY_SEARCH_LIMIT_MAXIMUM,
  Kpi: ENTITY_SEARCH_LIMIT_MAXIMUM,
  Portfolio: ENTITY_SEARCH_LIMIT_MAXIMUM,
  FRED: FRED_SEARCH_LIMIT_MAXIMUM,
  HAVER: HAVER_SEARCH_LIMIT_MAXIMUM,
  MarketCoordinate: MARKET_COORDINATE_SEARCH_LIMIT_MAXIMUM,
  TSDB: TSDB_SEARCH_LIMIT_MAXIMUM,
  Dataset: DATASET_SEARCH_LIMIT_MAXIMUM,
};

export type SearchDependencies = Readonly<{
  request: Transport['request'];
  /** Where the function library is cached between runs. */
  cacheDirectory: string;
  /** How long a search of every Class waits for each Class. */
  everyClassDeadlineMs: number;
}>;

type Search = Readonly<{
  request: Transport['request'];
  now: Date;
  query: string;
  /** `--limit` when given; absent, each search sends what Web sends. */
  limit: number | undefined;
}>;

type Library = Result<FunctionLibrary, DataClassSearchError>;

type ClassOutcome = Result<Readonly<{ rows: readonly DataClassMatch[]; total?: number }>, DataClassSearchError>;

/**
 * Searches one Class, or every Class in parallel when none is given, and fills each row's fixed
 * Measures from the cached function library. A Class that fails, or has not answered by the
 * deadline, leaves the others' rows standing: each Class is a module (ADR 0030); so does an
 * unreadable library, which fails only the Classes whose Measures it holds. Every Class is sent the
 * query as typed; the entity Classes share one bare-word search, as PlotTool Web sends it.
 */
export async function searchData(
  { request, cacheDirectory, everyClassDeadlineMs }: SearchDependencies,
  now: Date,
  input: DataSearchInput,
): Promise<DataSearchOutcome> {
  const invalid = invalidInput(input);
  if (invalid !== undefined) return { ok: false, error: invalid };
  const { query } = input;
  const library = (): Promise<Library> => functionLibrary(request, cacheDirectory, now);
  if (input.class === undefined) {
    const entities = searchEntityClasses(request, query, WEB_LIMITS);
    const search = (each: DataSearchClass): Promise<ClassOutcome> => (
      isEntityClass(each) ? entities.then((found) => entityOutcome(found, each)) : SEARCHES[each]({ request, now, query, limit: undefined })
    );
    // The library is cached for the day once fetched, so it is never cut short by the deadline.
    const [measures, searches] = await Promise.all([
      library(),
      Promise.all(DATA_SEARCH_CLASSES.map(async (each) => ({
        searched: each,
        found: await answeredBy(everyClassDeadlineMs, { searched: each, query }, search(each)),
      }))),
    ]);
    return {
      ok: true,
      everyClass: {
        query,
        searches: searches.map(({ searched, found }) => withMeasures(searched, query, found, measures, EVERY_CLASS_LIMIT)),
      },
    };
  }
  const searched = input.class;
  const limit = input.limit === undefined ? undefined : Number(input.limit);
  const measured: Promise<Library> = INSTANCE_MEASURE_CLASSES.has(searched) ? Promise.resolve(EMPTY_LIBRARY) : library();
  const searchedClass: Promise<ClassOutcome> = isEntityClass(searched)
    ? searchEntityClasses(request, query, { [searched]: limit ?? DEFAULT_LIMIT }).then((each) => entityOutcome(each, searched))
    : SEARCHES[searched]({ request, now, query, limit });
  const answered = await allOk([measured, searchedClass]);
  if (!answered.ok) return answered;
  const [measures, found] = answered.value;
  return withMeasures(searched, query, { ok: true, value: found }, { ok: true, value: measures }, limit ?? DEFAULT_LIMIT);
}

const EMPTY_LIBRARY: Library = { ok: true, value: { functions: [] } };

function entityOutcome(found: Readonly<Partial<Record<EntityClass, ClassOutcome>>>, searched: EntityClass): ClassOutcome {
  const outcome = found[searched];
  /* c8 ignore next -- type-unreachable: the bare-word search answers every entity Class it was sent. */
  if (outcome === undefined) throw new Error(`the bare-word search did not answer ${searched}`);
  return outcome;
}

async function functionLibrary(request: Transport['request'], directory: string, now: Date): Promise<Library> {
  const library = await cachedFunctionLibrary(request, directory, now);
  return library.ok ? library : { ok: false, error: { kind: 'library-failed', failure: library.error } };
}

/**
 * A Class's first `shown` rows in its search's own order, each with the Class's fixed Measures,
 * or the Class's own failure, or else the library's when the Class needs it. More rows exist when
 * the search returned or counted more than were shown, or stopped at its cap without a count.
 */
function withMeasures(
  searched: DataSearchClass,
  query: string,
  found: ClassOutcome,
  library: Library,
  shown: number,
): DataClassSearch {
  if (!found.ok) return found;
  const isInstanceMeasured = INSTANCE_MEASURE_CLASSES.has(searched);
  if (!isInstanceMeasured && !library.ok) return library;
  const measures = isInstanceMeasured || !library.ok ? [] : fixedMeasures(library.value, searched);
  if (measures === undefined) return { ok: false, error: { kind: 'class-not-in-library', class: searched } };
  const { rows, total } = found.value;
  const kept = rows.slice(0, shown);
  return {
    ok: true,
    value: {
      query,
      class: searched,
      rows: kept.map((row) => ({ ...row, measures })),
      ...(total === undefined ? {} : { total }),
      hasMore: rows.length > kept.length || (total ?? Number.POSITIVE_INFINITY) > kept.length,
    },
  };
}

/**
 * The Class's methods as they paste after the dot: a defaulted argument is not written
 * (`value()`, never `value(location)`), a required one is named (`point(date)`). Undefined when
 * the library has no such Class.
 */
function fixedMeasures(library: FunctionLibrary, searched: DataSearchClass): readonly string[] | undefined {
  const constructor = findFunction(library, searched);
  if (constructor === undefined || constructor.methods.length === 0) return undefined;
  return constructor.methods.map(({ name, parameters }) => {
    const required = parameters.filter((parameter) => parameter.default === undefined && !parameter.isVariadic);
    return `${name}(${required.map((parameter) => parameter.name).join(', ')})`;
  });
}

// The slow Class's request is left to finish unread; the CLI exits once the others print.
async function answeredBy(
  deadlineMs: number,
  { searched, query }: Readonly<{ searched: DataSearchClass; query: string }>,
  search: Promise<ClassOutcome>,
): Promise<ClassOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ClassOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: { kind: 'class-too-slow', class: searched, query, deadlineMs } }), deadlineMs);
  });
  try {
    return await Promise.race([search, late]);
  } finally {
    clearTimeout(timer);
  }
}

function invalidInput({ query, class: searched, limit }: DataSearchInput): DataClassSearchError | undefined {
  if (query.trim() === '') return { kind: 'empty-query' };
  if (limit === undefined) return undefined;
  if (searched === undefined) return { kind: 'limit-without-class', rowsPerClass: EVERY_CLASS_LIMIT };
  const maximum = LIMIT_MAXIMUM[searched];
  return isLimitWithin(limit, maximum) ? undefined : { kind: 'invalid-limit', class: searched, maximum };
}

// Each search as PlotTool Web sends it; `--limit` goes to the searches that take one.
const SEARCHES: Readonly<Record<Exclude<DataSearchClass, EntityClass>, (search: Search) => Promise<ClassOutcome>>> = {
  FRED: ({ request, query, limit }) => searchFred(request, query, limit),
  HAVER: ({ request, now, query }) => searchHaver(request, query, haverStartDate(now)),
  MarketCoordinate: ({ request, query }) => searchMarketCoordinates(request, query),
  TSDB: ({ request, query }) => searchTsdb(request, query),
  Dataset: ({ request, query, limit }) => searchDatasets(request, query, limit),
};

// The query as typed, starting two days back on New York's calendar, as Web's bundle sets it.
// Web's own arithmetic: two days back on the local calendar, written as New York's date.
function haverStartDate(now: Date): string {
  const start = new Date(now);
  start.setDate(start.getDate() - 2);
  return start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function isLimitWithin(limit: string, maximum: number): boolean {
  return /^[1-9]\d*$/.test(limit) && Number(limit) <= maximum;
}
