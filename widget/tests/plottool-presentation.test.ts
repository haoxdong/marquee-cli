// @format

import { describe, expect, it, vi } from 'vitest';

import type {
  PlotToolProjectedAxis,
  PlotToolProjectedSeries,
  PlotToolProjection,
} from '../plottool/index.js';
import { projectWidgetPlotToolResult } from '../plottool-presentation.js';

function axis(axisId: string, dimension: 'x' | 'y'): PlotToolProjectedAxis {
  return {
    axisId,
    dimension,
    label: '',
    labelFormat: 'auto',
    dataDomains: [0, 0],
    numberRule: { labelFormat: 'auto', decimals: 0, precision: 'auto', precisionDomains: [0, 0] },
    isHidden: false,
    isInverted: false,
    hasGridLines: false,
  };
}

function series(
  sourceIndex: number,
  legendLabel: string,
  points: Readonly<Record<string, number>>,
): PlotToolProjectedSeries {
  return {
    sourceIndex,
    label: legendLabel,
    legendLabel,
    axisId: 'y1',
    isOrdinal: false,
    points: Object.entries(points).map(([rawKey, value]) => ({ rawKey, value })),
  };
}

function projection(overrides: Partial<PlotToolProjection>): PlotToolProjection {
  return { kind: 'plot', chartType: 'line', isOrdinal: false, series: [], axes: [axis('y1', 'y')], ...overrides };
}

describe('projectWidgetPlotToolResult', () => {
  it('keys date rows by date, scales each point by its own magnitude, and keeps every value of a repeated label', () => {
    const { rows } = projectWidgetPlotToolResult(projection({
      series: [
        series(0, 'SPX', { '2026-01-02': 2_500_000 }),
        series(1, 'SPX', { '2026-01-02': 1 }),
        series(2, 'SPX', { '2026-01-02': 3 }),
      ],
    }));

    expect(rows).toEqual([{ date: '2026-01-02', SPX: [2.5, 1, 3] }]);
  });

  it('keys ordinal rows by category and formats scatter values by their axis', () => {
    const { rows } = projectWidgetPlotToolResult(projection({
      chartType: 'scatter',
      isOrdinal: true,
      axes: [axis('x1', 'x'), axis('y1', 'y')],
      series: [series(0, 'X', { 1: 2_500_000 }), series(1, 'Y', { 1: 4 })],
    }));

    expect(rows).toEqual([{ category: '1', X: 2_500_000, Y: 4 }]);
  });

  it('fails loud on a series with no elected axis', () => {
    expect(() => projectWidgetPlotToolResult(projection({
      axes: [],
      series: [series(3, 'SPX', { '2026-01-02': 1 })],
    }))).toThrow('PlotTool Pro series 3 has no elected axis');
  });

  // A MAX window of daily history runs to thousands of rows per series; a per-row scan
  // of every point made this quadratic and timed out the Replay Lane.
  it('projects a 20,000-day history of four series in time linear in its rows', { timeout: 2_000 }, () => {
    const days = 20_000;
    const points = Object.fromEntries(Array.from({ length: days }, (_, day) => [
      new Date(Date.UTC(1970, 0, 1 + day)).toISOString().slice(0, 10),
      day,
    ]));
    const numberFormat = vi.spyOn(Intl, 'NumberFormat');

    const { rows } = projectWidgetPlotToolResult(projection({
      series: [series(0, 'A', points), series(1, 'B', points), series(2, 'C', points), series(3, 'D', points)],
    }));
    const numberFormats = numberFormat.mock.calls.length;
    numberFormat.mockRestore();

    expect(rows).toHaveLength(days);
    expect(rows.at(-1)).toEqual({ date: '2024-10-03', A: 19_999, B: 19_999, C: 19_999, D: 19_999 });
    // One number format per precision (0, 1, 2 and 4 decimals here), not one per value.
    expect(numberFormats).toBeLessThanOrEqual(4);
  });
});
