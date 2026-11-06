import type { DashboardError } from '../../dashboard/index.js';
import type { EntityFeedError } from '../../entity-feed/index.js';
import type { EntityError } from '../../entity/index.js';
import {
  CLI_EXIT_CODES,
  formatJsonFields,
  UsageError,
  writeLine,
  type JsonOutputOptions,
  type JsonRecord,
} from '../../presentation/index.js';
import { widgetDependencyFailure, type WidgetError } from '../../widget/index.js';
import type { MarketViewSearchError } from '../search/index.js';
import type { MarketViewPresentationSink } from './types.js';

type FailureKind =
  | 'authentication-required'
  | 'cancelled'
  | 'rate-limited'
  | 'timeout'
  | 'unavailable';

function exitCodeForFailureKind(kind: FailureKind): 1 | 2 | 4 {
  if (kind === 'authentication-required') return CLI_EXIT_CODES.authRequired;
  if (kind === 'cancelled') return CLI_EXIT_CODES.cancelled;
  return CLI_EXIT_CODES.failure;
}

export function exitCodeForMarketViewSearchError(error: MarketViewSearchError): 1 | 2 | 4 {
  if (error.kind === 'discovery-failed') {
    return exitCodeForFailureKind(error.failure.kind);
  }
  if (error.kind === 'widget-hydration-failed' && error.problem === 'authentication') {
    return CLI_EXIT_CODES.authRequired;
  }
  if (error.kind === 'widget-hydration-failed' && error.problem === 'cancelled') {
    return CLI_EXIT_CODES.cancelled;
  }
  if (error.kind === 'widget-hydration-failed' && error.problem === 'widget-error') {
    return exitCodeForWidgetError(error.widgetError);
  }
  return CLI_EXIT_CODES.failure;
}

export function exitCodeForWidgetError(error: WidgetError): 1 | 2 | 4 {
  const failure = widgetDependencyFailure(error);
  return failure === undefined ? CLI_EXIT_CODES.failure : exitCodeForFailureKind(failure.kind);
}

export function exitCodeForDashboardError(error: DashboardError): 1 | 2 | 4 {
  if (error.kind === 'verification-failed') {
    return exitCodeForDashboardError(error.writeError ?? error.cause);
  }
  if (
    error.kind === 'dependency'
    || error.kind === 'write-failed'
    || error.kind === 'lookup-failed'
    || error.kind === 'create-failed'
  ) {
    return exitCodeForFailureKind(error.failure.kind);
  }
  return CLI_EXIT_CODES.failure;
}

export function exitCodeForEntityFeedError(error: EntityFeedError): 1 | 2 | 4 {
  return error.kind === 'dependency'
    ? exitCodeForFailureKind(error.failure.kind)
    : CLI_EXIT_CODES.failure;
}

export function exitCodeForEntityError(error: EntityError): 1 | 2 | 4 {
  return error.kind === 'dependency'
    ? exitCodeForFailureKind(error.failure.kind)
    : CLI_EXIT_CODES.failure;
}

/** Every MarketView command error: text on stderr with its classified exit code (ADR 0070). */
export function writeMarketViewErrorLine(
  sink: Pick<MarketViewPresentationSink, 'writeError' | 'setExitCode'>,
  line: string,
  exitCode: 1 | 2 | 4 = CLI_EXIT_CODES.failure,
): void {
  sink.setExitCode(exitCode);
  writeLine(sink.writeError, line);
}

/** A MarketView command's input it rejects: the error line, exit 1, then the usage error (ADR 0085 decision 4). */
export function rejectMarketViewInput(
  sink: Pick<MarketViewPresentationSink, 'writeError' | 'setExitCode'>,
  line: string,
): never {
  writeMarketViewErrorLine(sink, line);
  throw new UsageError(line);
}

export async function writeMarketViewJson(
  sink: MarketViewPresentationSink,
  value: JsonRecord | readonly JsonRecord[],
  options: JsonOutputOptions,
): Promise<void> {
  const formatted = await formatJsonFields(value, options);
  if (formatted.ok) sink.write(formatted.output);
  else writeMarketViewErrorLine(sink, `Error: ${formatted.error}`);
}
