import { afterEach, describe, expect, it } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { byEndpoint, entityAnswer, fixture, runDataSearch, SEARCH_LIBRARY } from './data-search-harness.js';

// Synthetic answers, shaped as Marquee answers the requests PlotTool Web sends for each Class (ADR 0043).
const ENTITIES = entityAnswer(fixture('asset-search-example.json') as Readonly<Record<string, unknown>>);
// The KPI search's answer on a site session re-minted without a recent multi-factor sign-in.
const KPI_LOGIN_REQUIRED = entityAnswer({
  ...fixture('asset-search-example.json') as Readonly<Record<string, unknown>>,
  kpis: { status_code: 401, _log_message: 'Login Required' },
});
// Answers of POST /v1/search/coordinates/query to the body PlotTool Web sends inside `FRED(`;
// public FRED series metadata, trimmed.
const FRED = fixture('fred-search-unemployment-rate.json');
const FRED_NO_MATCH = fixture('fred-search-no-match.json');
const HAVER = fixture('haver-search-unemployment.json');
const HAVER_NO_MATCH = fixture('haver-search-no-match.json');
const MARKET_COORDINATES = fixture('mdapi-search-ir-usd.json');
const TSDB = fixture('tsdb-search-exv.json');
const TSDB_NO_MATCH = fixture('tsdb-search-no-match.json');
const DATASETS = fixture('dataset-search-fx-spot.json');
const DATASETS_NO_MATCH = fixture('dataset-search-no-match.json');

// Every Class answers; a test overrides the answers it is about.
function everyClass(overrides: Readonly<Record<string, unknown>> = {}) {
  return byEndpoint({
    'POST /v1/plots/entities': ENTITIES,
    'POST /v1/search/coordinates/query': FRED,
    'GET /v1/plots/haversearch': HAVER,
    'GET /v1/plots/coordinates': MARKET_COORDINATES,
    'POST /v1/tsdb/search': TSDB,
    'GET /v1/search/datasets': DATASETS,
    'GET /v1/plots/functions': SEARCH_LIBRARY,
    ...overrides,
  });
}

const NOTHING = {
  'POST /v1/plots/entities': entityAnswer({ assets: { totalResults: 0, results: [] } }),
  'POST /v1/search/coordinates/query': FRED_NO_MATCH,
  'GET /v1/plots/haversearch': HAVER_NO_MATCH,
  'GET /v1/plots/coordinates': { results: [] },
  'POST /v1/tsdb/search': TSDB_NO_MATCH,
  'GET /v1/search/datasets': DATASETS_NO_MATCH,
};

const HEADER = 'Class(args)\tMeasure(args)\tName\tType\tView';
const LABOUR = 'Exampleland: Labour Market, Example Statistics Office, Quarterly';
const CASH = 'Type : Interest Rates | Asset : Currency = United States Dollar | Class : Instrument = Example cash rate';
const FUTURE = 'Type : Interest Rates | Asset : Currency = United States Dollar | Class : Instrument = Example rate future';
const COORDINATE_MEASURES = 'actual_data_quality(), ask(), bid(), expected_data_quality(), value()';

function denied(endpoint: Endpoint): never {
  throw new MarqueeError('http', `Marquee returned 403 for ${endpoint.path}`, {
    status: 403,
    path: endpoint.path,
    body: '{"statusCode":403}',
    responseClassification: 'http_status',
  });
}

// HAVER's answer to a query holding a character its search does not take, as Marquee words it.
function haverRefusal(endpoint: Endpoint): never {
  throw new MarqueeError('http', `Marquee returned 400 for ${endpoint.path}`, {
    status: 400,
    path: endpoint.path,
    body: 'Bad Request (Field \'qs3\': Input \'S&P\' does not fit pattern)',
    responseClassification: 'http_status',
  });
}

