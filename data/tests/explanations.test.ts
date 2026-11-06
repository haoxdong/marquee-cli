import { describe, expect, it } from 'vitest';
import { CLI_EXIT_CODES } from '../../presentation/index.js';
import { MarqueeError } from '../../transport/index.js';
import { createData, presentDataEval } from '../index.js';
import {
  CHART,
  FUNCTIONS,
  cacheDirectory,
  fixture,
  functionLibrary,
  marquee,
  savedChart,
  sentRequests,
  type Answer,
  type Route,
} from './support.js';

const RUNNER = 'POST /v1/plots/runner';
const ASSET_SEARCH = 'POST /v1/plots/entities';
const EXMP_UW_MEASURES = 'GET /v1/plots/availability/MA_SYNTHETIC_EXMP_UW';
const XFUZ8_COMDTY_MEASURES = 'GET /v1/plots/availability/MA_SYNTHETIC_XFUZ8';
const TODAY = new Date('2026-10-16T12:00:00Z');

// One runner call whose Expressions fail each way the runner rejects one.
const REJECTED = [
  'FRED(UNRATE).value()',
  'FRED(\'UNRATE\').value()',
  'EXMP.spot()',
  'XFUZ8.price()',
  'IRSwap(USD, pay, 5y, atmf, 0, 5y).swap_rate()',
  'EXMP UW.factset_estimates(EPS, Mean, Annual, 1)',
  'EXMP UW.swap_rate()',
  'MarketCoordinate("IR_USD_EXAMPLE_DEC26.PRICE").value(XYZ)',
  'zscores()',
  'XFUZ8 Comdty.price()',
];

// PlotTool Pro's asset search, answering each query the explanations send.
function assetSearch(body: unknown): Answer {
  const { asset } = body as { asset: { q: string } };
  const answers: Readonly<Record<string, Answer>> = {
    EXMP: fixture('nearest-assets-exmp.json'),
    XFUZ8: fixture('nearest-assets-xfuz8.json'),
  };
  const answer = answers[asset.q];
  if (answer === undefined) throw new Error(`Unexpected asset search: ${asset.q}`);
  return answer;
}

function routes(overrides: Readonly<Record<string, Route>> = {}) {
  return {
    [FUNCTIONS]: functionLibrary(),
    [RUNNER]: fixture('runner-explained-failures.json'),
    [CHART]: savedChart(),
    [ASSET_SEARCH]: assetSearch,
    [EXMP_UW_MEASURES]: fixture('availability-exmp-uw.json'),
    [XFUZ8_COMDTY_MEASURES]: fixture('availability-xfuz8-comdty.json'),
    ...overrides,
  };
}

