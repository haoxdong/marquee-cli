import {
  CLI_EXIT_CODES,
  formatJsonFields,
  type JsonOutputOptions,
} from '../../presentation/index.js';
import { renderText, type TextBlock, type TextHint } from '../../presentation/text.js';
import type {
  DataCatalogFailure,
  DataClassRow,
  DataClassSearch,
  DataClassSearchError,
  DataPresentation,
  DataSearchClass,
  DataSearchEveryClass,
  DataSearchOutcome,
} from '../types.js';
import { dataCommand } from '../command-lines.js';
import { DATA_SEARCH_CLASSES } from '../search.js';
import {
  cacheFailure,
  failed,
  failure,
  malformedResults,
  requestFailure,
  usageFailure,
  type Failure,
} from './failures.js';

/** `marquee data search --json` fields: the table's columns, one record per row. */
export const DATA_SEARCH_JSON_FIELDS = ['class', 'classArgs', 'measures', 'name', 'type', 'view'] as const;

const HEADERS = ['Class(args)', 'Measure(args)', 'Name', 'Type', 'View'];

// What a Class's rows are: plural for a cut count, and as `no <rows> match` says them.
const CLASS_TEXT: Readonly<Record<DataSearchClass, Readonly<{ noun: string; rows: string }>>> = {
  Asset: { noun: 'assets', rows: 'assets' },
  Country: { noun: 'countries', rows: 'countries' },
  RiskModel: { noun: 'risk models', rows: 'risk models' },
  Subdivision: { noun: 'subdivisions', rows: 'subdivisions' },
  Kpi: { noun: 'KPIs', rows: 'KPIs' },
  Portfolio: { noun: 'portfolios', rows: 'portfolios' },
  FRED: { noun: 'series', rows: 'FRED series' },
  HAVER: { noun: 'series', rows: 'HAVER series' },
  MarketCoordinate: { noun: 'coordinates', rows: 'market coordinates' },
  TSDB: { noun: 'symbols', rows: 'TSDB symbols' },
  Dataset: { noun: 'datasets', rows: 'datasets' },
};

const LIBRARY = 'PlotTool Pro\'s function library';

/**
 * One row per entry on stdout: the `Class(args)` and `Measure(args)` an Expression pastes, and
 * the `view` command where a row is not paste-ready (ADR 0084). No rows prints nothing on stdout
 * and says so on stderr (ADR 0070).
 */
export async function presentDataSearch(
  outcome: DataSearchOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  if ('everyClass' in outcome) return presentEveryClass(outcome.everyClass, options);
  if (!outcome.ok) {
    const presented = failed(classSearchFailure(outcome.error));
    return { ...presented, stderr: presented.stderr + nextSteps([outcome.error]) };
  }
  const results = outcome.value;
  if (options.json !== undefined) return json(results.rows, options, '', {});
  const stderr = leftOut(results.rows);
  const rows = onScreen(results.rows);
  if (rows.length === 0) {
    return { stdout: '', stderr: stderr === '' ? `no ${CLASS_TEXT[results.class].rows} match ${JSON.stringify(results.query)}\n` : stderr };
  }
  const { total } = results;
  const table: TextBlock = {
    type: 'table',
    title: results.class,
    noun: CLASS_TEXT[results.class].noun,
    count: { shown: rows.length, ...(total === undefined ? {} : { total: total - (results.rows.length - rows.length) }) },
    headers: HEADERS,
    rows: rows.map(cells),
  };
  return { stdout: renderText([table]), stderr };
}

/**
 * Every Class's rows in one table, in Class order, and a footer naming each Class with more rows
 * than it showed. Each Class is a module (ADR 0030): one that failed keeps its place in the table
 * marked `(failed: …)`, gets its error line on stderr, next steps follow the errors, and the exit
 * is non-zero.
 */
async function presentEveryClass(
  { query, searches }: DataSearchEveryClass,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  const found = searches.flatMap((search) => (search.ok ? [search.value] : []));
  const errors = searches.flatMap((search) => (search.ok ? [] : [search.error]));
  const failures = errors.map(classSearchFailure);
  const notes = [...new Set(failures.map(({ message }) => `Error: ${message}\n`))].join('')
    + nextSteps(errors, errors.length === 1 ? '; every other Class answered' : '');
  const exitCode = failures.length === 0 ? {} : { exitCode: mostSevere(failures) };
  const every = found.flatMap((results) => results.rows);
  if (options.json !== undefined) return json(every, options, notes, exitCode);
  const stderr = leftOut(every) + notes;
  const rows = onScreen(every);
  if (rows.length === 0) {
    return { stdout: '', stderr: stderr === '' ? `nothing in any Class matches ${JSON.stringify(query)}\n` : stderr, ...exitCode };
  }
  const more: readonly TextHint[] = found.filter((results) => results.hasMore).map((results) => ({
    action: `see more ${results.class} rows`,
    command: dataCommand('search', query, '--class', results.class),
  }));
  const blocks: readonly TextBlock[] = [
    { type: 'table', noun: 'rows', headers: HEADERS, rows: searches.flatMap((search, index) => classRows(search, index)) },
    { type: 'hints', hints: more },
  ];
  return { stdout: renderText(blocks), stderr, ...exitCode };
}

