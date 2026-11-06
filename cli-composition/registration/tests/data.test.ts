import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createData } from '../../../data/index.js';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { createProgram } from '../../index.js';

type SavedExchange = Readonly<{ requestBody?: unknown; status: number; body: unknown }>;

// A synthetic exchange under marquee-cli/data/tests/fixtures, shaped as Marquee answers (ADR 0043).
function fixture(name: string): Readonly<{ requestBody: unknown; status: number; body: string }> {
  const exchange = JSON.parse(readFileSync(
    new URL(`../../../data/tests/fixtures/${name}.json`, import.meta.url),
    'utf8',
  )) as SavedExchange;
  return { requestBody: exchange.requestBody, status: exchange.status, body: JSON.stringify(exchange.body) };
}

// Answers the runner as the transport does: a 2xx resolves with the parsed body, and any
// other status rejects with the classified error carrying the whole body.
function runnerAnswering(exchange: Readonly<{ status: number; body: string }>) {
  return vi.fn(async (endpoint: Endpoint, _init?: Readonly<{ body?: unknown }>): Promise<unknown> => {
    if (endpoint.path === '/v1/charts') return JSON.parse(fixture('chart-created').body);
    if (endpoint.path !== '/v1/plots/runner') throw new Error(`Unexpected request: ${endpoint.path}`);
    if (exchange.status < 300) return JSON.parse(exchange.body);
    throw new MarqueeError('http', `Marquee returned ${exchange.status} for ${endpoint.path}`, {
      status: exchange.status,
      path: endpoint.path,
      body: exchange.body,
      responseClassification: 'http_status',
    });
  });
}

// The runner calls among a request's calls; eval saves its chart alongside them.
function runnerCalls(request: ReturnType<typeof runnerAnswering>) {
  return request.mock.calls.filter(([endpoint]) => endpoint.path === '/v1/plots/runner');
}

const CHART_LINK = 'url:\thttps://marquee.gs.com/s/plottool/CH_SYNTHETIC_SAVED';

// The function library and the asset searches explanations send.
const LIBRARY = 'plots-functions';
const ASSET_SEARCHES: Readonly<Record<string, string>> = {
  EXMP: 'nearest-assets-exmp',
  EXNOASSET1: 'nearest-assets-none',
};

type MarqueeRequest = (endpoint: Endpoint, init?: Readonly<{ body?: unknown }>) => Promise<unknown>;

// Answers the catalog requests eval makes around the runner call, and the rest with `runner`.
function withCatalogs(runner: MarqueeRequest): MarqueeRequest {
  return async (endpoint, init) => {
    if (endpoint.path === '/v1/plots/functions') return JSON.parse(fixture(LIBRARY).body);
    if (endpoint.method === 'POST' && endpoint.path === '/v1/plots/entities') {
      const { asset } = init?.body as { asset: { q: string } };
      const search = ASSET_SEARCHES[asset.q];
      if (search === undefined) throw new Error(`Unexpected asset search: ${asset.q}`);
      return JSON.parse(fixture(search).body);
    }
    return runner(endpoint, init);
  };
}

async function run(args: readonly string[], request: MarqueeRequest, now = '2026-10-17T12:00:00Z') {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const data = createData({
    request: withCatalogs(request),
    now: () => new Date(now),
    cacheDirectory: mkdtempSync(join(tmpdir(), 'marquee-data-catalogs-')),
  });
  const { program } = createProgram((chunk) => stdout.push(chunk), {
    data,
    writeError: (chunk) => stderr.push(chunk),
  });
  try {
    await program.parseAsync(['data', ...args], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    process.exitCode = error.exitCode;
  }
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: process.exitCode };
}

const OCT_16 = '2026-10-16T12:00:00Z';

// A titled table's rows: the lines under its title and header, up to the blank line ending it.
function tableRows(stdout: string, title: RegExp): readonly (readonly string[])[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => title.test(line));
  if (start < 0) return [];
  const end = lines.indexOf('', start);
  return lines.slice(start + 2, end).map((line) => line.split('\t'));
}

// Each Statistics row's Expression and Last cells.
function statisticsEnds(stdout: string): readonly (readonly string[])[] {
  return tableRows(stdout, /^Statistics$/).map((cells) => [cells[0] ?? '', cells[7] ?? '']);
}

