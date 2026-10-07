import { describe, expect, it, vi } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../../transport/index.js';
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

    const result = await new ProductionPlotTool(
      { request },
      { widgetId: 'MW_TEST' },
    ).execute({
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

    const result = await new ProductionPlotTool(
      { request },
      { widgetId: 'MW_TEST' },
    ).execute({
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

    const result = await new ProductionPlotTool(
      { request },
      { widgetId: 'MW_TEST' },
    ).execute({
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

    const result = await new ProductionPlotTool(
      { request },
      { widgetId: 'MW_TEST' },
    ).execute({
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

    const result = await new ProductionPlotTool(
      { request },
      { widgetId: 'MW_TEST' },
    ).execute({
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

    const result = await new ProductionPlotTool(
      { request },
      { widgetId: 'MW_TEST' },
    ).execute({ chartId: 'CH_TEST', inputs: { controls: [] }, now });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-date-range', chartId: 'CH_TEST', problem },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
