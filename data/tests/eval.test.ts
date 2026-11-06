import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Endpoint } from '../../transport/index.js';
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
  type Route,
} from './support.js';

// Answers the runner with `body`, once `runnerHeld` resolves; the function library eval checks
// Expressions against; and the chart save and its picture.
function runnerAnswering(body: string, runnerHeld: Promise<void> = Promise.resolve()) {
  return vi.fn(async (endpoint: Endpoint, _init?: Readonly<{ body?: unknown }>): Promise<unknown> => {
    if (endpoint.path === '/v1/plots/functions') return JSON.parse(functionLibrary().body);
    if (endpoint.path === '/v1/charts') return JSON.parse(savedChart().body);
    if (endpoint.path === '/v1/data/visualizations/CH_SYNTHETIC_SAVED/picture') return JSON.parse(fixture('chart-picture.json').body);
    if (endpoint.path !== '/v1/plots/runner') throw new Error(`Unexpected request: ${endpoint.path}`);
    await runnerHeld;
    return JSON.parse(body);
  });
}

// A promise and the function that resolves it.
function held(): Readonly<{ gate: Promise<void>; release: () => void }> {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

describe('Data eval', () => {
  it('evaluates over one year back to today at 1D in one runner call', async () => {
    const { requestBody, body } = fixture('runner-unrate-1y-1d.json');
    const request = runnerAnswering(body);
    const data = createData({
      request,
      now: () => new Date('2026-10-16T12:00:00Z'),
      cacheDirectory: cacheDirectory(),
    });

    const outcome = await data.eval({ expressions: ['FRED(UNRATE).value()'] });

    expect(request.mock.calls.map(([endpoint]) => endpoint.path)).toEqual(['/v1/plots/functions', '/v1/plots/runner', '/v1/charts']);
    expect(request.mock.calls[1]?.[1]?.body).toEqual(requestBody);
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        window: { startDate: '2025-10-16', endDate: '2026-10-16', interval: '1D' },
        results: [{ kind: 'series', expression: 'FRED(UNRATE).value()' }],
        provenance: { assetIds: [], datasets: ['FRED'], tsdbSymbols: [] },
      },
    });
  });

  // Agents re-ran eval with --json only to read when the extremes fell, so
  // Low, High, First and Last each have a date column, and nothing prints above the Statistics;
  // a tie dates its latest occurrence: UNRATE's low of 4.1 fell on 2026-07-01 and 2026-08-01.
  it('dates the Low, High, First and Last in columns of their own, as the Data rows date theirs', async () => {
    const data = createData({
      request: runnerAnswering(fixture('runner-unrate-1y-1d.json').body),
      now: () => new Date('2026-10-16T12:00:00Z'),
      cacheDirectory: cacheDirectory(),
    });

    const { stdout } = await presentDataEval(await data.eval({ expressions: ['FRED(UNRATE).value()'] }), {});

    expect(stdout).toMatch(/^Statistics\nExpressions\tLow\tLow date\tHigh\tHigh date\tFirst\tFirst date\tLast\tLast date\tMedian\t/);
    expect(stdout).toContain('FRED(UNRATE).value()\t4.1\t01 Aug 2026\t4.5\t01 Nov 2025\t4.5\t01 Nov 2025\t4.2\t01 Sep 2026\t');
  });

  it("dates each result's First and Last by its own points where they differ", async () => {
    const data = createData({
      request: runnerAnswering(fixture('runner-assignments.json').body),
      now: () => new Date('2026-10-16T12:00:00Z'),
      cacheDirectory: cacheDirectory(),
    });

    const { stdout } = await presentDataEval(await data.eval({ expressions: ['a = EXMP UW.spot()', 'b = FRED(UNRATE).value()', 'correlation(b, a)'] }), {});
    const [headers = '', ...rows] = stdout.split('\n\n')[0]?.split('\n').slice(1) ?? [];
    const column = (name: string) => headers.split('\t').indexOf(name);

    expect(rows.map((row) => { const cells = row.split('\t'); return [cells[0], cells[column('First date')], cells[column('Last date')]]; })).toEqual([
      ['a = EXMP UW.spot()', '09 Oct 2026', '15 Oct 2026'],
      ['b = FRED(UNRATE).value()', '01 Nov 2025', '01 Sep 2026'],
      ['correlation(b, a)', '01 Jul 2026', '01 Sep 2026'],
    ]);
  });

  // The runner answers `"zscore": {}` for a constant series (live: `first(AAPL UW.spot())`).
  it('takes a constant series\' statistics from the runner, with no z-score', async () => {
    const answer = JSON.parse(fixture('runner-unrate-1y-1d.json').body) as { results: [{ values: unknown }]; statistics: unknown[] };
    const dates = ['2026-10-14', '2026-10-15', '2026-10-16'];
    answer.results[0].values = Object.fromEntries(dates.map((date) => [date, 332.41]));
    answer.statistics = [{
      low: { value: 332.41, keys: dates },
      high: { value: 332.41, keys: dates },
      first: { value: 332.41, keys: ['2026-10-14'] },
      last: { value: 332.41, keys: ['2026-10-16'] },
      median: { value: 332.41 },
      avg: { value: 332.41 },
      stdDev: { value: 0 },
      zscore: {},
      percentile: { value: 66.66666666666667 },
    }];
    const data = createData({
      request: runnerAnswering(JSON.stringify(answer)),
      now: () => new Date('2026-10-16T12:00:00Z'),
      cacheDirectory: cacheDirectory(),
    });

    const outcome = await data.eval({ expressions: ['FRED(UNRATE).value()'] });

    expect(outcome).toMatchObject({
      ok: true,
      value: { results: [{ kind: 'series', statistics: { average: 332.41, standardDeviation: 0, low: { dates } } }] },
    });
    expect(outcome.ok && outcome.value.results[0]).not.toHaveProperty('statistics.zScore');
  });

  it('fails as a command error, naming the cache file, when the fetched function library cannot be cached', async () => {
    // A regular file where the cache directory should be: no catalog can be written under it.
    const blocked = join(cacheDirectory(), 'not-a-directory');
    writeFileSync(blocked, '');
    const data = createData({
      request: runnerAnswering(fixture('runner-unrate-1y-1d.json').body),
      now: () => new Date('2026-10-16T12:00:00Z'),
      cacheDirectory: blocked,
    });

    const presentation = await presentDataEval(await data.eval({ expressions: ['FRED(UNRATE).value()'] }), {});

    expect(presentation).toEqual({
      stdout: '',
      stderr: expect.stringMatching(new RegExp(
        `^Error: Catalog cache unwritable at ${blocked}/plottool-functions\\.json: .+\\. Set MARQUEE_CACHE_DIR to a writable directory\\.\n$`,
      )),
      exitCode: 1,
    });
  });
});

