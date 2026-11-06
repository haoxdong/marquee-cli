import { PlotToolApi } from '../../api/plottool/index.js';
import type { Result } from '../../lib/result.js';
import { MarqueeError, type Endpoint } from '../../transport/index.js';
import type {
  PlotToolCurvePoint,
  PlotToolEvaluation,
  PlotToolEvaluationError,
  PlotToolEvaluationInput,
  PlotToolExpressionResult,
  PlotToolResolvedAsset,
} from '../types.js';
import { payloadHeaders } from './headers.js';
import { assetWithoutDataset, oneLineMessage } from './messages.js';
import {
  PlotToolResultDecodeError,
  readPlotToolRunnerItems,
  requiredRecord,
  type PlotToolRunnerItem,
} from './results.js';
import { readPlotToolSeriesStatistics } from './statistics.js';

type EvaluationRequest = (
  endpoint: Endpoint,
  init?: Readonly<{
    headers?: Readonly<Record<string, string>>;
    body?: unknown;
    isErrorBodyPreserved?: boolean;
    timeoutMs?: number;
  }>,
) => Promise<unknown>;

// An agent answers a question in 10–20s end to end, so a slow runner call fails rather than
// blocks it. One MDAPI coordinate takes 11–21s to evaluate (live, 2026-10-16), so 30s still
// lets one through; a cold batch of several fails.
const RUNNER_TIMEOUT_MS = 30_000;

type Outcome<T> = Result<T, PlotToolEvaluationError>;

/**
 * Evaluates Expressions in one runner call, with the runner's statistics as PlotTool Web asks
 * for them. The runner's status follows a failing Expression (memo 0047 §6), so a non-2xx
 * body that still carries per-Expression results is read like a 2xx one; only a batch with no
 * results fails as a whole.
 */
export async function evaluatePlotToolExpressions(
  request: EvaluationRequest,
  input: PlotToolEvaluationInput,
): Promise<Outcome<PlotToolEvaluation>> {
  try {
    const answered = await runEvaluation(request, input);
    return answered.ok
      ? { ok: true, value: readEvaluation(input.expressions, answered.value) }
      : answered;
  /* c8 ignore start -- Recording-unreachable for supported responses; focused malformed-response tests pin the typed decoder failure and the rethrown unclassified one. */
  } catch (error) {
    if (!(error instanceof PlotToolResultDecodeError)) throw error;
    return {
      ok: false,
      error: { kind: 'malformed-results', location: error.path, problem: error.problem },
    };
  }
  /* c8 ignore stop */
}

async function runEvaluation(
  request: EvaluationRequest,
  input: PlotToolEvaluationInput,
): Promise<Outcome<unknown>> {
  const api = new PlotToolApi({
    request: (endpoint, init) => request(endpoint, {
      headers: payloadHeaders(),
      body: init?.body,
      isErrorBodyPreserved: true,
      timeoutMs: RUNNER_TIMEOUT_MS,
    }),
  });
  try {
    return { ok: true, value: await api.runPlot(runnerBody(input)) };
  } catch (error) {
    /* c8 ignore next -- Recording-unreachable: replayed runner failures are all MarqueeErrors; a focused evaluation test pins the rethrown unclassified one. */
    if (!(error instanceof MarqueeError)) throw error;
    const body = runnerResultsBody(error);
    return body === undefined
      ? { ok: false, error: executionFailure(error) }
      : { ok: true, value: body };
  }
}

