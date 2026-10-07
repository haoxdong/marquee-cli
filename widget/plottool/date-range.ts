import { requiredGroup } from '../../lib/regex-group.js';
import type { PlotToolWindow, PlotToolWindowUnit } from './types.js';

export type PlotToolDateRangeChart = Readonly<{
  interval: string;
  window: PlotToolWindow;
  endDate?: string;
  isRealTime?: boolean;
  timeSettings?: Readonly<{
    start: string;
    end: string;
    timezone: string;
  }>;
}>;

type PlotToolResolvedDateRange =
  | Readonly<{
      kind: 'calendar';
      start: string;
      end: string;
      interval: string;
    }>
  | Readonly<{
      kind: 'real-time';
      start: string;
      end: string;
      interval: string;
      timeFilter: Readonly<{ start: string; end: string; timeZone: string }>;
    }>;

type PlotToolDateRangeResult =
  | Readonly<{ ok: true; value: PlotToolResolvedDateRange }>
  | Readonly<{ ok: false; error: PlotToolDateRangeFailure }>;

export type PlotToolDateRangeProblem =
  | 'invalid-clock'
  | 'unsupported-window'
  | 'unsupported-interval'
  | 'invalid-time-settings';

type PlotToolDateRangeFailure = Readonly<{
  problem: PlotToolDateRangeProblem;
  reason: string;
}>;

export function resolvePlotToolDateRange(
  chart: PlotToolDateRangeChart,
  now: Date,
): PlotToolDateRangeResult {
  if (Number.isNaN(now.getTime())) {
    return invalidDateRange('invalid-clock', 'PlotTool Pro clock is invalid');
  }
  if (chart.isRealTime === true) return realTimeWindow(chart, now);

  const start = plotToolStartDate(chart, now);
  if (!start.ok) return start;
  const end = /^\d{4}-\d{2}-\d{2}/.test(chart.endDate ?? '')
    ? new Date(`${String(chart.endDate).slice(0, 10)}T00:00:00`)
    : new Date(now);
  const relativeEnd = chart.window.end;
  if (relativeEnd?.kind === 'offset') {
    applyRelativeOffset(end, relativeEnd.amount, relativeEnd.unit);
  }
  const interval = executionInterval(chart.interval);
  if (!interval) {
    return invalidDateRange('unsupported-interval', `unsupported interval ${chart.interval}`);
  }
  return {
    ok: true,
    value: {
      kind: 'calendar',
      start: localDateString(start.value),
      end: localDateString(end),
      interval,
    },
  };
}

function plotToolStartDate(
  chart: PlotToolDateRangeChart,
  now: Date,
): Readonly<{ ok: true; value: Date }> | Readonly<{ ok: false; error: PlotToolDateRangeFailure }> {
  const start = new Date(now);
  const relativeStart = chart.window.start;
  const startDate = chart.window.startDate === undefined
    ? null
    : /^(\d{4})-(\d{2})-(\d{2})/.exec(chart.window.startDate);
  if (relativeStart?.kind === 'max') {
    start.setFullYear(start.getFullYear() - 100);
  } else if (relativeStart?.kind === 'year-start') {
    start.setMonth(0, 1);
  } else if (relativeStart?.kind === 'prior-year-end') {
    start.setFullYear(start.getFullYear() - 1, 11, 31);
  } else if (relativeStart?.kind === 'offset') {
    applyRelativeOffset(
      start,
      relativeStart.direction === 'back' ? -relativeStart.amount : relativeStart.amount,
      relativeStart.unit,
    );
  } else if (relativeStart?.kind === 'today') {
    return { ok: true, value: start };
  } else if (startDate) {
    start.setFullYear(
      Number(requiredGroup(startDate, 1)),
      Number(requiredGroup(startDate, 2)) - 1,
      Number(requiredGroup(startDate, 3)),
    );
  } else {
    return invalidDateRange('unsupported-window', 'Chart has no supported start date');
  }
  return { ok: true, value: start };
}

