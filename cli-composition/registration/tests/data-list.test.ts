import { afterEach, describe, expect, it } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { fixture, runData } from './data-search-harness.js';

// A synthetic library in the shape `GET /v1/plots/functions` answers: Functions under
// `results`, Classes under `classes`, IRSwap among them though its group is not `constructors`.
const LIBRARY = (fixture('plots-functions.json') as Readonly<{ body: unknown }>).body;

function list(args: readonly string[], library: unknown = LIBRARY) {
  return runData(['list', ...args], (endpoint: Endpoint) => {
    if (`${endpoint.method} ${endpoint.path}` !== 'GET /v1/plots/functions') {
      throw new Error(`Unexpected request: ${endpoint.method} ${endpoint.path}`);
    }
    if (library instanceof Error) throw library;
    return library;
  });
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('marquee data list functions', () => {

  it('projects each Function as JSON', async () => {
    const result = await list(['functions', '--json', 'name,signature,group,description', '--jq', '.[0]']);

    expect(JSON.parse(result.stdout)).toEqual({
      name: 'add',
      signature: 'add(x, y, method)',
      group: 'algebra',
      description: 'Example description of add',
    });
    expect(result.stderr).toBe('');
  });
});

describe('marquee data list classes', () => {

  it('projects each Class as JSON', async () => {
    const result = await list(['classes', '--json', 'name', '--jq', '[.[].name]']);

    expect(JSON.parse(result.stdout)).toEqual(['Dataset', 'FRED', 'HAVER', 'IRSwap', 'MarketCoordinate']);
  });
});

describe('marquee data list failures', () => {

  it('says what failed when the library cannot be fetched', async () => {
    const result = await list(['classes'], unavailable('/v1/plots/functions'));

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: PlotTool Pro\'s function library is unavailable\n',
      exitCode: 1,
    });
  });

  it('fails loud on a malformed library', async () => {
    const result = await list(['functions'], { results: {}, classes: [] });

    expect(result).toMatchObject({
      stdout: '',
      stderr: 'Error: PlotTool Pro\'s function library returned malformed results at results: expected an array\n',
      exitCode: 1,
    });
  });

  it('lets a defect, not Marquee, fail the command', async () => {
    await expect(list(['functions'], new TypeError('synthetic defect'))).rejects.toThrow('synthetic defect');
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
