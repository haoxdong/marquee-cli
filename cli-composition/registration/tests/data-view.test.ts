import { afterEach, describe, expect, it } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { entityAnswer, fixture, runData } from './data-search-harness.js';

type Init = Readonly<{ query?: Readonly<Record<string, unknown>>; body?: unknown }>;

const ASSET_FIELDS = ['id', 'bbid', 'name', 'type', 'assetClass'];
const NO_ASSETS = { totalResults: 0, results: [] };
const EXMP_UW = fixture('asset-bbid-exmp-uw.json');

// Each lookup `/v1/assets/data` takes, by the key PlotTool Web resolves a typed id with.
function assetsData({ query = {} }: Init): unknown {
  // Marquee validates `id` against a pattern and answers 400 for anything else (live, 2026-10-23).
  if (typeof query.id === 'string' && !/^[\w.-]{0,256}$/.test(query.id)) {
    throw new MarqueeError('http', 'Marquee returned 400 for /v1/assets/data', {
      status: 400,
      path: '/v1/assets/data',
      body: '{"statusCode":400,"title":"Path/Query Parameter Validation Error"}',
      responseClassification: 'http_status',
    });
  }
  if (query.id ==='MA_SYNTHETIC_EXMP_UW' || query.bbid === 'EXMP UW' || query.name === 'Example Corp') return EXMP_UW;
  return NO_ASSETS;
}

// Synthetic catalogs and answers in the shapes Marquee answered (2026-10-16, availability by dataset 2026-10-23).
const ROUTES: Readonly<Record<string, unknown>> = {
  'GET /v1/plots/functions': fixture('view/plots-functions.json'),
  'GET /v1/assets/data': assetsData,
  'GET /v1/plots/availability/MA_SYNTHETIC_EXMP_UW': fixture('view/availability-exmp-uw.json'),
  'GET /v1/plots/availability/FXVOL_SYNTHETIC': ({ query }: Init) => {
    if (query?.type !== 'dataset') throw new Error('expected ?type=dataset');
    return fixture('view/availability-dataset-fxvol.json');
  },
  'POST /v1/plots/entities': ({ body }: Init) => {
    const { q } = (body as { asset: { q: string } }).asset;
    if (q === 'EXMP') return entityAnswer(fixture('view/nearest-assets-exmp.json') as Readonly<Record<string, unknown>>);
    return entityAnswer({ assets: NO_ASSETS });
  },
};

