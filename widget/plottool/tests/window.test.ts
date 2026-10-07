import { describe, expect, it } from 'vitest';
import {
  parsePlotToolWindow,
  parsePlotToolWindowOverride,
  plotToolWindowDashboardToken,
  plotToolWindowOverrideToken,
  plotToolWindowRelativeDate,
  plotToolWindowOverrideProviderToken,
} from '../window.js';
import type { PlotToolWindow } from '../types.js';

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

describe('parsePlotToolWindow', () => {
  it.each([
    ['-max', { token: '-max', kind: 'max' }],
    ['-ytd', { token: '-ytd', kind: 'year-start' }],
    ['ytd', { token: 'ytd', kind: 'prior-year-end' }],
    ['0d', { token: '0d', kind: 'today' }],
    ['-10y', { token: '-10y', kind: 'offset', direction: 'back', amount: 10, unit: 'y' }],
    ['-0d', { token: '-0d', kind: 'offset', direction: 'back', amount: 0, unit: 'd' }],
    ['+1m', { token: '+1m', kind: 'offset', direction: 'forward', amount: 1, unit: 'm' }],
  ])('reads the relative start %s', (token, start) => {
    expect(window(token)).toStrictEqual({ start, isForward: false });
  });

  it.each([
    ['0d', { kind: 'today' }, false],
    ['-0d', { kind: 'offset', amount: 0, unit: 'd' }, false],
    ['+0d', { kind: 'offset', amount: 0, unit: 'd' }, false],
    ['+5y', { kind: 'offset', amount: 5, unit: 'y' }, true],
    ['30y', { kind: 'offset', amount: 30, unit: 'y' }, true],
    ['+8m', { kind: 'offset', amount: 8, unit: 'm' }, true],
  ])('reads the relative end %s', (token, end, isForward) => {
    expect(window(undefined, token)).toStrictEqual({ end, isForward });
  });

  it('keeps an absolute start date as given', () => {
    expect(window(undefined, '0d', '2021-01-01T00:00:00Z')).toStrictEqual({
      end: { kind: 'today' },
      startDate: '2021-01-01T00:00:00Z',
      isForward: false,
    });
    expect(window()).toStrictEqual({ isForward: false });
  });

  it.each(['forever', '', '+0d', '-5Y', 'x-5y', '-5yx', '5y', '+1xd'])(
    'rejects the relative start %j',
    (token) => {
      expect(parsePlotToolWindow({ relativeStartDate: token })).toStrictEqual({
        ok: false,
        reason: `unsupported relative start ${token}`,
      });
    },
  );

  it.each(['-5d', '-00d', '+5Y', 'x+5y', '+5yx', 'ytd', '-0dd'])('rejects the relative end %j', (token) => {
    expect(parsePlotToolWindow({ relativeEndDate: token })).toStrictEqual({
      ok: false,
      reason: `unsupported relative end ${token}`,
    });
  });
});

describe('plotToolWindowRelativeDate', () => {
  const options = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y'];

  it('shows a lookback start as Web does and keeps the provider token raw', () => {
    expect(plotToolWindowRelativeDate(window('-3m', '0d'))).toStrictEqual({
      display: '3M',
      raw: '-3m',
      options,
    });
  });

  // Web's control lists its seven choices, none selected, on a 10Y or 15Y Chart.
  it.each([['-10y', '10Y'], ['-15y', '15Y']])('reports the %s window without listing it as an option', (token, display) => {
    expect(plotToolWindowRelativeDate(window(token))).toStrictEqual({
      display,
      raw: token,
      options,
    });
  });

  it.each(['ytd', '-ytd'])('shows the %s Chart spelling as Web YTD, listed once', (token) => {
    expect(plotToolWindowRelativeDate(window(token))).toStrictEqual({
      display: 'YTD',
      raw: token,
      options,
    });
  });

  // Web's Relative Date control selects no option on a `-max` or `0d` Chart.
  it.each(['-max', '0d', '+1m'])('shows no current option for the start %s', (token) => {
    expect(plotToolWindowRelativeDate(window(token))).toStrictEqual({
      raw: token,
      options,
    });
  });

  it('falls back to the absolute start date with no current option', () => {
    expect(plotToolWindowRelativeDate(window(undefined, '0d', '2020-01-01'))).toStrictEqual({
      raw: '2020-01-01',
      options,
    });
  });

  it('offers none on a forward-looking window or one with no start', () => {
    expect(plotToolWindowRelativeDate(window('-1m', '+5y'))).toBeUndefined();
    expect(plotToolWindowRelativeDate(window(undefined, '0d', ''))).toBeUndefined();
    expect(plotToolWindowRelativeDate(window(undefined, '0d'))).toBeUndefined();
  });
});

describe('plotToolWindowDashboardToken', () => {
  it.each([
    [window('-5y'), '5y'],
    [window('0d', '0d'), undefined],
    [window('-ytd', '0d'), 'YTD'],
    [window('-max', '0d'), undefined],
    [window('ytd', '0d'), undefined],
    [window('-1y', '30y'), undefined],
    [window('-1y', '0d', '2021-01-01'), undefined],
    [window(undefined, '0d', '2021-01-01'), undefined],
  ])('projects %j to %j', (source, value) => {
    expect(plotToolWindowDashboardToken(source)).toStrictEqual({ ok: true, value });
  });

  it.each([
    [window(undefined, '0d'), 'missing relativeStartDate'],
    [window(undefined, '0d', ''), 'missing relativeStartDate'],
    [window('+1m', '0d'), 'unsupported relativeStartDate'],
  ])('rejects %j', (source, reason) => {
    expect(plotToolWindowDashboardToken(source)).toStrictEqual({ ok: false, reason });
  });
});

describe('parsePlotToolWindowOverride', () => {
  it.each([
    ['max', { token: '-max', kind: 'max' }],
    ['ytd', { token: '-ytd', kind: 'year-start' }],
    ['3M', { token: '-3m', kind: 'offset', direction: 'back', amount: 3, unit: 'm' }],
    ['0d', { token: '-0d', kind: 'offset', direction: 'back', amount: 0, unit: 'd' }],
    ['10Y', { token: '-10y', kind: 'offset', direction: 'back', amount: 10, unit: 'y' }],
  ])('reads %j as a window ending today', (value, start) => {
    expect(parsePlotToolWindowOverride(value)).toStrictEqual({
      start,
      end: { kind: 'today' },
      isForward: false,
    });
  });

  it.each(['+1M', '-3M', '3W', 'soon', 'MAXX', 'xYTD', ' 3M', '3M '])('rejects %j', (value) => {
    expect(parsePlotToolWindowOverride(value)).toBeUndefined();
  });

  it.each([
    ['3m', '3M'],
    ['10y', '10Y'],
    ['ytd', 'YTD'],
    ['Max', 'MAX'],
  ])('prints %j as %s, which parses back to the same window', (value, printed) => {
    const window = parsePlotToolWindowOverride(value);
    expect(window && plotToolWindowOverrideToken(window)).toBe(printed);
    expect(parsePlotToolWindowOverride(printed)).toStrictEqual(window);
  });
});

describe('plotToolWindowOverrideProviderToken', () => {
  it.each([
    ['max', 'MAX'],
    ['Ytd', 'YTD'],
    ['3M', '3m'],
    ['10y', '10y'],
  ])('writes %s to a Widget Config as %s', (value, provider) => {
    const window = parsePlotToolWindowOverride(value);
    expect(window && plotToolWindowOverrideProviderToken(window)).toBe(provider);
  });
});
