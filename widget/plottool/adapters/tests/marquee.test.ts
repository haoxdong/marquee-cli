import { describe, expect, it, vi } from 'vitest';

import type { Endpoint } from '../../../../transport/index.js';
import { PlotToolResultItemError } from '../results.js';
import {
  encodePlotToolInterval,
  encodePlotToolRunnerBody,
  mergePlotToolDisplayControls,
  mergePlotToolWireControls,
  PlotToolLaneDecodeError,
  renderPlotToolLane,
  resolvePlotToolControls,
  shouldPostPlotToolRunner,
  stripPlotToolExpressions,
} from '../marquee.js';

const definition = {
  id: 'CH_TEST',
  description: 'series = DataSeries("SPX")',
  controls: [],
  interval: 'Daily',
  realTime: false,
  showStatistics: false,
  startDate: '2025-01-02',
  endDate: '2026-01-02',
  timeSettings: {
    start: '00:00:00',
    end: '23:59:59',
    timezone: 'America/New_York',
  },
};

describe('PlotTool Pro control merges', () => {
  it('builds the runner controls in definition order with Web truthiness and type rules', () => {
    expect(mergePlotToolWireControls(
      [
        { id: 'enum', type: 'DefinitionType', value: 'saved' },
        { id: 'asset', type: 'DefinitionType', value: 'saved' },
        { id: 'portfolio', type: 'DefinitionType', value: 'saved' },
        { id: 'ticker', type: 'DefinitionType', value: 'saved' },
        { id: 'zero', type: 'DefinitionType', value: 'saved' },
        { id: 'false', type: 'DefinitionType', value: 'saved' },
        { id: 'empty', type: 'DefinitionType', value: 'saved' },
      ],
      [
        { id: 'ticker', value: 'AAPL' },
        { id: 'empty', type: 'Enum', value: '' },
        { id: 'portfolio', value: 'MP_PORTFOLIO' },
        { id: 'enum', type: 'Enum', value: '5' },
        { id: 'asset', value: 'MA_ASSET' },
        { id: 'zero', type: 'Enum', value: 0 },
        { id: 'false', type: 'Enum', value: false },
      ],
    )).toEqual([
      { id: 'enum', type: 'Enum', value: 5 },
      { id: 'asset', type: 'Asset', value: 'MA_ASSET' },
      { id: 'portfolio', type: 'Portfolio', value: 'MP_PORTFOLIO' },
      { id: 'ticker', type: 'Enum', value: 'AAPL' },
    ]);
  });

  it('keeps definition types and falsy values in the separate display merge', () => {
    expect(mergePlotToolDisplayControls(
      [
        { id: 'zero', type: 'Number', value: 3 },
        { id: 'false', type: 'Boolean', value: true },
        { id: 'saved', type: 'Country', value: 'US' },
      ],
      [
        { id: 'false', type: 'Enum', value: false },
        { id: 'zero', type: 'Enum', value: 0 },
      ],
    )).toEqual([
      { id: 'zero', type: 'Number', value: 0 },
      { id: 'false', type: 'Boolean', value: false },
      { id: 'saved', type: 'Country', value: 'US' },
    ]);
  });
});

describe('PlotTool Pro expression stripping', () => {
  it('derives both consumer forms from one filtered line array', () => {
    expect(stripPlotToolExpressions([
      'a = DataSeries("#literal") # ordinary comment',
      'b = a # @label(Visible label)',
      '#@label(orphan is dropped)',
      '',
      'c = b',
    ].join('\n'))).toEqual([
      {
        runner: 'a = DataSeries("',
        label: 'a = DataSeries("',
      },
      {
        runner: 'b = a',
        label: 'b = a # @label(Visible label)',
      },
      { runner: 'c = b', label: 'c = b' },
    ]);
  });
});

describe('PlotTool Pro runner selection', () => {
  it.each([
    ['controls', { controls: [{ id: 'cross', value: false }] }],
    [
      'relative start',
      { controls: [], start: { token: '0d', kind: 'today' as const } },
    ],
    ['relative end', { controls: [], end: { kind: 'today' as const } }],
    [
      'caller date override',
      { controls: [], dateOverride: { start: '2025-01-01', end: '2026-01-01' } },
    ],
    [
      'time setting relative bound',
      { controls: [], timeSettings: { relativeStart: '-1d' } },
    ],
    ['inline definition', { controls: [], inlineDefinition: definition }],
  ])('uses POST for the %s trigger', (_case, input) => {
    expect(shouldPostPlotToolRunner(input)).toBe(true);
  });

  it('prefers GET when none of the five conditions holds', () => {
    expect(shouldPostPlotToolRunner({ controls: [], timeSettings: definition.timeSettings })).toBe(false);
  });
});

