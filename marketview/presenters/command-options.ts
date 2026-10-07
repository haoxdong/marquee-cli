import { writeMarketViewErrorLine } from './failure-semantics.js';
import type { MarketViewPresentationSink } from './types.js';

// The pattern admits only positive integers; a run of digits past Number.MAX_VALUE parses to Infinity.
export function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parses a given dashboard `-L`; writes the error and returns undefined when it is not a positive integer. */
export function presentDashboardLimit(
  value: string,
  sink: MarketViewPresentationSink,
): number | undefined {
  const limit = parsePositiveInteger(value);
  if (limit === undefined) {
    writeMarketViewErrorLine(sink, 'Error: -L must be a positive integer');
  }
  return limit;
}