const RUNNER = 'POST /v1/plots/runner';
const PICTURE = 'GET /v1/data/visualizations/CH_SYNTHETIC_SAVED/picture';
const LINK = 'https://marquee.gs.com/s/plottool/CH_SYNTHETIC_SAVED';
const UNRATE = ['FRED(UNRATE).value()'];

// Evaluates through `routes`, with the function library, the UNRATE runner answer and the save
// answered unless overridden, and presents the outcome.
async function presented(
  routes: Readonly<Record<string, Route>>,
  input: Readonly<{ expressions?: readonly string[]; picture?: string }> = {},
  json?: string,
) {
  const request = marquee({
    [FUNCTIONS]: functionLibrary(),
    [RUNNER]: fixture('runner-unrate-1y-1d.json'),
    [CHART]: savedChart(),
    ...routes,
  });
  const data = createData({ request, now: () => new Date('2026-10-16T12:00:00Z'), cacheDirectory: cacheDirectory() });
  const outcome = await data.eval({ expressions: UNRATE, ...input });
  return { request, presentation: await presentDataEval(outcome, json === undefined ? {} : { json }) };
}

// A run saves its Expressions as a PlotTool Pro chart and prints its link, so an answer can cite
// a page a reader opens in Marquee Web (maintainer decision, 2026-10-28).
describe('Data eval saves its chart', () => {
  it('saves the Expressions while the runner runs, then links the chart under the results', async () => {
    const runner = held();
    const request = runnerAnswering(fixture('runner-unrate-1y-1d.json').body, runner.gate);
    const data = createData({ request, now: () => new Date('2026-10-16T12:00:00Z'), cacheDirectory: cacheDirectory() });

    const evaluating = data.eval({ expressions: UNRATE });
    await vi.waitFor(() => {
      expect(request.mock.calls.map(([endpoint]) => endpoint.path)).toContain('/v1/charts');
    });
    runner.release();
    const presentation = await presentDataEval(await evaluating, {});

    expect(request.mock.calls.find(([endpoint]) => endpoint.path === '/v1/charts')?.[1]?.body)
      .toEqual(fixture('chart-created.json').requestBody);
    expect(presentation.stdout).toMatch(/\n01 Nov 2025\t4\.5\n\nurl:\thttps:\/\/marquee\.gs\.com\/s\/plottool\/CH_SYNTHETIC_SAVED\n$/);
    expect(presentation.exitCode).toBeUndefined();
  });

  // Web's editor holds an assignment as a line like any other (live Quickstart charts, 2026-10-28).
  it('saves a batch as Web\'s editor text, the first Expression naming it, each on its own axis', async () => {
    const expressions = ['a = SPX.spot()', 'b = FRED(UNRATE).value()', 'correlation(b, a)'];
    const { request } = await presented({ [RUNNER]: fixture('runner-assignments.json') }, { expressions });

    const [, init] = request.mock.calls.find(([endpoint]) => endpoint.path === '/v1/charts') ?? [];
    expect(init?.body).toEqual({
      name: 'a = SPX.spot()',
      title: 'a = SPX.spot()',
      description: 'a = SPX.spot()\nb = FRED(UNRATE).value()\ncorrelation(b, a)',
      folderName: 'Scratch',
      chartType: 'line',
      expressions: ['Right', 'Right2', 'Right3'].map((axis) => ({ axis, label: '', hide: false, disable: false })),
      relativeStartDate: '-1y',
      relativeEndDate: '0d',
      interval: 'Daily',
      realTime: false,
    });
  });

  it('cycles through Web\'s six axes past the sixth Expression', async () => {
    const expressions = Array.from({ length: 7 }, (_, index) => `FRED(UNRATE).value() + ${index}`);
    const { request } = await presented({ [RUNNER]: fixture('runner-assignments.json') }, { expressions });

    const [, init] = request.mock.calls.find(([endpoint]) => endpoint.path === '/v1/charts') ?? [];
    expect((init?.body as { expressions: { axis: string }[] }).expressions.map(({ axis }) => axis))
      .toEqual(['Right', 'Right2', 'Right3', 'Left', 'Left2', 'Left3', 'Right']);
  });

  it('gives the link as the url field under --json', async () => {
    const { presentation } = await presented({}, {}, 'url');

    expect(presentation).toEqual({ stdout: `{"url":"${LINK}"}\n`, stderr: '' });
  });

  it('still prints the results when the save fails, then fails the command', async () => {
    const { presentation } = await presented({ [CHART]: { status: 503, body: '<html>Service Unavailable</html>' } });

    expect(presentation.stdout).toMatch(/\n01 Nov 2025\t4\.5\n$/);
    expect(presentation.stderr).toBe('Error: PlotTool Pro chart save is unavailable\n');
    expect(presentation.exitCode).toBe(1);
  });

  it('keeps the --json results and leaves url null when the save fails', async () => {
    const { presentation } = await presented({ [CHART]: { status: 503, body: '' } }, {}, 'url,startDate');

    expect(presentation).toEqual({
      stdout: '{"startDate":"2025-10-16","url":null}\n',
      stderr: 'Error: PlotTool Pro chart save is unavailable\n',
      exitCode: 1,
    });
  });

  it('says access is denied when Marquee refuses the save', async () => {
    const { presentation } = await presented({ [CHART]: { status: 403, body: '{"message":"Forbidden"}' } });

    expect(presentation.stderr).toBe('Error: Access denied: PlotTool Pro chart save\n');
  });

  it('fails loud on a save answered without the chart id', async () => {
    const { presentation } = await presented({ [CHART]: { status: 200, body: '{"name":"FRED(UNRATE).value()"}' } });

    expect(presentation.stderr).toBe('Error: PlotTool Pro chart save returned malformed results at id: expected the chart id\n');
    expect(presentation.exitCode).toBe(1);
  });

  it('writes the chart\'s PNG to --picture, fetched once the chart is saved and while the runner runs', async () => {
    const runner = held();
    const request = runnerAnswering(fixture('runner-unrate-1y-1d.json').body, runner.gate);
    const data = createData({ request, now: () => new Date('2026-10-16T12:00:00Z'), cacheDirectory: cacheDirectory() });
    const picture = join(cacheDirectory(), 'unrate.png');

    const evaluating = data.eval({ expressions: UNRATE, picture });
    await vi.waitFor(() => {
      expect(sentRequests(request)).toEqual([FUNCTIONS, RUNNER, CHART, PICTURE]);
    });
    runner.release();
    const presentation = await presentDataEval(await evaluating, {});

    expect(readFileSync(picture).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(presentation.stdout).toMatch(new RegExp(`\\n\\nurl:\\t${LINK}\\npicture:\\t${picture}\\n$`));
    expect(presentation.exitCode).toBeUndefined();
  });

  it('gives the file as the picture field under --json', async () => {
    const picture = join(cacheDirectory(), 'unrate.png');
    const { presentation } = await presented({ [PICTURE]: fixture('chart-picture.json') }, { picture }, 'picture,url');

    expect(presentation).toEqual({ stdout: `{"picture":"${picture}","url":"${LINK}"}\n`, stderr: '' });
  });

  it('still links the chart when its picture cannot be fetched, then fails the command', async () => {
    const picture = join(cacheDirectory(), 'unrate.png');
    const { presentation } = await presented({ [PICTURE]: { status: 504, body: '' } }, { picture });

    expect(presentation.stdout).toMatch(new RegExp(`\\n\\nurl:\\t${LINK}\\n$`));
    expect(presentation.stderr).toBe('Error: PlotTool Pro chart picture is unavailable\n');
    expect(presentation.exitCode).toBe(1);
  });

  it('fails loud on a picture that is not a PNG data URL', async () => {
    const picture = join(cacheDirectory(), 'unrate.png');
    const { presentation } = await presented({ [PICTURE]: { status: 200, body: '{"value":"<svg/>"}' } }, { picture });

    expect(presentation.stderr).toBe(
      'Error: PlotTool Pro chart picture returned malformed results at value: expected a data:image/png;base64, URL\n',
    );
  });

  it('names the file a picture cannot be written to', async () => {
    const picture = join(cacheDirectory(), 'missing', 'unrate.png');
    const { presentation } = await presented({ [PICTURE]: fixture('chart-picture.json') }, { picture });

    expect(presentation.stdout).toMatch(new RegExp(`\\n\\nurl:\\t${LINK}\\n$`));
    expect(presentation.stderr).toMatch(new RegExp(`^Error: Picture unwritable at ${picture}: ENOENT`));
    expect(presentation.exitCode).toBe(1);
  });

  it('saves no chart when the function library rejects every Expression', async () => {
    const { request } = await presented({}, { expressions: ['nosuchfunction(1)'] });

    expect(sentRequests(request)).toEqual([FUNCTIONS]);
  });
});
