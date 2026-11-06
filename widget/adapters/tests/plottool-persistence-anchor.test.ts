import { describe, expect, it, vi } from 'vitest';
import { MarqueeError } from '../../../transport/index.js';
import { savedChartAnchors } from '../plottool-persistence-anchor.js';
import { InvalidWidgetResponseError } from '../../semantic-failure.js';

describe('saved Chart persistence anchors', () => {
  it.each([
    [{ relativeStartDate: '-5y', relativeEndDate: null }, { parameters: [], relativeDate: '5y' }],
    [{ relativeStartDate: 'ytd', relativeEndDate: '0d' }, { parameters: [] }],
    [{ relativeStartDate: 7, startDate: '2021-01-01', relativeEndDate: 30 }, { parameters: [] }],
  ])('projects %j to %j', async (chart, expected) => {
    const getChart = vi.fn(async () => chart);

    await expect(savedChartAnchors({ getChart }, 'CH_ANCHOR', 'WC_ANCHOR', [])).resolves.toStrictEqual({
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
    const failure = await savedChartAnchors({ getChart: async () => chart }, 'CH_BAD', 'WC_BAD', [])
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidWidgetResponseError);
    expect((failure as InvalidWidgetResponseError).error).toEqual({
      source: 'configuration',
      problem: 'unsupported-payload-shape',
      detail,
    });
  });

  it.each([
    [404, { kind: 'configuration-not-found', identity: { widgetId: '', configurationId: 'WC_FAILURE' } }],
    [403, { kind: 'widget-access-denied', identity: { widgetId: '' } }],
  ] as const)('classifies HTTP %i', async (status, error) => {
    const getChart = async () => {
      throw new MarqueeError('http', 'failed', { status });
    };

    await expect(savedChartAnchors({ getChart }, 'CH_FAILURE', 'WC_FAILURE', [])).resolves.toEqual({ ok: false, error });
  });

  it('rethrows any other failure for the Widget error mapping', async () => {
    const thrown = new MarqueeError('http', 'failed', { status: 429 });

    await expect(savedChartAnchors({ getChart: async () => { throw thrown; } }, 'CH_BUSY', 'WC_BUSY', [])).rejects.toBe(thrown);
  });
});