describe('marquee data eval', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('prints the good rows on stdout, each failed Expression on stderr, and exits 1', async () => {
    const result = await run(
      ['eval', 'HAVER("EXSERIES", "EXDB").value()', 'EXNOASSET1.spot()'],
      runnerAnswering(fixture('runner-haver-partial-failure')),
      OCT_16,
    );

    expect(statisticsEnds(result.stdout)).toEqual([['HAVER("EXSERIES", "EXDB").value()', '1,336']]);
    expect(result.stdout).toContain('\nData (30 of 85 rows)\n');
    expect(result.stderr).toBe([
      'Error: EXNOASSET1.spot(): code: 404 - Not Found (did not find any entities for EXNOASSET1) (Historical mode)',
      'Hints for EXNOASSET1.spot():',
      '  No assets match EXNOASSET1',
      '',
    ].join('\n'));
    expect(result.exitCode).toBe(1);
  });

  it.each([
    [['--start-date', '-1y']],
    [['--start-date=-1y']],
  ])('takes a relative start date spelled %j', async (flags) => {
    const exchange = fixture('runner-unrate-1y-1d');
    const request = runnerAnswering(fixture('runner-unrate-1y-1d'));

    const result = await run(['eval', 'FRED(UNRATE).value()', ...flags], request, OCT_16);

    expect(request.mock.calls[0]?.[1]?.body).toEqual(exchange.requestBody);
    expect(statisticsEnds(result.stdout)).toEqual([['FRED(UNRATE).value()', '4.2']]);
    expect(result.exitCode).toBeUndefined();
  });

  it('takes --interval in either case', async () => {
    const exchange = fixture('runner-unrate-1y-7d');
    const request = runnerAnswering(exchange);

    const result = await run(['eval', 'FRED(UNRATE).value()', '--interval', '1w'], request, OCT_16);

    expect(request.mock.calls[0]?.[1]?.body).toEqual(exchange.requestBody);
    expect(result.exitCode).toBeUndefined();
  });

  it.each(['yesterday', '2026-02-30'])('rejects the start date %s before any call', async (token) => {
    const request = vi.fn(async () => ({}));

    const result = await run(['eval', 'FRED(UNRATE).value()', '--start-date', token], request);

    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      stdout: '',
      stderr: `error: option '--start-date <date>' argument '${token}' is invalid. expected -<n>d, -<n>w, -<n>m, -<n>y, -ytd, -max, 0d, +<n>d, +<n>w, +<n>m, +<n>y or YYYY-MM-DD\n`,
      exitCode: 1,
    });
  });

  // Marquee's data service answers some Expressions 502 and clears seconds later (live, 2026-11-04).
  it('prints an upstream failure verbatim on one line, then one line to run the failed Expressions again with their assignments', async () => {
    const unrate = JSON.parse(fixture('runner-unrate-1y-1d').body) as { results: unknown[]; statistics: unknown[] };
    const body = JSON.stringify({
      ...unrate,
      results: [unrate.results[0], {
        error: 'Error',
        message: 'context: None: POST https://cache-layer.example:4556/v1/data/measures\nstatus: 502, message: Bad Gateway (Historical mode)',
        statusCode: 502,
      }],
      statistics: [unrate.statistics[0], { error: 'Error', message: 'No statistics for non-series object.' }],
      entities: [[], []],
    });

    const result = await run(['eval', 'a = FRED(UNRATE).value()', 'a * 2'], runnerAnswering({ status: 200, body }), OCT_16);

    expect(result.stderr).toBe([
      'Error: a * 2: code: 502 - context: None: POST https://cache-layer.example:4556/v1/data/measures status: 502, message: Bad Gateway (Historical mode)',
      '1 of 2 expressions failed upstream; run them again: marquee data eval \'a = FRED(UNRATE).value()\' \'a * 2\' --start-date 2025-10-16 --end-date 2026-10-16 --interval 1D',
      '',
    ].join('\n'));
    expect(result.exitCode).toBe(1);
  });

  // Live, 2026-11-05: `USDBRL.implied_volatility(27m, delta_put, 10)` answers so, while 12m and 2y answer.
  it.each([
    ['EXMP UW.implied_volatility(27m, delta_put, 10)', [
      'Hints for EXMP UW.implied_volatility(27m, delta_put, 10):',
      '  Marquee holds no data at these arguments: try a standard tenor, such as 1y or 2y, or a strike nearer the money',
    ]],
    ['FRED(DGS10).value() * 2', ['Hints for FRED(DGS10).value() * 2:', '  Check its arguments: marquee data view FRED']],
  ])('keeps Marquee\'s message for arguments it holds no data for, and suggests a tenor or strike only to a measure that takes some: %s', async (expression, hints) => {
    const unrate = JSON.parse(fixture('runner-unrate-1y-1d').body) as { results: unknown[]; statistics: unknown[] };
    const message = 'measure service request 00000000-0000-4000-8000-000000000000 failed: [\'DataSet not found for entity with id: MA_SYNTHETIC_EXMP_UW\'] (Historical mode)';
    const body = JSON.stringify({
      ...unrate,
      results: [unrate.results[0], { error: 'Error', message, statusCode: 400 }],
      statistics: [unrate.statistics[0], { error: 'Error', message: 'No statistics for non-series object.' }],
      entities: [[], []],
    });

    const result = await run(['eval', 'FRED(UNRATE).value()', expression], runnerAnswering({ status: 200, body }), OCT_16);

    expect(result.stderr).toBe([`Error: ${expression}: code: 400 - ${message}`, ...hints, ''].join('\n'));
    expect(result.exitCode).toBe(1);
  });

  // The runner answers text as `{"type": "string", "values": "Fixed Income"}` (Recording widget-control-group-country-name).
  it('prints the good rows beside an Expression that evaluated to text, with where to check its arguments', async () => {
    const unrate = JSON.parse(fixture('runner-unrate-1y-1d').body) as { results: unknown[]; statistics: unknown[] };
    const body = JSON.stringify({
      ...unrate,
      results: [unrate.results[0], { type: 'string', values: 'Fixed Income' }],
      statistics: [unrate.statistics[0], { error: 'Error', message: 'No statistics for non-series object.' }],
      entities: [[], []],
    });

    const result = await run(['eval', 'FRED(UNRATE).value()', 'EXMP UW.spot()'], runnerAnswering({ status: 200, body }), OCT_16);

    expect(statisticsEnds(result.stdout)).toEqual([['FRED(UNRATE).value()', '4.2']]);
    expect(result.stderr).toBe([
      'Error: EXMP UW.spot(): evaluated to the text "Fixed Income", not a series',
      'Hints for EXMP UW.spot():',
      '  Check its arguments: marquee data view "EXMP UW"',
      '',
    ].join('\n'));
    expect(result.exitCode).toBe(1);
  });

  it('prints a curve\'s points, one row each, under the series rows and in --json', async () => {
    const exchange = {
      status: 200,
      body: JSON.stringify({
        results: [
          { type: 'sortedSeries', values: [[-25, 6.5], [0, 6.1]], result_type: 'term_structure' },
          { type: 'series', values: { '2026-10-15': 1, '2026-10-16': 2 } },
        ],
        statistics: [
          { low: { value: 6.1, keys: [0] }, high: { value: 6.5, keys: [-25] } },
          {
            low: { value: 1, keys: ['2026-10-15'] },
            high: { value: 2, keys: ['2026-10-16'] },
            first: { value: 1, keys: ['2026-10-15'] },
            last: { value: 2, keys: ['2026-10-16'] },
            median: { value: 1.5 },
            avg: { value: 1.5 },
            stdDev: { value: 0.7071067811865476 },
            zscore: { value: 0.7071067811865475 },
            percentile: { value: 100 },
          },
        ],
        asset_ids: [],
        entities: [[], []],
        datasets: [],
        tsdb_symbols: [],
      }),
    };

    const text = await run(['eval', 'EXMP.fx_vol_smile(3m)', 'EXMP.spot()'], runnerAnswering(exchange), OCT_16);
    const json = await run(
      ['eval', 'EXMP.fx_vol_smile(3m)', 'EXMP.spot()', '--json', 'results', '--jq', '.results[0]'],
      runnerAnswering(exchange),
      OCT_16,
    );

    expect(text.stdout.split('\n').slice(2)).toEqual([
      'EXMP.spot()\t1\t15 Oct 2026\t2\t16 Oct 2026\t1\t15 Oct 2026\t2\t16 Oct 2026\t1.5\t1.5\t0.7071\t0.71\t100.00%',
      '',
      'Data',
      'date\tEXMP.spot()',
      '16 Oct 2026\t2',
      '15 Oct 2026\t1',
      '',
      'expression\tpoint\tvalue',
      'EXMP.fx_vol_smile(3m)\t-25\t6.5',
      'EXMP.fx_vol_smile(3m)\t0\t6.1',
      '',
      CHART_LINK,
      '',
    ]);
    expect(text.exitCode).toBeUndefined();
    expect(JSON.parse(json.stdout)).toEqual({
      expression: 'EXMP.fx_vol_smile(3m)',
      values: [{ point: -25, value: 6.5 }, { point: 0, value: 6.1 }],
    });
  });

  it('prints a model by its name, for the methods called on it, and exits 0', async () => {
    const exchange = {
      status: 200,
      body: JSON.stringify({
        results: [
          { type: 'object', values: ['<LinearRegression object>'] },
          { type: 'series', values: { '2026-10-15': 0.2, '2026-10-16': 0.2 } },
        ],
        // The runner gives a model method's series no statistics (live, 2026-10-22: `m.r_squared()`).
        statistics: [
          { error: 'Error', message: 'No statistics for non-series object.' },
          { error: 'Error', message: 'No statistics for non-series object.' },
        ],
        asset_ids: [],
        entities: [[], []],
        datasets: [],
        tsdb_symbols: [],
      }),
    };
    // The synthetic library has no LinearRegression; the fake runner answers its object anyway.
    const args = ['eval', 'm = correlation(EXMP.spot(), EXMP.spot(), 63)', 'EXMP.spot()'];

    const text = await run(args, runnerAnswering(exchange), OCT_16);
    const json = await run([...args, '--json', 'results', '--jq', '.results'], runnerAnswering(exchange), OCT_16);

    // No series has statistics, so no Statistics table prints.
    expect(text.stdout.split('\n')).toEqual([
      'Data',
      'date\tEXMP.spot()',
      '16 Oct 2026\t0.2',
      '15 Oct 2026\t0.2',
      '',
      'expression\tobject',
      'm = correlation(EXMP.spot(), EXMP.spot(), 63)\t<LinearRegression object>',
      '',
      CHART_LINK,
      '',
    ]);
    expect(text).toMatchObject({ stderr: '', exitCode: undefined });
    expect(JSON.parse(json.stdout)).toEqual([
      { expression: 'm = correlation(EXMP.spot(), EXMP.spot(), 63)', object: '<LinearRegression object>' },
      { expression: 'EXMP.spot()', values: [{ date: '2026-10-15', value: 0.2 }, { date: '2026-10-16', value: 0.2 }] },
    ]);
  });

  // Marquee Web sends every Expression in one runner call and never sends it again, so a
  // call failing as a whole prints Marquee's answer verbatim, a hint, and the same batch to run again.
  it('prints a 500 for the whole call once, verbatim, with the views to check and the same batch to run again', async () => {
    const { body } = fixture('runner-unrate-1y-1m-500');
    const request = runnerAnswering({ status: 500, body });

    const result = await run(['eval', 'f = EXMP UW.spot()', 'b = FRED(UNRATE).value()', 'f - b'], request, OCT_16);

    expect(runnerCalls(request)).toHaveLength(1);
    expect(result).toMatchObject({
      stdout: '',
      stderr: [
        `Error: PlotTool Pro evaluation of 3 expressions: code: 500 - ${body}`,
        'Hint: one Expression PlotTool Pro cannot evaluate fails the whole call; check their arguments: marquee data view "EXMP UW", marquee data view FRED',
        "run it again: marquee data eval 'f = EXMP UW.spot()' 'b = FRED(UNRATE).value()' 'f - b' --start-date 2025-10-16 --end-date 2026-10-16 --interval 1D",
        '',
      ].join('\n'),
      exitCode: 1,
    });
  });

  // A cold or long-window batch outlasts the runner's 30 s (live, 2026-11-05: 32 equity implied vols over -10y).
  it('says a call that timed out had no answer, with a later start as the hint and the same batch to run again', async () => {
    const request = vi.fn(async (endpoint: Endpoint, init?: Readonly<{ body?: unknown }>): Promise<unknown> => {
      if (endpoint.path === '/v1/plots/runner') throw new MarqueeError('timeout', 'PlotTool Pro evaluation timed out after 30s');
      return runnerAnswering(fixture('runner-unrate-1y-1d'))(endpoint, init);
    });

    const result = await run(['eval', 'FRED(UNRATE).value()', 'FRED(DGS10).value()', '--start-date', '-10y'], request, OCT_16);

    expect(runnerCalls(request)).toHaveLength(1);
    expect(result).toMatchObject({
      stdout: '',
      stderr: [
        'Error: PlotTool Pro evaluation of 2 expressions: no answer within 30 s',
        'Hint: a cold or long window answers slowly; a later --start-date answers sooner',
        "run it again: marquee data eval 'FRED(UNRATE).value()' 'FRED(DGS10).value()' --start-date 2016-10-16 --end-date 2026-10-16 --interval 1D",
        '',
      ].join('\n'),
      exitCode: 1,
    });
  });

  it('prints a 503 for the whole call verbatim, as passing, with the same Expression to run again', async () => {
    const request = runnerAnswering({ status: 503, body: '<html>Service Unavailable</html>\n' });

    const result = await run(['eval', 'FRED(UNRATE).value()'], request, OCT_16);

    expect(runnerCalls(request)).toHaveLength(1);
    expect(result).toMatchObject({
      stdout: '',
      stderr: [
        'Error: PlotTool Pro evaluation of 1 expression: code: 503 - <html>Service Unavailable</html>',
        'Hint: Marquee was unavailable for a moment, and usually answers a second run',
        "run it again: marquee data eval 'FRED(UNRATE).value()' --start-date 2025-10-16 --end-date 2026-10-16 --interval 1D",
        '',
      ].join('\n'),
      exitCode: 1,
    });
  });

  it('prints the status alone for a whole call Marquee failed with no body', async () => {
    const result = await run(['eval', 'FRED(UNRATE).value()'], runnerAnswering({ status: 502, body: '' }), OCT_16);

    expect(result.stderr.split('\n')[0]).toBe('Error: PlotTool Pro evaluation of 1 expression: code: 502');
  });

  // The runner answers 1M with a 500 for every series unless the window ends on a month end that is a
  // weekday (live, 2026-11-05: 2026-09-30 and 2026-08-31 answer; 2026-10-30, 2026-10-31, 2026-02-27 and
  // 2026-02-28 do not); `FRED(UNRATE)` fails at 1M even on 2026-09-30.
  it.each([
    ['0d', 'Hint: --interval 1M answers only for a window ending on a month end that is a weekday, and --end-date 2026-10-16 is not one; try --end-date 2026-09-30, or --interval 1W', '2026-10-16'],
    ['2026-10-31', 'Hint: --interval 1M answers only for a window ending on a month end that is a weekday, and --end-date 2026-10-31 is not one; try --end-date 2026-09-30, or --interval 1W', '2026-10-31'],
    ['2026-03-02', 'Hint: --interval 1M answers only for a window ending on a month end that is a weekday, and --end-date 2026-03-02 is not one; try --end-date 2025-12-31, or --interval 1W', '2026-03-02'],
    ['2025-10-20', 'Hint: --interval 1M answers only for a window ending on a month end that is a weekday, and --end-date 2025-10-20 is not one; try --interval 1W', '2025-10-20'],
    ['2026-09-30', 'Hint: some series fail at --interval 1M; try --interval 1W or 1D', '2026-09-30'],
  ])('prints a 500 at 1M ending %s verbatim, with the month-end rule as the hint', async (endDate, hint, resolved) => {
    const { body } = fixture('runner-unrate-1y-1m-500');

    const result = await run(
      ['eval', 'FRED(UNRATE).value()', '--start-date', '2025-10-01', '--end-date', endDate, '--interval', '1M'],
      runnerAnswering({ status: 500, body }),
      OCT_16,
    );

    expect(result).toMatchObject({
      stdout: '',
      stderr: [
        `Error: PlotTool Pro evaluation of 1 expression: code: 500 - ${body}`,
        hint,
        `run it again: marquee data eval 'FRED(UNRATE).value()' --start-date 2025-10-01 --end-date ${resolved} --interval 1M`,
        '',
      ].join('\n'),
      exitCode: 1,
    });
  });

  describe('--json', () => {

    it('lists the fields for a bare --json', async () => {
      const request = vi.fn(async () => ({}));

      const result = await run(['eval', 'FRED(UNRATE).value()', '--json'], request);

      expect(request).not.toHaveBeenCalled();
      expect(result).toEqual({
        stdout: '',
        stderr: 'Specify one or more comma-separated fields for `--json`:\n  endDate\n  interval\n  picture\n  provenance\n  results\n  startDate\n  url\n',
        exitCode: 1,
      });
    });

    it('reports a failing --jq on stderr and exits 1', async () => {
      const result = await run(
        ['eval', 'FRED(UNRATE).value()', '--json', 'results', '--jq', '.results[0] | keys | .['],
        runnerAnswering(fixture('runner-unrate-1y-1d')),
        OCT_16,
      );

      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/^Error: .*JavaScript-to-jq example/);
      expect(result.exitCode).toBe(1);
    });

    it('reports a failed Expression before the --jq error it causes', async () => {
      const result = await run(
        [
          'eval', 'FRED(UNRATE).value()', 'FRED(GOLDAMGBD228NLBM).value()', 'FRED(NOTAREALSERIESXYZ).value()',
          '--json', 'results', '--jq', '.results[1].values[]',
        ],
        runnerAnswering(fixture('runner-empty-series')),
        '2026-10-16T12:00:00Z',
      );

      expect(result.stderr.split('\n').slice(0, 4)).toEqual([
        'Error: FRED(GOLDAMGBD228NLBM).value(): no points between 2025-10-16 and 2026-10-16',
        'Error: FRED(NOTAREALSERIESXYZ).value(): no points between 2025-10-16 and 2026-10-16',
        'Hints for FRED(GOLDAMGBD228NLBM).value():',
        '  Check the id: marquee data search GOLDAMGBD228NLBM --class FRED',
      ]);
      expect(result.stderr).toMatch(/\nError: .*JavaScript-to-jq example/);
      expect(result.exitCode).toBe(1);
    });
  });

  it('points an asset measure with no points to the asset\'s measures, in --json too', async () => {
    const assignments = fixture('runner-assignments');
    const body = JSON.parse(assignments.body) as { results: { type: string; values: unknown }[] };
    body.results[0] = { type: 'series', values: {} };

    const result = await run(
      ['eval', 'a = EXMP UW.spot()', 'b = FRED(UNRATE).value()', 'correlation(b, a)', '--json', 'results', '--jq', '.results[0]'],
      runnerAnswering({ status: 200, body: JSON.stringify(body) }),
      '2026-10-16T12:00:00Z',
    );

    const hint = 'List its measures: marquee data view "EXMP UW"';
    expect(JSON.parse(result.stdout)).toEqual({
      expression: 'a = EXMP UW.spot()',
      error: 'no points between 2025-10-16 and 2026-10-16',
      hints: [hint],
    });
    expect(result.stderr).toBe(`Error: a = EXMP UW.spot(): no points between 2025-10-16 and 2026-10-16\nHints for a = EXMP UW.spot():\n  ${hint}\n`);
    expect(result.exitCode).toBe(1);
  });

  it('gives a function of a series with no points an earlier start or its signature, not a measure hint', async () => {
    const assignments = fixture('runner-assignments');
    const body = JSON.parse(assignments.body) as { results: { type: string; values: unknown }[] };
    body.results[2] = { type: 'series', values: {} };

    const result = await run(
      ['eval', 'a = EXMP UW.spot()', 'b = FRED(UNRATE).value()', 'correlation(b, a)'],
      runnerAnswering({ status: 200, body: JSON.stringify(body) }),
      '2026-10-16T12:00:00Z',
    );

    expect(statisticsEnds(result.stdout).map(([expression]) => expression)).toEqual(['a = EXMP UW.spot()', 'b = FRED(UNRATE).value()']);
    expect(result.stderr).toBe([
      'Error: correlation(b, a): no points between 2025-10-16 and 2026-10-16',
      'Hints for correlation(b, a):',
      '  Try an earlier --start-date, or check its arguments: marquee data view correlation',
      '',
    ].join('\n'));
  });
});

