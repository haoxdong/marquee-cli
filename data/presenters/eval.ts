import type { PlotToolEvaluationError, PlotToolProjectedSeries } from '../../plottool/index.js';
import { projectPlotToolEvaluation } from '../../plottool/projection.js';
import { plotToolDataTable, plotToolStatisticsTable } from '../../plottool/text-tables.js';
import {
  CLI_EXIT_CODES,
  formatJsonFields,
  type JsonOutputOptions,
  type JsonRecord,
} from '../../presentation/index.js';
import { dataPreview, renderText, statisticsBlocks, type TextBlock } from '../../presentation/text.js';
import type { Result } from '../../lib/result.js';
import type {
  DataChartFailure,
  DataEvalError,
  DataEvalOutcome,
  DataEvalResult,
  DataEvalWindow,
  DataEvaluation,
  DataPresentation,
  DataSavedChart,
} from '../types.js';
import {
  cacheFailure,
  failed,
  failure,
  malformedResults,
  notAuthenticated,
  requestFailure,
  type Failure,
} from './failures.js';
import { evalCommand, signatureHint, signatureView } from '../command-lines.js';
import { weekdayMonthEndOnOrBefore } from '../window.js';

type SeriesResult = Extract<DataEvalResult, { kind: 'series' }>;

type CurveResult = Extract<DataEvalResult, { kind: 'curve' }>;

type ObjectResult = Extract<DataEvalResult, { kind: 'object' }>;

type FailedResult = Extract<DataEvalResult, { kind: 'value' | 'error' }>;

type FailedEvaluation = Extract<DataEvalOutcome, { ok: false }>;

/**
 * `marquee data eval --json` fields: the resolved window, every result, provenance, the saved
 * chart's link and the file `--picture` wrote.
 */
export const DATA_EVAL_JSON_FIELDS = [
  'endDate',
  'interval',
  'picture',
  'provenance',
  'results',
  'startDate',
  'url',
] as const;

/**
 * PlotTool Web's statistics grid and the Data preview for the series, one row per curve point
 * and one per model, then the saved chart's link on stdout, or `--json` with every
 * Expression's result and the link; every Expression that did not return a series gets one
 * error line on stderr and makes the exit non-zero in both modes (ADR 0084). Under `--json` a
 * failed Expression also keeps its `error` in `results`: it is data about the batch, not a
 * JSON error envelope (ADR 0070). A chart that could not be saved, or a picture not written,
 * fails the command after the results print, which it never withholds (ADR 0030).
 */
export async function presentDataEval(
  outcome: DataEvalOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  if (!outcome.ok) return batchPresentation(outcome);
  const { results, chart, upstreamFailure } = outcome.value;
  const chartFailed = chartFailure(chart);
  const failed = results.filter(isFailed);
  const failures = [
    ...failed.map((result) => `Error: ${result.expression}: ${failureMessage(result)}\n`),
    chartFailed === undefined ? '' : `Error: ${chartFailed.message}\n`,
    guidance(failed.map((result) => ({ expression: result.expression, hints: hintsOf(result) }))),
    upstreamFailure === undefined
      ? ''
      : `${upstreamFailure.failed} of ${upstreamFailure.total} expressions failed upstream; run them again: ${upstreamFailure.command}\n`,
  ].join('');
  const exitCode = chartFailed?.exitCode ?? (failures === '' ? undefined : CLI_EXIT_CODES.failure);
  const exit = exitCode === undefined ? {} : { exitCode };
  if (options.json === undefined) return { stdout: resultTables(results, chart), stderr: failures, ...exit };
  const formatted = await formatJsonFields(evaluationJson(outcome.value), options);
  return formatted.ok
    ? { stdout: formatted.output, stderr: failures, ...exit }
    // A failed Expression first: it is often why the filter found nothing to read.
    : { stdout: '', stderr: `${failures}Error: ${formatted.error}\n`, exitCode: CLI_EXIT_CODES.failure };
}

type Chart = Result<DataSavedChart, DataChartFailure>;

// The save's failure, else the picture's.
function chartFailure(chart: Chart): Failure | undefined {
  if (!chart.ok) return chartFailureOf(chart.error);
  const { picture } = chart.value;
  return picture === undefined || picture.ok ? undefined : chartFailureOf(picture.error);
}

function chartFailureOf(error: DataChartFailure): Failure {
  switch (error.kind) {
    case 'chart-request-failed':
      return requestFailure(CHART_SUBJECTS[error.subject], error.failure, error.reason);
    case 'malformed-chart':
      return malformedResults(CHART_SUBJECTS[error.subject], error.location, error.problem);
    case 'picture-unwritable':
      return failure(`Picture unwritable at ${error.path}: ${error.problem}`);
  }
}