function view(args: readonly string[], routes: Readonly<Record<string, unknown>> = ROUTES) {
  return runData(['view', ...args], (endpoint: Endpoint, init: Init) => {
    const answer = routes[`${endpoint.method} ${endpoint.path}`];
    if (answer === undefined) throw new Error(`Unexpected request: ${endpoint.method} ${endpoint.path}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? (answer as (init: Init) => unknown)(init) : answer;
  });
}

// The lookups an id that names no library Class or Function costs, sent at once.
function lookups(identifier: string, keys: readonly string[] = ['id', 'bbid', 'name']) {
  return keys.map((key) => ({
    method: 'GET',
    path: '/v1/assets/data',
    query: { [key]: identifier, field: ASSET_FIELDS },
  }));
}

// Each distinct Measure once, paste-ready, grouped by who supplies it and how often, smallest group first.
const EXMP_UW_SCREEN = [
  'ID:\tEXMP UW',
  'Name:\tExample Corp',
  'Type:\tSingle Stock',
  'Asset class:\tEquity',
  '',
  'Measures (End Of Day)',
  'EXMP UW.short_interest()',
  '',
  'Measures by Example Research',
  'EXMP UW.example_estimates(metric, period)',
  '',
  'Measures by Example Vendor (End Of Day)',
  'EXMP UW.implied_volatility(tenor)',
  '',
  'Measures by Example Vendor (End Of Day, Real Time)',
  'EXMP UW.spot()',
  '',
  'To see a Measure\'s description and allowed values, try: '
    + 'marquee data view "EXMP UW" --json measures --jq \'.measures[] | select(.name == "<measure>")\'',
  '',
].join('\n');

afterEach(() => {
  process.exitCode = undefined;
});

describe('marquee data view <Function>', () => {
  it('shows the signature, each parameter with its default, allowed values and description', async () => {
    const result = await view(['zscore_band']);

    expect(result.sent).toEqual([{ method: 'GET', path: '/v1/plots/functions' }]);
    expect(result.stdout).toBe([
      'ID:\tzscore_band',
      'Group:\tstatistics',
      'Signature:\tzscore_band(x, method)',
      'Description:\tAn example band around z-scores',
      '',
      'Parameters',
      'parameter\tdefault\tallowed\tdescription',
      'x\t\t\ttime series',
      'method\tstep\tintersect | step | nan\thow to align dates',
      '',
    ].join('\n'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  it('fails loud when the Function library does not answer', async () => {
    const unavailable = new MarqueeError('http', 'Marquee returned 503', {
      status: 503,
      path: '/v1/plots/functions',
      body: '',
      responseClassification: 'http_status',
    });
    const result = await view(['zscores'], { ...ROUTES, 'GET /v1/plots/functions': unavailable });

    expect(result).toMatchObject({ stdout: '', stderr: 'Error: Function library is unavailable\n', exitCode: 1 });
  });
});

describe('marquee data view <Class>', () => {
  it('shows the constructor and each Measure with its allowed values', async () => {
    const result = await view(['MarketCoordinate']);

    expect(result.stdout).toBe([
      'ID:\tMarketCoordinate',
      'Group:\tconstructors',
      'Signature:\tMarketCoordinate(coordinate)',
      'Description:\tA market data coordinate',
      '',
      'Parameters',
      'parameter\tdefault\tallowed\tdescription',
      'coordinate\t\t\tthe coordinate name',
      '',
      'Measures',
      'measure\tsignature\tallowed\tdescription',
      'value\tvalue(location)\tlocation: NYC (default) | LDN\tGet the coordinate\'s value',
      'bid\tbid()\t\tGet the coordinate\'s bid',
      '',
    ].join('\n'));
  });

  it('takes a search row\'s Class(args) cell verbatim, each Measure signed on that Class', async () => {
    const result = await view(['MarketCoordinate("IR_EXAMPLE_10Y.ATMRATE")']);

    expect(result.sent).toEqual([{ method: 'GET', path: '/v1/plots/functions' }]);
    expect(result.stdout.split('\n').slice(-4, -1)).toEqual([
      'measure\tsignature\tallowed\tdescription',
      'value\tMarketCoordinate("IR_EXAMPLE_10Y.ATMRATE").value(location)\tlocation: NYC (default) | LDN\tGet the coordinate\'s value',
      'bid\tMarketCoordinate("IR_EXAMPLE_10Y.ATMRATE").bid()\t\tGet the coordinate\'s bid',
    ]);
  });

  it('fails a Class(args) cell of no library Class with the nearest names', async () => {
    const result = await view(['MarketCoordinat("IR_EXAMPLE_10Y.ATMRATE")']);

    expect(result).toEqual({
      stdout: '',
      stderr: [
        'Error: no Class "MarketCoordinat"',
        '  Nearest Classes and Functions:',
        '    MarketCoordinate',
        '',
      ].join('\n'),
      exitCode: 1,
      sent: [{ method: 'GET', path: '/v1/plots/functions' }],
    });
  });
});

describe('marquee data view <Entity id>', () => {

  it('looks a Marquee id up by every key', async () => {
    const result = await view(['MA_SYNTHETIC_EXMP_UW']);

    expect(result.sent.slice(1, 4)).toEqual(lookups('MA_SYNTHETIC_EXMP_UW'));
  });

  it.each([
    ['its Marquee id', 'MA_SYNTHETIC_EXMP_UW'],
    ['its name', 'Example Corp'],
  ])('resolves %s as an Expression does, naming it by its Bloomberg ID', async (_by, identifier) => {
    const result = await view([identifier]);

    expect(result.stdout).toBe(EXMP_UW_SCREEN);
  });

  it('prints the refused KPI search beside the nearest Entities, since the id may be a Kpi', async () => {
    const result = await view(['EXMP'], {
      ...ROUTES,
      'POST /v1/plots/entities': entityAnswer({
        ...fixture('view/nearest-assets-exmp.json') as Readonly<Record<string, unknown>>,
        kpis: { status_code: 401, _log_message: 'Login Required' },
      }),
    });

    expect(result.stderr).toBe([
      'Error: no Entity, Class or Function "EXMP" among the Classes that answered',
      'Error: Kpi: code: 401 - Login Required',
      '  Nearest Entities:',
      '    EXMP UW',
      '    EXMP UP',
      'Kpi\'s search needs an interactive Marquee sign-in',
      '',
    ].join('\n'));
  });

  it('names a nearest Entity without a Bloomberg ID by its Marquee id', async () => {
    const result = await view(['EXMP'], {
      ...ROUTES,
      'POST /v1/plots/entities': entityAnswer({
        assets: { totalResults: 1, results: [{ id: 'MA_SYNTHETIC_NO_BBID', name: 'Example Fund', type: 'Fund', assetClass: 'Equity' }] },
      }),
    });

    expect(result.stderr).toBe([
      'Error: no Entity, Class or Function "EXMP"',
      '  Nearest Entities:',
      '    MA_SYNTHETIC_NO_BBID',
      '',
    ].join('\n'));
  });

  it('says plainly when the Entity\'s Measures are not entitled', async () => {
    const denied = new MarqueeError('http', 'Marquee returned 403', {
      status: 403,
      path: '/v1/plots/availability/MA_SYNTHETIC_EXMP_UW',
      body: '{"statusCode":403}',
      responseClassification: 'http_status',
    });
    const result = await view(['EXMP UW'], { ...ROUTES, 'GET /v1/plots/availability/MA_SYNTHETIC_EXMP_UW': denied });

    expect(result.stderr).toBe('Error: Access denied: Entity view\n');
    expect(result.exitCode).toBe(1);
  });

  it('fails loud on an allowed value that is not text, a number or true or false', async () => {
    const result = await view(['EXMP UW'], {
      ...ROUTES,
      'GET /v1/plots/availability/MA_SYNTHETIC_EXMP_UW': {
        measures: [{
          name: 'implied_volatility',
          description: 'Implied volatility.',
          parameters: [{ name: 'tenor', values: [{ conditions: { assetClass: 'Equity' }, allowed: [{ tenor: '1m' }] }] }],
          restrictions: { asset_class: 'Equity' },
          datasets: [],
        }],
      },
    });

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: Entity view returned malformed results at measures[0].parameters[0].values[0].allowed[0]: expected a value\n',
      exitCode: 1,
    });
  });

  it.each([
    ['parameters[0].values', 'expected an array', [{ name: 'tenor', values: null }]],
    ['parameters[0].values[0].allowed', 'expected an array', [{ name: 'tenor', values: [{ conditions: { assetClass: 'Equity' }, allowed: null }] }]],
  ])('fails loud on a null at measures[0].%s, which no recorded catalog has', async (location, problem, parameters) => {
    const result = await view(['EXMP UW'], {
      ...ROUTES,
      'GET /v1/plots/availability/MA_SYNTHETIC_EXMP_UW': {
        measures: [{
          name: 'implied_volatility',
          description: 'Implied volatility.',
          parameters,
          restrictions: { asset_class: 'Equity' },
          datasets: [],
        }],
      },
    });

    expect(result).toMatchObject({
      stdout: '',
      stderr: `Error: Entity view returned malformed results at measures[0].${location}: ${problem}\n`,
      exitCode: 1,
    });
  });

  it('lets a defect, not Marquee, fail the command', async () => {
    await expect(view(['EXMP UW'], {
      ...ROUTES,
      'GET /v1/plots/availability/MA_SYNTHETIC_EXMP_UW': new TypeError('synthetic defect'),
    })).rejects.toThrow('synthetic defect');
  });
});

describe('marquee data view Dataset(<id>)', () => {
  it.each(['Dataset(FXVOL_SYNTHETIC)', 'Dataset("FXVOL_SYNTHETIC")'])(
    'shows %s\'s availability: each Measure signed with its dimensions',
    async (target) => {
      const result = await view([target]);

      expect(result.sent).toEqual([
        { method: 'GET', path: '/v1/plots/availability/FXVOL_SYNTHETIC', query: { type: 'dataset' } },
      ]);
      expect(result.stdout).toBe([
        'ID:\tFXVOL_SYNTHETIC',
        '',
        'Measures',
        'measure\tsignature\tvendor\tfrequency\tallowed\tdescription',
        'implied_volatility\tDataset(FXVOL_SYNTHETIC).implied_volatility(assetId, tenor, deltaStrike)\t'
          + 'Example Vendor\tEnd Of Day\tdeltaStrike: 25DC (default) | DN | 25DP\t'
          + 'Volatility of an asset implied by observations of market prices',
        '',
      ].join('\n'));
      expect(result.exitCode).toBeUndefined();
    },
  );

  it('says plainly when the dataset is not entitled', async () => {
    const denied = new MarqueeError('http', 'Marquee returned 403', {
      status: 403,
      path: '/v1/plots/availability/FXVOL_SYNTHETIC',
      body: '{"statusCode":403}',
      responseClassification: 'http_status',
    });
    const result = await view(['Dataset(FXVOL_SYNTHETIC)'], { ...ROUTES, 'GET /v1/plots/availability/FXVOL_SYNTHETIC': denied });

    expect(result).toMatchObject({ stdout: '', stderr: 'Error: Access denied: Dataset view\n', exitCode: 1 });
  });
});

describe('marquee data view --json', () => {
  it('returns a Class\'s parameters and Measures as one record', async () => {
    const result = await view(['MarketCoordinate', '--json', 'kind,signature,measures']);

    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'class',
      signature: 'MarketCoordinate(coordinate)',
      measures: [
        {
          name: 'value',
          signature: 'value(location)',
          description: 'Get the coordinate\'s value',
          parameters: [{
            name: 'location',
            isVariadic: false,
            default: 'NYC',
            allowed: [{ values: ['NYC', 'LDN'] }],
            description: 'where close data was recorded',
          }],
        },
        { name: 'bid', signature: 'bid()', description: 'Get the coordinate\'s bid', parameters: [] },
      ],
    });
  });

  it('projects the same Entity detail the text shows', async () => {
    const result = await view(['EXMP UW', '--json', 'kind,id,name,type,assetClass', '--jq', '.']);

    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'entity',
      id: 'EXMP UW',
      name: 'Example Corp',
      type: 'Single Stock',
      assetClass: 'Equity',
    });
  });

  it('returns a dataset\'s Measures with their parameters', async () => {
    const result = await view(['Dataset(FXVOL_SYNTHETIC)', '--json', 'kind,id,measures', '--jq', '[.kind, .id, .measures[0].signature]']);

    expect(JSON.parse(result.stdout)).toEqual([
      'dataset',
      'FXVOL_SYNTHETIC',
      'Dataset(FXVOL_SYNTHETIC).implied_volatility(assetId, tenor, deltaStrike)',
    ]);
  });
});