function realTimeWindow(
  chart: PlotToolDateRangeChart,
  now: Date,
): PlotToolDateRangeResult {
  if (chart.window.end?.kind !== 'today') {
    return invalidDateRange('unsupported-window', 'unsupported real-time relative end');
  }
  const settings = chart.timeSettings;
  if (!settings) {
    return invalidDateRange(
      'invalid-time-settings',
      'real-time Chart has no time settings',
    );
  }
  if (!isClockTime(settings.start) || !isClockTime(settings.end)) {
    return invalidDateRange(
      'invalid-time-settings',
      'real-time Chart has an invalid time setting',
    );
  }
  const interval = /^(\d+) min$/.exec(chart.interval)?.[1];
  if (!interval && chart.interval !== 'Tick') {
    return invalidDateRange(
      'unsupported-interval',
      `unsupported real-time interval ${chart.interval}`,
    );
  }
  let startTime: string;
  const relativeStart = chart.window.start;
  if (relativeStart?.kind === 'today') {
    try {
      startTime = realTimeStartIso(now, settings.timezone, settings.start);
    } catch (error) {
      if (error instanceof RangeError) {
        return invalidDateRange(
          'invalid-time-settings',
          'real-time Chart has an invalid time setting',
        );
      }
      throw error;
    }
  } else {
    if (
      relativeStart?.kind !== 'offset'
      || relativeStart.direction !== 'back'
      || relativeStart.unit !== 'd'
    ) {
      return invalidDateRange('unsupported-window', 'unsupported real-time relative start');
    }
    startTime = new Date(now.getTime() - relativeStart.amount * 86_400_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
  }
  return {
    ok: true,
    value: {
      kind: 'real-time',
      start: startTime,
      end: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      interval: interval ? `${interval}m` : chart.interval,
      timeFilter: {
        start: settings.start,
        end: settings.end,
        timeZone: settings.timezone,
      },
    },
  };
}

function executionInterval(interval: string): string | undefined {
  const named = ({
    Daily: '1D',
    Weekly: '1W',
    Monthly: '1M',
    Quarterly: '3M',
    Yearly: '1Y',
  } as Record<string, string>)[interval];
  if (named) return named;
  return /^\d+(?:m|D|W|M|Y)$/i.test(interval)
    ? interval.replace(/d/i, 'D').replace(/w/i, 'W').replace(/y/i, 'Y')
    : undefined;
}

function realTimeStartIso(now: Date, timeZone: string, start: string): string {
  const [hours, minutes, seconds] = start.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value);
  const localMillis = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    hours,
    minutes,
    seconds,
  );
  let utcMillis = localMillis;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMillis = timeZoneOffsetMinutes(new Date(utcMillis), timeZone) * 60_000;
    const nextUtcMillis = localMillis - offsetMillis;
    if (nextUtcMillis === utcMillis) break;
    utcMillis = nextUtcMillis;
  }
  return new Date(utcMillis).toISOString().replace('.000Z', 'Z');
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const raw = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
  const normalized = String(raw)
    .replace(/^GMT$/, 'GMT+0')
    .replace(/^(GMT[+-]\d{1,2})$/, '$1:00');
  const match = /^GMT([+-])(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) throw new RangeError(`Unsupported time zone ${timeZone}`);
  const offset = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -offset : offset;
}

function isClockTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return !!match
    && Number(match[1]) <= 23
    && Number(match[2]) <= 59
    && Number(match[3]) <= 59;
}

function applyRelativeOffset(date: Date, amount: number, unit: PlotToolWindowUnit): void {
  if (unit === 'y') date.setFullYear(date.getFullYear() + amount);
  else if (unit === 'm') date.setMonth(date.getMonth() + amount);
  else date.setDate(date.getDate() + amount);
}

function localDateString(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function invalidDateRange(
  problem: PlotToolDateRangeProblem,
  reason: string,
): Readonly<{ ok: false; error: PlotToolDateRangeFailure }> {
  return { ok: false, error: { problem, reason } };
}