const CHART_SUBJECTS = { save: 'PlotTool Pro chart save', picture: 'PlotTool Pro chart picture' } as const;

// The link, and the file the picture went to, as fields under the results.
function chartFields(chart: Chart): readonly TextBlock[] {
  if (!chart.ok) return [];
  const { link, picture } = chart.value;
  return [
    { type: 'field', key: 'url', value: link },
    ...(picture?.ok === true ? [{ type: 'field' as const, key: 'picture', value: picture.value }] : []),
  ];
}

function isFailed(result: DataEvalResult): result is FailedResult {
  return result.kind === 'value' || result.kind === 'error';
}

// Series print under the window their points cover, then as PlotTool Web shows a new chart of
// them: its statistics grid, then the Data preview `widget view` prints; a curve has no dates,
// so each of its points is a row; a model prints its name, for the methods an Expression calls
// on it.
function resultTables(results: readonly DataEvalResult[], chart: Chart): string {
  const series = results.filter((result): result is SeriesResult => result.kind === 'series');
  const curves = results.filter((result): result is CurveResult => result.kind === 'curve');
  const objects = results.filter((result): result is ObjectResult => result.kind === 'object');
  const projection = series.length === 0 ? undefined : projectPlotToolEvaluation(series);
  // Each series is labelled by its Expression as typed, not the legend Web derives from it.
  const asTyped = ({ sourceIndex }: PlotToolProjectedSeries) => series[sourceIndex]?.expression ?? unpresentable(
    `series ${sourceIndex} has no Expression`,
  );
  return renderText([
    ...(projection === undefined ? [] : [
      ...statisticsBlocks(plotToolStatisticsTable(projection, asTyped, unpresentable)),
      dataPreview(plotToolDataTable(projection, asTyped, unpresentable)),
    ]),
    ...(curves.length === 0 ? [] : [{
      type: 'table' as const,
      noun: 'curve points',
      headers: ['expression', 'point', 'value'],
      rows: curves.flatMap(({ expression, points }) => points.map(({ point, value }) => [expression, point, value])),
    }]),
    ...(objects.length === 0 ? [] : [{
      type: 'table' as const,
      noun: 'objects',
      headers: ['expression', 'object'],
      rows: objects.map(({ expression, value }) => [expression, value]),
    }]),
    ...chartFields(chart),
  ]);
}

// The runner's series always project (its dates and numbers decode first), so this is a bug.
function unpresentable(detail: string): never {
  throw new Error(`data eval cannot present the series: ${detail}`);
}

function evaluationJson({ window, provenance, results, chart }: DataEvaluation): JsonRecord {
  const picture = chart.ok ? chart.value.picture : undefined;
  return {
    ...window,
    provenance,
    results: results.map(resultJson),
    ...(chart.ok ? { url: chart.value.link } : {}),
    ...(picture?.ok === true ? { picture: picture.value } : {}),
  };
}

function resultJson(result: DataEvalResult): JsonRecord {
  switch (result.kind) {
    case 'series':
      return {
        expression: result.expression,
        values: result.points,
        ...(result.statistics === undefined ? {} : { statistics: result.statistics }),
      };
    case 'curve':
      return { expression: result.expression, values: result.points };
    case 'value': {
      const hints = hintsOf(result);
      return { expression: result.expression, value: result.value, ...(hints === undefined ? {} : { hints }) };
    }
    case 'object':
      return { expression: result.expression, object: result.value };
    case 'error':
      return {
        expression: result.expression,
        error: failureMessage(result),
        ...(result.hints === undefined ? {} : { hints: result.hints }),
      };
  }
}

// Every Expression the function library rejects, or the one reason the batch failed.
function batchPresentation({ error, window, expressions }: FailedEvaluation): DataPresentation {
  if (error.kind === 'invalid-expressions') {
    return {
      stdout: '',
      stderr: [
        ...error.problems.map(({ expression, message }) => `Error: ${expression}: ${message}\n`),
        guidance(error.problems),
      ].join(''),
      exitCode: CLI_EXIT_CODES.failure,
      usage: true,
    };
  }
  return failed(batchFailure(error, window, expressions));
}

function hintsOf(result: DataEvalResult): readonly string[] | undefined {
  if (result.kind === 'error') return result.hints;
  if (result.kind !== 'value') return undefined;
  const hint = signatureHint(result.expression);
  return hint === undefined ? undefined : [hint];
}

// Our guidance comes after every row, each Expression's hints under its name, so a row holds only
// what Marquee said.
function guidance(rows: readonly Readonly<{ expression: string; hints?: readonly string[] | undefined }>[]): string {
  return rows
    .filter((row): row is Readonly<{ expression: string; hints: readonly string[] }> => (row.hints?.length ?? 0) > 0)
    .map(({ expression, hints }) => [`Hints for ${expression}:`, ...hints.map((line) => `  ${line}`)].map((line) => `${line}\n`).join(''))
    .join('');
}

