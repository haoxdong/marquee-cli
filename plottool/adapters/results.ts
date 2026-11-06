export class PlotToolResultDecodeError extends Error {
  override readonly name = 'PlotToolResultDecodeError';
  readonly kind = 'plot-result-decode';

  constructor(
    readonly path: string,
    readonly problem: string,
  ) {
    super(`Unsupported PlotTool Pro runner ${path}: ${problem}`);
  }
}

export class PlotToolResultItemError extends Error {
  override readonly name = 'PlotToolResultItemError';
  readonly kind = 'plot-result-item';
  readonly isAccessDenied: boolean;

  constructor(
    readonly index: number,
    message: string,
    readonly statusCode: number | undefined,
  ) {
    super(message);
    this.isAccessDenied = statusCode === 403;
  }
}

export type PlotToolRunnerResponse = Readonly<Record<string, unknown>> & Readonly<{
  results: readonly Readonly<Record<string, unknown>>[];
  statistics?: unknown;
}>;

/** One runner item: the Expression's result, or the provider's error for it. */
export type PlotToolRunnerItem =
  | Readonly<{ kind: 'result'; result: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: 'error'; error: PlotToolResultItemError }>;

/**
 * The Widget policy: a Chart renders only when every result succeeded, so the first provider
 * error rejects the whole response; a statistic's own error only leaves its series without one.
 */
export function readPlotToolRunnerResponse(value: unknown): PlotToolRunnerResponse {
  const response = requiredRecord(value, 'response');
  const results = requiredItems(response.results);
  rejectProviderErrors(results);
  return response as PlotToolRunnerResponse;
}

/**
 * Every Expression's item in Expression order, each its own result or error, so one
 * failing Expression never discards its siblings.
 */
export function readPlotToolRunnerItems(value: unknown): Readonly<{
  response: Readonly<Record<string, unknown>>;
  items: readonly PlotToolRunnerItem[];
}> {
  const response = requiredRecord(value, 'response');
  const items = requiredItems(response.results).map(readRunnerItem);
  return { response, items };
}

function rejectProviderErrors(items: readonly Readonly<Record<string, unknown>>[]): void {
  for (const [index, item] of items.entries()) {
    const read = readRunnerItem(item, index);
    if (read.kind === 'error') throw read.error;
  }
}

function readRunnerItem(
  item: Readonly<Record<string, unknown>>,
  index: number,
): PlotToolRunnerItem {
  if (!Object.prototype.hasOwnProperty.call(item, 'error')) return { kind: 'result', result: item };
  const path = `results[${index}]`;
  return {
    kind: 'error',
    error: new PlotToolResultItemError(
      index,
      requiredString(item.message, `${path}.message`),
      optionalNumber(item.statusCode, `${path}.statusCode`),
    ),
  };
}

function requiredItems(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) {
    throw new PlotToolResultDecodeError('results', 'expected an array');
  }
  return value.map((item, index) => requiredRecord(item, `results[${index}]`));
}

export function requiredRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  /* c8 ignore start -- Recording-unreachable for supported responses; focused malformed-response tests pin the typed decoder failure. */
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlotToolResultDecodeError(label, 'expected a record');
  }
  /* c8 ignore stop */
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, path: string): string {
  /* c8 ignore start -- Recording-unreachable for supported responses; focused malformed-response tests pin the typed decoder failure. */
  if (typeof value !== 'string') {
    throw new PlotToolResultDecodeError(path, 'expected a string');
  }
  /* c8 ignore stop */
  return value;
}

function optionalNumber(value: unknown, path: string): number | undefined {
  /* c8 ignore start -- Recording-unreachable: every recorded item error carries a numeric status; focused result-policy and malformed-response tests pin an absent and a malformed one. */
  if (value === undefined) return undefined;
  if (typeof value !== 'number') {
    throw new PlotToolResultDecodeError(path, 'expected a number');
  }
  /* c8 ignore stop */
  return value;
}
