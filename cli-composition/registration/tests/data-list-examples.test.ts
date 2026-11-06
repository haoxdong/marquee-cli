import { afterEach, describe, expect, it } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { fixture, runData } from './data-search-harness.js';

// Three collections in the shape `GET /v1/collections?expand=true&subType=quickstart` answers
// (live 2026-10-23): `Quickstart` repeats `FX - Spot` and `Equity - Options` from the others and
// adds `FX`; one Equity folder comes back as a 404 instead of a folder.
const COLLECTIONS = fixture('quickstart-folders.json');
const FAILED_FOLDER = 'Error: Quickstart folder CL_SYNTHETIC_MISSING in Quickstart - Equity: code: 404\n';

function list(args: readonly string[], collections: unknown = COLLECTIONS) {
  return runData(['list', 'examples', ...args], (endpoint: Endpoint) => {
    if (`${endpoint.method} ${endpoint.path}` !== 'GET /v1/collections') {
      throw new Error(`Unexpected request: ${endpoint.method} ${endpoint.path}`);
    }
    if (collections instanceof Error) throw collections;
    return collections;
  });
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('marquee data list examples <folder>', () => {
  it('prints each example of the folder named verbatim, with its Expressions', async () => {
    const result = await list(['FX - Spot']);

    expect(result.sent).toEqual([{
      method: 'GET',
      path: '/v1/collections',
      query: { expand: true, limit: 100, subType: 'quickstart' },
    }]);
    expect(result.stdout).toBe([
      'collection:\tQuickstart - FX',
      'folder:\tFX - Spot',
      '',
      'Forward Points, Spot, Carry',
      'EURUSD.forward_point(3m, NYC)',
      'EURUSD.spot(NYC)',
      '',
      'Fair Value (FX)',
      'spot = EURUSD.spot(NYC)',
      'fair_value = repeat(EURUSD.fair_value(gsdeer), 1)',
      'spot / fair_value - 1',
      '',
    ].join('\n'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  it('projects each example as JSON', async () => {
    const result = await list(['FX - Spot', '--json', 'collection,folder,title,expressions', '--jq', '.[1]']);

    expect(JSON.parse(result.stdout)).toEqual({
      collection: 'Quickstart - FX',
      folder: 'FX - Spot',
      title: 'Fair Value (FX)',
      expressions: ['spot = EURUSD.spot(NYC)', 'fair_value = repeat(EURUSD.fair_value(gsdeer), 1)', 'spot / fair_value - 1'],
    });
    expect(result.stderr).toBe('');
  });

  it('matches the folder name exactly as Web spells it', async () => {
    const result = await list(['fx - spot']);

    expect(result.stderr).toContain('Error: no Quickstart folder is named "fx - spot"');
    expect(result.exitCode).toBe(1);
  });
});

describe('marquee data list examples', () => {

  it('projects each folder as JSON, with the folder that failed as its error, and exits 1', async () => {
    const result = await list(['--json', 'collection,folder']);

    expect(JSON.parse(result.stdout)).toEqual([
      { collection: 'Quickstart - FX', folder: 'FX - Spot' },
      { collection: 'Quickstart - FX', folder: 'FX - Vol' },
      { collection: 'Quickstart', folder: 'FX' },
      { collection: 'Quickstart - Equity', folder: 'Equity - Options' },
    ]);
    expect(result.stderr).toBe(FAILED_FOLDER);
    expect(result.exitCode).toBe(1);
  });
});

describe('marquee data list examples failures', () => {
  it('says what failed when the collections cannot be fetched', async () => {
    const result = await list([], unavailable('/v1/collections'));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: PlotTool Pro\'s Quickstart collections is unavailable\n',
      exitCode: 1,
    });
  });

  it('fails loud on a folder that is neither a folder nor a failed load', async () => {
    const result = await list([], { results: [{ name: 'Quickstart - FX', entities: [{ id: 'CL_X', name: 'FX' }] }] });

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: PlotTool Pro\'s Quickstart collections returned malformed results at '
        + 'results[0].entities[0].entities: expected an array\n',
      exitCode: 1,
    });
  });

  it('rejects a folder after functions or classes', async () => {
    const result = await runData(['list', 'functions', 'FX'], () => {
      throw new Error('no request expected');
    });

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: data list functions takes no folder; only examples does\n',
      exitCode: 1,
    });
  });
});

function unavailable(path: string): MarqueeError {
  return new MarqueeError('http', `Marquee returned 503 for ${path}`, {
    status: 503,
    path,
    body: '{"statusCode":503}',
    responseClassification: 'http_status',
  });
}