describe('PlotTool Pro runner encodings', () => {
  it.each([
    ['Daily', '1D'],
    ['Weekly', '7D'],
    ['Monthly', '1M'],
    ['Quarterly', '3M'],
    ['Yearly', '1Y'],
    ['1 min', '1m'],
    ['15 min', '15m'],
    ['60 min', '1h'],
    ['1D', '1D'],
    ['1M', '1M'],
    ['15m', '15m'],
    ['1h', '1h'],
    ['Tick', undefined],
  ])('maps %s to %s', (source, expected) => {
    expect(encodePlotToolInterval(source)).toBe(expected);
  });

  it('fails loud on an unsupported interval', () => {
    expect(() => encodePlotToolInterval('Biweekly')).toThrow(PlotToolLaneDecodeError);
    expect(() => encodePlotToolInterval('Biweekly')).toThrow('Unsupported PlotTool Pro interval: Biweekly');
    expect(() => encodePlotToolInterval('constructor')).toThrow(PlotToolLaneDecodeError);
  });

  it.each([
    ['missing dates', { ...definition, startDate: null, endDate: null }, 'Chart startDate is not a string'],
    ['invalid dates', { ...definition, startDate: 'not-a-date' }, 'PlotTool Pro date is invalid'],
    [
      'invalid realtime timezone',
      {
        ...definition,
        interval: '1 min',
        realTime: true,
        startTime: '2026-08-19T14:40:10Z',
        endTime: '2026-08-19T14:41:10Z',
        timeSettings: { ...definition.timeSettings, timezone: 'Not/A_Zone' },
      },
      'Unsupported PlotTool Pro time zone: Not/A_Zone',
    ],
    [
      'malformed realtime time settings',
      {
        ...definition,
        interval: '1 min',
        realTime: true,
        startTime: '2026-08-19T14:40:10Z',
        endTime: '2026-08-19T14:41:10Z',
        timeSettings: 'America/New_York',
      },
      'Chart time settings is not a record',
    ],
    [
      'invalid realtime start',
      {
        ...definition,
        interval: '1 min',
        realTime: true,
        startTime: 'soon',
        endTime: '2026-08-19T14:41:10Z',
      },
      'PlotTool Pro start time is invalid',
    ],
    [
      'invalid realtime end',
      {
        ...definition,
        interval: '1 min',
        realTime: true,
        startTime: '2026-08-19T14:40:10Z',
        endTime: 'soon',
      },
      'PlotTool Pro end time is invalid',
    ],
  ])('classifies provider-derived %s as a typed decode failure', (_case, chart, reason) => {
    expect(() => encodePlotToolRunnerBody({
      definition: chart,
      expressions: [],
      controls: [],
      now: new Date('2026-08-19T15:00:00Z'),
    })).toThrowError(expect.objectContaining({
      name: 'PlotToolLaneDecodeError',
      message: `Unsupported PlotTool Pro response shape: ${reason}; record a Scenario before accepting this fallback.`,
    }));
  });

  it('encodes an eod POST with local date field names and variables', () => {
    expect(encodePlotToolRunnerBody({
      definition,
      expressions: [{ runner: 'series = DataSeries("SPX")', label: 'series' }],
      controls: [{ id: 'currency', type: 'Enum', value: 'USD' }],
      dates: {
        start: '2025-01-02',
        end: '2026-01-02',
      },
      statistics: true,
      now: new Date('2026-08-19T15:00:00Z'),
    })).toEqual({
      expressions: ['series = DataSeries("SPX")'],
      startDate: '2025-01-02',
      endDate: '2026-01-02',
      statistics: true,
      realTime: false,
      hints: [],
      variables: {},
      interval: '1D',
      controls: [{ id: 'currency', type: 'Enum', value: 'USD' }],
    });
  });

  it('uses realtime field names, same-minute start-of-day, and rolling-24h now', () => {
    expect(encodePlotToolRunnerBody({
      definition: {
        ...definition,
        interval: '1 min',
        realTime: true,
      },
      expressions: [{ runner: 'series()', label: 'series()' }],
      controls: [],
      dates: {
        start: '2026-08-19T14:40:10Z',
        end: '2026-08-19T14:40:50Z',
        timeZone: 'America/New_York',
      },
      now: new Date('2026-08-19T15:00:00Z'),
    })).toEqual({
      expressions: ['series()'],
      startTime: '2026-08-19T04:00:00Z',
      endTime: '2026-08-19T15:00:00Z',
      statistics: false,
      realTime: true,
      hints: [],
      interval: '1m',
      timeFilter: {
        start: '00:00:00',
        end: '23:59:59',
        timeZone: 'America/New_York',
      },
    });
  });

  it('preserves a realtime end outside the rolling 24-hour window and omits Tick', () => {
    const body = encodePlotToolRunnerBody({
      definition: {
        ...definition,
        interval: 'Tick',
        realTime: true,
      },
      expressions: [{ runner: 'series()', label: 'series()' }],
      controls: [],
      dates: {
        start: '2026-08-01T14:39:00Z',
        end: '2026-08-02T14:40:00Z',
        timeZone: 'America/New_York',
      },
      now: new Date('2026-08-19T15:00:00Z'),
    });

    expect(body).toMatchObject({
      startTime: '2026-08-01T14:39:00Z',
      endTime: '2026-08-02T14:40:00Z',
    });
    expect(body).not.toHaveProperty('interval');
    expect(body).not.toHaveProperty('variables');
  });
});

