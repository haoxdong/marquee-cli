import { describe, expect, it, vi } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { createProductionPlotTool } from '../../index.js';

type RunnerInit = Readonly<{
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
  isErrorBodyPreserved?: boolean;
}>;

// Answers the runner as the transport does: a 2xx resolves with the parsed body, and any
// other status rejects with a classified MarqueeError whose body is cut to 1 KB unless
// the caller asked to preserve it.
function runnerAnswering(status: number, body: string) {
  return vi.fn(async (endpoint: Endpoint, init?: RunnerInit): Promise<unknown> => {
    if (endpoint.path !== '/v1/plots/runner') throw new Error(`Unexpected request: ${endpoint.path}`);
    if (status < 300) return JSON.parse(body);
    throw new MarqueeError('http', `Marquee returned ${status} for ${endpoint.path}`, {
      status,
      path: endpoint.path,
      body: init?.isErrorBodyPreserved === true ? body : body.slice(0, 1024),
      responseClassification: 'http_status',
    });
  });
}

const HAVER = 'HAVER("EXSERIES", "EXDB").value()';
const UNRESOLVED = 'EXNOASSET1.spot()';

const evaluation = {
  expressions: [HAVER, UNRESOLVED],
  startDate: '2005-06-28',
  endDate: '2026-10-06',
  interval: '3M',
};

// 85 quarter-end points to 2026-06-30, as the runner answers a quarterly Haver series.
const HAVER_POINTS = Array.from({ length: 85 }, (_, index) => {
  const date = new Date(Date.UTC(2005, 6 + 3 * index, 0));
  return { date: date.toISOString().slice(0, 10), value: 681 + 20 * index };
});

// The runner's statistics for anything but a series (live, 2026-10-22).
const NOT_SERIES = { error: 'Error', message: 'No statistics for non-series object.' };

// A batch of two Expressions: the Haver series returned, EXNOASSET1 did not resolve, and the
// runner answered HTTP 404 with both results in a body well over the transport's 1 KB cut.
const PARTIAL_FAILURE = JSON.stringify({
  results: [
    { type: 'series', values: Object.fromEntries(HAVER_POINTS.map(({ date, value }) => [date, value])) },
    {
      error: 'Error',
      message: 'Not Found (did not find any entities for EXNOASSET1) (Historical mode)',
      statusCode: 404,
    },
  ],
  statistics: [
    {
      low: { value: 681, keys: ['2005-06-30'] },
      high: { value: 2361, keys: ['2026-06-30'] },
      first: { value: 681, keys: ['2005-06-30'] },
      last: { value: 2361, keys: ['2026-06-30'] },
      median: { value: 1521 },
      avg: { value: 1521 },
      stdDev: { value: 493.63 },
      zscore: { value: 1.7017 },
      percentile: { value: 100 },
    },
    NOT_SERIES,
  ],
  asset_ids: [],
  entities: [[], []],
  datasets: ['EXAMPLE_HAVER'],
  tsdb_symbols: [],
});

function expectGoodResultsAndTheError(outcome: unknown): void {
  expect(outcome).toMatchObject({
    ok: true,
    value: {
      results: [
        { kind: 'series', expression: HAVER },
        {
          kind: 'error',
          expression: UNRESOLVED,
          message: 'Not Found (did not find any entities for EXNOASSET1) (Historical mode)',
          status: 404,
        },
      ],
      provenance: { assetIds: [], datasets: ['EXAMPLE_HAVER'], tsdbSymbols: [] },
    },
  });
  const [series] = (outcome as { value: { results: [{ points: unknown[] }] } }).value.results;
  expect(series.points).toHaveLength(85);
  expect(series.points.slice(0, 2)).toEqual([
    { date: '2005-06-30', value: 681 },
    { date: '2005-09-30', value: 701 },
  ]);
  expect(series.points.at(-1)).toEqual({ date: '2026-06-30', value: 2361 });
  expect(series).toHaveProperty('statistics', {
    low: { value: 681, dates: ['2005-06-30'] },
    high: { value: 2361, dates: ['2026-06-30'] },
    first: { value: 681, dates: ['2005-06-30'] },
    last: { value: 2361, dates: ['2026-06-30'] },
    median: 1521,
    average: 1521,
    standardDeviation: 493.63,
    zScore: 1.7017,
    percentile: 100,
  });
}

