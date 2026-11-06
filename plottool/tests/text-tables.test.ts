import { describe, expect, it } from 'vitest';

import { projectPlotTool } from '../projection.js';
import { plotToolDataTable, plotToolStatisticsTable } from '../text-tables.js';
import type { PlotToolProjectedSeries, PlotToolSeriesStatistics } from '../types.js';

const legend = ({ legendLabel }: PlotToolProjectedSeries) => legendLabel;

function fail(detail: string): never {
  throw new Error(detail);
}

function statistics(values: Readonly<{
  low: number;
  high: number;
  first: number;
  last: number;
  median: number;
  average: number;
  standardDeviation: number;
  zScore: number;
  percentile: number;
}>): PlotToolSeriesStatistics {
  // A distinct date per statistic, so a column dated from the wrong one shows.
  return {
    ...values,
    low: { value: values.low, dates: ['2026-10-19'] },
    high: { value: values.high, dates: ['2026-10-20'] },
    first: { value: values.first, dates: ['2026-10-16'] },
    last: { value: values.last, dates: ['2026-10-23'] },
  };
}

describe('PlotTool Pro statistics table', () => {
  // A live chart (2026-10-24): its axes author 2 decimals, and Web's grid
  // printed DXY as 97.86, 104.34, 100.00, 103.49, 101.09, 101.22, 1.4143, 1.60, 93.40% and
  // JPY's standard deviation as 1.487.
  // Each of Low, High, First and Last is followed by its date, which Web's grid leaves out, for every caller.
  it('prints a series as Web does under an axis that authors its decimals, with a date column after Low, High, First and Last', () => {
    const projection = projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [{ label: 'DXY' }, { label: 'JPY' }],
        yAxesSettings: [{ id: 'Right', labelFormat: 'none', decimalPrecision: 2 }],
      },
      results: [
        { type: 'series', values: { '2026-10-23': 103.4911 } },
        { type: 'series', values: { '2026-10-23': 99.9412 } },
      ],
      expressions: ['index(DXY FNX.spot(), 100)', 'index(JPYUSD.spot(), 100)'],
      statistics: [
      statistics({
        low: 97.8612,
        high: 104.3389,
        first: 100,
        last: 103.4911,
        median: 101.0877,
        average: 101.2201,
        standardDeviation: 1.414271,
        zScore: 1.6012,
        percentile: 93.4,
      }),
      statistics({
        low: 95.6702,
        high: 102.6511,
        first: 100,
        last: 99.9412,
        median: 98.7603,
        average: 98.9399,
        standardDeviation: 1.48698,
        zScore: 0.6731,
        percentile: 77.4566,
      }),
      ],
    });

    expect(plotToolStatisticsTable(projection, legend, fail)).toEqual({
      headers: ['Expressions', 'Low', 'Low date', 'High', 'High date', 'First', 'First date', 'Last', 'Last date', 'Median', 'Avg', 'StdDev', 'Zscore', 'Percentile'],
      rows: [
        ['DXY', '97.86', '19 Oct 2026', '104.34', '20 Oct 2026', '100.00', '16 Oct 2026', '103.49', '23 Oct 2026', '101.09', '101.22', '1.4143', '1.60', '93.40%'],
        ['JPY', '95.67', '19 Oct 2026', '102.65', '20 Oct 2026', '100.00', '16 Oct 2026', '99.94', '23 Oct 2026', '98.76', '98.94', '1.487', '0.67', '77.46%'],
      ],
    });
  });

  it('leaves out a series the runner gave no statistics', () => {
    const projection = projectPlotTool({
      definition: {},
      results: [{ type: 'series', values: { '2026-10-23': 0.2021 } }],
      expressions: ['m.r_squared()'],
      statistics: [undefined],
    });

    expect(plotToolStatisticsTable(projection, legend, fail).rows).toEqual([]);
  });
});

describe('PlotTool Pro table labels', () => {
  const expressions = ['NG1.spot()', 'FRED(DGS10).value()'];
  const projection = projectPlotTool({
    definition: {},
    results: [
      { type: 'series', values: { '2026-10-23': 3.512 } },
      { type: 'series', values: { '2026-10-23': 4.01 } },
    ],
    expressions,
    statistics: [
      statistics({
        low: 3, high: 4, first: 3, last: 3.512, median: 3.5, average: 3.5, standardDeviation: 0.2, zScore: 0.1, percentile: 50,
      }),
      undefined,
    ],
  });
  const asTyped = ({ sourceIndex }: PlotToolProjectedSeries) => expressions[sourceIndex] ?? '';

  it('labels each statistics row by the label the caller gives', () => {
    expect(plotToolStatisticsTable(projection, asTyped, fail).rows.map(([label]) => label))
      .toEqual(['NG1.spot()']);
  });

  it('heads each Data column by the label the caller gives', () => {
    expect(plotToolDataTable(projection, asTyped, fail).headers)
      .toEqual(['date', 'NG1.spot()', 'FRED(DGS10).value()']);
    expect(plotToolDataTable(projection, legend, fail).headers)
      .toEqual(['date', 'NG1 Spot', 'FRED DGS10 Value']);
  });
});