describe('PlotTool Pro control resolution', () => {
  it('expands groups, seeds countries, then performs entity lookup', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/marketview/constituents') {
        return {
          results: [
            {
              constituentType: 'Asset',
              constituentId: 'MA_TYPED',
              controlGroups: ['CG_GROUP'],
            },
            { id: 'MA_UNTYPED', controlGroups: ['CG_GROUP'] },
          ],
        };
      }
      if (path === '/v1/countries') return { results: [] };
      if (path === '/v1/plots/entities') {
        return { assets: [{ id: 'MA_TYPED' }, { id: 'MA_UNTYPED' }] };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    await expect(resolvePlotToolControls(request, [
      { id: 'basket', type: 'Asset', value: 'CG_GROUP' },
    ])).resolves.toEqual({
      controls: [{ id: 'basket', type: 'Asset', value: ['MA_TYPED', 'MA_UNTYPED'] }],
      entities: { assets: [{ id: 'MA_TYPED' }, { id: 'MA_UNTYPED' }] },
    });
    expect(request.mock.calls).toEqual([
      [
        { method: 'GET', path: '/v1/marketview/constituents' },
        { query: { groupIds: ['CG_GROUP'], limit: 50 } },
      ],
      [{ method: 'GET', path: '/v1/countries' }, { query: { limit: 300 } }],
      [
        { method: 'GET', path: '/v1/plots/entities' },
        {
          query: {
            ids: ['MA_TYPED', 'MA_UNTYPED'],
            type: ['Asset', 'Control_Group'],
          },
        },
      ],
    ]);
  });

  it('keeps Enum controls local without a country seed or entity lookup', async () => {
    const request = vi.fn();

    await expect(resolvePlotToolControls(request, [
      { id: 'tenor', type: 'Enum', value: '5' },
    ])).resolves.toEqual({
      controls: [{ id: 'tenor', type: 'Enum', value: '5' }],
      entities: {},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps non-entity controls local without a country seed or entity lookup', async () => {
    const request = vi.fn();
    const controls = [
      { id: 'label', type: 'String', value: 'custom' },
      { id: 'pricingDate', type: 'Date', value: '2026-08-19' },
      { id: 'window', type: 'RelativeDate', value: '-1y' },
      { id: 'tenors', type: 'EnumList', value: ['1y', '5y'] },
    ];

    await expect(resolvePlotToolControls(request, controls)).resolves.toEqual({
      controls,
      entities: {},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps an explicit Enum with a CG-prefixed value out of group expansion', async () => {
    const request = vi.fn();

    await expect(resolvePlotToolControls(request, [
      { id: 'scenario', type: 'Enum', value: 'CG_ENUM' },
    ])).resolves.toEqual({
      controls: [{ id: 'scenario', type: 'Enum', value: 'CG_ENUM' }],
      entities: {},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', 40],
    ['POST', 41],
  ])('uses %s for an entity batch of %i ids', async (method, count) => {
    const ids = Array.from({ length: count }, (_, index) => `MA_${index}`);
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/countries') return { results: [] };
      if (path === '/v1/plots/entities') return { assets: [] };
      throw new Error(`Unexpected path ${path}`);
    });

    await resolvePlotToolControls(request, [
      { id: 'assets', type: 'Asset', value: ids },
    ]);

    expect(request).toHaveBeenLastCalledWith({ method, path: '/v1/plots/entities' }, method === 'POST'
      ? {
          body: { ids, types: ['Asset', 'Control_Group'] },
        }
      : {
          query: { ids, type: ['Asset', 'Control_Group'] },
        });
  });

  it.each([
    [null, 'PlotTool Pro entity response is not a record'],
    [{ assets: {} }, 'assets is not an array'],
  ])('fails with a typed decode error for the entity response %j', async (response, reason) => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/countries') return { results: [] };
      if (path === '/v1/plots/entities') return response;
      throw new Error(`Unexpected path ${path}`);
    });

    await expect(resolvePlotToolControls(request, [
      { id: 'asset', type: 'Asset', value: 'MA_ONE' },
    ])).rejects.toThrow(`Unsupported PlotTool Pro response shape: ${reason};`);
  });

  it('uses the sole requested group when the provider omits item attribution', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/marketview/constituents') {
        return { results: [{ constituentType: 'Asset', constituentId: 'MA_MEMBER' }] };
      }
      if (path === '/v1/countries') return { results: [] };
      if (path === '/v1/plots/entities') return { assets: [] };
      throw new Error(`Unexpected path ${path}`);
    });

    await expect(resolvePlotToolControls(request, [
      { id: 'basket', type: 'Asset', value: 'CG_ONLY' },
    ])).resolves.toMatchObject({
      controls: [{ id: 'basket', type: 'Asset', value: ['MA_MEMBER'] }],
    });
  });

  it.each([
    [
      'ambiguous missing attribution',
      { constituentType: 'Asset', constituentId: 'MA_MEMBER' },
      ['CG_ONE', 'CG_TWO'],
    ],
    [
      'malformed attribution member',
      { constituentType: 'Asset', constituentId: 'MA_MEMBER', controlGroups: ['CG_ONE', 42] },
      ['CG_ONE'],
    ],
  ])('fails with a typed decode error for %s', async (_case, result, groupIds) => {
    const request = vi.fn().mockResolvedValue({ results: [result] });
    const promise = resolvePlotToolControls(request, [
      { id: 'basket', type: 'Asset', value: groupIds },
    ]);

    await expect(promise).rejects.toBeInstanceOf(PlotToolLaneDecodeError);
  });
});

