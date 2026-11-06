import { EntityApi, type EntitiesQuery, type EntityTypeQuery } from '../../api/entity/index.js';
import { MarqueeError, type Transport } from '../../transport/index.js';
import type { DataClassMatch, DataClassSearchError, DataSearchClass } from '../types.js';
import {
  field,
  malformed,
  readRows,
  sendSearch,
  type ClassSearchOutcome,
  type Fields,
  type MalformedResults,
} from './search-results.js';

/** Each entity type's search cap: a larger `limit` is a 400. */
export const ENTITY_SEARCH_LIMIT_MAXIMUM = 1000;

/**
 * The library Classes PlotTool Web's bare-word search finds (`marquee data list classes`), in
 * the order a search of every Class prints them.
 */
export const ENTITY_CLASSES = ['Asset', 'Country', 'RiskModel', 'Subdivision', 'Kpi', 'Portfolio'] as const;

export type EntityClass = (typeof ENTITY_CLASSES)[number];

// PlotTool Web's bare-word search body (2026-10-23, PlotTool Pro's Expression editor): the asset
// types and classes it searches and the fields it asks for, then every other entity type with
// its own cap. Web also searches backtests, which no Expression names: `BT….pnl()` resolves as a
// report and fails 404 (live 2026-10-23), and the library has no Backtest constructor.
const ASSET_TYPES = [
  'Access', 'Bond', 'Commodity', 'CommodityEUNaturalGasHub', 'CommodityNaturalGasHub',
  'CommodityPowerAggregatedNodes', 'CommodityReferencePrice', 'Cross', 'Cryptocurrency', 'Currency',
  'Custom Basket', 'Default Swap', 'ETF', 'Fund', 'Future', 'FutureMarket', 'FutureContract', 'Index',
  'Multi-Asset Allocation', 'Option', 'Research Basket', 'Risk Premia', 'Single Stock', 'Swap', 'Swaption',
  'Systematic Hedging', 'WeatherIndex', 'XccySwapMTM', 'Company', 'TBA',
];
const ASSET_CLASSES = [
  'Cash', 'Commod', 'Credit', 'Cross Asset', 'Cryptocurrency', 'Digital Asset', 'Equity', 'FX', 'Rates',
  'Mortgage',
];
const SEARCH_FIELDS = [
  'id', 'bbid', 'name', 'assetClass', 'cusip', 'tdapi', 'type', 'exchangeCode', 'currency', 'plotId',
  'displayId', 'tsdbShortname', 'region', 'ric', 'assetClassificationsGicsSector', 'tags', 'listed',
];

/**
 * Each Class's entity type, in the order Web's body lists them: the key Web searches, the key
 * Marquee answers under, Web's cap, and whether an Expression takes its bare id, as it does an asset's, a country's and a risk model's
 * (`SPX.spot()`, `US.fci()`, `BARRA_USSLOWL.factor_return(Momentum)`, memo 0047 §2.2); any other
 * is written with its constructor.
 */
const TYPES = {
  Asset: { key: 'asset', answer: 'assets', webLimit: 10, isBare: true },
  Country: { key: 'country', answer: 'countries', webLimit: 5, isBare: true },
  Kpi: { key: 'kpi', answer: 'kpis', webLimit: 5, isBare: false },
  Portfolio: { key: 'portfolio', answer: 'portfolios', webLimit: 5, isBare: false },
  RiskModel: { key: 'riskModel', answer: 'riskModel', webLimit: 10, isBare: true },
  Subdivision: { key: 'subdivision', answer: 'subdivisions', webLimit: 5, isBare: false },
} as const satisfies Record<EntityClass, Readonly<{ key: keyof EntitiesQuery; answer: string; webLimit: number; isBare: boolean }>>;

/** How many rows of each Class Web's bare-word search asks for. */
export const WEB_LIMITS: Readonly<Record<EntityClass, number>> = Object.fromEntries(
  ENTITY_CLASSES.map((each) => [each, TYPES[each].webLimit]),
) as Record<EntityClass, number>;

// The KPI search's own query pattern: it answers anything else, such as `United States`, with a
// 400 in place of its rows (live 2026-10-23).
const KPI_QUERY = /^\w+[\w|.-]*$/;

export function isEntityClass(searched: DataSearchClass): searched is EntityClass {
  return (ENTITY_CLASSES as readonly string[]).includes(searched);
}

/** `data view`'s bare-word search limits: Web's, with Kpi only for a query its search takes. */
export function viewLimits(query: string): Readonly<Partial<Record<EntityClass, number>>> {
  return Object.fromEntries(ENTITY_CLASSES.filter((each) => each !== 'Kpi' || KPI_QUERY.test(query)).map((each) => [each, WEB_LIMITS[each]]));
}

type Rows =
  | Readonly<{ ok: true; rows: readonly DataClassMatch[] }>
  | Readonly<{ ok: false; error: MalformedResults | Extract<DataClassSearchError, Readonly<{ kind: 'class-refused' }>> }>;

/**
 * Each Class's rows from one bare-word search, in Marquee's own order, up to its limit: the one
 * request PlotTool Web sends, with no lookup beside it (live 2026-10-25). A failed request fails
 * every Class searched; a type whose own search failed fails its Class.
 */