// Marquee's error as Marquee Web's View Errors shows it, `code: <status> - <message>`.
function failureMessage(result: FailedResult): string {
  if (result.kind === 'value') return `evaluated to the text ${JSON.stringify(result.value)}, not a series`;
  return result.status === undefined ? result.message : `code: ${result.status} - ${result.message}`;
}

const LIBRARY = 'PlotTool Pro\'s function library';

function batchFailure(
  error: Exclude<DataEvalError, { kind: 'invalid-expressions' }>,
  window: DataEvalWindow,
  expressions: readonly string[],
): Failure {
  switch (error.kind) {
    case 'catalog-cache-unreadable':
    case 'catalog-cache-unwritable':
      return cacheFailure(error);
    case 'malformed-catalog':
      return malformedResults(LIBRARY, error.location, error.problem);
    case 'catalog-unavailable':
      return requestFailure(LIBRARY, error.failure, error.reason);
    case 'explanation-failed': {
      const { subject, failure: read } = error;
      return read.kind === 'malformed-catalog'
        ? malformedResults(subject, read.location, read.problem)
        : requestFailure(subject, read.failure, read.reason);
    }
    default:
      return runnerFailure(error, window, expressions);
  }
}

type RunnerFailure = Extract<PlotToolEvaluationError, { kind: 'execution-failed' }>;

// Marquee's answer verbatim, as Marquee Web shows the whole call failing, then our next step and
// the same batch to run again: data eval never splits it or sends it again.
function runnerFailure(error: PlotToolEvaluationError, window: DataEvalWindow, expressions: readonly string[]): Failure {
  if (error.kind === 'malformed-results') return malformedResults('PlotTool Pro', error.location, error.problem);
  if (error.authentication !== undefined) return notAuthenticated();
  const answer = runnerAnswer(error);
  if (answer === undefined) return requestFailure('PlotTool Pro evaluation', error.failure, error.reason);
  const count = expressions.length === 1 ? '1 expression' : `${expressions.length} expressions`;
  return failure([
    `PlotTool Pro evaluation of ${count}: ${answer}`,
    `Hint: ${runnerHint(error, window, expressions)}`,
    `run it again: ${evalCommand(expressions, window)}`,
  ].join('\n'));
}

function runnerAnswer({ status, message, timeoutMs }: RunnerFailure): string | undefined {
  if (timeoutMs !== undefined) return `no answer within ${timeoutMs / 1000} s`;
  if (status === undefined) return undefined;
  return message === undefined ? `code: ${status}` : `code: ${status} - ${message}`;
}

const STATUS_HINTS: Readonly<Record<number, string>> = {
  403: 'Marquee denied access to data an Expression reads; drop that Expression or ask for access in Marquee',
  429: 'Marquee is limiting requests; wait a moment first',
};

function runnerHint(error: RunnerFailure, window: DataEvalWindow, expressions: readonly string[]): string {
  if (error.timeoutMs !== undefined) return 'a cold or long window answers slowly; a later --start-date answers sooner';
  const status = error.status ?? 0;
  if (status === 500 && window.interval === '1M') return monthlyHint(window);
  if (status >= 502) return 'Marquee was unavailable for a moment, and usually answers a second run';
  // One Expression the runner cannot evaluate fails its whole batch with one 500 (live,
  // 2026-10-16: `SPX.dividend_yield()` with no arguments).
  const lead = status === 500 ? 'one Expression PlotTool Pro cannot evaluate fails the whole call; ' : '';
  return STATUS_HINTS[status] ?? `${lead}check their arguments: ${signatureViews(expressions)}`;
}

/** How many `data view` commands a hint names before counting the rest. */
const LISTED_VIEWS = 3;

function signatureViews(expressions: readonly string[]): string {
  const views = [...new Set(expressions.flatMap((expression) => signatureView(expression) ?? []))];
  const more = views.length - LISTED_VIEWS;
  return [...views.slice(0, LISTED_VIEWS), ...(more > 0 ? [`and ${more} more`] : [])].join(', ');
}

// The runner answers 1M with a 500 for every series unless the window ends on a month end that is
// a weekday (live, 2026-11-05); some series, such as `FRED(UNRATE)`, fail at 1M even then.
function monthlyHint({ startDate, endDate }: DataEvalWindow): string {
  const monthEnd = weekdayMonthEndOnOrBefore(endDate);
  if (monthEnd === endDate) return 'some series fail at --interval 1M; try --interval 1W or 1D';
  const rule = `--interval 1M answers only for a window ending on a month end that is a weekday, and --end-date ${endDate} is not one`;
  return monthEnd < startDate ? `${rule}; try --interval 1W` : `${rule}; try --end-date ${monthEnd}, or --interval 1W`;
}