// A request that never answers.
function stalled(): Promise<never> {
  return new Promise(() => undefined);
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('marquee data search', () => {
  it('prints every Class\'s first rows in one table that pastes into eval and view, and a footer per Class with more', async () => {
    const result = await runDataSearch(['unemployment'], everyClass());

    expect(result.stdout).toBe([
      HEADER,
      'EXMP UW\t\tExample Corp\tSingle Stock; Equity\tmarquee data view "EXMP UW"',
      'EXMP UP\t\tExample Corp\tSingle Stock; Equity\tmarquee data view "EXMP UP"',
      'EXBSKT1\t\tExample Suppliers\tResearch Basket; Equity\tmarquee data view EXBSKT1',
      'EXMP UN\t\tExample Corp\tSingle Stock; Equity\tmarquee data view "EXMP UN"',
      'EXPL UN\t\tExample Hospitality Inc\tSingle Stock; Equity\tmarquee data view "EXPL UN"',
      'FRED(UNRATE)\tvalue()\tUnemployment Rate\tMonthly; Percent; SA\t',
      'FRED(UNRATENSA)\tvalue()\tUnemployment Rate\tMonthly; Percent; NSA\t',
      'FRED(U2RATE)\tvalue()\tUnemployment Rate - Job Losers (U-2)\tMonthly; Percent; SA\t',
      'FRED(NROU)\tvalue()\tNoncyclical Rate of Unemployment\tQuarterly; Percent; NSA\t',
      'FRED(CAUR)\tvalue()\tUnemployment Rate in California\tMonthly; Percent; SA\t',
      `HAVER(X01LST, EXDB)\tvalue()\tExampleland: Long-term unemployment as a % of unemployment (NSA, %)\t${LABOUR}\t`,
      `HAVER(X01ULT, EXDB)\tvalue()\tExampleland: Long-term unemployment as a % of active population (NSA, %)\t${LABOUR}\t`,
      `HAVER(X01UVF, EXDB)\tvalue()\tExampleland: Very long-term unemployment as a % active population: Females (NSA, %)\t${LABOUR}\t`,
      `HAVER(X01ULM, EXDB)\tvalue()\tExampleland: Long-term unemployment as a % of active population: Males (NSA, %)\t${LABOUR}\t`,
      `HAVER(X01LSF, EXDB)\tvalue()\tExampleland: Long-term unemployment as a % of unemployment: Females (NSA, %)\t${LABOUR}\t`,
      `MarketCoordinate("IR_USD_EXAMPLE CASH_12 MONTH.ATMRATE")\t${COORDINATE_MEASURES}\t${CASH} | Point : Tenor = 12 MONTH | Quoting Style : At-the-money rate\tinternal only\t`,
      `MarketCoordinate("IR_USD_EXAMPLE CASH_2 MONTH.ATMRATE")\t${COORDINATE_MEASURES}\t${CASH} | Point : Tenor = 2 MONTH | Quoting Style : At-the-money rate\tinternal only\t`,
      `MarketCoordinate("IR_USD_EXAMPLE CASH_CASH STUB.ATMRATE")\t${COORDINATE_MEASURES}\t${CASH} | Point : Tenor = CASH STUB | Quoting Style : At-the-money rate\tinternal only\t`,
      `MarketCoordinate("IR_USD_EXAMPLE FUTURE_JUN31.PRICE")\t${COORDINATE_MEASURES}\t${FUTURE} | Point : Tenor = JUN31 | Quoting Style : Price\tinternal only\t`,
      `MarketCoordinate("IR_USD_EXAMPLE FUTURE_MAR30.PRICE")\t${COORDINATE_MEASURES}\t${FUTURE} | Point : Tenor = MAR30 | Quoting Style : Price\tinternal only\t`,
      'TSDB(exv)\tvalue()\tEXV Mid Term Structure\tExample Market Data\t',
      'TSDB(EXV120d)\tvalue()\tEXV120d\tExample Strategies Group\t',
      'TSDB(EXV120d_rt)\tvalue()\tEXV120d_rt\tExample Strategies Group; intraday\t',
      'TSDB(EXV150d)\tvalue()\tEXV150d\tExample Strategies Group\t',
      'TSDB(EXV150d_rt)\tvalue()\tEXV150d_rt\tExample Strategies Group; intraday\t',
      'Dataset(EXFX_SPOT_SAMPLE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_SAMPLE)"',
      'Dataset(EXFX_SPOT_STANDARD_SAMPLE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_STANDARD_SAMPLE)"',
      'Dataset(EXFX_SPOT_PREMIUM_SAMPLE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_PREMIUM_SAMPLE)"',
      'Dataset(EXFX_SPOT_DEV)\t\tExample FX Spot\tDaily\tmarquee data view "Dataset(EXFX_SPOT_DEV)"',
      'Dataset(EXFX_SPOT_PREMIUM)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_PREMIUM)"',
      '',
      'To see more Asset rows, try: marquee data search unemployment --class Asset',
      'To see more FRED rows, try: marquee data search unemployment --class FRED',
      'To see more HAVER rows, try: marquee data search unemployment --class HAVER',
      'To see more MarketCoordinate rows, try: marquee data search unemployment --class MarketCoordinate',
      'To see more TSDB rows, try: marquee data search unemployment --class TSDB',
      'To see more Dataset rows, try: marquee data search unemployment --class Dataset',
      '',
    ].join('\n'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  it('sends each Class its search as PlotTool Web sends it, and reads the function library for the Measures', async () => {
    const result = await runDataSearch(['unemployment', 'rate'], everyClass());

    expect(result.sent.map(({ method, path, query, body }) => [`${method} ${path}`, body ?? query ?? null])).toEqual(expect.arrayContaining([
      ['GET /v1/plots/functions', null],
      ['POST /v1/plots/entities', expect.objectContaining({ asset: expect.objectContaining({ q: 'unemployment rate', limit: 10 }) })],
      ['POST /v1/search/coordinates/query', { qs: 'unemployment rate OR DCFREDUNEMPLOYMENT RATE' }],
      ['GET /v1/plots/haversearch', expect.objectContaining({ qs1: 'Unemployment', qs2: 'Rate', qs3: 'Unemployment', qs4: 'Rate', qs5: 'Unemployment', startDate: '2026-10-15' })],
      ['GET /v1/plots/coordinates', { q: 'unemployment rate' }],
      ['POST /v1/tsdb/search', { type: 'SearchSymbolsRequest', namespace: 'TSDB', search: 'unemployment rate' }],
      ['GET /v1/search/datasets', { q: 'unemployment rate' }],
    ]));
    expect(result.sent).toHaveLength(7);
  });

  it('names only the Classes that had more rows than they showed', async () => {
    const result = await runDataSearch(['unemployment'], everyClass({
      ...NOTHING,
      'POST /v1/search/coordinates/query': { totalResults: 2, results: (FRED as { results: unknown[] }).results.slice(0, 2) },
      'GET /v1/plots/coordinates': { results: [{ name: 'FX EVENTS_EXAMPLE_26OCT26.ADD', description: '' }] },
    }));

    expect(result.stdout).toBe([
      HEADER,
      'FRED(UNRATE)\tvalue()\tUnemployment Rate\tMonthly; Percent; SA\t',
      'FRED(UNRATENSA)\tvalue()\tUnemployment Rate\tMonthly; Percent; NSA\t',
      `MarketCoordinate("FX EVENTS_EXAMPLE_26OCT26.ADD")\t${COORDINATE_MEASURES}\t\texternal\t`,
      '',
    ].join('\n'));
  });

  it('projects the same rows as JSON, with view null where a row pastes as it is', async () => {
    const result = await runDataSearch(
      ['unemployment', '--json', 'class,classArgs,measures,name,type,view', '--jq', '[.[0], .[5], .[15], .[25]]'],
      everyClass(),
    );

    expect(JSON.parse(result.stdout)).toEqual([
      {
        class: 'Asset',
        classArgs: 'EXMP UW',
        measures: [],
        name: 'Example Corp',
        type: 'Single Stock; Equity',
        view: 'marquee data view "EXMP UW"',
      },
      {
        class: 'FRED',
        classArgs: 'FRED(UNRATE)',
        measures: ['value()'],
        name: 'Unemployment Rate',
        type: 'Monthly; Percent; SA',
        view: null,
      },
      {
        class: 'MarketCoordinate',
        classArgs: 'MarketCoordinate("IR_USD_EXAMPLE CASH_12 MONTH.ATMRATE")',
        measures: ['actual_data_quality()', 'ask()', 'bid()', 'expected_data_quality()', 'value()'],
        name: `${CASH} | Point : Tenor = 12 MONTH | Quoting Style : At-the-money rate`,
        type: 'internal only',
        view: null,
      },
      {
        class: 'Dataset',
        classArgs: 'Dataset(EXFX_SPOT_SAMPLE)',
        measures: [],
        name: 'Example FX Spot',
        type: 'Example Pricing Co; Daily',
        view: 'marquee data view "Dataset(EXFX_SPOT_SAMPLE)"',
      },
    ]);
    expect(result.stderr).toBe('');
  });

  it('leaves an asset without a Bloomberg ID out of the table but lists it in JSON by its Marquee id', async () => {
    const answers = everyClass({
      'POST /v1/plots/entities': entityAnswer({
        assets: {
          totalResults: 2,
          results: [
            { id: 'MA_SYNTHETIC_EXMP', bbid: 'EXMP UW', name: 'Example Corp', type: 'Single Stock', assetClass: 'Equity' },
            { id: 'MA_NO_BBID', name: 'No Bloomberg ID', type: 'Fund', assetClass: 'Equity' },
          ],
        },
      }),
    });

    const text = await runDataSearch(['unemployment'], answers);
    const json = await runDataSearch(['unemployment', '--json', 'classArgs', '--jq', '[.[0:3][].classArgs]'], answers);

    expect(text.stdout.split('\n').slice(1, 3)).toEqual([
      'EXMP UW\t\tExample Corp\tSingle Stock; Equity\tmarquee data view "EXMP UW"',
      'FRED(UNRATE)\tvalue()\tUnemployment Rate\tMonthly; Percent; SA\t',
    ]);
    expect(text.stderr).toBe('Left out 1 asset without a Bloomberg ID; --json name,classArgs lists them\n');
    expect(JSON.parse(json.stdout)).toEqual(['EXMP UW', 'MA_NO_BBID', 'FRED(UNRATE)']);
    expect(json.stderr).toBe('');
  });

  it('sends HAVER and Kpi a query they cannot take, and prints each refusal as its Class\'s error beside the others\' rows', async () => {
    const result = await runDataSearch(['S&P 500'], everyClass({
      'GET /v1/plots/haversearch': haverRefusal,
      'POST /v1/plots/entities': entityAnswer({
        ...fixture('asset-search-example.json') as Readonly<Record<string, unknown>>,
        kpis: { status_code: 400, _log_message: '{"statusCode":400,"messages":["Expected search phrase","Request: R1"]}' },
      }),
    }));

    expect(result.stdout).toContain('FRED(UNRATE)\t');
    expect(result.stderr).toBe([
      'Error: Kpi: code: 400 - Expected search phrase; Request: R1\n',
      'Error: HAVER: code: 400 - Bad Request (Field \'qs3\': Input \'S&P\' does not fit pattern)\n',
    ].join(''));
    expect(Object.keys(result.sent.find(({ path }) => path === '/v1/plots/entities')?.body as object)).toContain('kpi');
    expect(result.exitCode).toBe(1);
  });

  it('prints a Kpi search that answers Login Required as Kpi\'s error beside the others\' rows, and exits 1', async () => {
    const result = await runDataSearch(['unemployment'], everyClass({ 'POST /v1/plots/entities': KPI_LOGIN_REQUIRED }));

    expect(result.stdout).toContain('FRED(UNRATE)\t');
    expect(result.stdout).toContain('EXMP UW\t');
    expect(result.stderr).toBe('Error: Kpi: code: 401 - Login Required\nKpi\'s search needs an interactive Marquee sign-in; every other Class answered\n');
    expect(result.exitCode).toBe(1);
  });

  it('fails a Kpi search alone that answers Login Required', async () => {
    const result = await runDataSearch(['unemployment', '--class', 'Kpi'], everyClass({ 'POST /v1/plots/entities': KPI_LOGIN_REQUIRED }));

    expect(result).toMatchObject({ stdout: '', stderr: 'Error: Kpi: code: 401 - Login Required\nKpi\'s search needs an interactive Marquee sign-in\n', exitCode: 1 });
  });

  it('splits one bare-word search, as PlotTool Web sends it, into a Class each with its own rows in Marquee\'s order', async () => {
    const countries = ['XA', 'XB', 'XC', 'XD', 'XE'].map((id) => ({ id, name: `Exampleland ${id}` }));
    const answers = everyClass({
      'POST /v1/plots/entities': entityAnswer({
        assets: { totalResults: 1, results: [{ id: 'MA_SYNTHETIC_XLF', bbid: 'XLF', name: 'Exampleland Fund', type: 'ETF', assetClass: 'Equity' }] },
        countries: { totalResults: 5, results: countries },
        riskModel: { totalResults: 1, results: [{ id: 'EXRM_LONG', name: 'Example Risk Model', type: 'Factor' }] },
        portfolios: { totalResults: 1, results: [{ id: 'MPEXAMPLE', name: 'Example Book' }] },
      }),
    });

    const json = await runDataSearch(['Exampleland', '--json', 'class,classArgs'], answers);
    const text = await runDataSearch(['Exampleland'], answers);

    const searches = json.sent.filter(({ path }) => path === '/v1/plots/entities');
    expect(searches.map(({ body }) => body)).toEqual([{
      asset: expect.objectContaining({ q: 'Exampleland', limit: 10 }),
      country: { q: 'Exampleland', limit: 5 },
      kpi: { q: 'Exampleland', limit: 5 },
      portfolio: { q: 'Exampleland', limit: 5 },
      riskModel: { q: 'Exampleland', limit: 10 },
      subdivision: { q: 'Exampleland', limit: 5 },
    }]);
    const entityRows = (JSON.parse(json.stdout) as { class: string; classArgs: string }[])
      .filter((row) => ['Asset', 'Country', 'RiskModel', 'Subdivision', 'Kpi', 'Portfolio'].includes(row.class));
    expect(entityRows).toEqual([
      { class: 'Asset', classArgs: 'XLF' },
      ...countries.map(({ id }) => ({ class: 'Country', classArgs: id })),
      { class: 'RiskModel', classArgs: 'EXRM_LONG' },
      { class: 'Portfolio', classArgs: 'Portfolio(MPEXAMPLE)' },
    ]);
    // Web's cap of 5 countries came back full, so more may match.
    expect(text.stdout).toContain('To see more Country rows, try: marquee data search Exampleland --class Country\n');
    expect(text.stdout).not.toContain('--class Asset');
  });

  it('prints an empty JSON array when no Class matched', async () => {
    const result = await runDataSearch(['zzqqxxnotathing', '--json', 'classArgs'], everyClass(NOTHING));

    expect(result).toMatchObject({ stdout: '[]\n', stderr: '', exitCode: undefined });
  });

  it('prints the other Classes\' rows beside a Class that failed, and exits 1', async () => {
    const result = await runDataSearch(['unemployment'], everyClass({ 'POST /v1/tsdb/search': denied }));

    expect(result.stdout).toContain('FRED(UNRATE)\t');
    expect(result.stdout).not.toContain('TSDB(');
    expect(result.stdout).toContain('\nTSDB (failed: code: 403)\t\t\t\t\n');
    expect(result.stderr).toBe('Error: TSDB: code: 403 - {"statusCode":403}\n');
    expect(result.exitCode).toBe(1);
  });

  it('prints the other Classes\' rows beside a failed dataset search, and exits 1', async () => {
    const result = await runDataSearch(['unemployment'], everyClass({ 'GET /v1/search/datasets': denied }));

    expect(result.stdout).toContain('TSDB(exv)\t');
    expect(result.stdout).not.toContain('Dataset(');
    expect(result.stderr).toBe('Error: Dataset: code: 403 - {"statusCode":403}\n');
    expect(result.exitCode).toBe(1);
  });

  it('asks for a login once when every Class needs one', async () => {
    const expired = () => {
      throw new MarqueeError('auth_expired', 'Not authenticated');
    };
    const result = await runDataSearch(['unemployment'], everyClass({
      'POST /v1/plots/entities': expired,
      'POST /v1/search/coordinates/query': expired,
      'GET /v1/plots/haversearch': expired,
      'GET /v1/plots/coordinates': expired,
      'POST /v1/tsdb/search': expired,
      'GET /v1/search/datasets': expired,
    }));

    expect(result).toMatchObject({ stdout: '', stderr: 'Error: Not authenticated. Run: marquee auth login\n', exitCode: 4 });
  });

  it('reports a Class that has not answered by the deadline and prints the others', async () => {
    const result = await runDataSearch(
      ['unemployment'],
      everyClass({ 'POST /v1/tsdb/search': () => new Promise(() => undefined) }),
      { everyClassDeadlineMs: 20 },
    );

    expect(result.stdout).toContain('FRED(UNRATE)\t');
    expect(result.stdout).toContain('\nTSDB (failed: did not answer within 0.02s)\t');
    expect(result.stderr).toBe(
      'Error: TSDB: did not answer within 0.02s\nSearch TSDB alone: marquee data search unemployment --class TSDB\n',
    );
    expect(result.exitCode).toBe(1);
  });

  it('reports an unreadable function library as the error of each Class whose Measures it holds, and prints the others', async () => {
    const result = await runDataSearch(['unemployment'], everyClass({ 'GET /v1/plots/functions': denied }));

    expect(result.stdout).toContain('EXMP UW\t\tExample Corp\t');
    expect(result.stdout).toContain('Dataset(');
    expect(result.stdout).not.toMatch(/^(FRED|HAVER|MarketCoordinate|TSDB)\(/m);
    expect(result.stderr).toBe('Error: Access denied: PlotTool Pro\'s function library\n');
    expect(result.exitCode).toBe(1);
  });

  it('fails a search of one library Class when the function library cannot be read', async () => {
    const result = await runDataSearch(['unemployment', '--class', 'FRED'], everyClass({ 'GET /v1/plots/functions': denied }));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Access denied: PlotTool Pro\'s function library\n',
      exitCode: 1,
    });
  });

  it.each([
    ['the search fails while the function library stalls', { 'POST /v1/search/coordinates/query': denied, 'GET /v1/plots/functions': stalled }],
    ['the function library fails while the search stalls', { 'POST /v1/search/coordinates/query': stalled, 'GET /v1/plots/functions': denied }],
  ])('fails a search of one Class at once when %s', async (_, overrides) => {
    const result = await runDataSearch(['unemployment', '--class', 'FRED'], everyClass(overrides));

    expect(result).toMatchObject({ stdout: '', exitCode: 1 });
  });

  it('fails loud on a function library that lists no Measures for a Class its search found', async () => {
    const result = await runDataSearch(['unemployment'], everyClass({
      'GET /v1/plots/functions': {
        results: [],
        classes: (SEARCH_LIBRARY as { classes: { name: string }[] }).classes.filter(({ name }) => name !== 'TSDB'),
      },
    }));

    expect(result.stdout).toContain('FRED(UNRATE)\t');
    expect(result.stderr).toBe('Error: PlotTool Pro\'s function library lists no Measures for TSDB\n');
    expect(result.exitCode).toBe(1);
  });

  it('rejects an empty query before searching', async () => {
    const result = await runDataSearch([' '], everyClass());

    expect(result).toEqual({ stdout: '', stderr: 'Error: data search query must not be empty\n', exitCode: 1, sent: [] });
  });
});
