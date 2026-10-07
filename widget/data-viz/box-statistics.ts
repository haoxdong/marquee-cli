export type BoxStatistics = Readonly<{
  minimum: number;
  lowerFence: number;
  q1: number;
  median: number;
  mean: number;
  standardDeviation: number;
  q3: number;
  upperFence: number;
  maximum: number;
}>;

export function boxStatistics(samples: readonly number[]): BoxStatistics {
  if (samples.length === 0 || samples.some((value) => !Number.isFinite(value))) {
    throw new Error('box samples must contain finite numbers');
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const q1 = plotlyPercentile(sorted, 0.25);
  const median = plotlyPercentile(sorted, 0.5);
  const q3 = plotlyPercentile(sorted, 0.75);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const interquartileRange = q3 - q1;
  const lowerLimit = q1 - 1.5 * interquartileRange;
  const upperLimit = q3 + 1.5 * interquartileRange;
  return {
    minimum: sampleAt(sorted, 0),
    lowerFence: Math.min(q1, sampleAt(sorted, sorted.findIndex((value) => value >= lowerLimit))),
    q1,
    median,
    mean,
    standardDeviation: Math.sqrt(
      sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / sorted.length,
    ),
    q3,
    upperFence: Math.max(
      q3,
      sampleAt(sorted, sorted.filter((value) => value <= upperLimit).length - 1),
    ),
    maximum: sampleAt(sorted, sorted.length - 1),
  };
}

function plotlyPercentile(sorted: readonly number[], percentile: number): number {
  // Plotly's Lib.interp uses Langford method #10, not percentile * (length - 1).
  const index = percentile * sorted.length - 0.5;
  // Stryker disable next-line EqualityOperator: at index 0 the interpolation below also returns sorted[0], with weight 0
  if (index <= 0) return sampleAt(sorted, 0);
  if (index >= sorted.length - 1) return sampleAt(sorted, sorted.length - 1);
  const lowerIndex = Math.floor(index);
  const weight = index - lowerIndex;
  return sampleAt(sorted, lowerIndex) * (1 - weight) + sampleAt(sorted, lowerIndex + 1) * weight;
}

function sampleAt(sorted: readonly number[], index: number): number {
  const sample = sorted[index];
  // Stryker disable next-line StringLiteral: callers index inside the nonempty sorted samples, so this never throws
  if (sample === undefined) throw new Error(`box sample ${index} is out of range`);
  return sample;
}
