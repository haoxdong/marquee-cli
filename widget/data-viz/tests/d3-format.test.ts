import { describe, expect, it } from 'vitest';
import {
  createD3NumberFormatter,
  DataVizD3FormatError,
} from '../d3-format.js';

describe('createD3NumberFormatter', () => {
  it.each([
    ['.1f', 12.34, '12.3'],
    [',.2f', 1234.567, '1,234.57'],
    ['.2f', 12.346, '12.35'],
    ['.0%', 0.413, '41%'],
    [',.0%', 12.34, '1,234%'],
  ] as const)(
    'covers recorded corpus format %s',
    (specifier, value, expected) => {
      expect(createD3NumberFormatter(specifier)(value)).toBe(expected);
    },
  );

  it.each([
    ['comma grouping', ',.2f', 12345.678, '12,345.68'],
    ['fixed precision', '.3f', 1.2, '1.200'],
    ['percent scaling', '.1%', 0.126, '12.6%'],
    ['SI prefixes', '.3s', 1_234_567, '1.23M'],
    ['currency', '$,.2f', 12345.678, '$12,345.68'],
    ['explicit positive signs', '+.1f', 12.34, '+12.3'],
    ['parenthesized negative signs', '($.2f', -12.34, '($12.34)'],
  ] as const)(
    'implements d3 semantics for %s',
    (_behavior, specifier, value, expected) => {
      expect(createD3NumberFormatter(specifier)(value)).toBe(expected);
    },
  );

  it('uses the default d3 number type when the type is omitted', () => {
    expect(createD3NumberFormatter(',.3')(12345.678)).toBe('1.23e+4');
  });

  it.each([
    ['binary', 'b', 10, '1010'],
    ['character data', 'c', 65, '65'],
    ['decimal integer', 'd', 42.6, '43'],
    ['exponent', '.2e', 12.34, '1.23e+1'],
    ['general notation', '.3g', 12.34, '12.3'],
    ['grouped general notation', 'n', 1234.56, '1,234.56'],
    ['octal', 'o', 10, '12'],
    ['rounded percent', '.3p', 0.1234, '12.3%'],
    ['rounded decimal', '.3r', 12345, '12300'],
    ['lowercase hexadecimal', 'x', 48879, 'beef'],
    ['uppercase hexadecimal', 'X', 48879, 'BEEF'],
  ] as const)(
    'implements the full d3 type grammar for %s',
    (_behavior, specifier, value, expected) => {
      expect(createD3NumberFormatter(specifier)(value)).toBe(expected);
    },
  );

  it.each([
    ['zero padding and width', '08d', 42, '00000042'],
    ['alternate-prefix symbols', '#x', 48879, '0xbeef'],
    ['insignificant-zero trimming', '.3~s', 1200, '1.2k'],
    ['custom fill and left alignment', '*<8.2f', 12.3, '12.30***'],
    ['center alignment', '*^9.1f', 12.3, '**12.3***'],
  ] as const)(
    'implements d3 grammar flags for %s',
    (_behavior, specifier, value, expected) => {
      expect(createD3NumberFormatter(specifier)(value)).toBe(expected);
    },
  );

  it.each(['.2ff', 'not-a-format', '..2f'])(
    'classifies malformed specifier %s',
    (specifier) => {
      expect(() => createD3NumberFormatter(specifier)).toThrow(
        expect.objectContaining({
          name: 'DataVizD3FormatError',
          problem: 'malformed-specifier',
          specifier,
        }),
      );
    },
  );

  it.each(['.2q', 'Q'])(
    'fails loud for unsupported directive %s',
    (specifier) => {
      expect(() => createD3NumberFormatter(specifier)).toThrow(
        expect.objectContaining({
          name: 'DataVizD3FormatError',
          problem: 'unsupported-directive',
          specifier,
        }),
      );
    },
  );

  it('exposes a stable typed error', () => {
    const error = new DataVizD3FormatError('bad', 'malformed-specifier');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Invalid d3 format specifier: bad');
  });
});
