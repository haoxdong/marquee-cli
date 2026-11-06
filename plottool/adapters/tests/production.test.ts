import { describe, expect, it, vi } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { readPlotToolChart } from '../../index.js';
import { ProductionPlotTool } from '../production.js';

function chartResponse(): Record<string, unknown> {
  return {
    description: 'series = DataSeries("SPX")',
    controls: [],
    interval: 'Daily',
    startDate: '2025-01-02',
    endDate: '2026-01-02',
  };
}

describe('production PlotTool Pro', () => {
  it('owns provider requests and returns semantic PlotTool Pro values', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/charts/CH_TEST') return chartResponse();
      if (path === '/v1/plots/runner/CH_TEST') {
        return { results: [{ type: 'series', values: { '2026-01-02': 1 } }] };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await new ProductionPlotTool({ request }).execute({
      widgetId: 'MW_TEST',
      chartId: 'CH_TEST',
      inputs: { controls: [] },
      now: new Date('2026-01-02T12:00:00Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        chart: { chartId: 'CH_TEST' },
        projection: { kind: 'plot' },
      },
    });
    expect(request).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/plots/runner/CH_TEST' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Support-Reference': 'MW_TEST' }),
      }),
    );
  });

  // The runner answers a statistic per Expression; one it cannot summarize carries its own
  // `{error, message}` (live, 2026-10-22: `No statistics for empty series.`), as data eval reads.
  it('gives each series the runner statistics it answered and none where it answered an error', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/charts/CH_TEST') {
        return { ...chartResponse(), description: 'spx = DataSeries("SPX")\nndx = DataSeries("NDX")' };
      }
      if (path === '/v1/plots/runner/CH_TEST') {
        return {
          results: [
            { type: 'series', values: { '2026-01-02': 5 } },
            { type: 'series', values: { '2026-01-02': 7 } },
          ],
          statistics: [
            {
              low: { value: 4, keys: ['2025-03-01'] },
              high: { value: 6, keys: ['2025-09-01'] },
              first: { value: 4.5, keys: ['2025-01-02'] },
              last: { value: 5, keys: ['2026-01-02'] },
              median: { value: 5.1 },
              avg: { value: 5.2 },
              stdDev: { value: 0.5 },
              zscore: {},
              percentile: { value: 50 },
            },
            { error: 'Error', message: 'No statistics for empty series.' },
          ],
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await new ProductionPlotTool({ request }).execute({
      widgetId: 'MW_TEST',
      chartId: 'CH_TEST',
      inputs: { controls: [] },
      now: new Date('2026-01-02T12:00:00Z'),
    });

    expect(result.ok && result.value.projection.series.map(({ statistics }) => statistics)).toEqual([
      {
        low: { value: 4, dates: ['2025-03-01'] },
        high: { value: 6, dates: ['2025-09-01'] },
        first: { value: 4.5, dates: ['2025-01-02'] },
        last: { value: 5, dates: ['2026-01-02'] },
        median: 5.1,
        average: 5.2,
        standardDeviation: 0.5,
        percentile: 50,
      },
      undefined,
    ]);
  });

  it('returns a typed cardinality mismatch for partial runner results', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/charts/CH_TEST') {
        return { ...chartResponse(), description: 'one = DataSeries("SPX")\ntwo = DataSeries("NDX")' };
      }
      if (path === '/v1/plots/runner/CH_TEST') {
        return { results: [{ type: 'series', values: { '2026-01-02': 1 } }] };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await new ProductionPlotTool({ request }).execute({
      widgetId: 'MW_TEST',
      chartId: 'CH_TEST',
      inputs: { controls: [] },
      now: new Date('2026-01-02T12:00:00Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'cardinality-mismatch',
        chartId: 'CH_TEST',
        expressionCount: 2,
        resultCount: 1,
      },
    });
  });

  it('returns a typed invalid Chart for a malformed Chart definition', async () => {
    const request = vi.fn(async () => ({ ...chartResponse(), description: 7 }));

    const result = await new ProductionPlotTool({ request }).execute({
      widgetId: 'MW_TEST',
      chartId: 'CH_TEST',
      inputs: { controls: [] },
      now: new Date('2026-01-02T12:00:00Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-chart', chartId: 'CH_TEST', problem: 'malformed-definition' },
    });
  });

  it.each([
    [404, 'chart-not-found'],
    [403, 'chart-access-denied'],
    [401, 'chart-load-failed'],
  ] as const)('maps Chart HTTP %s to %s', async (status, kind) => {
    const request = vi.fn(async () => {
      throw new MarqueeError('http', 'Chart request failed', {
        path: '/v1/charts/CH_TEST',
        status,
      });
    });

    const result = await new ProductionPlotTool({ request }).execute({
      widgetId: 'MW_TEST',
      chartId: 'CH_TEST',
      inputs: { controls: [] },
      now: new Date('2026-01-02T12:00:00Z'),
    });

    expect(result).toMatchObject({ ok: false, error: { kind, chartId: 'CH_TEST' } });
  });

  it('maps runner access denial to a typed execution failure', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/charts/CH_TEST') return chartResponse();
      throw new MarqueeError('http', 'Runner request failed', {
        path: '/v1/plots/runner/CH_TEST',
        status: 403,
      });
    });

    const result = await new ProductionPlotTool({ request }).execute({
      widgetId: 'MW_TEST',
      chartId: 'CH_TEST',
      inputs: { controls: [] },
      now: new Date('2026-01-02T12:00:00Z'),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'execution-failed',
        chartId: 'CH_TEST',
        reason: 'access-denied',
      },
    });
  });

  it.each([
    [
      'an invalid clock',
      {
        ...chartResponse(),
        relativeStartDate: '-1y',
        relativeEndDate: '0d',
      },
      new Date('invalid'),
      'invalid-clock',
    ],
    [
      'an unsupported window',
      {
        ...chartResponse(),
        relativeStartDate: 'forever',
        relativeEndDate: '0d',
      },
      new Date('2026-01-02T12:00:00Z'),
      'unsupported-window',
    ],
    [
      'an unsupported interval',
      {
        ...chartResponse(),
        interval: 'Biweekly',
        relativeStartDate: '-1y',
        relativeEndDate: '0d',
      },
      new Date('2026-01-02T12:00:00Z'),
      'unsupported-interval',
    ],
    [
      'invalid real-time settings',
      {
        ...chartResponse(),
        interval: '5 min',
        relativeStartDate: '0d',
        relativeEndDate: '0d',
        realTime: true,
        timeSettings: {
          start: '09:30:00',
          end: '16:00:00',
          timezone: 'Not/A_Timezone',
        },
      },
      new Date('2026-01-02T12:00:00Z'),
      'invalid-time-settings',
    ],
  ] as const)('maps %s to invalid-date-range/%s', async (
    _case,
    chart,
    now,
    problem,
  ) => {
    const request = vi.fn().mockResolvedValue(chart);

    const result = await new ProductionPlotTool({ request }).execute({ widgetId: 'MW_TEST', chartId: 'CH_TEST', inputs: { controls: [] }, now });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-date-range', chartId: 'CH_TEST', problem },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('readPlotToolChart', () => {
  it('reads the Chart with card headers and learns whether its window runs forward', async () => {
    const request = vi.fn(async () => ({ ...chartResponse(), relativeEndDate: '30y' }));

    await expect(readPlotToolChart({ request }, { widgetId: 'MW_TEST', chartId: 'CH_TEST' }))
      .resolves.toEqual({
        ok: true,
        value: {
          chartId: 'CH_TEST',
          definition: { ...chartResponse(), relativeEndDate: '30y' },
          isForward: true,
        },
      });
    expect(request).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/charts/CH_TEST' },
      { headers: expect.objectContaining({ 'X-Support-Reference': 'MW_TEST' }) },
    );
  });

  it.each([
    [404, 'chart-not-found'],
    [403, 'chart-access-denied'],
    [401, 'chart-load-failed'],
  ] as const)('classifies Chart HTTP %s as %s', async (status, kind) => {
    const request = vi.fn(async () => {
      throw new MarqueeError('http', 'Chart request failed', {
        path: '/v1/charts/CH_TEST',
        status,
      });
    });

    await expect(readPlotToolChart({ request }, { widgetId: 'MW_TEST', chartId: 'CH_TEST' }))
      .resolves.toMatchObject({ ok: false, error: { kind, chartId: 'CH_TEST' } });
  });

  it('throws a failure it cannot classify', async () => {
    const failure = new Error('socket closed');
    const request = vi.fn(async () => {
      throw failure;
    });

    await expect(readPlotToolChart({ request }, { widgetId: 'MW_TEST', chartId: 'CH_TEST' }))
      .rejects.toBe(failure);
  });
});
