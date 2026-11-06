import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
} from './support.js';

const RUNNER = 'POST /v1/plots/runner';
const TODAY = new Date('2026-10-16T12:00:00Z');

// A batch with variable assignments.
const ASSIGNMENTS = ['a = EXMP UW.spot()', 'b = FRED(UNRATE).value()', 'correlation(b, a)'];

function assignments(): Answer {
  return fixture('runner-assignments.json');
}

describe('Data eval checks Expressions against the function library first', () => {
  it('rejects an unknown function as usage before the runner call and names the nearest one', async () => {
    const request = marquee({ [FUNCTIONS]: functionLibrary() });
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const outcome = await data.eval({
      expressions: ['FRED(UNRATE).value()', 'zscore(FRED(UNRATE).value(), 1y)'],
    });

    expect(sentRequests(request)).toEqual([FUNCTIONS]);
    expect(await presentDataEval(outcome, {})).toEqual({
      stdout: '',
      stderr: [
        'Error: zscore(FRED(UNRATE).value(), 1y): zscore is not a PlotTool Pro function',
        'Hints for zscore(FRED(UNRATE).value(), 1y):',
        '  Nearest functions:',
        '    zscores(x, w)',
        '',
      ].join('\n'),
      exitCode: 1,
      usage: true,
    });
  });

  // Agents guessed Class names from other tools (e2e harness round 1).
  it('lists the Classes and the search for its words when an unknown name is called like a Class', async () => {
    const request = marquee({ [FUNCTIONS]: functionLibrary() });
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const outcome = await data.eval({ expressions: ['Stock("AAPL UW").price()', 'ECON("LNS14000000").value()'] });

    expect(sentRequests(request)).toEqual([FUNCTIONS]);
    expect((await presentDataEval(outcome, {})).stderr).toBe([
      'Error: Stock("AAPL UW").price(): Stock is not a PlotTool Pro function',
      'Error: ECON("LNS14000000").value(): ECON is not a PlotTool Pro function',
      'Hints for Stock("AAPL UW").price():',
      '  Classes an Expression constructs: Asset, Country, RiskModel, Subdivision, Kpi, Portfolio, FRED, HAVER, MarketCoordinate, TSDB, Dataset',
      '  Find the id: marquee data search "AAPL UW"',
      'Hints for ECON("LNS14000000").value():',
      '  Classes an Expression constructs: Asset, Country, RiskModel, Subdivision, Kpi, Portfolio, FRED, HAVER, MarketCoordinate, TSDB, Dataset',
      '  Find the id: marquee data search LNS14000000',
      '',
    ].join('\n'));
  });

  it('points a quoted Entity id to its unquoted form', async () => {
    const request = marquee({ [FUNCTIONS]: functionLibrary() });
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const outcome = await data.eval({ expressions: ['"AAPL UW".spot()'] });

    expect(sentRequests(request)).toEqual([FUNCTIONS]);
    expect((await presentDataEval(outcome, {})).stderr).toBe([
      'Error: "AAPL UW".spot(): "AAPL UW" is quoted text, not an Entity',
      'Hints for "AAPL UW".spot():',
      '  Write the Entity id unquoted: AAPL UW.spot()',
      '',
    ].join('\n'));
  });

  it('rejects more arguments than a function takes as usage before the runner call, with its signature', async () => {
    const request = marquee({ [FUNCTIONS]: functionLibrary() });
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const outcome = await data.eval({
      expressions: ['moving_average(FRED(UNRATE).value(), 3m, 4, 5)'],
    });

    expect(sentRequests(request)).toEqual([FUNCTIONS]);
    expect(await presentDataEval(outcome, {})).toEqual({
      stdout: '',
      stderr: [
        'Error: moving_average(FRED(UNRATE).value(), 3m, 4, 5): moving_average takes at most 2 arguments, got 4',
        'Hints for moving_average(FRED(UNRATE).value(), 3m, 4, 5):',
        '  moving_average(x, w)',
        '',
      ].join('\n'),
      exitCode: 1,
      usage: true,
    });
  });

  it('shows each parameter\'s allowed values and default in a signature', async () => {
    const request = marquee({ [FUNCTIONS]: functionLibrary() });
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const outcome = await data.eval({
      expressions: ['add(FRED(UNRATE).value(), 1, step, 4)'],
    });

    expect((await presentDataEval(outcome, {})).stderr).toBe([
      'Error: add(FRED(UNRATE).value(), 1, step, 4): add takes at most 3 arguments, got 4',
      'Hints for add(FRED(UNRATE).value(), 1, step, 4):',
      '  add(x, y, method)',
      '    method: intersect | step (default) | nan | zero | time',
      '',
    ].join('\n'));
  });
});

