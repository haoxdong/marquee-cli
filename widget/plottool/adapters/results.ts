export type PlotToolResultErrorSource = 'results' | 'statistics';

export type PlotToolProviderItemError = Readonly<Record<string, unknown>> & Readonly<{
  error: unknown;
  message: string;
  statusCode?: number;
  requestId?: string;
  isFnlpError?: boolean;
  isWarning?: boolean;
}>;

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
  readonly statusCode: number | undefined;
  readonly isAccessDenied: boolean;
  readonly requestId: string | undefined;
  readonly isFnlpError: boolean | undefined;
  readonly isWarning: boolean | undefined;

  constructor(
    readonly source: PlotToolResultErrorSource,
    readonly index: number,
    readonly providerError: PlotToolProviderItemError,
  ) {
    super(providerError.message);
    this.statusCode = providerError.statusCode;
    this.isAccessDenied = providerError.statusCode === 403;
    this.requestId = providerError.requestId;
    this.isFnlpError = providerError.isFnlpError;
    this.isWarning = providerError.isWarning;
  }
}

export type PlotToolRunnerResponse = Readonly<Record<string, unknown>> & Readonly<{
  results: readonly Readonly<Record<string, unknown>>[];
  statistics?: readonly Readonly<Record<string, unknown>>[];
}>;

export function readPlotToolRunnerResponse(value: unknown): PlotToolRunnerResponse {
  const response = requiredRecord(value, 'response');
  const results = requiredItems(response.results, 'results');
  rejectProviderErrors(results, 'results');
  if (response.statistics !== undefined) {
    rejectProviderErrors(requiredItems(response.statistics, 'statistics'), 'statistics');
  }
  return response as PlotToolRunnerResponse;
}

function rejectProviderErrors(
  items: readonly Readonly<Record<string, unknown>>[],
  source: PlotToolResultErrorSource,
): void {
  for (const [index, item] of items.entries()) {
    if (Object.prototype.hasOwnProperty.call(item, 'error')) {
      throw new PlotToolResultItemError(
        source,
        index,
        decodeProviderError(item, source, index),
      );
    }
  }
}

function requiredItems(
  value: unknown,
  label: PlotToolResultErrorSource,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) {
    throw new PlotToolResultDecodeError(label, 'expected an array');
  }
  return value.map((item, index) => requiredRecord(item, `${label}[${index}]`));
}

function requiredRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlotToolResultDecodeError(label, 'expected a record');
  }
  return value as Readonly<Record<string, unknown>>;
}

function decodeProviderError(
  value: Readonly<Record<string, unknown>>,
  source: PlotToolResultErrorSource,
  index: number,
): PlotToolProviderItemError {
  const path = `${source}[${index}]`;
  const error = {
    error: value.error,
    message: requiredString(value.message, `${path}.message`),
  };
  if (source === 'statistics') return error;
  return {
    ...value,
    ...error,
    ...optionalNumber(value, 'statusCode', path),
    ...optionalString(value, 'requestId', path),
    ...optionalBoolean(value, 'isFnlpError', path),
    ...optionalBoolean(value, 'isWarning', path),
  };
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new PlotToolResultDecodeError(path, 'expected a string');
  }
  return value;
}

function optionalNumber(
  value: Readonly<Record<string, unknown>>,
  field: 'statusCode',
  path: string,
): Readonly<{ statusCode?: number }> {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (typeof candidate !== 'number') {
    throw new PlotToolResultDecodeError(`${path}.${field}`, 'expected a number');
  }
  return { [field]: candidate };
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  field: 'requestId',
  path: string,
): Readonly<{ requestId?: string }> {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (typeof candidate !== 'string') {
    throw new PlotToolResultDecodeError(`${path}.${field}`, 'expected a string');
  }
  return { [field]: candidate };
}

function optionalBoolean(
  value: Readonly<Record<string, unknown>>,
  field: 'isFnlpError' | 'isWarning',
  path: string,
): Readonly<{ isFnlpError?: boolean; isWarning?: boolean }> {
  const candidate = value[field];
  if (candidate === undefined) return {};
  if (typeof candidate !== 'boolean') {
    throw new PlotToolResultDecodeError(`${path}.${field}`, 'expected a boolean');
  }
  return { [field]: candidate };
}
