import type { DashboardError } from '../../dashboard/index.js';
import type { EntityFeedError } from '../../entity-feed/index.js';
import type { EntityError } from '../../entity/index.js';
import type { DashboardPreferencesError } from '../adapters/dashboard-preferences.js';
import {
  CLI_EXIT_CODES,
  writeLine,
} from '../../presentation/index.js';
import type { WidgetError } from '../../widget/index.js';
import type { MarketViewSearchError } from '../index.js';
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
  return CLI_EXIT_CODES.failure;
}

export function exitCodeForWidgetError(error: WidgetError): 1 | 2 | 4 {
  const nestedFailure = widgetNestedFailure(error);
  if (nestedFailure) return exitCodeForFailureKind(nestedFailure);
  if (error.kind === 'widget-load-failure') {
    return exitCodeForFailureKind(error.failure.kind);
  }
  if (error.kind === 'control-group-resolution-failure' && error.failure.kind === 'dependency') {
    return exitCodeForFailureKind(error.failure.failure.kind);
  }
  return CLI_EXIT_CODES.failure;
}

function widgetNestedFailure(error: WidgetError): FailureKind | undefined {
  if (error.kind === 'plottool-failure') {
    if (error.problem.kind === 'chart-load-failed') return error.problem.failure.kind;
    if (error.problem.kind === 'execution-failed') return error.problem.failure?.kind;
  }
  if (error.kind === 'data-viz-failure' && error.problem.kind === 'render-failure') {
    return error.problem.failure.kind;
  }
  return undefined;
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

export function exitCodeForDashboardPreferencesError(
  error: DashboardPreferencesError,
): 1 | 2 | 4 {
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
