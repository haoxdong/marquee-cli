import type { Result } from '../../lib/result.js';
import { MarqueeError } from '../../transport/index.js';
import type { DataClassMatch, DataClassSearchError, DataSearchClass } from '../types.js';

/** Every row a Class's search returned, in its own order, and every match it reports when it says. */
export type ClassSearchOutcome = Result<Readonly<{ rows: readonly DataClassMatch[]; total?: number }>, DataClassSearchError>;

export type Fields = Readonly<Record<string, unknown>>;

export type MalformedResults = Extract<DataClassSearchError, Readonly<{ kind: 'malformed-results' }>>;

/** A Class's request that Marquee rejected or failed, or a rejection the CLI cannot read. */
export type RequestError = Extract<DataClassSearchError, Readonly<{ kind: 'class-refused' | 'search-failed' }>>;

/** Sends one Class's request, keeping Marquee's own failures as a classified search error. */
export async function sendSearch(
  searched: DataSearchClass,
  send: () => Promise<unknown>,
): Promise<Readonly<{ ok: true; body: unknown }> | Readonly<{ ok: false; error: RequestError }>> {
  try {
    return { ok: true, body: await send() };
  } catch (error) {
    /* c8 ignore next -- Recording-unreachable: only a defect throws anything else; a focused data search test pins that it propagates. */
    if (!(error instanceof MarqueeError)) throw error;
    return { ok: false, error: searchFailure(error, searched) };
  }
}

function searchFailure(error: MarqueeError, searched: DataSearchClass): RequestError {
  const answer = error.marqueeAnswer();
  if (answer !== undefined) return { kind: 'class-refused', class: searched, ...answer };
  /* c8 ignore start -- Recording-unreachable: no recorded search fails without an answer; focused data search tests pin it. */
  return { kind: 'search-failed', class: searched, failure: error.dependencyFailure() };
}
/* c8 ignore stop */

/** Reads each result into a row, or reports the first that is not one. */
export function readRows<Row extends object>(
  searched: DataSearchClass,
  items: readonly unknown[],
  row: (item: Fields) => Row | string,
): Readonly<{ ok: true; rows: readonly Row[] }> | Readonly<{ ok: false; error: MalformedResults }> {
  const rows: Row[] = [];
  for (const [index, item] of items.entries()) {
    /* c8 ignore start -- Recording-unreachable: every recorded result is a row; focused malformed-result tests pin the typed failure. */
    const read = isFields(item) ? row(item) : 'expected an object';
    if (typeof read === 'string') return { ok: false, error: malformed(searched, `results[${index}]`, read) };
    /* c8 ignore stop */
    rows.push(read);
  }
  return { ok: true, rows };
}

/* c8 ignore start -- Recording-unreachable: every recorded response decodes; focused malformed-response tests pin the typed failure. */
export function malformed(searched: DataSearchClass, location: string, problem: string): MalformedResults {
  return { kind: 'malformed-results', class: searched, location, problem };
}
/* c8 ignore stop */

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at `key` of an object, or undefined when there is no object to read. */
export function field(value: unknown, key: string): unknown {
  /* c8 ignore next -- Recording-unreachable: every recorded body is an object; focused malformed-response tests pin the typed failure. */
  return isFields(value) ? value[key] : undefined;
}

/** The total a capped search reports by returning fewer rows than its cap; unknown at the cap. */
export function totalBelowCap(returned: number, cap: number): Readonly<{ total?: number }> {
  return returned < cap ? { total: returned } : {};
}
