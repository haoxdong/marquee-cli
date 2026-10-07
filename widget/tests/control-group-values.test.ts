import { describe, expect, it } from 'vitest';
import { expandControlGroupValues } from '../control-group-values.js';

describe('Control Group values', () => {
  it('expands top-level parameter values without flattening nested values', () => {
    expect(expandControlGroupValues(
      ['CG_ONE', ['MA_AAPL', 'CG_UNKNOWN'], 42],
      { CG_ONE: ['MA_MSFT', 'MA_NVDA'] },
    )).toEqual(['MA_MSFT', 'MA_NVDA', ['MA_AAPL', 'CG_UNKNOWN'], 42]);
  });
});
