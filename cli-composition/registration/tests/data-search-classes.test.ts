import { afterEach, describe, expect, it } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { byEndpoint, entityAnswer, fixture, runDataSearch, SEARCH_LIBRARY } from './data-search-harness.js';

// Synthetic answers, shaped as Marquee answers the requests PlotTool Web sends for each Class (ADR 0043).
const EXAMPLE = fixture('asset-search-example.json');
const EXMP_UW = fixture('asset-search-exmp-uw.json');
// Answers of POST /v1/search/coordinates/query to the body PlotTool Web sends inside `FRED(`:
// `{"qs":"unemployment rate OR DCFREDUNEMPLOYMENT RATE"}`; public FRED series metadata, trimmed.
const UNEMPLOYMENT_RATE = fixture('fred-search-unemployment-rate.json');
const FRED_NO_MATCH = fixture('fred-search-no-match.json');
const HAVER_UNEMPLOYMENT = fixture('haver-search-unemployment.json');
// 100 rows: Haver's cap, so more series match than it returned.
const HAVER_RATE = fixture('haver-search-rate.json');
const HAVER_NO_MATCH = fixture('haver-search-no-match.json');
const MDAPI_IR_USD = fixture('mdapi-search-ir-usd.json');
const TSDB_EXV = fixture('tsdb-search-exv.json');
const TSDB_NO_MATCH = fixture('tsdb-search-no-match.json');
// 10 of 681 datasets: the dataset search's default page.
const DATASETS_FX_SPOT = fixture('dataset-search-fx-spot.json');
const DATASETS_NO_MATCH = fixture('dataset-search-no-match.json');

const HEADER = 'Class(args)\tMeasure(args)\tName\tType\tView';
const LIBRARY = { 'GET /v1/plots/functions': SEARCH_LIBRARY };

// A search answer, or a function standing in for the search.
function entities(search: unknown) {
  return byEndpoint({
    'POST /v1/plots/entities': typeof search === 'function' ? search : entityAnswer(search as Readonly<Record<string, unknown>>),
  });
}

function fred(answer: unknown) {
  return byEndpoint({ ...LIBRARY, 'POST /v1/search/coordinates/query': answer });
}

