import type { PlotTool } from '../plottool/index.js';
import { allOk, type Result } from '../lib/result.js';
import type { Transport } from '../transport/index.js';
import { cachedFunctionLibrary } from './catalog-cache.js';
import { saveEvalChart } from './chart.js';
import { expressionProblems } from './checks.js';
import { dataCommand, evalCommand, signatureHint, signatureView } from './command-lines.js';
import { createExplainer, type EmptySeries, type Explainer, type ExpressionFailure } from './explanations.js';
import { expressionCalls } from './expressions.js';
import type {
  DataEvalError,
  DataEvalInput,
  DataEvalOutcome,
  DataEvalResult,
  DataEvalWindow,
  DataEvaluation,
  DataExplanationFailure,
  FunctionLibrary,
} from './types.js';
import { dataEvalWindow, runnerInterval } from './window.js';

type EvalDependencies = Readonly<{
  plotTool: PlotTool;
  request: Transport['request'];
  /** Where catalogs are cached between runs. */
  cacheDirectory: string;
}>;

/**
 * Checks Expressions against the cached function library, then evaluates them in one
 * runner call over the resolved window (ADR 0084) and explains each rejection, while saving
 * them as a PlotTool Pro chart alongside. Like Marquee Web, it never splits the batch or sends it
 * again: a batch the runner fails as a whole fails the command. A catalog an explanation cannot read fails the command
 * (ADR 0030).
 */
export async function evaluateExpressions(
  dependencies: EvalDependencies,
  now: Date,
  input: DataEvalInput,
): Promise<DataEvalOutcome> {
  const { request, cacheDirectory } = dependencies;
  const { expressions } = input;
  const window = dataEvalWindow(now, input);
  const library = await cachedFunctionLibrary(request, cacheDirectory, now);
  if (!library.ok) return { ok: false, error: library.error, window, expressions };
  const problems = expressionProblems(library.value, expressions);
  if (problems.length > 0) return { ok: false, error: { kind: 'invalid-expressions', problems }, window, expressions };
  // The save runs beside the runner, so it adds only what it outlasts the runner by (live,
  // 2026-10-28: about 0.1 s against a cached runner answer, none against a slower one).
  const [answer, chart] = await Promise.all([
    answered(dependencies, library.value, window, expressions),
    saveEvalChart(request, input),
  ]);
  if (!answer.ok) return { ok: false, error: answer.error, window, expressions };
  return { ok: true, value: { window, ...answer.value, chart } };
}

type Answer = Result<Pick<DataEvaluation, 'results' | 'provenance' | 'upstreamFailure'>, DataEvalError>;

async function answered(
  { plotTool, request }: EvalDependencies,
  library: FunctionLibrary,
  window: DataEvalWindow,
  expressions: readonly string[],
): Promise<Answer> {
  const batch = await plotTool.evaluate({
    expressions,
    startDate: window.startDate,
    endDate: window.endDate,
    interval: runnerInterval(window.interval),
  });
  if (!batch.ok) return batch;
  const explain = createExplainer(request, library);
  const results = await allOk(batch.value.results.map(async (result): Promise<Explained> => {
    if (result.kind === 'error') return explained(result, explain);
    return result.kind === 'empty-series' ? withoutPoints(result, window, explain) : { ok: true, value: result };
  }));
  if (!results.ok) return results;
  const upstreamFailure = failedUpstream(expressions, results.value, window);
  return {
    ok: true,
    value: { results: results.value, provenance: batch.value.provenance, ...(upstreamFailure ? { upstreamFailure } : {}) },
  };
}

// Marquee fails some Expressions upstream (5xx) for a moment, at any batch size (live,
// 2026-11-04), so a caller runs only those again, after the assignments they name, over the same window.
function failedUpstream(
  expressions: readonly string[],
  results: readonly DataEvalResult[],
  window: DataEvalWindow,
): DataEvaluation['upstreamFailure'] {
  const failed = results.flatMap((result, index) => (
    result.kind === 'error' && (result.status ?? 0) >= 500 ? [index] : []
  ));
  if (failed.length === 0) return undefined;
  const again = [...new Set(failed.flatMap((index) => [...assignmentsNamed(expressions, index), index]))]
    .sort((left, right) => left - right)
    .map((index) => expressions[index] ?? '');
  return {
    failed: failed.length,
    total: expressions.length,
    command: evalCommand(again, window),
  };
}