function runnerBody(input: PlotToolEvaluationInput): Readonly<Record<string, unknown>> {
  return {
    expressions: [...input.expressions],
    // `statistics: true` fails no interval the runner otherwise answers (live, 2026-10-22: 1D and
    // 7D answer with and without it; 1W, and 1M to a date that is not a month end, answer 500 either way).
    statistics: true,
    realTime: false,
    hints: [],
    variables: {},
    interval: input.interval,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}

function runnerResultsBody(error: MarqueeError): unknown {
  /* c8 ignore start -- Recording-unreachable: every recorded runner failure answers JSON; focused evaluation tests pin a timed-out batch and an HTML denial. */
  const body = statusBody(error);
  if (body === undefined || !body.trimStart().startsWith('{')) return undefined;
  /* c8 ignore stop */
  const parsed = parseFailureBody(body);
  const hasResults = typeof parsed === 'object' && parsed !== null
    && Array.isArray((parsed as Readonly<Record<string, unknown>>).results);
  return hasResults ? parsed : undefined;
}

function parseFailureBody(body: string): unknown {
  try {
    return JSON.parse(body);
  /* c8 ignore start -- Recording-unreachable: every recorded runner failure body parses; a focused malformed-response test pins the typed decoder failure. */
  } catch {
    throw new PlotToolResultDecodeError('failure body', 'expected JSON');
  }
  /* c8 ignore stop */
}

// The body Marquee answered a non-2xx status with. The MarqueeBot session gateway relays it without
// the direct transport's `http_status` classification (live, 2026-11-05).
function statusBody(error: MarqueeError): string | undefined {
  const classification = error.details?.responseClassification;
  /* c8 ignore next 3 -- Recording-unreachable: Recordings come from the direct transport, which classifies every status body; a focused evaluation test pins the session gateway's unclassified one. */
  return error.code === 'http' && (classification === undefined || classification === 'http_status')
    ? error.details?.body
    : undefined;
}

function executionFailure(error: MarqueeError): PlotToolEvaluationError {
  const status = error.details?.status;
  /* c8 ignore start -- Recording-unreachable: the one recorded whole-batch failure is a 500; focused evaluation tests pin expired and upstream 401s, a denial and a timeout. */
  const authentication = error.code === 'auth_expired'
    ? 'expired' as const
    : status === 401
      ? 'required' as const
      : undefined;
  const body = statusBody(error);
  return {
    kind: 'execution-failed',
    ...(status === undefined ? {} : { status }),
    ...(body === undefined || body.trim() === '' ? {} : { message: oneLineMessage(body.trim()) }),
    ...(error.code === 'timeout' ? { timeoutMs: RUNNER_TIMEOUT_MS } : {}),
    ...(status === 403 ? { reason: 'access-denied' as const } : {}),
    ...(authentication ? { authentication } : {}),
    /* c8 ignore stop */
    failure: error.dependencyFailure(),
  };
}

function readEvaluation(expressions: readonly string[], value: unknown): PlotToolEvaluation {
  const { response, items } = readPlotToolRunnerItems(value);
  /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
  if (items.length !== expressions.length) {
    throw new PlotToolResultDecodeError(
      'results',
      `expected ${expressions.length} results, got ${items.length}`,
    );
  }
  /* c8 ignore stop */
  const entities = entityLists(response.entities, items.length);
  const statistics = readPlotToolSeriesStatistics(response.results as readonly unknown[], response.statistics);
  return {
    results: items.map((item, index) => {
      /* c8 ignore start -- Unreachable: the count checks above align results, Expressions and entities; the fallbacks only satisfy noUncheckedIndexedAccess. */
      const result = expressionResult(expressions[index] ?? '', item, index, entities[index] ?? []);
      /* c8 ignore stop */
      const summary = statistics[index];
      return result.kind === 'series' && summary !== undefined ? { ...result, statistics: summary } : result;
    }),
    provenance: {
      assetIds: strings(response.asset_ids, 'asset_ids'),
      datasets: strings(response.datasets, 'datasets'),
      tsdbSymbols: strings(response.tsdb_symbols, 'tsdb_symbols'),
    },
  };
}

function expressionResult(
  expression: string,
  item: PlotToolRunnerItem,
  index: number,
  entities: readonly unknown[],
): PlotToolExpressionResult {
  if (item.kind === 'error') {
    const { message, statusCode } = item.error;
    /* c8 ignore next -- Recording-unreachable: every recorded item error carries a status; a focused malformed-response test pins the typed decoder failure. */
    if (statusCode === undefined) throw new PlotToolResultDecodeError(`results[${index}].statusCode`, 'expected a number');
    const written = assetWithoutDataset(message);
    const assets = resolvedAssets(entities, `entities[${index}]`).map((asset) => (
      asset.assetId === written?.assetId ? { ...asset, identifier: written.identifier } : asset
    ));
    return {
      kind: 'error',
      expression,
      message: oneLineMessage(message),
      status: statusCode,
      assets,
    };
  }
  const { type, values } = item.result;
  if (type === 'series') return seriesResult(expression, values, entities, index);
  if (type === 'sortedSeries' && Array.isArray(values)) {
    // A FRED id with no data in the window, or none at all, answers an empty `sortedSeries`.
    if (values.length === 0) return emptySeries(expression, entities, index);
    // A smile answers its points keyed by delta (live: `EURUSD.fx_vol_smile(3m)`, 2026-10-16).
    return { kind: 'curve', expression, points: curvePoints(values, `results[${index}].values`) };
  }
  // A model answers its name for the methods called on it (live: `LinearRegression(r, g, true)`
  // is `["<LinearRegression object>"]`, 2026-10-16).
  if (type === 'object' && Array.isArray(values) && typeof values[0] === 'string') {
    return { kind: 'object', expression, value: values[0] };
  }
  /* c8 ignore start -- Recording-unreachable: no recorded data eval answers a string or an unsupported result; focused evaluation tests pin the value and the typed decoder failure. */
  // The runner answers text as `{"type": "string", "values": "Fixed Income"}` (Recording
  // widget-control-group-country-name).
  if (type === 'string' && typeof values === 'string') {
    return { kind: 'value', expression, value: values };
  }
  throw new PlotToolResultDecodeError(`results[${index}]`, `unsupported result type ${String(type)}`);
}
/* c8 ignore stop */

function emptySeries(expression: string, entities: readonly unknown[], index: number): PlotToolExpressionResult {
  const path = `entities[${index}]`;
  return { kind: 'empty-series', expression, assets: resolvedAssets(entities, path), entityIds: otherEntityIds(entities, path) };
}

// The ids of the Entities besides assets, such as `{entityName: "United States of America",
// mqid: "US", type: "country"}` (live: `US.cai(FOO)`, 2026-10-28).
function otherEntityIds(entities: readonly unknown[], path: string): string[] {
  return entities.flatMap((entity, index) => {
    const { type, mqid } = requiredRecord(entity, `${path}[${index}]`);
    if (type === 'asset') return [];
    /* c8 ignore start -- Recording-unreachable: no recorded empty series resolved a Country; focused evaluation tests pin its id and the typed decoder failure. */
    if (typeof mqid !== 'string') throw new PlotToolResultDecodeError(`${path}[${index}].mqid`, 'expected text');
    return [mqid];
    /* c8 ignore stop */
  });
}

function seriesResult(
  expression: string,
  values: unknown,
  entities: readonly unknown[],
  index: number,
): PlotToolExpressionResult {
  const path = `results[${index}].values`;
  const series = requiredRecord(values, path);
  if (Object.values(series).some((value) => typeof value === 'string')) {
    return { kind: 'error', expression, message: 'PlotTool Pro returned a text series; numeric values are required', assets: [] };
  }
  const points = Object.entries(series).map(([date, value]) => {
    /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
    if (typeof value !== 'number') {
      throw new PlotToolResultDecodeError(`${path}.${date}`, 'expected a number');
    }
    /* c8 ignore stop */
    return { date, value };
  });
  /* c8 ignore next -- Recording-unreachable: every recorded empty series is an empty `sortedSeries`; a focused evaluation test pins an empty `series`. */
  if (points.length === 0) return emptySeries(expression, entities, index);
  return { kind: 'series', expression, points };
}

function curvePoints(values: readonly unknown[], path: string): PlotToolCurvePoint[] {
  return values.map((entry, index) => {
    /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || typeof entry[1] !== 'number') {
      throw new PlotToolResultDecodeError(`${path}[${index}]`, 'expected a [number, number] pair');
    }
    /* c8 ignore stop */
    return { point: entry[0], value: entry[1] };
  });
}