const FAILED_ASSET = { error: 'Error', message: 'failed', statusCode: 404 };
const SERIES = { type: 'series', values: { '2026-01-01': 1 } };
const SERIES_STATISTICS = {
  low: { value: 1, keys: ['2026-01-01'] },
  high: { value: 1, keys: ['2026-01-01'] },
  first: { value: 1, keys: ['2026-01-01'] },
  last: { value: 1, keys: ['2026-01-01'] },
  median: { value: 1 },
  avg: { value: 1 },
  stdDev: { value: 0 },
  zscore: { value: 0 },
  percentile: { value: 100 },
};

describe('PlotTool Pro evaluation', () => {
  it('keeps the good results and the error when the runner answers non-2xx', async () => {
    expect(PARTIAL_FAILURE.length).toBeGreaterThan(1024);
    const request = runnerAnswering(404, PARTIAL_FAILURE);

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expectGoodResultsAndTheError(outcome);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.body).toEqual({
      expressions: [HAVER, UNRESOLVED],
      statistics: true,
      realTime: false,
      hints: [],
      variables: {},
      interval: '3M',
      startDate: '2005-06-28',
      endDate: '2026-10-06',
    });
  });

  // PlotTool Web received HTTP 200 for the same per-Expression body (memo 0047 §6).
  it('keeps the good results and the error when the runner answers 2xx', async () => {
    const outcome = await createProductionPlotTool({ request: runnerAnswering(200, PARTIAL_FAILURE) })
      .evaluate(evaluation);

    expectGoodResultsAndTheError(outcome);
  });

  // A constant series has no z-score: the runner answers `"zscore": {}` (live: `first(AAPL UW.spot())`).
  it('gives a constant series no z-score, as the runner answers none', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [SERIES],
      statistics: [{ ...SERIES_STATISTICS, zscore: {} }],
      asset_ids: [],
      entities: [[]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({ ...evaluation, expressions: ['EXMP.spot()'] });

    expect(outcome).toMatchObject({ ok: true, value: { results: [{ kind: 'series', statistics: { average: 1 } }] } });
    expect(outcome.ok && outcome.value.results[0]).not.toHaveProperty('statistics.zScore');
  });

  // The runner gives a model method's series none (live, 2026-10-22: `m.r_squared()`).
  it('gives a series the runner answers no statistics for none', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [SERIES],
      statistics: [NOT_SERIES],
      asset_ids: [],
      entities: [[]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({ ...evaluation, expressions: ['m.r_squared()'] });

    expect(outcome).toEqual({
      ok: true,
      value: {
        results: [{ kind: 'series', expression: 'm.r_squared()', points: [{ date: '2026-01-01', value: 1 }] }],
        provenance: { assetIds: [], datasets: [], tsdbSymbols: [] },
      },
    });
  });

  // An empty series has no statistics: the runner answers `No statistics for empty series.` (live,
  // 2026-10-22). It names what the Expression resolved, a Country by its id (live: `US.cai(FOO)`, 2026-10-28).
  it('reads an empty series as the Entities it resolved, with no statistics', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [{ type: 'series', values: {} }],
      statistics: [{ error: 'Error', message: 'No statistics for empty series.' }],
      asset_ids: [],
      entities: [[{ entityName: 'Example Country', mqid: 'EX', type: 'country' }]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({ ...evaluation, expressions: ['EX.cai(FOO)'] });

    expect(outcome).toEqual({
      ok: true,
      value: {
        results: [{ kind: 'empty-series', expression: 'EX.cai(FOO)', assets: [], entityIds: ['EX'] }],
        provenance: { assetIds: [], datasets: [], tsdbSymbols: [] },
      },
    });
  });

  it('sends the Expressions with Web\'s PlotTool Pro app id', async () => {
    const request = runnerAnswering(200, PARTIAL_FAILURE);

    await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(request).toHaveBeenCalledWith(
      { method: 'POST', path: '/v1/plots/runner' },
      expect.objectContaining({ headers: { 'X-Dash-AppId': 'MQPLOT' } }),
    );
  });

  it('waits 30s for the runner, so a slow evaluation fails instead of blocking the answer', async () => {
    const request = runnerAnswering(200, PARTIAL_FAILURE);

    await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(request).toHaveBeenCalledWith(
      { method: 'POST', path: '/v1/plots/runner' },
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it('fails the batch as a whole when the runner answers with no results, keeping its answer on one line', async () => {
    const request = runnerAnswering(500, JSON.stringify({
      statusCode: 500,
      reasonPhrase: 'Internal Server Error',
      title: '500 - Internal Server Error',
      messages: ['Error ID: 0000000000000000002', 'Message: 500\nInternal Server Error'],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: 'execution-failed',
        status: 500,
        failure: { kind: 'unavailable', status: 500, message: 'Error ID: 0000000000000000002; Message: 500 Internal Server Error' },
        message: '{"statusCode":500,"reasonPhrase":"Internal Server Error","title":"500 - Internal Server Error","messages":["Error ID: 0000000000000000002","Message: 500\\nInternal Server Error"]}',
      },
    });
  });

  // The MarqueeBot session gateway relays the body without a classification (live, 2026-11-05).
  it('keeps the answer of a batch failed through the session gateway', async () => {
    const body = '{"statusCode":500,"reasonPhrase":"Internal Server Error","messages":["Error ID: 0000000000000000003"]}';
    const request = vi.fn(async (endpoint: Endpoint): Promise<unknown> => {
      throw new MarqueeError('http', `Marquee returned 500 for ${endpoint.path}`, { status: 500, path: endpoint.path, body });
    });

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: { kind: 'execution-failed', status: 500, failure: { kind: 'unavailable', status: 500, message: 'Error ID: 0000000000000000003' }, message: body },
    });
  });

  it('reports a denied batch as access denied', async () => {
    const request = runnerAnswering(403, '<html>Forbidden</html>');

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: 'execution-failed',
        status: 403,
        reason: 'access-denied',
        failure: { kind: 'unavailable', status: 403, message: '<html>Forbidden</html>' },
        message: '<html>Forbidden</html>',
      },
    });
  });

  it('reads a string result as a value', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [{ type: 'string', values: 'hello' }],
      statistics: [NOT_SERIES],
      asset_ids: [],
      entities: [[]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['"hello"'],
    });

    expect(outcome).toEqual({
      ok: true,
      value: {
        results: [{ kind: 'value', expression: '"hello"', value: 'hello' }],
        provenance: { assetIds: [], datasets: [], tsdbSymbols: [] },
      },
    });
  });

  // A smile answers `sortedSeries` points keyed by delta (live: `EURUSD.fx_vol_smile(3m)`).
  it('reads a sortedSeries keyed by number as a curve', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [{ type: 'sortedSeries', values: [[-25, 6.5], [0, 6.1], [25, 6.2]], result_type: 'term_structure' }],
      // A curve's statistics are keyed by its points, and not read.
      statistics: [{ low: { value: 6.1, keys: [0] }, high: { value: 6.5, keys: [-25] } }],
      asset_ids: [],
      entities: [[]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['EXMP.fx_vol_smile(3m)'],
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [{
          kind: 'curve',
          expression: 'EXMP.fx_vol_smile(3m)',
          points: [{ point: -25, value: 6.5 }, { point: 0, value: 6.1 }, { point: 25, value: 6.2 }],
        }],
      },
    });
  });

  it('keeps the Marquee id a message names, as Marquee sends it', async () => {
    const request = runnerAnswering(400, JSON.stringify({
      results: [{
        error: 'Error',
        message: 'Bad Request (Risk Reversal is not available for None MA_SYNTHETIC_EXMP) (Historical mode)',
        statusCode: 400,
      }],
      statistics: [NOT_SERIES],
      asset_ids: ['MA_SYNTHETIC_EXMP'],
      entities: [[{
        entityName: 'EXMP',
        mqid: 'MA_SYNTHETIC_EXMP',
        type: 'asset',
        assetName: 'EXMP',
        properties: { assetClass: 'FX', description: '', assetType: 'Cross', region: 'Global' },
      }]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['EXMP.risk_reversal(3m, 25)'],
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [{
          kind: 'error',
          message: 'Bad Request (Risk Reversal is not available for None MA_SYNTHETIC_EXMP) (Historical mode)',
        }],
      },
    });
  });

  // A 404 for an asset that resolved but carries no such measure. The entity names the asset
  // by its name (live, 2026-10-16); only the message names it as written.
  it('names the assets a failed Expression resolved, as written, and keeps the message as Marquee sends it', async () => {
    const request = runnerAnswering(404, JSON.stringify({
      results: [{
        error: 'Error',
        message: 'Not Found (Markets endpoint: 00000000-0000-4000-8000-000000000051 DataSet not found for entity with id: MA_SYNTHETIC_EXMP_UW ,EXMP UW) (Historical mode)',
        statusCode: 404,
      }],
      statistics: [NOT_SERIES],
      asset_ids: ['MA_SYNTHETIC_EXMP_UW'],
      entities: [[{
        entityName: 'Example Corp',
        mqid: 'MA_SYNTHETIC_EXMP_UW',
        type: 'asset',
        assetName: 'Example Corp',
        properties: { assetClass: 'Equity', description: '', assetType: 'Single Stock', region: null },
      }]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['EXMP UW.swap_rate()'],
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [{
          kind: 'error',
          expression: 'EXMP UW.swap_rate()',
          message: 'Not Found (Markets endpoint: 00000000-0000-4000-8000-000000000051 DataSet not found for entity with id: MA_SYNTHETIC_EXMP_UW ,EXMP UW) (Historical mode)',
          assets: [{
            identifier: 'EXMP UW',
            assetId: 'MA_SYNTHETIC_EXMP_UW',
            name: 'Example Corp',
            assetClass: 'Equity',
            assetType: 'Single Stock',
          }],
        }],
      },
    });
  });

  // The runner names its internal cache host bare, with no scheme, in some messages.
  it('keeps internal hosts, bare or in a URL, as Marquee sends them', async () => {
    const request = runnerAnswering(404, JSON.stringify({
      results: [
        {
          error: 'Error',
          message: 'Not Found (cache-layer.example:4556 did not find any entities for EXNOASSET1) (Historical mode)',
          statusCode: 404,
        },
        {
          error: 'Error',
          message: 'Bad Gateway (GET https://cache-layer.example:4556/v1/assets/EXNOASSET2 failed)',
          statusCode: 502,
        },
      ],
      statistics: [NOT_SERIES, NOT_SERIES],
      asset_ids: [],
      entities: [[], []],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['EXNOASSET1.spot()', 'EXNOASSET2.spot()'],
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [
          { kind: 'error', message: 'Not Found (cache-layer.example:4556 did not find any entities for EXNOASSET1) (Historical mode)' },
          { kind: 'error', message: 'Bad Gateway (GET https://cache-layer.example:4556/v1/assets/EXNOASSET2 failed)' },
        ],
      },
    });
  });

  it('fails loud on a result count that does not match the Expressions', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [{ type: 'string', values: 'hello' }],
      asset_ids: [],
      entities: [[]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: { kind: 'malformed-results', location: 'results', problem: 'expected 2 results, got 1' },
    });
  });

  it('reports a timed-out batch with no status, and how long the runner was given', async () => {
    const request = vi.fn(async () => {
      throw new MarqueeError('timeout', 'Timed out', { path: '/v1/plots/runner' });
    });

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: { kind: 'execution-failed', failure: { kind: 'timeout' }, timeoutMs: 30_000 },
    });
  });

  it('reports an expired session as expired authentication', async () => {
    const request = vi.fn(async () => {
      throw new MarqueeError('auth_expired', 'Not authenticated', {
        status: 401,
        path: '/v1/plots/runner',
        body: '',
        responseClassification: 'http_401',
      });
    });

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: 'execution-failed',
        status: 401,
        authentication: 'expired',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });
  });

  it('reports an upstream 401 as required authentication', async () => {
    const request = vi.fn(async () => {
      throw new MarqueeError('http', 'Unauthorized', {
        status: 401,
        path: '/v1/plots/runner',
        body: '{"title":"Unauthorized"}',
        responseClassification: 'entity_401',
      });
    });

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: {
        kind: 'execution-failed',
        status: 401,
        authentication: 'required',
        failure: { kind: 'unavailable', status: 401, message: '{"title":"Unauthorized"}' },
      },
    });
  });

  it('rethrows a failure that is not a classified Marquee error', async () => {
    const failure = new TypeError('fetch failed');
    const request = vi.fn(async () => {
      throw failure;
    });

    await expect(createProductionPlotTool({ request }).evaluate(evaluation)).rejects.toBe(failure);
  });

  // The runner lists a country among an Expression's entities as `{entityName, mqid, type}`
  // (Recording widget-country-name-input).
  it('names only the assets among a failed Expression\'s resolved entities', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [{ error: 'Error', message: 'Expression failed', statusCode: 400 }],
      statistics: [NOT_SERIES],
      asset_ids: ['MA_SYNTHETIC_EXMP'],
      entities: [[
        { entityName: 'Germany', mqid: 'DE', type: 'country' },
        {
          entityName: 'EXMP',
          mqid: 'MA_SYNTHETIC_EXMP',
          type: 'asset',
          assetName: 'Example Corp',
          properties: { assetClass: 'Equity', description: '', assetType: 'Single Stock' },
        },
      ]],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['EXMP.spot()'],
    });

    expect(outcome).toEqual({
      ok: true,
      value: {
        results: [{
          kind: 'error',
          expression: 'EXMP.spot()',
          message: 'Expression failed',
          status: 400,
          assets: [{
            identifier: 'EXMP',
            assetId: 'MA_SYNTHETIC_EXMP',
            name: 'Example Corp',
            assetClass: 'Equity',
            assetType: 'Single Stock',
          }],
        }],
        provenance: { assetIds: ['MA_SYNTHETIC_EXMP'], datasets: [], tsdbSymbols: [] },
      },
    });
  });

  it('fails loud on a non-2xx body that is not JSON', async () => {
    const request = runnerAnswering(500, '{"results": [');

    const outcome = await createProductionPlotTool({ request }).evaluate(evaluation);

    expect(outcome).toEqual({
      ok: false,
      error: { kind: 'malformed-results', location: 'failure body', problem: 'expected JSON' },
    });
  });


  it.each([
    ['numeric-only', [{ type: 'series', values: { '2026-09-01': 4.2 } }]],
    ['text-only', [{ type: 'series', values: { '2026-09-01': 'Inflation' } }]],
    ['one mixed series', [{ type: 'series', values: { '2026-09-01': 4.2, '2026-09-02': 'Inflation' } }]],
  ])('rejects missing statistics for a %s batch', async (_name, results) => {
    const request = runnerAnswering(200, JSON.stringify({
      results,
      entities: [[]],
      asset_ids: [],
      datasets: [],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({ ...evaluation, expressions: [HAVER] });

    expect(outcome).toEqual({
      ok: false,
      error: { kind: 'malformed-results', location: 'statistics', problem: 'expected 1 statistics' },
    });
  });

  it('keeps numeric points without statistics when a sibling is a text series', async () => {
    const request = runnerAnswering(200, JSON.stringify({
      results: [
        { type: 'series', values: { '2026-09-01': 4.2 } },
        { type: 'series', values: { '2026-09-01': 'Inflation' } },
      ],
      entities: [[], []],
      asset_ids: [],
      datasets: ['FRED'],
      tsdb_symbols: [],
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['FRED(UNRATE).value()', 'US.turnleaf_category()'],
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        results: [
          { kind: 'series', points: [{ date: '2026-09-01', value: 4.2 }] },
          { kind: 'error', expression: 'US.turnleaf_category()', message: 'PlotTool Pro returned a text series; numeric values are required' },
        ],
      },
    });
    expect(outcome.ok && outcome.value.results[0]).not.toHaveProperty('statistics');
    expect(outcome.ok && outcome.value.results[1]).not.toHaveProperty('status');
  });

  it.each([
    ['results[0]', 'unsupported result type object', { results: [{ type: 'object', values: [1] }] }],
    ['results[0].values[0]', 'expected a [number, number] pair', { results: [{ type: 'sortedSeries', values: [['1m', 1]] }] }],
    ['results[0].values', 'expected a record', { results: [{ type: 'series', values: [1] }] }],
    [
      'results[0].values.2026-01-01',
      'expected a number',
      { results: [{ type: 'series', values: { '2026-01-01': true } }] },
    ],
    ['entities', 'expected 1 entity lists', { results: [SERIES], entities: [] }],
    ['entities[0][0]', 'expected a record', { results: [FAILED_ASSET], entities: [[null]] }],
    [
      'entities[0][0].mqid',
      'expected text',
      { results: [{ type: 'sortedSeries', values: [] }], entities: [[{ type: 'country', entityName: 'Example Country' }]] },
    ],
    [
      'entities[0][0]',
      'expected entityName, mqid and assetName',
      { results: [FAILED_ASSET], entities: [[{ type: 'asset', entityName: 'EXMP' }]] },
    ],
    [
      'entities[0][0].properties',
      'expected a record',
      {
        results: [FAILED_ASSET],
        entities: [[{ type: 'asset', entityName: 'EXMP', mqid: 'MA_SYNTHETIC_EXMP', assetName: 'Example Corp' }]],
      },
    ],
    [
      'results[0].statusCode',
      'expected a number',
      { results: [{ error: 'Error', message: 'failed' }] },
    ],
    [
      'entities[0][0].properties.assetType',
      'expected text',
      {
        results: [FAILED_ASSET],
        entities: [[{
          type: 'asset',
          entityName: 'EXMP',
          mqid: 'MA_SYNTHETIC_EXMP',
          assetName: 'Example Corp',
          properties: { assetClass: 'Equity', assetType: '' },
        }]],
      },
    ],
    ['asset_ids', 'expected an array of strings', { results: [SERIES], statistics: [SERIES_STATISTICS], asset_ids: [1] }],
    ['statistics', 'expected 1 statistics', { results: [SERIES], statistics: [] }],
    [
      'statistics[0].low.keys',
      'expected dates',
      { results: [SERIES], statistics: [{ ...SERIES_STATISTICS, low: { value: 1 } }] },
    ],
    [
      'statistics[0].avg',
      'expected a number value',
      { results: [SERIES], statistics: [{ ...SERIES_STATISTICS, avg: { value: '1' } }] },
    ],
  ])('fails loud on malformed %s: %s', async (location, problem, body) => {
    const request = runnerAnswering(200, JSON.stringify({
      statistics: [NOT_SERIES],
      entities: [[]],
      asset_ids: [],
      datasets: [],
      tsdb_symbols: [],
      ...body,
    }));

    const outcome = await createProductionPlotTool({ request }).evaluate({
      ...evaluation,
      expressions: ['EXMP.spot()'],
    });

    expect(outcome).toEqual({ ok: false, error: { kind: 'malformed-results', location, problem } });
  });
});