type Explained = Result<DataEvalResult, DataExplanationFailure>;

const ASSIGNMENT = /^\s*([A-Za-z_]\w*)\s*=(?!=)/;

function assignmentsNamed(expressions: readonly string[], index: number): readonly number[] {
  const needed = new Set<number>();
  const pending = [index];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    const body = (expressions[at] ?? '').replace(ASSIGNMENT, '').replace(/"[^"]*"|#.*/g, '').replace(/\.\s*[A-Za-z_]\w*/g, '');
    for (const name of new Set(body.match(/[A-Za-z_]\w*/g) ?? [])) {
      const source = lastAssignment(expressions, at, name);
      if (source !== undefined && !needed.has(source)) {
        needed.add(source);
        pending.push(source);
      }
    }
  }
  return [...needed].sort((left, right) => left - right);
}

function lastAssignment(expressions: readonly string[], before: number, name: string): number | undefined {
  for (let at = before - 1; at >= 0; at -= 1) {
    if (ASSIGNMENT.exec(expressions[at] ?? '')?.[1] === name) return at;
  }
  return undefined;
}

async function explained(
  failure: ExpressionFailure & Readonly<{ status?: number }>,
  explain: Explainer,
): Promise<Explained> {
  const explanation = await explain.rejection(failure);
  if (!explanation.ok) return explanation;
  // A 5xx's next step is the rerun line, and a denial's is access, not arguments; any other failure
  // no catalog explains points to its signature.
  const status = failure.status ?? 0;
  const fallback = status >= 500 || status === 401 || status === 403 ? undefined : signatureHint(failure.expression);
  const hints = { ok: true, value: explanation.value.length > 0 || fallback === undefined ? explanation.value : [fallback] };
  return {
    ok: true,
    value: {
      kind: 'error',
      expression: failure.expression,
      message: failure.message,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      ...(hints.value.length === 0 ? {} : { hints: hints.value }),
    },
  };
}

// A series with no points fails like any other Expression (ADR 0030): the runner answers
// an unknown FRED id, an asset measure with no data, a window too short and a Measure's
// argument off its grid alike.
async function withoutPoints(series: EmptySeries, window: DataEvalWindow, explain: Explainer): Promise<Explained> {
  const choices = await explain.emptySeries(series);
  if (!choices.ok) return choices;
  const view = signatureView(series.expression);
  const hint = noPointsHint(series.expression) ?? (view === undefined ? undefined : `Try an earlier --start-date, or check its arguments: ${view}`);
  const hints = choices.value.length > 0 || hint === undefined ? choices.value : [hint];
  return {
    ok: true,
    value: {
      kind: 'error',
      expression: series.expression,
      message: `no points between ${window.startDate} and ${window.endDate}`,
      ...(hints.length === 0 ? {} : { hints }),
    },
  };
}

// Classes whose search finds an id by the id itself (live: `UNRATE` and `GDBR10_BB`,
// 2026-10-16; `NAPMC` and `IR_USD_SWAP_10Y.ATMRATE`, 2026-10-28).
const ID_CLASSES: ReadonlySet<string> = new Set(['FRED', 'TSDB', 'HAVER', 'MarketCoordinate']);

// Where to check what an Expression with no points names: the Measures of the Entity it calls
// a Measure on directly (`EXMP UW.spot()`), or the search of the Class whose id it constructs
// (`FRED(T10Y2Y).value()`), as an unknown id and a discontinued one answer alike.
function noPointsHint(expression: string): string | undefined {
  const [outermost] = expressionCalls(expression);
  if (outermost?.receiver?.kind === 'identifier') {
    return `List its measures: ${dataCommand('view', outermost.receiver.text)}`;
  }
  const [id] = outermost?.arguments ?? [];
  if (outermost === undefined || !ID_CLASSES.has(outermost.name) || id === undefined) return undefined;
  return `Check the id: ${dataCommand('search', id.replace(/^"|"$/g, ''), '--class', outermost.name)}`;
}
