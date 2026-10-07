import { describe, expect, it } from 'vitest';
import { resolvePlotToolDateRange } from '../date-range.js';
import type { PlotToolWindow } from '../types.js';
import { parsePlotToolWindow } from '../window.js';

function window(
  relativeStartDate?: string,
  relativeEndDate?: string,
  startDate?: string,
): PlotToolWindow {
  const parsed = parsePlotToolWindow({
    relativeStartDate,
    relativeEndDate,
    ...(startDate !== undefined ? { startDate } : {}),
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

describe('PlotTool Pro date range', () => {
  it.each([
    ['spring transition', '2026-03-08T16:00:00Z', '2026-03-08T05:00:00Z'],
    ['fall transition', '2026-11-01T16:00:00Z', '2026-11-01T04:00:00Z'],
  ])('resolves the %s using the offset at the local start', (_name, now, start) => {
    expect(
      resolvePlotToolDateRange(
        {
          interval: '1 min',
          window: window('0d', '0d'),
          isRealTime: true,
          timeSettings: {
            start: '00:00:00',
            end: '23:59:59',
            timezone: 'America/New_York',
          },
        },
        new Date(now),
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: 'real-time',
        start,
        end: now,
        interval: '1m',
        timeFilter: {
          start: '00:00:00',
          end: '23:59:59',
          timeZone: 'America/New_York',
        },
      },
    });
  });

  it('starts the provider unsigned year-to-date spelling at the prior year end, as Marquee Web does', () => {
    expect(
      resolvePlotToolDateRange(
        { interval: 'Daily', window: window('ytd', '0d') },
        new Date('2026-08-09T12:00:00'),
      ),
    ).toEqual({
      ok: true,
      value: { kind: 'calendar', start: '2025-12-31', end: '2026-08-09', interval: '1D' },
    });
  });

  it.each([
    ['-max', '0d', undefined, '1926-08-09', '2026-08-09'],
    ['-ytd', '0d', undefined, '2026-01-01', '2026-08-09'],
    ['0d', '0d', undefined, '2026-08-09', '2026-08-09'],
    ['-3m', '-0d', undefined, '2026-05-09', '2026-08-09'],
    ['-2d', '0d', undefined, '2026-08-07', '2026-08-09'],
    ['+1m', '+5y', undefined, '2026-09-09', '2031-08-09'],
    ['-1y', '30y', undefined, '2025-08-09', '2056-08-09'],
    ['-1y', '+8m', undefined, '2025-08-09', '2027-04-09'],
    ['-1y', '+3d', undefined, '2025-08-09', '2026-08-12'],
    [undefined, '0d', '2021-02-03T00:00:00Z', '2021-02-03', '2026-08-09'],
  ])('resolves start %s, end %s, start date %s to %s .. %s', (
    relativeStartDate,
    relativeEndDate,
    startDate,
    start,
    end,
  ) => {
    expect(
      resolvePlotToolDateRange(
        { interval: 'Daily', window: window(relativeStartDate, relativeEndDate, startDate) },
        new Date('2026-08-09T12:00:00'),
      ),
    ).toEqual({ ok: true, value: { kind: 'calendar', start, end, interval: '1D' } });
  });

  it('adds the relative end to a saved end date', () => {
    expect(
      resolvePlotToolDateRange(
        { interval: 'Daily', window: window('-1y', '+1y'), endDate: '2030-01-02T00:00:00Z' },
        new Date('2026-08-09T12:00:00'),
      ),
    ).toEqual({
      ok: true,
      value: { kind: 'calendar', start: '2025-08-09', end: '2031-01-02', interval: '1D' },
    });
  });

  it('fails on an invalid clock', () => {
    expect(
      resolvePlotToolDateRange({ interval: 'Daily', window: window('-1y', '0d') }, new Date(Number.NaN)),
    ).toEqual({
      ok: false,
      error: { problem: 'invalid-clock', reason: 'PlotTool Pro clock is invalid' },
    });
  });

  it.each([undefined, 'soon', 'x2021-02-03'])('fails without a start (start date %s)', (startDate) => {
    expect(
      resolvePlotToolDateRange(
        { interval: 'Daily', window: window(undefined, '0d', startDate) },
        new Date('2026-08-09T12:00:00'),
      ),
    ).toEqual({
      ok: false,
      error: { problem: 'unsupported-window', reason: 'Chart has no supported start date' },
    });
  });

  it('starts a real-time lookback that many days before now', () => {
    expect(
      resolvePlotToolDateRange(
        {
          interval: 'Tick',
          window: window('-2d', '0d'),
          isRealTime: true,
          timeSettings: { start: '09:30:00', end: '16:00:00', timezone: 'America/New_York' },
        },
        new Date('2026-08-09T12:00:00Z'),
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: 'real-time',
        start: '2026-08-07T12:00:00Z',
        end: '2026-08-09T12:00:00Z',
        interval: 'Tick',
        timeFilter: { start: '09:30:00', end: '16:00:00', timeZone: 'America/New_York' },
      },
    });
  });

  it.each([
    ['-1d', '-0d', 'unsupported real-time relative end'],
    ['-1d', '+1d', 'unsupported real-time relative end'],
    ['-1m', '0d', 'unsupported real-time relative start'],
    ['+1d', '0d', 'unsupported real-time relative start'],
    ['-max', '0d', 'unsupported real-time relative start'],
  ])('rejects the real-time window %s .. %s', (relativeStartDate, relativeEndDate, reason) => {
    expect(
      resolvePlotToolDateRange(
        {
          interval: '1 min',
          window: window(relativeStartDate, relativeEndDate),
          isRealTime: true,
          timeSettings: { start: '09:30:00', end: '16:00:00', timezone: 'America/New_York' },
        },
        new Date('2026-08-09T12:00:00Z'),
      ),
    ).toEqual({ ok: false, error: { problem: 'unsupported-window', reason } });
  });

  it('starts at the calendar day of an absolute start date, ignoring its time', () => {
    expect(
      resolvePlotToolDateRange(
        { interval: 'Daily', window: window(undefined, '0d', '2026-03-15T18:30:00') },
        new Date('2026-08-09T12:00:00'),
      ),
    ).toEqual({
      ok: true,
      value: { kind: 'calendar', start: '2026-03-15', end: '2026-08-09', interval: '1D' },
    });
  });
});
