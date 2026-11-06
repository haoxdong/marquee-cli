import type { DataDate, DataEvalWindow, DataInterval } from './types.js';

/** The spellings `--start-date` and `--end-date` accept, as PlotTool Pro stores them. */
export const DATA_DATE_FORMS = '-<n>d, -<n>w, -<n>m, -<n>y, -ytd, -max, 0d, +<n>d, +<n>w, +<n>m, +<n>y or YYYY-MM-DD';

export const DATA_INTERVALS = ['1D', '1W', '1M'] as const;

const DEFAULT_START: DataDate = { kind: 'back', amount: 1, unit: 'y' };
const TODAY: DataDate = { kind: 'back', amount: 0, unit: 'd' };

// Web sends Weekly as `7D`; the runner answers 500 for `1W` on every Expression (live, 2026-10-16).
const RUNNER_INTERVALS: Readonly<Record<DataInterval, string>> = { '1D': '1D', '1W': '7D', '1M': '1M' };

// A saved chart names its interval (live, 2026-10-28: Web's charts store `Daily`).
const CHART_INTERVALS: Readonly<Record<DataInterval, string>> = { '1D': 'Daily', '1W': 'Weekly', '1M': 'Monthly' };

/** The window as given, each value defaulted but not resolved against today. */
export type DataStoredWindow = Readonly<{ startDate: DataDate; endDate: DataDate; interval: DataInterval }>;

/** A `--start-date`/`--end-date` value, or undefined when it is none of `DATA_DATE_FORMS`. */
export function parseDataDate(token: string): DataDate | undefined {
  if (token === '-max') return { kind: 'max' };
  if (token === '-ytd') return { kind: 'prior-year-end' };
  if (token === '0d') return TODAY;
  const relative = /^-(\d{1,3})([dwmy])$/.exec(token);
  if (relative) {
    return { kind: 'back', amount: Number(relative[1]), unit: relative[2] as 'd' | 'w' | 'm' | 'y' };
  }
  // Web's Charts store a forward end both signed and bare (`+5y`, `30y`), as the runner's errors ask (`[0d, 3y]`).
  const ahead = /^\+?([1-9]\d{0,2})([dwmy])$/.exec(token);
  if (ahead) {
    return { kind: 'ahead', amount: Number(ahead[1]), unit: ahead[2] as 'd' | 'w' | 'm' | 'y' };
  }
  return isCalendarDate(token) ? { kind: 'date', date: token } : undefined;
}

/** An `--interval` value in either case, as `1w` is typed as often as `1W`; undefined when none. */
export function parseDataInterval(token: string): DataInterval | undefined {
  return DATA_INTERVALS.find((interval) => interval === token.toUpperCase());
}

/** The window, defaulting to `-1y` through `0d` at `1D` (ADR 0084). */
export function dataStoredWindow(
  window: Readonly<{ startDate?: DataDate; endDate?: DataDate; interval?: DataInterval }>,
): DataStoredWindow {
  return {
    startDate: window.startDate ?? DEFAULT_START,
    endDate: window.endDate ?? TODAY,
    interval: window.interval ?? '1D',
  };
}

/** The absolute window for the runner. */
export function dataEvalWindow(
  now: Date,
  window: Readonly<{ startDate?: DataDate; endDate?: DataDate; interval?: DataInterval }>,
): DataEvalWindow {
  const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  const stored = dataStoredWindow(window);
  return {
    startDate: resolve(stored.startDate, today),
    endDate: resolve(stored.endDate, today),
    interval: stored.interval,
  };
}

export function runnerInterval(interval: DataInterval): string {
  return RUNNER_INTERVALS[interval];
}

export function chartInterval(interval: DataInterval): string {
  return CHART_INTERVALS[interval];
}

/** A relative date in the spelling `parseDataDate` reads, as PlotTool Pro stores it. */
export function relativeDateSpelling(date: Exclude<DataDate, { kind: 'date' }>): string {
  switch (date.kind) {
    case 'max':
      return '-max';
    case 'prior-year-end':
      return '-ytd';
    case 'back':
      return date.amount === 0 && date.unit === 'd' ? '0d' : `-${date.amount}${date.unit}`;
    case 'ahead':
      return `${date.amount}${date.unit}`;
  }
}

/**
 * The last day on or before `date` (`YYYY-MM-DD`) that ends a month on a weekday: the runner
 * answers `1M` only for a window ending on one (live, 2026-11-05: 2026-09-30 and
 * 2026-08-31 answer; 2026-10-30, 2026-10-31, 2026-02-27 and 2026-02-28 answer 500).
 */
export function weekdayMonthEndOnOrBefore(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const monthEnd = (back: number) => new Date(Date.UTC(year, month - back, 0));
  const latest = (back: number): Date => (monthEnd(back).getUTCDay() % 6 === 0 ? latest(back + 1) : monthEnd(back));
  const end = latest(monthEnd(0).getUTCDate() === day ? 0 : 1);
  return formatDay({ year: end.getUTCFullYear(), month: end.getUTCMonth(), day: end.getUTCDate() });
}

type LocalDay = Readonly<{ year: number; month: number; day: number }>;

// Web's resolution (live, 2026-10-16): calendar arithmetic on today's local date like
// moment's `add`, no business-day adjustment; `-1d` is today, `-ytd` the prior year end,
// `-max` the fixed 1970-01-01.
function resolve(date: DataDate, today: LocalDay): string {
  switch (date.kind) {
    case 'date':
      return date.date;
    case 'max':
      return '1970-01-01';
    case 'prior-year-end':
      return formatDay({ year: today.year - 1, month: 11, day: 31 });
    case 'back':
      return formatDay(backFrom(today, date.amount, date.unit));
    case 'ahead':
      return formatDay(backFrom(today, -date.amount, date.unit));
  }
}

function backFrom(today: LocalDay, amount: number, unit: 'd' | 'w' | 'm' | 'y'): LocalDay {
  if (unit === 'w') return daysBack(today, amount * 7);
  // Web resolves `-1d` to today.
  if (unit === 'd') return daysBack(today, amount === 1 ? 0 : amount);
  const months = today.year * 12 + today.month - (unit === 'y' ? amount * 12 : amount);
  const year = Math.floor(months / 12);
  const month = months - year * 12;
  // Like moment, a day the target month lacks falls back to its last day.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { year, month, day: Math.min(today.day, lastDay) };
}

function daysBack(today: LocalDay, days: number): LocalDay {
  const shifted = new Date(Date.UTC(today.year, today.month, today.day - days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function isCalendarDate(token: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (!match) return false;
  const day = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
  // A day the month lacks rolls over into the next month, so it no longer reads back the same.
  return formatDay(daysBack(day, 0)) === token;
}

function formatDay(day: LocalDay): string {
  return [
    String(day.year).padStart(4, '0'),
    String(day.month + 1).padStart(2, '0'),
    String(day.day).padStart(2, '0'),
  ].join('-');
}
