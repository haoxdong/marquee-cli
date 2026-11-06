import { describe, expect, it, vi } from 'vitest';
import type { Endpoint } from '../../transport/index.js';
import { createData, parseDataDate, type DataEvalInput } from '../index.js';
import { cacheDirectory, fixture, functionLibrary } from './support.js';

// Any well-formed runner answer: these tests read only the request.
const RUNNER_ANSWER: unknown = JSON.parse(fixture('runner-unrate-1y-1d.json').body);

const LIBRARY: unknown = JSON.parse(functionLibrary().body);

const ANSWERS: Readonly<Record<string, unknown>> = {
  '/v1/plots/functions': LIBRARY,
  '/v1/plots/runner': RUNNER_ANSWER,
  '/v1/charts': { id: 'CH_SYNTHETIC_SAVED' },
};

// The body eval sent to `path`.
async function sent(path: string, today: string, input: Omit<DataEvalInput, 'expressions'>) {
  const request = vi.fn(async (endpoint: Endpoint, _init?: Readonly<{ body?: unknown }>) => ANSWERS[endpoint.path]);
  const data = createData({ request, now: () => new Date(`${today}T12:00:00`), cacheDirectory: cacheDirectory() });
  await data.eval({ expressions: ['FRED(UNRATE).value()'], ...input });
  const call = request.mock.calls.find(([endpoint]) => endpoint.path === path);
  return call?.[1]?.body as Readonly<Record<string, unknown>>;
}

async function runnerWindow(today: string, input: Omit<DataEvalInput, 'expressions'>) {
  const body = await sent('/v1/plots/runner', today, input);
  return { startDate: body.startDate, endDate: body.endDate, interval: body.interval };
}

// The window fields of the chart eval saves.
async function chartWindow(input: Omit<DataEvalInput, 'expressions'>) {
  const body = await sent('/v1/charts', '2026-10-16', input);
  return Object.fromEntries(['relativeStartDate', 'relativeEndDate', 'startDate', 'endDate', 'interval']
    .filter((key) => key in body)
    .map((key) => [key, body[key]]));
}

function date(token: string) {
  const parsed = parseDataDate(token);
  if (parsed === undefined) throw new Error(`unparsed ${token}`);
  return parsed;
}

describe('Data eval window', () => {
  // Web's resolution on 2026-10-16 (live PlotTool Pro, apis.md "Web relative-date resolution").
  it.each([
    ['-1y', '2025-10-16'],
    ['-3y', '2023-10-16'],
    ['-10y', '2016-10-16'],
    ['-6m', '2026-04-16'],
    ['-3m', '2026-07-16'],
    ['-2w', '2026-10-02'],
    ['-5d', '2026-10-11'],
    ['-1d', '2026-10-16'],
    ['0d', '2026-10-16'],
    ['-ytd', '2025-12-31'],
    ['-max', '1970-01-01'],
    ['2020-02-29', '2020-02-29'],
  ])('resolves --start-date %s to %s as Web does', async (token, expected) => {
    expect((await runnerWindow('2026-10-16', { startDate: date(token) })).startDate).toBe(expected);
  });

  it('defaults to -1y through 0d at 1D', async () => {
    expect(await runnerWindow('2026-10-16', {})).toEqual({
      startDate: '2025-10-16',
      endDate: '2026-10-16',
      interval: '1D',
    });
  });

  it('resolves --end-date like --start-date', async () => {
    expect((await runnerWindow('2026-10-16', { endDate: date('-1m') })).endDate).toBe('2026-09-16');
  });

  // A term structure's points lie ahead of today; Web's Charts store such ends as `+5y` and `30y`.
  it.each([
    ['3y', '2029-10-16'],
    ['+6m', '2027-04-16'],
    ['+2w', '2026-10-30'],
    ['1d', '2026-10-17'],
  ])('resolves the forward --end-date %s to %s', async (token, expected) => {
    expect((await runnerWindow('2026-10-16', { startDate: date('0d'), endDate: date(token) })).endDate).toBe(expected);
  });

  // moment's `add(-n, unit)` keeps the day of month, falling back to the month's last day.
  it.each([
    ['2026-03-31', '-1m', '2026-02-28'],
    ['2028-02-29', '-1y', '2027-02-28'],
    ['2026-01-15', '-2m', '2025-11-15'],
  ])('on %s resolves %s to %s', async (today, token, expected) => {
    expect((await runnerWindow(today, { startDate: date(token) })).startDate).toBe(expected);
  });

  // Web sends Weekly as 7D; the runner answers 500 for 1W at every Expression (live, 2026-10-16).
  it.each([
    ['1D', '1D'],
    ['1W', '7D'],
    ['1M', '1M'],
  ] as const)('sends --interval %s to the runner as %s', async (interval, wire) => {
    expect((await runnerWindow('2026-10-16', { interval })).interval).toBe(wire);
  });

  it.each(['yesterday', '+0y', '-1q', '-1000d', '1000d', 'ytd', '2026-02-30', '2026-1-05'])(
    'refuses the date %s',
    (token) => {
      expect(parseDataDate(token)).toBeUndefined();
    },
  );

  // A saved chart keeps the window as given, so it rolls forward as Web's do (live, 2026-10-28).
  it('saves the default window unresolved, as Web stores it', async () => {
    expect(await chartWindow({})).toEqual({ relativeStartDate: '-1y', relativeEndDate: '0d', interval: 'Daily' });
  });

  it.each(['-10y', '-6m', '-2w', '-5d', '-1d', '0d', '-ytd', '-max'])(
    'saves --start-date %s as the chart\'s relative start',
    async (token) => {
      expect((await chartWindow({ startDate: date(token) })).relativeStartDate).toBe(token);
    },
  );

  // Web stores a forward end unsigned, as `30y` (51aee0342).
  it('saves a forward --end-date as the chart\'s relative end', async () => {
    expect(await chartWindow({ startDate: date('0d'), endDate: date('3y') })).toEqual({
      relativeStartDate: '0d',
      relativeEndDate: '3y',
      interval: 'Daily',
    });
  });

  // Web's Quickstart charts mix an absolute start with a relative end (live, 2026-10-28).
  it('saves calendar dates as the chart\'s start and end dates', async () => {
    expect(await chartWindow({ startDate: date('2026-01-02'), endDate: date('2026-09-30') })).toEqual({
      startDate: '2026-01-02',
      endDate: '2026-09-30',
      interval: 'Daily',
    });
    expect(await chartWindow({ startDate: date('2026-01-02') })).toEqual({
      startDate: '2026-01-02',
      relativeEndDate: '0d',
      interval: 'Daily',
    });
  });

  it.each([
    ['1D', 'Daily'],
    ['1W', 'Weekly'],
    ['1M', 'Monthly'],
  ] as const)('saves --interval %s as the chart\'s %s', async (interval, named) => {
    expect((await chartWindow({ interval })).interval).toBe(named);
  });
});
