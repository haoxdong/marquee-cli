import type { PlotToolDatedValue, PlotToolSeriesStatistics } from '../types.js';
import { PlotToolResultDecodeError, requiredRecord } from './results.js';

export function readPlotToolSeriesStatistics(
  results: readonly unknown[],
  statistics: unknown,
): readonly (PlotToolSeriesStatistics | undefined)[] {
  if (statistics === undefined && hasMixedSeries(results)) return results.map(() => undefined);
  /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
  if (!Array.isArray(statistics) || statistics.length !== results.length) {
    throw new PlotToolResultDecodeError('statistics', `expected ${results.length} statistics`);
  }
  /* c8 ignore stop */
  return results.map((result, index) => {
    const path = `statistics[${index}]`;
    const fields = requiredRecord(statistics[index], path);
    const isSeries = typeof result === 'object' && result !== null
      && (result as Readonly<Record<string, unknown>>).type === 'series';
    return isSeries && typeof fields.error !== 'string' ? seriesStatistics(fields, path) : undefined;
  });
}

function hasMixedSeries(results: readonly unknown[]): boolean {
  const series = results.flatMap((result, index) => {
    const item = requiredRecord(result, `results[${index}]`);
    return item.type === 'series' ? [Object.values(requiredRecord(item.values, `results[${index}].values`))] : [];
  });
  return series.some((values) => values.length > 0 && values.every((value) => typeof value === 'number'))
    && series.some((values) => values.some((value) => typeof value === 'string'));
}

function seriesStatistics(fields: Readonly<Record<string, unknown>>, path: string): PlotToolSeriesStatistics {
  const number = (key: string) => statisticValue(fields[key], `${path}.${key}`);
  // The runner answers `{}` for a statistic it cannot compute: a constant series has no z-score
  // (live: `first(AAPL UW.spot())`), and a one-point series no deviation either (live:
  // `TSDB(JNCPIYOY_BBSTS).value()` over one month).
  const optional = (key: string) => (requiredRecord(fields[key], `${path}.${key}`).value === undefined ? undefined : number(key));
  const standardDeviation = optional('stdDev');
  const zScore = optional('zscore');
  return {
    low: datedValue(fields.low, `${path}.low`),
    high: datedValue(fields.high, `${path}.high`),
    first: datedValue(fields.first, `${path}.first`),
    last: datedValue(fields.last, `${path}.last`),
    median: number('median'),
    average: number('avg'),
    ...(standardDeviation === undefined ? {} : { standardDeviation }),
    ...(zScore === undefined ? {} : { zScore }),
    percentile: number('percentile'),
  };
}

function statisticValue(value: unknown, path: string): number {
  const { value: number } = requiredRecord(value, path);
  /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
  if (typeof number !== 'number') throw new PlotToolResultDecodeError(path, 'expected a number value');
  /* c8 ignore stop */
  return number;
}

function datedValue(value: unknown, path: string): PlotToolDatedValue {
  const { keys } = requiredRecord(value, path);
  /* c8 ignore start -- Recording-unreachable for supported responses; a focused malformed-response test pins the typed decoder failure. */
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string')) {
    throw new PlotToolResultDecodeError(`${path}.keys`, 'expected dates');
  }
  /* c8 ignore stop */
  return { value: statisticValue(value, path), dates: keys };
}