// Answers keyed by the five filters captured from PlotTool Web.
function haver(answers: Readonly<Record<string, unknown>>) {
  return byEndpoint({
    ...LIBRARY,
    'GET /v1/plots/haversearch': (_endpoint: Endpoint, init: Readonly<{ query?: Readonly<Record<string, unknown>> }>) => {
      const slots = ['qs1', 'qs2', 'qs3', 'qs4', 'qs5'].map((slot) => String(init.query?.[slot]));
      const answer = answers[slots.join(' ')];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
}

function coordinates(answer: unknown) {
  return byEndpoint({ ...LIBRARY, 'GET /v1/plots/coordinates': answer });
}

function tsdb(answer: unknown) {
  return byEndpoint({ ...LIBRARY, 'POST /v1/tsdb/search': answer });
}

// No function library: a Dataset's Measures vary by instance.
function datasets(answer: unknown) {
  return byEndpoint({ 'GET /v1/search/datasets': answer });
}

function denial(path: string): MarqueeError {
  return new MarqueeError('http', `Marquee returned 403 for ${path}`, {
    status: 403,
    path,
    body: '{"statusCode":403}',
    responseClassification: 'http_status',
  });
}

function denied(endpoint: Endpoint): never {
  throw denial(endpoint.path);
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('marquee data search --class Asset', () => {

  it('types a bond by its asset class like any other asset', async () => {
    const result = await runDataSearch(['exmp uw', '--class', 'Asset'], entities(EXMP_UW));

    expect(result.stdout).toContain('BX000001\t\tEXMP 2.650 02/08/2051\tBond; Credit\tmarquee data view BX000001\n');
    expect(result.stdout).toContain('BX000003\t\tEXMP 2.400 05/03/2023\tBond; Rates\tmarquee data view BX000003\n');
  });

  it('widens the search with -L up to the asset cap', async () => {
    const result = await runDataSearch(['example', '--class', 'Asset', '-L', '1000'], entities(EXAMPLE));

    expect(result.sent[0]?.body).toMatchObject({ asset: { limit: 1000 } });
    expect(result.stdout.split('\n')[0]).toBe('Asset');
  });

  it('leaves an asset without a Bloomberg ID out of the text, counting it on stderr and pointing to --json', async () => {
    const result = await runDataSearch(
      ['example', '--class', 'Asset'],
      entities({
        assets: {
          totalResults: 2,
          results: [
            { id: 'MA_NO_BBID', name: 'No Bloomberg ID', type: 'Single Stock', assetClass: 'Equity' },
            { id: 'MA_SYNTHETIC_EXMP', bbid: 'EXMP UW', name: 'Example Corp', type: 'Single Stock', assetClass: 'Equity' },
          ],
        },
      }),
    );

    expect(result).toEqual({
      stdout: ['Asset', HEADER, 'EXMP UW\t\tExample Corp\tSingle Stock; Equity\tmarquee data view "EXMP UW"', ''].join('\n'),
      stderr: 'Left out 1 asset without a Bloomberg ID; --json name,classArgs lists them\n',
      exitCode: undefined,
      sent: expect.any(Array),
    });
  });

  it('lists an asset without a Bloomberg ID in JSON by its Marquee id, in the search\'s own order', async () => {
    const result = await runDataSearch(
      ['example', '--class', 'Asset', '--json', 'class,classArgs,name,view'],
      entities({
        assets: {
          totalResults: 2,
          results: [
            { id: 'MA_NO_BBID', name: 'No Bloomberg ID', type: 'Single Stock', assetClass: 'Equity' },
            { id: 'MA_SYNTHETIC_EXMP', bbid: 'EXMP UW', name: 'Example Corp', type: 'Single Stock', assetClass: 'Equity' },
          ],
        },
      }),
    );

    expect(JSON.parse(result.stdout)).toEqual([
      { class: 'Asset', classArgs: 'MA_NO_BBID', name: 'No Bloomberg ID', view: 'marquee data view MA_NO_BBID' },
      { class: 'Asset', classArgs: 'EXMP UW', name: 'Example Corp', view: 'marquee data view "EXMP UW"' },
    ]);
    expect(result).toMatchObject({ stderr: '', exitCode: undefined });
  });

  it('says only that it left assets out when none has a Bloomberg ID', async () => {
    const result = await runDataSearch(
      ['example', '--class', 'Asset'],
      entities({
        assets: {
          totalResults: 2,
          results: [
            { id: 'MA_NO_BBID_1', name: 'Example Fund 1', type: 'Fund', assetClass: 'Equity' },
            { id: 'MA_NO_BBID_2', name: 'Example Fund 2', type: 'Fund', assetClass: 'Equity' },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Left out 2 assets without a Bloomberg ID; --json name,classArgs lists them\n',
      exitCode: undefined,
    });
  });

  it('still fails loud on an asset without a name', async () => {
    const result = await runDataSearch(
      ['example', '--class', 'Asset'],
      entities({
        assets: { totalResults: 1, results: [{ id: 'MA_SYNTHETIC', bbid: 'EXMP UW', type: 'Single Stock', assetClass: 'Equity' }] },
      }),
    );

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Asset search returned malformed results at assets.results[0]: expected id, name, type and assetClass text\n',
      exitCode: 1,
    });
  });

  it('says on stderr that no asset matched', async () => {
    const result = await runDataSearch(
      ['example', '--class', 'Asset'],
      entities({ assets: { totalResults: 0, results: [] } }),
    );

    expect(result).toMatchObject({ stdout: '', stderr: 'no assets match "example"\n', exitCode: undefined });
  });
});

describe('marquee data search --class Country, RiskModel, Subdivision, Kpi or Portfolio', () => {

  it('writes a type an Expression does not take bare with its constructor, quoting an id that is not a word', async () => {
    const result = await runDataSearch(['Exampleland', '--class', 'Subdivision', '--json', 'class,classArgs,view'], entities({
      subdivisions: { totalResults: 1, results: [{ id: 'XL-01', name: 'Exampleland Capital', countryId: 'XL' }] },
    }));

    expect(JSON.parse(result.stdout)).toEqual([
      { class: 'Subdivision', classArgs: 'Subdivision("XL-01")', view: 'marquee data view \'Subdivision("XL-01")\'' },
    ]);
  });

  it('fails loud on a type whose own search answers a failure in place of its rows', async () => {
    const result = await runDataSearch(['example', '--class', 'Kpi'], entities({
      kpis: { 'status_code': 400, _log_message: 'q does not match' },
    }));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Kpi: code: 400 - q does not match\n',
      exitCode: 1,
    });
  });
});

describe('marquee data search --class FRED', () => {

  const widenings: readonly (readonly [readonly string[], number])[] = [
    [['--limit', '20'], 20],
    [['-L', '1000'], 1000],
  ];
  it.each(widenings)('widens the search with %j up to the cap', async (flags, limit) => {
    const result = await runDataSearch(['unemployment rate', '--class', 'FRED', ...flags], fred(UNEMPLOYMENT_RATE));

    expect(result.sent.flatMap(({ body }) => (body === undefined ? [] : [body]))).toEqual([
      { qs: 'unemployment rate OR DCFREDUNEMPLOYMENT RATE', limit },
    ]);
    expect(result.exitCode).toBeUndefined();
  });

  it.each(['1001', '0', '5x'])('rejects --limit %s before searching', async (limit) => {
    const result = await runDataSearch(['unemployment rate', '--class', 'FRED', '--limit', limit], fred(UNEMPLOYMENT_RATE));

    expect(result).toEqual({
      stdout: '',
      stderr: 'Error: --limit must be a whole number from 1 to 1000 for --class FRED\n',
      exitCode: 1,
      sent: [],
    });
  });

  it('joins the words of an unquoted query', async () => {
    const result = await runDataSearch(['unemployment', 'rate', '--class', 'FRED'], fred(UNEMPLOYMENT_RATE));

    expect(result.sent.flatMap(({ body }) => (body === undefined ? [] : [body]))).toEqual([
      { qs: 'unemployment rate OR DCFREDUNEMPLOYMENT RATE' },
    ]);
  });

  it('prints an empty JSON array when nothing matched', async () => {
    const result = await runDataSearch(['zzqqxxnotathing', '--class', 'FRED', '--json', 'classArgs'], fred(FRED_NO_MATCH));

    expect(result).toMatchObject({ stdout: '[]\n', stderr: '', exitCode: undefined });
  });

  it.each([
    ['is not JSON', 'Bad Request'],
    ['gives no message', '{"statusCode":400,"messages":[]}'],
  ])('passes a rejection that %s through as Marquee sent it', async (_case, body) => {
    const result = await runDataSearch(['(', '--class', 'FRED'], fred((endpoint: Endpoint) => {
      throw new MarqueeError('http', `Marquee returned 400 for ${endpoint.path}`, {
        status: 400,
        path: endpoint.path,
        body,
        responseClassification: 'http_status',
      });
    }));

    expect(result).toMatchObject({
      stdout: '',
      stderr: `Error: FRED: code: 400 - ${body}\n`,
      exitCode: 1,
    });
  });

  it('lets a defect, not Marquee, fail the command', async () => {
    await expect(runDataSearch(['unemployment rate', '--class', 'FRED'], fred(() => {
      throw new TypeError('synthetic defect');
    }))).rejects.toThrow('synthetic defect');
  });

  it('asks for a login when the session expired', async () => {
    const result = await runDataSearch(['unemployment rate', '--class', 'FRED'], fred(() => {
      throw new MarqueeError('auth_expired', 'Not authenticated. Run: marquee auth login');
    }));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Not authenticated. Run: marquee auth login\n',
      exitCode: 4,
    });
  });

  const SERIES = {
    id: 'DCFREDUNRATE',
    title: 'Unemployment Rate',
    frequency: 'Monthly',
    units: 'Percent',
    seasonalAdjustmentShort: 'SA',
  };
  const malformedAnswers: readonly (readonly [string, unknown, string])[] = [
    ['with a row that is not a FRED series', { totalResults: 1, results: [{ ...SERIES, id: 'UNRATE' }] }, 'results[0]: expected an id starting DCFRED'],
    ['without a total', { results: [] }, 'response: expected totalResults and results'],
    ['with a row that is not an object', { totalResults: 1, results: ['UNRATE'] }, 'results[0]: expected an object'],
    [
      'with a series without a title',
      { totalResults: 1, results: [{ ...SERIES, title: undefined }] },
      'results[0]: expected title, frequency, units and seasonalAdjustmentShort text',
    ],
  ];
  it.each(malformedAnswers)('fails loudly on an answer %s', async (_case, answer, problem) => {
    const result = await runDataSearch(['unemployment rate', '--class', 'FRED'], fred(answer));

    expect(result).toMatchObject({
      stdout: '',
      stderr: `Error: FRED search returned malformed results at ${problem}\n`,
      exitCode: 1,
    });
  });
});

describe('marquee data search --class HAVER', () => {

  it('counts no total when a request returns the 100 series Haver caps it at', async () => {
    const result = await runDataSearch(['rate', '--class', 'HAVER', '-L', '2'], haver({ 'Rate Rate Rate Rate Rate': HAVER_RATE }));

    expect(result.stdout.split('\n').slice(0, 3)).toEqual([
      'HAVER (2 shown)',
      HEADER,
      'HAVER(R001, EXDB)\tvalue()\tExampleland: Policy Rate Corridor 1 (EOP, %)\tExampleland: Monetary Policy, Example Central Bank, Monthly\t',
    ]);
  });

  it('counts the total when Haver returns fewer than 100 series', async () => {
    const result = await runDataSearch(['unemployment', '--class', 'HAVER', '-L', '2'], haver({ 'Unemployment Unemployment Unemployment Unemployment Unemployment': HAVER_UNEMPLOYMENT }));

    expect(result.stdout.split('\n').slice(0, 2)).toEqual(['HAVER (2 of 39 series)', HEADER]);
  });

  it('sends a query HAVER cannot take, and prints HAVER\'s refusal as Marquee words it', async () => {
    const refusal = new MarqueeError('http', 'Marquee returned 400 for /v1/plots/haversearch', {
      status: 400,
      path: '/v1/plots/haversearch',
      body: 'Bad Request (Field \'qs3\': Input \'S&P\' does not fit pattern)',
      responseClassification: 'http_status',
    });
    const result = await runDataSearch(['S&P', '--class', 'HAVER'], haver({ 'S&P S&P S&P S&P S&P': refusal }));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: HAVER: code: 400 - Bad Request (Field \'qs3\': Input \'S&P\' does not fit pattern)\n',
      exitCode: 1,
    });
    expect(result.sent.map(({ path }) => path)).toContain('/v1/plots/haversearch');
  });

  it('fails the search when Marquee fails it', async () => {
    const result = await runDataSearch(
      ['core HICP', '--class', 'HAVER'],
      haver({ 'Core HICP Core HICP Core': new MarqueeError('auth_expired', 'Not authenticated') }),
    );

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Not authenticated. Run: marquee auth login\n',
      exitCode: 4,
    });
  });

  it('says on stderr that nothing matched and exits 0', async () => {
    const result = await runDataSearch(['zzqqxx', '--class', 'HAVER'], haver({ 'Zzqqxx Zzqqxx Zzqqxx Zzqqxx Zzqqxx': HAVER_NO_MATCH }));

    expect(result).toMatchObject({ stdout: '', stderr: 'no HAVER series match "zzqqxx"\n', exitCode: undefined });
  });

  it('rejects --limit above the 100 series Haver returns per request', async () => {
    const result = await runDataSearch(['unemployment', '--class', 'HAVER', '--limit', '101'], haver({}));

    expect(result).toEqual({
      stdout: '',
      stderr: 'Error: --limit must be a whole number from 1 to 100 for --class HAVER\n',
      exitCode: 1,
      sent: [],
    });
  });
});