describe('PlotTool Pro lane orchestration', () => {
  it('runs control resolution before the definition and POST runner call', async () => {
    const request = vi.fn(async ({ path }: Endpoint) => {
      if (path === '/v1/countries') return { results: [] };
      if (path === '/v1/plots/entities') return { assets: [{ id: 'MA_ASSET' }] };
      if (path === '/v1/charts/CH_TEST') {
        return {
          ...definition,
          controls: [{ id: 'asset', controlType: 'Asset', value: 'MA_SAVED' }],
        };
      }
      if (path === '/v1/plots/runner') return { results: [] };
      throw new Error(`Unexpected path ${path}`);
    });

    await expect(renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_TEST',
      controls: [{ id: 'asset', type: 'Asset', value: 'MA_ASSET' }],
      now: new Date('2026-08-08T12:00:00Z'),
    })).resolves.toMatchObject({
      results: { results: [] },
      displayControls: [{ id: 'asset', type: 'Asset', value: 'MA_ASSET' }],
      entities: { assets: [{ id: 'MA_ASSET' }] },
    });
    expect(request.mock.calls.map(([target]) => target)).toEqual([
      { method: 'GET', path: '/v1/countries' },
      { method: 'GET', path: '/v1/plots/entities' },
      { method: 'GET', path: '/v1/charts/CH_TEST' },
      { method: 'POST', path: '/v1/plots/runner' },
    ]);
  });

  it('prefers the saved runner GET when no POST trigger exists', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(definition)
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_TEST',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request.mock.calls).toEqual([
      [{ method: 'GET', path: '/v1/charts/CH_TEST' }, {
        headers: {
          'X-Dash-AppId': 'MQPLOT',
          'X-Support-Reference': 'MW_TEST',
        },
      }],
      [{ method: 'GET', path: '/v1/plots/runner/CH_TEST' }, {
        headers: {
          'X-Dash-AppId': 'MQPLOT',
          'X-Support-Reference': 'MW_TEST',
        },
      }],
    ]);
  });

  it('resolves saved relative bounds before sending the POST runner body', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        ...definition,
        startDate: null,
        endDate: null,
        relativeStartDate: '-1y',
        relativeEndDate: '30y',
      })
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_FORWARD',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/plots/runner' }, {
      headers: {
        'X-Dash-AppId': 'MQPLOT',
        'X-Support-Reference': 'MW_TEST:CH_FORWARD',
      },
      body: expect.objectContaining({
        startDate: '2025-08-08',
        endDate: '2056-08-08',
      }),
      isErrorBodyPreserved: true,
    });
  });

  it('keeps a real-time Chart with no relative window on its saved times', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        ...definition,
        interval: '1 min',
        realTime: true,
        startTime: '2026-08-08T10:00:00Z',
        endTime: '2026-08-08T11:00:00Z',
      })
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_REALTIME',
      controls: [{ id: 'tenor', type: 'Enum', value: '10y' }],
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/plots/runner' }, expect.objectContaining({
      body: expect.objectContaining({ realTime: true, interval: '1m' }),
    }));
  });

  it('ends a start-only relative window today', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ...definition, startDate: null, endDate: null, relativeStartDate: '-1m' })
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_START_ONLY',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/plots/runner' }, expect.objectContaining({
      body: expect.objectContaining({ startDate: '2026-07-08', endDate: '2026-08-08' }),
    }));
  });

  it('starts a relative end window at the saved absolute start date', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ...definition, endDate: null, relativeEndDate: '0d' })
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_ANCHORED',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/plots/runner' }, expect.objectContaining({
      body: expect.objectContaining({ startDate: '2025-01-02', endDate: '2026-08-08' }),
    }));
  });

  it('leaves the saved window unresolved under an explicit date override', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        ...definition,
        realTime: true,
        relativeStartDate: '-1y',
        relativeEndDate: '0d',
      })
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_OVERRIDE',
      controls: [],
      dateOverride: { start: '2026-01-02', end: '2026-02-02' },
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/plots/runner' }, expect.any(Object));
  });

  it.each([
    ['relativeStartDate', 'Chart relative start date is not a string'],
    ['relativeEndDate', 'Chart relative end date is not a string'],
  ])('fails loud on a non-string %s', async (field, message) => {
    const request = vi.fn().mockResolvedValueOnce({ ...definition, [field]: 7 });

    await expect(renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_BAD_WINDOW',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    })).rejects.toThrow(message);
  });

  it('sends the saved definition control when another trigger forces POST', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        ...definition,
        controls: [{ id: 'basket', controlType: 'Asset', value: 'MA_SAVED' }],
        relativeStartDate: '-1y',
        relativeEndDate: '0d',
      })
      .mockResolvedValueOnce({ results: [] });

    await renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_SAVED_CONTROL',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(request).toHaveBeenLastCalledWith({ method: 'POST', path: '/v1/plots/runner' }, expect.objectContaining({
      body: expect.objectContaining({
        controls: [{ id: 'basket', type: 'Asset', value: 'MA_SAVED' }],
      }),
    }));
  });

  it('ignores a blank-id definition control that cannot participate in a merge', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        ...definition,
        controls: [
          { id: 'asset', controlType: 'Asset', value: 'MA_SAVED' },
          { id: '', controlType: 'Asset', value: '' },
        ],
      })
      .mockResolvedValueOnce({ results: [] });

    await expect(renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_TEST',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    })).resolves.toMatchObject({
      displayControls: [{ id: 'asset', type: 'Asset', value: 'MA_SAVED' }],
    });
  });

  it('classifies malformed provider responses as decode failures', async () => {
    const request = vi.fn().mockResolvedValue({ description: 42 });

    await expect(renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_BAD',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    }))
      .rejects.toBeInstanceOf(PlotToolLaneDecodeError);
  });

  it('discards the whole chart when one runner result has an error key', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(definition)
      .mockResolvedValueOnce({
        results: [
          { type: 'series', values: { '2026-01-01': 1 } },
          { error: 'InvalidExpression', message: 'second series failed' },
        ],
      });

    await expect(renderPlotToolLane(request, {
      widgetId: 'MW_TEST',
      targetId: 'CH_TEST',
      controls: [],
      now: new Date('2026-08-08T12:00:00Z'),
    }))
      .rejects.toBeInstanceOf(PlotToolResultItemError);
  });
});