// `entities[i]` lists what Expression i resolved, aligned with `results`.
function entityLists(value: unknown, count: number): readonly (readonly unknown[])[] {
  /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
  if (!Array.isArray(value) || value.length !== count || !value.every(Array.isArray)) {
    throw new PlotToolResultDecodeError('entities', `expected ${count} entity lists`);
  }
  /* c8 ignore stop */
  return value as readonly (readonly unknown[])[];
}

function resolvedAssets(entities: readonly unknown[], path: string): PlotToolResolvedAsset[] {
  return entities.flatMap((entity, index) => {
    const fields = requiredRecord(entity, `${path}[${index}]`);
    // A country is listed as `{entityName, mqid, type: 'country'}` (Recording widget-country-name-input).
    /* c8 ignore start -- Recording-unreachable: every recorded failed Expression resolved only assets; focused evaluation tests pin a skipped country and the typed decoder failure. */
    if (fields.type !== 'asset') return [];
    const { entityName, mqid, assetName } = fields;
    /* c8 ignore stop */
    // An asset the runner could not look up is listed by the id as written, with no name
    // (live: `Asset("AAPL UW")` is `{entityName: "AAPL UW", mqid: "AAPL UW", type: "asset"}`,
    // 2026-10-24); it resolved nothing.
    if (assetName === undefined && mqid === entityName) return [];
    /* c8 ignore start -- Recording-unreachable: focused evaluation tests pin the typed decoder failure. */
    if (typeof entityName !== 'string' || typeof mqid !== 'string' || typeof assetName !== 'string') {
      throw new PlotToolResultDecodeError(`${path}[${index}]`, 'expected entityName, mqid and assetName');
    }
    /* c8 ignore stop */
    const properties = requiredRecord(fields.properties, `${path}[${index}].properties`);
    return [{
      identifier: entityName,
      assetId: mqid,
      name: assetName,
      assetClass: text(properties.assetClass, `${path}[${index}].properties.assetClass`),
      assetType: text(properties.assetType, `${path}[${index}].properties.assetType`),
    }];
  });
}

function text(value: unknown, path: string): string {
  /* c8 ignore next -- Recording-unreachable: every recorded failed asset names its class and type; a focused malformed-response test pins the typed decoder failure. */
  if (typeof value !== 'string' || value === '') throw new PlotToolResultDecodeError(path, 'expected text');
  return value;
}

function strings(value: unknown, path: string): readonly string[] {
  /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new PlotToolResultDecodeError(path, 'expected an array of strings');
  }
  /* c8 ignore stop */
  return value;
}