export async function searchEntityClasses(
  request: Transport['request'],
  query: string,
  limits: Readonly<Partial<Record<EntityClass, number>>>,
): Promise<Readonly<Partial<Record<EntityClass, ClassSearchOutcome>>>> {
  const searched = searchedLimits(limits);
  const answer = await sendSearch(
    /* c8 ignore next -- selected by input, not response: every caller searches a Class. */
    searched[0]?.[0] ?? 'Asset',
    () => new EntityApi({ request }).searchEntities(entitiesQuery(query, limits)),
  );
  return Object.fromEntries(searched.map(([each, limit]): [EntityClass, ClassSearchOutcome] => {
    /* c8 ignore next -- Recording-unreachable: every recorded entity search answers; focused data search tests pin the typed failure. */
    if (!answer.ok) return [each, { ok: false, error: { ...answer.error, class: each } }];
    const read = entityClassRows(answer.body, each);
    if (!read.ok) return [each, read];
    return [each, { ok: true, value: { rows: read.rows, ...(read.rows.length < limit ? { total: read.rows.length } : {}) } }];
  }));
}

/** Web's bare-word search body for these Classes at these limits. */
export function entitiesQuery(query: string, limits: Readonly<Partial<Record<EntityClass, number>>>): EntitiesQuery {
  return Object.fromEntries(searchedLimits(limits).map(([each, limit]): [string, EntityTypeQuery] => [
    TYPES[each].key,
    each === 'Asset'
      ? { q: query, limit, where: { type: ASSET_TYPES, assetClass: ASSET_CLASSES }, fields: SEARCH_FIELDS }
      : { q: query, limit },
  ]));
}

// The Classes searched, each at its limit, in Web's body order.
function searchedLimits(
  limits: Readonly<Partial<Record<EntityClass, number>>>,
): readonly (readonly [EntityClass, number])[] {
  return (Object.keys(TYPES) as EntityClass[]).flatMap((each) => {
    const limit = limits[each];
    return limit === undefined ? [] : [[each, limit] as const];
  });
}

/**
 * One Class's rows in a bare-word search's answer, each by what an Expression and `data view`
 * take: its bare id, or its constructor on its id, quoted unless a word (`Subdivision("US-UM")`;
 * unquoted, the `-` does not parse). A type's own search that failed answers its status and
 * Marquee's message in place of its rows.
 */
export function entityClassRows(body: unknown, searched: EntityClass): Rows {
  const { answer, isBare } = TYPES[searched];
  const answered = field(body, answer);
  const status = field(answered, 'status_code');
  if (typeof status === 'number') {
    const message = field(answered, '_log_message');
    /* c8 ignore next -- Recording-unreachable: every recorded refusal gives its message; focused data search tests pin the typed failure. */
    if (typeof message !== 'string') return { ok: false, error: malformed(searched, `${answer}._log_message`, 'expected text') };
    return { ok: false, error: { kind: 'class-refused', class: searched, status, message: MarqueeError.marqueeMessage(message) } };
  }
  if (searched === 'Asset') return listedRows(answered, searched, answer, assetRow);
  return listedRows(answered, searched, answer, ({ id, name }) => {
    /* c8 ignore next -- Recording-unreachable: every recorded entity carries these; focused data search tests pin the typed failure. */
    if (typeof id !== 'string' || typeof name !== 'string') return 'expected id and name text';
    const argument = /^\w+$/.test(id) ? id : JSON.stringify(id);
    return { class: searched, classArgs: isBare ? id : `${searched}(${argument})`, name, type: searched };
  });
}

// The rows of a body's `results`.
function listedRows(
  body: unknown,
  searched: EntityClass,
  location: string,
  row: (item: Fields) => DataClassMatch | string,
): Rows {
  const items = field(body, 'results');
  /* c8 ignore start -- Recording-unreachable: every recorded body lists its rows; focused data search tests pin the typed failures. */
  if (!Array.isArray(items)) return { ok: false, error: malformed(searched, `${location}.results`, 'expected a list') };
  const read = readRows(searched, items, row);
  if (!read.ok) return { ok: false, error: { ...read.error, location: `${location}.${read.error.location}` } };
  /* c8 ignore stop */
  return { ok: true, rows: read.rows };
}

/**
 * The row for one asset, or what is wrong with it: its bare Bloomberg ID, which an Expression
 * and `data view` take, or else its Marquee id, which they take too.
 */
function assetRow(item: Fields): DataClassMatch | string {
  const { id, bbid, name, type, assetClass } = item;
  /* c8 ignore start -- Recording-unreachable: every recorded asset carries these; focused data search tests pin the typed failure. */
  if (typeof id !== 'string' || (bbid !== undefined && typeof bbid !== 'string') || typeof name !== 'string'
    || typeof type !== 'string' || typeof assetClass !== 'string') {
    return 'expected id, name, type and assetClass text';
  }
  /* c8 ignore stop */
  const row = { class: 'Asset', name, type: `${type}; ${assetClass}` } as const;
  return bbid === undefined ? { ...row, classArgs: id, withoutBbid: true } : { ...row, classArgs: bbid };
}