describe('Data eval explains each Expression the runner rejects', () => {
  it('explains each failure from the catalogs under its name, after every error row', async () => {
    const request = marquee(routes());
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const presentation = await presentDataEval(await data.eval({ expressions: REJECTED }), {});

    expect(presentation.exitCode).toBe(1);
    expect(presentation.stdout).toMatch(/\nFRED\(UNRATE\)\.value\(\)\t4\.1\t01 Aug 2026\t4\.5\t01 Nov 2025\t/);
    expect(presentation.stderr.split('\n')).toEqual([
      'Error: FRED(\'UNRATE\').value(): code: 400 - Bad Request (unparsable expression FRED(\'UNRATE\').value(): No terminal matches \'\'\' in the current parser context, at line 1 col 6) (Historical mode)',
      'Error: EXMP.spot(): code: 404 - Not Found (did not find any entities for EXMP) (Historical mode)',
      'Error: XFUZ8.price(): code: 404 - Not Found (did not find any entities for XFUZ8) (Historical mode)',
      'Error: IRSwap(USD, pay, 5y, atmf, 0, 5y).swap_rate(): code: 400 - Bad Request (object does not have attribute: swap_rate) (Historical mode)',
      expect.stringMatching(/^Error: EXMP UW\.factset_estimates\(EPS, Mean, Annual, 1\): code: 400 - Bad Request \(EPS is not valid; allowed values are \[Earnings Per Share, /),
      'Error: EXMP UW.swap_rate(): code: 404 - Not Found (Markets endpoint: 00000000-0000-4000-8000-000000000021 DataSet not found for entity with id: MA_SYNTHETIC_EXMP_UW ,EXMP UW) (Historical mode)',
      'Error: MarketCoordinate("IR_USD_EXAMPLE_DEC26.PRICE").value(XYZ): code: 400 - Bad Request (XYZ is not valid; allowed values are [NYC, LDN, TKO, HKG]) (Historical mode)',
      'Error: zscores(): code: 400 - Bad Request (zscores(): zscores() missing 1 required positional argument: \'x\') (Historical mode)',
      'Error: XFUZ8 Comdty.price(): code: 404 - Not Found (Markets endpoint: 00000000-0000-4000-8000-000000000022 DataSet not found for entity with id: MA_SYNTHETIC_XFUZ8 ,XFUZ8 Comdty) (Historical mode)',
      'Hints for FRED(\'UNRATE\').value():',
      '  Strings take double quotes: FRED("UNRATE").value()',
      'Hints for EXMP.spot():',
      '  Nearest assets to EXMP:',
      '    EXMP UW (Example Corp, Single Stock)',
      '    EXMP UP (Example Corp, Single Stock)',
      '    BX000001 (EXMP 2.650 02/08/2051, Bond)',
      '    BX000002 (EXMP 2.375 02/08/2041, Bond)',
      '    BX000003 (EXMP 2.400 05/03/2023, Bond)',
      'Hints for XFUZ8.price():',
      '  Nearest assets to XFUZ8:',
      '    XFUZ8 Comdty (Example Rate Future DEC28, Future)',
      'Hints for IRSwap(USD, pay, 5y, atmf, 0, 5y).swap_rate():',
      '  IRSwap methods:',
      '    annuity_value()',
      '    delta()',
      '    fixed_rate_level()',
      '    forward()',
      '    price()',
      'Hints for EXMP UW.factset_estimates(EPS, Mean, Annual, 1):',
      '  EXMP UW.factset_estimates(metric, statistic, report_basis, period)',
      expect.stringMatching(/^ {4}metric: Earnings Per Share \(default\) \| Consolidated EPS \| .* \| Total Debt$/),
      '    statistic: Mean (default) | Median | High | Low | Actual',
      '    report_basis: Annual (default) | Quarterly | Semi annual | Next Twelve Months | Second Twelve Months',
      '    period: default 1',
      'Hints for EXMP UW.swap_rate():',
      '  EXMP UW has no measure swap_rate; measures named like it: var_swap',
      'Hints for MarketCoordinate("IR_USD_EXAMPLE_DEC26.PRICE").value(XYZ):',
      '  MarketCoordinate(coordinate).value(location)',
      '    location: NYC (default) | LDN | TKO | HKG',
      'Hints for zscores():',
      '  zscores(x, w)',
      'Hints for XFUZ8 Comdty.price():',
      '  XFUZ8 Comdty has no PlotTool Pro measures',
      '',
    ]);
    // Each asset's measures are read once, however many Expressions name it.
    expect(sentRequests(request)).toEqual([
      FUNCTIONS,
      RUNNER,
      CHART,
      ASSET_SEARCH,
      ASSET_SEARCH,
      EXMP_UW_MEASURES,
      XFUZ8_COMDTY_MEASURES,
    ]);
  });

  // `Asset("AAPL UW").close_price()` (live, 2026-10-24): the runner looks the ticker up as a
  // Marquee id, lists it unresolved with no assetName, and answers a bare Bad Request.
  it('points an Asset of a ticker to the Measure called on the ticker itself', async () => {
    const library = JSON.parse(functionLibrary().body) as { classes: unknown[] };
    library.classes.push({
      name: 'Asset',
      group: 'constructors',
      description: 'Create an asset entity',
      parameters: [{ name: 'identifier', variadic: false }],
      returns: { type: 'Asset', methods: [] },
    });
    const data = createData({
      request: marquee(routes({
        [FUNCTIONS]: { status: 200, body: JSON.stringify(library) },
        [RUNNER]: fixture('runner-asset-unresolved.json'),
      })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: ['Asset("EXMP UW").close_price()'] }), {});

    // The chart saved alongside the runner call still links, though nothing on it evaluates.
    expect(presentation).toEqual({
      stdout: 'url:\thttps://marquee.gs.com/s/plottool/CH_SYNTHETIC_SAVED\n',
      stderr: [
        'Error: Asset("EXMP UW").close_price(): code: 400 - Bad Request (Bad Request) (Historical mode)',
        'Hints for Asset("EXMP UW").close_price():',
        '  Asset takes a Marquee asset id (MA…); call the Measure on the Entity id itself: EXMP UW.close_price()',
        '',
      ].join('\n'),
      exitCode: CLI_EXIT_CODES.failure,
    });
  });

  describe('names the measures an asset has when it has none like the one called', () => {
    // EXMP UW answering no dataset for `measure`, as the runner answers USGGBE10.spot() (live, 2026-10-16).
    function noDataset(measure: string): Answer {
      const { body } = fixture('runner-explained-failures.json');
      const parsed = JSON.parse(body) as { results: unknown[]; statistics: unknown[]; entities: unknown[][] };
      return {
        status: 404,
        body: JSON.stringify({
          ...parsed,
          results: [parsed.results[6]],
          statistics: [parsed.statistics[6]],
          entities: [parsed.entities[6]],
          expressions: [`EXMP UW.${measure}()`],
        }),
      };
    }

    async function hints(measure: string, overrides: Readonly<Record<string, Answer>> = {}): Promise<string[]> {
      const data = createData({
        request: marquee(routes({ [RUNNER]: noDataset(measure), ...overrides })),
        now: () => TODAY,
        cacheDirectory: cacheDirectory(),
      });
      const presentation = await presentDataEval(await data.eval({ expressions: [`EXMP UW.${measure}()`] }), {});
      return presentation.stderr.split('\n');
    }

    it('lists each measure that applies to the asset', async () => {
      expect(await hints('price')).toEqual([
        'Error: EXMP UW.price(): code: 404 - Not Found (Markets endpoint: 00000000-0000-4000-8000-000000000021 DataSet not found for entity with id: MA_SYNTHETIC_EXMP_UW ,EXMP UW) (Historical mode)',
        'Hints for EXMP UW.price():',
        '  EXMP UW has no measure price; its measures: factset_estimates, forward_vol, spot, var_swap',
        '',
      ]);
    });

    it('lists ten and points to the view for the rest', async () => {
      const measures = Array.from({ length: 13 }, (_, index) => ({
        name: `measure_${String(index + 1).padStart(2, '0')}`,
        description: 'Example measure.',
        datasets: [],
        parameters: [],
        restrictions: { asset_class: ['Equity'] },
      }));
      const availability = { status: 200, body: JSON.stringify({ measures }) };

      expect((await hints('price', { [EXMP_UW_MEASURES]: availability }))[2]).toBe(
        '  EXMP UW has no measure price; its measures: measure_01, measure_02, measure_03, measure_04, measure_05, '
          + 'measure_06, measure_07, measure_08, measure_09, measure_10 and 3 more: marquee data view "EXMP UW"',
      );
    });
  });

  // `USDJPY.impliedVolatility(3m, delta_neutral)` (live, 2026-10-25): the runner rejects the
  // camelCase name and resolves no Entity, so the asset is looked up by its id.
  describe('names the snake_case measure when the runner rejects a name\'s casing', () => {
    const ASSETS_DATA = 'GET /v1/assets/data';
    // `/v1/assets/data` finds EXMP UW by its Bloomberg ID only, as Marquee answers a bbid lookup.
    const assetsData = (_body: unknown, query?: Readonly<Record<string, unknown>>): Answer => ({
      status: 200,
      body: JSON.stringify(query?.bbid === 'EXMP UW'
        ? {
          totalResults: 1,
          results: [{ id: 'MA_SYNTHETIC_EXMP_UW', bbid: 'EXMP UW', name: 'Example Corp', type: 'Single Stock', assetClass: 'Equity' }],
        }
        : { totalResults: 0, results: [] }),
    });

    function casingError(expression: string, name: string): Answer {
      const { body } = fixture('runner-bad-casing.json');
      return {
        status: 400,
        body: body.replaceAll('EXMP UW.forwardVol(1m, 1m, delta_neutral, 50)', expression).replace('forwardVol:', `${name}:`),
      };
    }

    async function evaluated(expression: string, name: string, overrides: Readonly<Record<string, Route>> = {}) {
      const request = marquee(routes({ [RUNNER]: casingError(expression, name), [ASSETS_DATA]: assetsData, ...overrides }));
      const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });
      return { request, presentation: await presentDataEval(await data.eval({ expressions: [expression] }), {}) };
    }

    it('names the measure whose snake_case spelling matches', async () => {
      const { request, presentation } = await evaluated('EXMP UW.forwardVol(1m, 1m, delta_neutral, 50)', 'forwardVol');

      expect(presentation.stderr.split('\n')).toEqual([
        'Error: EXMP UW.forwardVol(1m, 1m, delta_neutral, 50): code: 400 - Bad Request (invalid function name forwardVol: bad casing?) (Historical mode)',
        'Hints for EXMP UW.forwardVol(1m, 1m, delta_neutral, 50):',
        '  EXMP UW has no measure forwardVol; did you mean forward_vol?',
        '',
      ]);
      expect(sentRequests(request)).toEqual([FUNCTIONS, RUNNER, CHART, ASSETS_DATA, ASSETS_DATA, EXMP_UW_MEASURES]);
    });

    it('names the measures like its words when none matches', async () => {
      const { presentation } = await evaluated('EXMP UW.varSwapRate()', 'varSwapRate');

      expect(presentation.stderr.split('\n')[2]).toBe('  EXMP UW has no measure varSwapRate; measures named like it: var_swap');
    });

    it('fails the command when the asset cannot be looked up', async () => {
      const { presentation } = await evaluated('EXMP UW.forwardVol(1m, 1m, delta_neutral, 50)', 'forwardVol', {
        [ASSETS_DATA]: { status: 503, body: '<html>Service Unavailable</html>' },
      });

      expect(presentation).toEqual({
        stdout: '',
        stderr: 'Error: Marquee asset lookup for EXMP UW is unavailable\n',
        exitCode: 1,
      });
    });
  });

  it('shows only the allowed values a measure gives the asset\'s class', async () => {
    const data = createData({
      request: marquee(routes({ [RUNNER]: fixture('runner-forward-vol-rejected.json') })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(
      await data.eval({ expressions: ['EXMP UW.forward_vol(1m, 1m, sideways, 50)'] }),
      {},
    );

    // EXMP UW is an Equity: the FX tenors, start dates and strikes are not its own.
    expect(presentation.stderr.split('\n')).toEqual([
      'Error: EXMP UW.forward_vol(1m, 1m, sideways, 50): code: 400 - Bad Request (sideways is not valid; allowed values are [delta_call, delta_put, delta_neutral, normalized, spot, forward]) (Historical mode)',
      'Hints for EXMP UW.forward_vol(1m, 1m, sideways, 50):',
      '  EXMP UW.forward_vol(tenor, forward_start_date, strike_reference, relative_strike)',
      '    tenor: 1m (default) | 2m | 3m | 4m | 5m | 6m | 7m | 8m | 9m | 1y | 13m | 14m | 15m | 18m | 21m | 2y | 27m | 30m | 3y | 4y | 5y | 6y | 7y | 8y | 9y',
      '    forward_start_date: default 1m',
      '    strike_reference: delta_call | delta_put | delta_neutral | normalized | spot | forward',
      '    relative_strike when strike_reference in (spot, forward): 40 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 97.5 | 100 (default) | 102.5 | 105 | 110 | 115 | 120 | 125 | 130 | 135 | 140 | 145 | 150 | 175 | 200',
      '    relative_strike when strike_reference in (delta_call, delta_put): 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 (default) | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95',
      '    relative_strike when strike_reference=normalized: -0.25 | -0.5 | -0.75 | -1 | -1.5 | -2 | -2.5 | -3 | -3.5 | -4 | 0 (default) | 0.25 | 0.5 | 0.75 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4',
      '',
    ]);
  });

  // Agents quote a string argument, as data.md says, and the runner names the value unquoted
  // (live: `USDJPY.implied_volatility("3m", "ATMF")`, 2026-10-27).
  it('shows the signature for a rejected value written in double quotes', async () => {
    const data = createData({
      request: marquee(routes({ [RUNNER]: fixture('runner-forward-vol-rejected.json') })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(
      await data.eval({ expressions: ['EXMP UW.forward_vol(1m, 1m, "sideways", 50)'] }),
      {},
    );

    expect(presentation.stderr.split('\n')[2]).toBe('  EXMP UW.forward_vol(tenor, forward_start_date, strike_reference, relative_strike)');
  });

  // Live: `USD.swap_rate(10y)`, 2026-10-27, which names neither the measure nor its arguments.
  it('shows the signature for arguments that match several assets', async () => {
    const data = createData({
      request: marquee(routes({ [RUNNER]: fixture('runner-forward-vol-ambiguous.json') })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: ['EXMP UW.forward_vol(1m)'] }), {});

    expect(presentation.stderr.split('\n')[2]).toBe('  EXMP UW.forward_vol(tenor, forward_start_date, strike_reference, relative_strike)');
  });

  it('points arguments that match several assets, with no Entity to name, to the signature', async () => {
    const data = createData({
      request: marquee(routes({ [RUNNER]: fixture('runner-constructor-ambiguous.json') })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: ['FRED(EXMP).value(1m)'] }), {});

    expect(presentation.stderr).toBe([
      'Error: FRED(EXMP).value(1m): code: 400 - Specified arguments match multiple assets (Historical mode)',
      'Hints for FRED(EXMP).value(1m):',
      '  Check its arguments: marquee data view FRED',
      '',
    ].join('\n'));
  });

  it('keeps each Expression\'s hints with its error under --json', async () => {
    const data = createData({ request: marquee(routes()), now: () => TODAY, cacheDirectory: cacheDirectory() });

    const presentation = await presentDataEval(
      await data.eval({ expressions: REJECTED }),
      { json: 'results', jq: '.results[] | select(.expression == "XFUZ8.price()")' },
    );

    expect(JSON.parse(presentation.stdout)).toEqual({
      expression: 'XFUZ8.price()',
      error: 'code: 404 - Not Found (did not find any entities for XFUZ8) (Historical mode)',
      hints: ['Nearest assets to XFUZ8:', '  XFUZ8 Comdty (Example Rate Future DEC28, Future)'],
    });
  });

  it('fails the command when an asset\'s measures cannot be read', async () => {
    const data = createData({
      request: marquee(routes({ [EXMP_UW_MEASURES]: { status: 503, body: '<html>Service Unavailable</html>' } })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: REJECTED }), {});

    expect(presentation).toEqual({
      stdout: '',
      stderr: 'Error: PlotTool Pro measure lookup for EXMP UW is unavailable\n',
      exitCode: 1,
    });
  });

  it('fails the command on the first catalog an explanation cannot read, without waiting for the rest', async () => {
    const answered = marquee(routes({ [EXMP_UW_MEASURES]: { status: 503, body: '<html>Service Unavailable</html>' } }));
    const data = createData({
      request: async (endpoint, init) => (
        `${endpoint.method} ${endpoint.path}` === XFUZ8_COMDTY_MEASURES ? new Promise(() => undefined) : answered(endpoint, init)
      ),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: REJECTED }), {});

    expect(presentation).toMatchObject({ stdout: '', exitCode: 1 });
  });

  it('asks for a login when the asset search finds the session expired', async () => {
    const data = createData({
      request: marquee(routes({
        [ASSET_SEARCH]: () => {
          throw new MarqueeError('auth_expired', 'Not authenticated');
        },
      })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: REJECTED }), {});

    expect(presentation).toEqual({
      stdout: '',
      stderr: 'Error: Not authenticated. Run: marquee auth login\n',
      exitCode: CLI_EXIT_CODES.authRequired,
    });
  });
});

// The runner answers a Measure called with an argument off its grid as it answers one with no
// data in the window (live, 2026-10-28: `SPX.implied_volatility(13w, forward, 100)` and
// `US.cai(FOO)` answer an empty series; `USD.swaption_vol(7w, 10y)` matches no asset).
describe('Data eval shows the choices for an argument off a Measure\'s grid', () => {
  const EMPTY_SERIES = [
    'EXMP UW.forward_vol(1m, 1m, forward, 101)',
    'EXMP UW.var_swap(13w)',
    'EX.cai(FOO)',
    'HAVER(NOTACODE, EXECON).value()',
    'MarketCoordinate("IR_EXMP_FOO.PRICE").value()',
  ];

  async function emptySeriesErrors(): Promise<string[]> {
    const data = createData({
      request: marquee(routes({
        [RUNNER]: fixture('runner-empty-series-choices.json'),
        'GET /v1/plots/availability/EX': fixture('availability-country-ex.json'),
      })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });
    return (await presentDataEval(await data.eval({ expressions: EMPTY_SERIES }), {})).stderr.split('\n');
  }

  // The Expression's error row, then the hints listed under its name after every row.
  function errorBlock(lines: readonly string[], expression: string): string[] {
    const row = `Error: ${expression}: no points between 2025-10-16 and 2026-10-16`;
    const start = lines.indexOf(`Hints for ${expression}:`);
    const next = lines.findIndex((line, index) => index > start && !line.startsWith('  '));
    return [...lines.filter((line) => line === row), ...lines.slice(start, next)];
  }

  it('shows the signature of an asset Measure with no points called with arguments', async () => {
    expect(errorBlock(await emptySeriesErrors(), EMPTY_SERIES[0] ?? '')).toEqual([
      'Error: EXMP UW.forward_vol(1m, 1m, forward, 101): no points between 2025-10-16 and 2026-10-16',
      'Hints for EXMP UW.forward_vol(1m, 1m, forward, 101):',
      '  EXMP UW.forward_vol(tenor, forward_start_date, strike_reference, relative_strike)',
      '    tenor: 1m (default) | 2m | 3m | 4m | 5m | 6m | 7m | 8m | 9m | 1y | 13m | 14m | 15m | 18m | 21m | 2y | 27m | 30m | 3y | 4y | 5y | 6y | 7y | 8y | 9y',
      '    forward_start_date: default 1m',
      '    strike_reference: delta_call | delta_put | delta_neutral | normalized | spot | forward',
      '    relative_strike when strike_reference in (spot, forward): 40 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 97.5 | 100 (default) | 102.5 | 105 | 110 | 115 | 120 | 125 | 130 | 135 | 140 | 145 | 150 | 175 | 200',
      '    relative_strike when strike_reference in (delta_call, delta_put): 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 (default) | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95',
      '    relative_strike when strike_reference=normalized: -0.25 | -0.5 | -0.75 | -1 | -1.5 | -2 | -2.5 | -3 | -3.5 | -4 | 0 (default) | 0.25 | 0.5 | 0.75 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4',
    ]);
  });

  it('shows the signature of a Country Measure with no points called with arguments', async () => {
    expect(errorBlock(await emptySeriesErrors(), 'EX.cai(FOO)')).toEqual([
      'Error: EX.cai(FOO): no points between 2025-10-16 and 2026-10-16',
      'Hints for EX.cai(FOO):',
      '  EX.cai(metricName)',
      '    metricName: CAI_HEADLINE (default) | CAI_CONTRIBUTION_SECTOR_LABOR | CAI_CONTRIBUTION_TYPE_HARD',
    ]);
  });

  // A grid needs allowed values to check the arguments against.
  it('points a Measure with no allowed values to the asset\'s measures', async () => {
    expect(errorBlock(await emptySeriesErrors(), 'EXMP UW.var_swap(13w)')).toEqual([
      'Error: EXMP UW.var_swap(13w): no points between 2025-10-16 and 2026-10-16',
      'Hints for EXMP UW.var_swap(13w):',
      '  List its measures: marquee data view "EXMP UW"',
    ]);
  });

  // Live, 2026-10-28: `data search` finds `HAVER(NAPMC, SURVEYS)` by `NAPMC` and
  // `MarketCoordinate("IR_USD_SWAP_10Y.ATMRATE")` by its id, and answers no match for an unknown one.
  it('points a HAVER or MarketCoordinate id with no points to its search', async () => {
    const lines = await emptySeriesErrors();

    expect(errorBlock(lines, 'HAVER(NOTACODE, EXECON).value()')).toEqual([
      'Error: HAVER(NOTACODE, EXECON).value(): no points between 2025-10-16 and 2026-10-16',
      'Hints for HAVER(NOTACODE, EXECON).value():',
      '  Check the id: marquee data search NOTACODE --class HAVER',
    ]);
    expect(errorBlock(lines, 'MarketCoordinate("IR_EXMP_FOO.PRICE").value()')).toEqual([
      'Error: MarketCoordinate("IR_EXMP_FOO.PRICE").value(): no points between 2025-10-16 and 2026-10-16',
      'Hints for MarketCoordinate("IR_EXMP_FOO.PRICE").value():',
      '  Check the id: marquee data search IR_EXMP_FOO.PRICE --class MarketCoordinate',
    ]);
  });

  it('shows the signature for arguments that match no asset, under the runner\'s own message', async () => {
    const data = createData({
      request: marquee(routes({ [RUNNER]: fixture('runner-forward-vol-no-match.json') })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });

    const presentation = await presentDataEval(await data.eval({ expressions: ['EXMP UW.forward_vol(7w)'] }), {});

    expect(presentation.stderr.split('\n').slice(0, 3)).toEqual([
      'Error: EXMP UW.forward_vol(7w): code: 400 - Specified arguments did not match any asset in the dataset{\'asset_class\': \'Equity\', \'type\': \'Single Stock\', \'asset_parameters_expiration_date\': \'7w\'} (Historical mode)',
      'Hints for EXMP UW.forward_vol(7w):',
      '  EXMP UW.forward_vol(tenor, forward_start_date, strike_reference, relative_strike)',
    ]);
  });
});

// The runner names a Measure the asset lacks in Title Case (live, 2026-10-28:
// `EURUSD.forward_points(3m)` is `Forward Points is not available for None EURUSD`).
describe('Data eval names the Measures nearest one the asset lacks', () => {
  function unavailable(expression: string, title: string): Answer {
    const { body } = fixture('runner-measure-unavailable.json');
    return { status: 400, body: body.replaceAll('EXMP UW.forward_vols(1m)', expression).replace('Forward Vols', title) };
  }

  async function hints(expression: string, title: string, overrides: Readonly<Record<string, Answer>> = {}) {
    const data = createData({
      request: marquee(routes({ [RUNNER]: unavailable(expression, title), ...overrides })),
      now: () => TODAY,
      cacheDirectory: cacheDirectory(),
    });
    return (await presentDataEval(await data.eval({ expressions: [expression] }), {})).stderr.split('\n');
  }

  it('names the asset\'s Measures named like it', async () => {
    expect(await hints('EXMP UW.forward_vols(1m)', 'Forward Vols')).toEqual([
      'Error: EXMP UW.forward_vols(1m): code: 400 - Bad Request (Forward Vols is not available for None MA_SYNTHETIC_EXMP_UW) (Historical mode)',
      'Hints for EXMP UW.forward_vols(1m):',
      '  EXMP UW has no measure forward_vols; measures named like it: forward_vol',
      '',
    ]);
  });

  // Live, 2026-10-28: `AAPL UW.fe_avg_ntm(EPS)` shares a word with 72 of Apple's Measures.
  it('names the five nearest by spelling and points to the view for the rest', async () => {
    const measures = ['fe_buy', 'fe_high_lt', 'fe_high_ntm', 'fe_high_stm', 'fe_low_ntm', 'fe_low_stm', 'fe_mean_ntm', 'spot']
      .map((name) => ({ name, description: 'Example measure.', datasets: [], parameters: [], restrictions: { asset_class: ['Equity'] } }));
    const availability = { status: 200, body: JSON.stringify({ measures }) };

    expect((await hints('EXMP UW.fe_avg_ntm(EPS)', 'Fe Avg Ntm', { [EXMP_UW_MEASURES]: availability }))[2]).toBe(
      '  EXMP UW has no measure fe_avg_ntm; measures named like it: fe_high_ntm, fe_low_ntm, fe_high_stm, fe_low_stm, '
        + 'fe_mean_ntm and 2 more: marquee data view "EXMP UW"',
    );
  });
});
