import { describe, expect, it } from 'vitest';
import { paramTypeFromRecord } from '../parameter-type.js';

describe('paramTypeFromRecord without a declared type', () => {
  it.each([
    ['an Asset default', `MA${'K'.repeat(15)}`, [], 'Asset'],
    ['a Control Group default', `CG${'J'.repeat(15)}`, [], 'Asset'],
    ['an Asset among the options', 'EU', ['US', `MA${'K'.repeat(15)}`], 'Asset'],
    ['a Control Group among the options', 'EU', [`CG${'J'.repeat(15)}`], 'Asset'],
    ['a default that ends like an Asset', 'XMA', [], 'String'],
    ['a word that starts like an Asset', 'MAX', [], 'String'],
    ['plain text options', 'EU', ['US'], 'Enum'],
    ['non-text options', undefined, [1, 2], 'Enum'],
    ['no options', 'EU', [], 'String'],
    ['an Asset in a list default', [`MA${'K'.repeat(15)}`], [], 'AssetList'],
    ['an Asset among list options', ['EU'], ['US', `MA${'K'.repeat(15)}`], 'AssetList'],
    ['a plain list', ['EU'], ['US'], 'EnumList'],
  ])('infers the type of %s', (_case, rawDefault, rawValues, expected) => {
    expect(paramTypeFromRecord({}, rawDefault, rawValues)).toBe(expected);
  });
});