// A Class's rows on screen, or its place marked with why it failed.
function classRows(search: DataClassSearch, index: number): readonly (readonly (string | readonly string[] | undefined)[])[] {
  if (search.ok) return onScreen(search.value.rows).map(cells);
  const searched = DATA_SEARCH_CLASSES[index];
  const { error } = search;
  const reason = error.kind === 'class-refused' ? `code: ${error.status}` : classSearchFailure(error).message.replace(`${searched}: `, '');
  return [[`${searched} (failed: ${reason})`, undefined, undefined, undefined, undefined]];
}

// What to do about the failed Classes, after their errors: search alone a Class too slow to
// answer; a Kpi 401 needs an interactive Marquee sign-in, which a re-minted session lacks.
function nextSteps(errors: readonly DataClassSearchError[], others = ''): string {
  return errors.map((error) => {
    if (error.kind === 'class-too-slow') return `Search ${error.class} alone: ${dataCommand('search', error.query, '--class', error.class)}\n`;
    if (error.kind === 'class-refused' && error.class === 'Kpi' && error.status === 401) {
      return `Kpi's search needs an interactive Marquee sign-in${others}\n`;
    }
    return '';
  }).join('');
}

async function json(
  rows: readonly DataClassRow[],
  options: JsonOutputOptions,
  stderr: string,
  exitCode: Readonly<{ exitCode?: number }>,
): Promise<DataPresentation> {
  const formatted = await formatJsonFields(rows.map((row) => ({ ...row, view: view(row) })), options);
  return formatted.ok ? { stdout: formatted.output, stderr, ...exitCode } : failed(failure(formatted.error));
}

function cells(row: DataClassRow): readonly (string | readonly string[] | undefined)[] {
  return [row.classArgs, row.measures, row.name, row.type, view(row)];
}

// A row without Measures, an entity Class's or Dataset's whose Measures vary by instance, points to
// the availability `view` lists.
function view({ classArgs, measures }: DataClassRow): string | undefined {
  return measures.length === 0 ? dataCommand('view', classArgs) : undefined;
}

// Text screens leave out an asset named by its Marquee id (Contract screens bar raw ids); `--json` lists it.
function onScreen(rows: readonly DataClassRow[]): readonly DataClassRow[] {
  return rows.filter((row) => row.withoutBbid !== true);
}

// Says how many assets a text screen left out, and where they are listed.
function leftOut(rows: readonly DataClassRow[]): string {
  const count = rows.length - onScreen(rows).length;
  if (count === 0) return '';
  return `Left out ${count} ${count === 1 ? 'asset' : 'assets'} without a Bloomberg ID; --json name,classArgs lists them\n`;
}

// A login fixes every Class at once, so it outranks the other failures' exit codes.
function mostSevere(failures: readonly Failure[]): number {
  const codes = failures.map(({ exitCode }) => exitCode);
  if (codes.includes(CLI_EXIT_CODES.authRequired)) return CLI_EXIT_CODES.authRequired;
  if (codes.includes(CLI_EXIT_CODES.cancelled)) return CLI_EXIT_CODES.cancelled;
  return CLI_EXIT_CODES.failure;
}

function classSearchFailure(error: DataClassSearchError): Failure {
  switch (error.kind) {
    case 'empty-query':
      return usageFailure('data search query must not be empty');
    case 'invalid-limit':
      return usageFailure(`--limit must be a whole number from 1 to ${error.maximum} for --class ${error.class}`);
    case 'limit-without-class':
      return usageFailure(`--limit needs --class; a search of every Class shows ${error.rowsPerClass} rows from each`);
    case 'class-refused':
      return failure(`${error.class}: code: ${error.status} - ${error.message}`);
    case 'malformed-results':
      return malformedResults(`${error.class} search`, error.location, error.problem);
    case 'search-failed':
      return requestFailure(`${error.class} search`, error.failure);
    case 'class-too-slow':
      return failure(`${error.class}: did not answer within ${error.deadlineMs / 1000}s`);
    case 'library-failed':
      return libraryFailure(error.failure);
    case 'class-not-in-library':
      return failure(`${LIBRARY} lists no Measures for ${error.class}`);
  }
}

function libraryFailure(error: DataCatalogFailure): Failure {
  switch (error.kind) {
    case 'catalog-cache-unreadable':
    case 'catalog-cache-unwritable':
      return cacheFailure(error);
    case 'malformed-catalog':
      return malformedResults(LIBRARY, error.location, error.problem);
    case 'catalog-unavailable':
      return requestFailure(LIBRARY, error.failure, error.reason);
  }
}
