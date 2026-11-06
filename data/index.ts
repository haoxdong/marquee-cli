import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createProductionPlotTool } from '../plottool/index.js';
import { evaluateExpressions } from './eval.js';
import {
  DATA_EVAL_JSON_FIELDS,
  presentDataEval as presentDataEvalImplementation,
} from './presenters/eval.js';
import {
  DATA_SEARCH_JSON_FIELDS,
  presentDataSearch as presentDataSearchImplementation,
} from './presenters/search.js';
import { listData } from './list.js';
import {
  DATA_LIST_JSON_FIELDS,
  presentDataList as presentDataListImplementation,
} from './presenters/list.js';
import {
  DATA_VIEW_JSON_FIELDS,
  presentDataView as presentDataViewImplementation,
} from './presenters/view.js';
import {
  DATA_SEARCH_CLASSES,
  DEFAULT_LIMIT,
  EVERY_CLASS_DEADLINE_MS,
  EVERY_CLASS_LIMIT,
  LIMIT_MAXIMUM,
  searchData,
} from './search.js';
import type { JsonOutputOptions } from '../presentation/index.js';
import type {
  Data,
  DataConfig,
  DataDate,
  DataEvalOutcome,
  DataInterval,
  DataListOutcome,
  DataPresentation,
  DataSearchClass,
  DataSearchOutcome,
  DataViewOutcome,
} from './types.js';
import { viewData } from './view.js';
import {
  DATA_DATE_FORMS,
  DATA_INTERVALS,
  parseDataDate as parseDate,
  parseDataInterval as parseInterval,
} from './window.js';
export type {
  Data,
  DataConfig,
  DataDate,
  DataEvalInput,
  DataEvalOutcome,
  DataInterval,
  DataListOutcome,
  DataPresentation,
  DataSearchClass,
  DataSearchOutcome,
  DataViewOutcome,
} from './types.js';

export function createData(config: DataConfig): Data {
  const { request } = config;
  const plotTool = createProductionPlotTool({ request });
  const now = config.now ?? marqueeNow;
  const cacheDirectory = config.cacheDirectory ?? defaultCacheDirectory();
  return {
    eval: (input) => evaluateExpressions({ plotTool, request, cacheDirectory }, now(), input),
    search: (input) => searchData(
      { request, cacheDirectory, everyClassDeadlineMs: config.everyClassDeadlineMs ?? EVERY_CLASS_DEADLINE_MS },
      now(),
      input,
    ),
    list: (input) => listData({ request, cacheDirectory }, now(), input),
    view: (input) => viewData({ request, cacheDirectory }, now(), input),
  };
}

export function presentDataEval(
  outcome: DataEvalOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  return presentDataEvalImplementation(outcome, options);
}

/** The `--start-date`/`--end-date` spellings, for help and usage errors. */
export function dataDateForms(): string {
  return DATA_DATE_FORMS;
}

/** The `--interval` values the runner takes. */
export function dataIntervals(): readonly DataInterval[] {
  return DATA_INTERVALS;
}

/** A `--start-date`/`--end-date` value, or undefined when it is none of `dataDateForms()`. */
export function parseDataDate(token: string): DataDate | undefined {
  return parseDate(token);
}

/** An `--interval` value in either case, or undefined when it is none of `dataIntervals()`. */
export function parseDataInterval(token: string): DataInterval | undefined {
  return parseInterval(token);
}

/** `marquee data eval --json` fields. */
export function dataEvalJsonFields(): readonly string[] {
  return DATA_EVAL_JSON_FIELDS;
}

/** The Classes `marquee data search --class` takes. */
export function dataSearchClasses(): readonly DataSearchClass[] {
  return DATA_SEARCH_CLASSES;
}

/** `marquee data search` row limits: per Class without `--limit`, per Class over every Class, and each Class's largest. */
export function dataSearchLimits(): Readonly<{
  defaultLimit: number;
  everyClassLimit: number;
  maximum: Readonly<Record<DataSearchClass, number>>;
}> {
  return { defaultLimit: DEFAULT_LIMIT, everyClassLimit: EVERY_CLASS_LIMIT, maximum: LIMIT_MAXIMUM };
}

/** `marquee data search --json` fields. */
export function dataSearchJsonFields(): readonly string[] {
  return DATA_SEARCH_JSON_FIELDS;
}

export function presentDataSearch(
  outcome: DataSearchOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  return presentDataSearchImplementation(outcome, options);
}

/** `marquee data list --json` fields. */
export function dataListJsonFields(): readonly string[] {
  return DATA_LIST_JSON_FIELDS;
}

export function presentDataList(
  outcome: DataListOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  return presentDataListImplementation(outcome, options);
}

/** `marquee data view --json` fields. */
export function dataViewJsonFields(): readonly string[] {
  return DATA_VIEW_JSON_FIELDS;
}

export function presentDataView(
  outcome: DataViewOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  return presentDataViewImplementation(outcome, options);
}

// Replay gives each Scenario its own directory, so a recorded request set never depends
// on what an earlier Scenario cached.
function defaultCacheDirectory(): string {
  return catalogCacheDirectory(process.env, homedir());
}

/**
 * Where catalogs are cached: under the MarqueeBot proxy's endpoint and account, when set, so
 * one account never reads a catalog fetched as another.
 */
export function catalogCacheDirectory(env: NodeJS.ProcessEnv, home: string): string {
  const directory = env.MARQUEE_CACHE_DIR ?? join(home, '.marquee', 'cache');
  const baseUrl = env.MARQUEE_BASE_URL?.trim();
  const accountId = env.MARQUEEBOT_ACCOUNT_ID?.trim();
  if (!baseUrl && !accountId) return directory;
  return join(directory, createHash('sha256').update(`${baseUrl ?? ''}\n${accountId ?? ''}`).digest('hex').slice(0, 16));
}

// Replay pins the clock to a Scenario's `as_of` through `MARQUEE_NOW`.
function marqueeNow(): Date {
  return process.env.MARQUEE_NOW ? new Date(process.env.MARQUEE_NOW) : new Date();
}