describe('marquee data search --class MarketCoordinate', () => {

  it('shows 10 coordinates by default and says more exist', async () => {
    const result = await runDataSearch(['IR_USD', '--class', 'MarketCoordinate'], coordinates(MDAPI_IR_USD));

    expect(result.stdout.split('\n')[0]).toBe('MarketCoordinate (10 shown)');
  });

  it('says on stderr that nothing matched', async () => {
    const result = await runDataSearch(['ZZ_NONE', '--class', 'MarketCoordinate'], coordinates({ results: [] }));

    expect(result).toMatchObject({ stdout: '', stderr: 'no market coordinates match "ZZ_NONE"\n', exitCode: undefined });
  });
});

describe('marquee data search --class TSDB', () => {

  it('lists a Measure with a required argument by its argument names, and one whose arguments all default as it pastes', async () => {
    const library = SEARCH_LIBRARY as { results: unknown[]; classes: { name: string; returns: { methods: unknown[] } }[] };
    const point = {
      name: 'point',
      parameters: [
        { name: 'date', variadic: false, description: 'observation date' },
        { name: 'modifier', variadic: false, default: '', description: 'symbol modifier' },
      ],
      returns: { type: 'number', description: 'one observation' },
      description: 'Get one observation of a TSDB series.',
    };
    const result = await runDataSearch(['exv', '--class', 'TSDB', '--limit', '1'], byEndpoint({
      'GET /v1/plots/functions': {
        ...library,
        classes: library.classes.map((entry) => (
          entry.name === 'TSDB' ? { ...entry, returns: { ...entry.returns, methods: [...entry.returns.methods, point] } } : entry
        )),
      },
      'POST /v1/tsdb/search': TSDB_EXV,
    }));

    expect(result.stdout.split('\n')[2]).toBe('TSDB(exv)\tvalue(), point(date)\tEXV Mid Term Structure\tExample Market Data\t');
  });

  it('says on stderr that nothing matched and exits 0', async () => {
    const result = await runDataSearch(['zzqqxx', '--class', 'TSDB'], tsdb(TSDB_NO_MATCH));

    expect(result).toMatchObject({ stdout: '', stderr: 'no TSDB symbols match "zzqqxx"\n', exitCode: undefined });
  });

  it('rejects --limit above the 20 symbols TSDB returns', async () => {
    const result = await runDataSearch(['exv', '--class', 'TSDB', '--limit', '21'], tsdb(TSDB_EXV));

    expect(result).toMatchObject({
      stderr: 'Error: --limit must be a whole number from 1 to 20 for --class TSDB\n',
      exitCode: 1,
    });
  });
});

