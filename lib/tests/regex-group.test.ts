import { describe, expect, it } from 'vitest';
import { requiredGroup } from '../regex-group.js';

const PIN = /^(MW\w+)(?:-(WC\w+))?$/;

describe('requiredGroup', () => {
  it('returns the capture group the regex matched', () => {
    const match = PIN.exec('MW1-WC2');
    expect(match && requiredGroup(match, 2)).toBe('WC2');
  });

  it('fails loud when the capture group did not participate in the match', () => {
    const match = PIN.exec('MW1');
    expect(() => match && requiredGroup(match, 2)).toThrow(
      'Regex capture group 2 did not match "MW1"',
    );
  });
});
