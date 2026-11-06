import { describe, expect, it } from 'vitest';
import { record, text } from '../json-value.js';

describe('record', () => {
  it('returns a plain object as is', () => {
    const value = { id: 'MA1' };
    expect(record(value)).toBe(value);
  });

  it.each([
    ['an array', ['MA1']],
    ['null', null],
    ['a string', 'MA1'],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(record(value)).toBeUndefined();
  });
});

describe('text', () => {
  it('trims a non-blank string', () => {
    expect(text('  AAPL UW  ')).toBe('AAPL UW');
  });

  it.each([
    ['an empty string', ''],
    ['a blank string', '   '],
    ['a number', 7],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(text(value)).toBeUndefined();
  });
});
