import { describe, expect, it } from 'vitest';
import { soleElement } from '../sole-element.js';

describe('soleElement', () => {
  it('returns the element of a one-element array', () => {
    expect(soleElement(['MW1'])).toBe('MW1');
  });

  it('returns undefined for an empty array', () => {
    expect(soleElement([])).toBeUndefined();
  });

  it('returns undefined when the array holds more than one element', () => {
    expect(soleElement(['MW1', 'MW2'])).toBeUndefined();
  });
});
