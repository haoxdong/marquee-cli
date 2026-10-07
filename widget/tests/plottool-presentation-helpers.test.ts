// @format

import { describe, expect, it } from 'vitest';

import { dateKeyTime } from '../plottool-presentation-helpers.js';

describe('dateKeyTime', () => {
  it('reads raw date keys as epoch milliseconds', () => {
    expect(dateKeyTime('2026-09-25')).toBe(Date.UTC(2026, 8, 25));
    expect(dateKeyTime('2026-08-20T14:30:45Z')).toBe(Date.UTC(2026, 7, 20, 14, 30, 45));
    expect(dateKeyTime(Date.UTC(2025, 10, 27))).toBe(Date.UTC(2025, 10, 27));
  });

  it.each([['not-a-date'], [undefined], [null]])('fails loud on the unreadable date key %s', (value) => {
    expect(() => dateKeyTime(value)).toThrow(`unreadable date key ${JSON.stringify(value)}`);
  });
});