describe('marquee data search --class Dataset', () => {
  it('searches as PlotTool Web does inside Dataset( and points each dataset to view, as its Measures vary', async () => {
    const result = await runDataSearch(['fx spot', '--class', 'Dataset'], datasets(DATASETS_FX_SPOT));

    expect(result.sent).toEqual([{ method: 'GET', path: '/v1/search/datasets', query: { q: 'fx spot' } }]);
    expect(result.stdout).toBe([
      'Dataset (10 of 681 datasets)',
      HEADER,
      'Dataset(EXFX_SPOT_SAMPLE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_SAMPLE)"',
      'Dataset(EXFX_SPOT_STANDARD_SAMPLE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_STANDARD_SAMPLE)"',
      'Dataset(EXFX_SPOT_PREMIUM_SAMPLE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_PREMIUM_SAMPLE)"',
      'Dataset(EXFX_SPOT_DEV)\t\tExample FX Spot\tDaily\tmarquee data view "Dataset(EXFX_SPOT_DEV)"',
      'Dataset(EXFX_SPOT_PREMIUM)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_PREMIUM)"',
      'Dataset(EXFX_SPOT_CLOUD)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_CLOUD)"',
      'Dataset(EXFX_SPOT_STANDARD)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_STANDARD)"',
      'Dataset(EXINDEXFXSPOT)\t\tExample Index FX Spot\tExample Index Co; Daily\tmarquee data view "Dataset(EXINDEXFXSPOT)"',
      'Dataset(EXWIRE_FXSPOT)\t\tExample Wire FX Spot\tExample Wire Services; Intraday\tmarquee data view "Dataset(EXWIRE_FXSPOT)"',
      'Dataset(EXFX_SPOT_ARCHIVE)\t\tExample FX Spot\tExample Pricing Co; Daily\tmarquee data view "Dataset(EXFX_SPOT_ARCHIVE)"',
      '',
    ].join('\n'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  it('widens the search with --limit up to the dataset search\'s 10000 cap', async () => {
    const result = await runDataSearch(['fx spot', '--class', 'Dataset', '--limit', '10000'], datasets(DATASETS_FX_SPOT));

    expect(result.sent).toEqual([{ method: 'GET', path: '/v1/search/datasets', query: { q: 'fx spot', limit: 10000 } }]);
  });

  it('rejects --limit above the dataset search\'s cap before searching', async () => {
    const result = await runDataSearch(['fx spot', '--class', 'Dataset', '--limit', '10001'], datasets(DATASETS_FX_SPOT));

    expect(result).toEqual({
      stdout: '',
      stderr: 'Error: --limit must be a whole number from 1 to 10000 for --class Dataset\n',
      exitCode: 1,
      sent: [],
    });
  });

  // Live: `IR_BASIS` names its vendor and an empty frequency (2026-10-23).
  it('types a dataset with an empty frequency by its vendor alone', async () => {
    const result = await runDataSearch(['ir basis', '--class', 'Dataset'], datasets({
      totalResults: 1,
      results: [{ id: 'EX_IR_BASIS', name: 'Example IR Basis', vendor: 'Goldman Sachs', parameters: { frequency: '' } }],
    }));

    expect(result.stdout.split('\n')[2]).toBe(
      'Dataset(EX_IR_BASIS)\t\tExample IR Basis\tGoldman Sachs\tmarquee data view "Dataset(EX_IR_BASIS)"',
    );
  });

  it('says on stderr that no dataset matched and exits 0', async () => {
    const result = await runDataSearch(['zzqqxx', '--class', 'Dataset'], datasets(DATASETS_NO_MATCH));

    expect(result).toMatchObject({ stdout: '', stderr: 'no datasets match "zzqqxx"\n', exitCode: undefined });
  });

  it('gives the validation message of a query holding & or ?', async () => {
    const result = await runDataSearch(['S&P 500', '--class', 'Dataset'], datasets((endpoint: Endpoint) => {
      throw new MarqueeError('http', `Marquee returned 400 for ${endpoint.path}`, {
        status: 400,
        path: endpoint.path,
        // The 400 Marquee answers for `GET /v1/search/datasets?q=S%26P+500` (live, 2026-10-23).
        body: '{"data":["S&P 500"],"message":"query \'q\' validation failed, [error] failed to validate item 1: failed to match pattern ^[^&?]*$ with \\"S&P 500\\""}',
        responseClassification: 'http_status',
      });
    }));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Dataset: code: 400 - query \'q\' validation failed, [error] failed to validate item 1: '
        + 'failed to match pattern ^[^&?]*$ with "S&P 500"\n',
      exitCode: 1,
    });
  });
});

describe('marquee data search failures per Class', () => {
  const denials: readonly (readonly [string, readonly string[], Parameters<typeof runDataSearch>[1], string])[] = [
    ['the asset search', ['example', '--class', 'Asset'], entities(denied), 'Asset'],
    ['the country search', ['example', '--class', 'Country'], entities(denied), 'Country'],
    ['HAVER search', ['core', '--class', 'HAVER'], haver({ 'Core Core Core Core Core': denial('/v1/plots/haversearch') }), 'HAVER'],
    ['MarketCoordinate search', ['IR_USD', '--class', 'MarketCoordinate'], coordinates(denied), 'MarketCoordinate'],
    ['TSDB search', ['exv', '--class', 'TSDB'], tsdb(denied), 'TSDB'],
    ['Dataset search', ['fx spot', '--class', 'Dataset'], datasets(denied), 'Dataset'],
  ];
  it.each(denials)('passes Marquee\'s denial of %s through as its Class\'s error', async (_request, args, answer, searched) => {
    const result = await runDataSearch(args, answer);

    expect(result).toMatchObject({ stdout: '', stderr: `Error: ${searched}: code: 403 - {"statusCode":403}\n`, exitCode: 1 });
  });

  const malformedAnswers: readonly (readonly [string, readonly string[], Parameters<typeof runDataSearch>[1], string])[] = [
    ['HAVER results without data', ['core', '--class', 'HAVER'], haver({ 'Core Core Core Core Core': { results: {} } }), 'HAVER search returned malformed results at results: expected data'],
    [
      'a HAVER series without its group',
      ['core', '--class', 'HAVER'],
      haver({ 'Core Core Core Core Core': { results: { data: [{ haverid: 'X01HCI', database: 'EXDB', description: 'Example' }] } } }),
      'HAVER search returned malformed results at results[0]: expected haverid, database, description and groupdescription text',
    ],
    [
      'MarketCoordinate search without results',
      ['IR_USD', '--class', 'MarketCoordinate'],
      coordinates({}),
      'MarketCoordinate search returned malformed results at response: expected results',
    ],
    [
      'an unnamed coordinate',
      ['IR_USD', '--class', 'MarketCoordinate'],
      coordinates({ results: [{ description: '**Available for External Users.** Example' }] }),
      'MarketCoordinate search returned malformed results at results[0]: expected name and description text',
    ],
    ['TSDB without descriptors', ['exv', '--class', 'TSDB'], tsdb({}), 'TSDB search returned malformed results at response: expected descriptors'],
    [
      'a TSDB symbol without its key',
      ['exv', '--class', 'TSDB'],
      tsdb({ descriptors: [{ source: 'Example', description: 'exv', isIntraday: false }] }),
      'TSDB search returned malformed results at results[0]: expected key.symbol text',
    ],
    [
      'a TSDB symbol without its source',
      ['exv', '--class', 'TSDB'],
      tsdb({ descriptors: [{ key: { symbol: 'exv' }, description: 'exv', isIntraday: false }] }),
      'TSDB search returned malformed results at results[0]: expected source and description text and isIntraday',
    ],
    [
      'Dataset search without results',
      ['fx spot', '--class', 'Dataset'],
      datasets({ totalResults: 0 }),
      'Dataset search returned malformed results at response: expected totalResults and results',
    ],
    [
      'a dataset without its frequency',
      ['fx spot', '--class', 'Dataset'],
      datasets({ totalResults: 1, results: [{ id: 'EXFX_SPOT', name: 'Example FX Spot', parameters: {} }] }),
      'Dataset search returned malformed results at results[0]: expected id, name and parameters.frequency text, and vendor text when given',
    ],
  ];
  it.each(malformedAnswers)('fails loudly on %s', async (_answer, args, answer, message) => {
    const result = await runDataSearch(args, answer);

    expect(result).toMatchObject({ stdout: '', stderr: `Error: ${message}\n`, exitCode: 1 });
  });
});
