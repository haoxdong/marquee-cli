import { describe, expect, it, vi } from 'vitest';
import { MarqueeError } from '../../../transport/index.js';
import { createPlotToolPersistenceAnchorResolver } from '../plottool-persistence-anchor.js';
import { InvalidWidgetResponseError } from '../../semantic-failure.js';

describe('saved Chart persistence anchors', () => {
  it.each([
    [{ relativeStartDate: '-5y', relativeEndDate: null }, { relativeDate: '5y' }],
    [{ relativeStartDate: 'ytd', relativeEndDate: '0d' }, {}],
    [{ relativeStartDate: 7, startDate: '2021-01-01', relativeEndDate: 30 }, {}],
  ])('projects %j to %j', async (chart, expected) => {
    const getChart = vi.fn(async () => chart);
    const resolver = createPlotToolPersistenceAnchorResolver({ getChart });

    await expect(resolver.resolveConfiguration('CH_ANCHOR')).resolves.toStrictEqual({
      ok: true,
      value: expected,
    });
    expect(getChart).toHaveBeenCalledWith('CH_ANCHOR');
  });

  it.each([
    [[], 'chart is not a record'],
    [{ relativeStartDate: 7, startDate: 7 }, 'chart missing relativeStartDate'],
    [{ relativeStartDate: '+1m' }, 'chart unsupported relativeStartDate'],
    [{ relativeStartDate: 'forever' }, 'chart unsupported relative start forever'],
    [{ relativeStartDate: '-1y', relativeEndDate: '+5Y' }, 'chart unsupported relative end +5Y'],
  ])('fails invalid-response on %j', async (chart, detail) => {
    const resolver = createPlotToolPersistenceAnchorResolver({ getChart: async () => chart });

    const failure = await resolver.resolveConfiguration('CH_BAD').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidWidgetResponseError);
    expect((failure as InvalidWidgetResponseError).error).toEqual({
      source: 'configuration',
      problem: 'unsupported-payload-shape',
      detail,
    });
  });

  it.each([
    [404, 'chart-not-found'],
    [403, 'chart-access-denied'],
    [429, 'chart-load-failed'],
  ] as const)('classifies HTTP %i as %s', async (status, kind) => {
    const resolver = createPlotToolPersistenceAnchorResolver({
      getChart: async () => {
        throw new MarqueeError('http', 'failed', { status });
      },
    });

    await expect(resolver.resolveConfiguration('CH_FAILURE')).resolves.toMatchObject({
      ok: false,
      error: { kind, chartId: 'CH_FAILURE' },
    });
  });

  it('rethrows a failure that is not a Marquee response', async () => {
    const thrown = new TypeError('bug');
    const resolver = createPlotToolPersistenceAnchorResolver({
      getChart: async () => {
        throw thrown;
      },
    });

    await expect(resolver.resolveConfiguration('CH_BUG')).rejects.toBe(thrown);
  });
});