describe('Data eval caches the function library on disk for a day', () => {
  it('fetches the library on a cold call, then costs one runner call per valid batch', async () => {
    const directory = cacheDirectory();
    const cold = marquee({ [FUNCTIONS]: functionLibrary(), [RUNNER]: assignments(), [CHART]: savedChart() });
    const warm = marquee({ [RUNNER]: assignments(), [CHART]: savedChart() });

    const first = await createData({ request: cold, now: () => TODAY, cacheDirectory: directory })
      .eval({ expressions: ASSIGNMENTS });
    const second = await createData({ request: warm, now: () => TODAY, cacheDirectory: directory })
      .eval({ expressions: ASSIGNMENTS });

    expect(sentRequests(cold)).toEqual([FUNCTIONS, RUNNER, CHART]);
    expect(sentRequests(warm)).toEqual([RUNNER, CHART]);
    expect(first.ok && second.ok).toBe(true);
  });

  it('fetches the library again once a day has passed', async () => {
    const directory = cacheDirectory();
    const routes = { [FUNCTIONS]: functionLibrary(), [RUNNER]: assignments(), [CHART]: savedChart() };
    await createData({ request: marquee(routes), now: () => TODAY, cacheDirectory: directory })
      .eval({ expressions: ASSIGNMENTS });

    const withinTheDay = marquee(routes);
    await createData({
      request: withinTheDay,
      now: () => new Date('2026-10-17T11:59:59Z'),
      cacheDirectory: directory,
    }).eval({ expressions: ASSIGNMENTS });
    const aDayLater = marquee(routes);
    await createData({
      request: aDayLater,
      now: () => new Date('2026-10-17T12:00:00Z'),
      cacheDirectory: directory,
    }).eval({ expressions: ASSIGNMENTS });

    expect(sentRequests(withinTheDay)).toEqual([RUNNER, CHART]);
    expect(sentRequests(aDayLater)).toEqual([FUNCTIONS, RUNNER, CHART]);
  });

  it('fails the batch when the function library cannot be fetched', async () => {
    const request = marquee({ [FUNCTIONS]: { status: 503, body: '<html>Service Unavailable</html>' } });
    const data = createData({ request, now: () => TODAY, cacheDirectory: cacheDirectory() });

    const outcome = await data.eval({ expressions: ASSIGNMENTS });

    expect(sentRequests(request)).toEqual([FUNCTIONS]);
    expect(await presentDataEval(outcome, {})).toEqual({
      stdout: '',
      stderr: 'Error: PlotTool Pro\'s function library is unavailable\n',
      exitCode: 1,
    });
  });

  it('reports an unreadable cache file instead of guessing', async () => {
    const directory = cacheDirectory();
    writeFileSync(join(directory, 'plottool-functions.json'), '{"version": 1, "fetchedAt": ');
    const request = marquee({});

    const outcome = await createData({ request, now: () => TODAY, cacheDirectory: directory })
      .eval({ expressions: ASSIGNMENTS });

    expect(sentRequests(request)).toEqual([]);
    expect(await presentDataEval(outcome, {})).toEqual({
      stdout: '',
      stderr: `Error: Catalog cache unreadable at ${join(directory, 'plottool-functions.json')}: expected JSON. Delete it and retry.\n`,
      exitCode: 1,
    });
  });
});
