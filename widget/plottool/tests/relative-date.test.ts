import { describe, expect, it } from 'vitest';
import {
  isRelativeDateObject,
  relativeDateConcreteValue,
  relativeDateRule,
  resolveRelativeDateDefault,
} from '../relative-date.js';

const REL = { rdate: { rule: '1Y' }, value: '2023-01-01' };

describe('isRelativeDateObject', () => {
  it('is true when rdate carries a string rule', () => {
    expect(isRelativeDateObject(REL)).toBe(true);
    expect(isRelativeDateObject({ rdate: { rule: '3M' } })).toBe(true);
  });

  it('is false without a string rule', () => {
    expect(isRelativeDateObject({ rdate: {} })).toBe(false);
    expect(isRelativeDateObject({ rdate: { rule: 5 } })).toBe(false);
    expect(isRelativeDateObject({})).toBe(false);
    expect(isRelativeDateObject('1Y')).toBe(false);
    expect(isRelativeDateObject(null)).toBe(false);
  });
});

describe('relativeDateRule', () => {
  it('returns the rule string for a relative-date object', () => {
    expect(relativeDateRule(REL)).toBe('1Y');
  });

  it('returns undefined for non-relative values', () => {
    expect(relativeDateRule('1Y')).toBeUndefined();
    expect(relativeDateRule({ value: 'x' })).toBeUndefined();
  });
});

describe('relativeDateConcreteValue', () => {
  it('returns the concrete value for a relative-date object', () => {
    expect(relativeDateConcreteValue(REL)).toBe('2023-01-01');
  });

  it('returns undefined for non-relative values', () => {
    expect(relativeDateConcreteValue('2023-01-01')).toBeUndefined();
  });
});

describe('resolveRelativeDateDefault', () => {
  it('restores a relative object when the raw default matches its rule or concrete value', () => {
    expect(resolveRelativeDateDefault(REL, '1Y')).toEqual(REL);
    expect(resolveRelativeDateDefault(REL, '2023-01-01')).toEqual(REL);
  });

  it('keeps the raw default when the component is not relative or does not match', () => {
    expect(resolveRelativeDateDefault('plain', 'raw')).toBe('raw');
    expect(resolveRelativeDateDefault(REL, '3M')).toBe('3M');
  });

  it('keeps a missing or null raw default when the relative object has no concrete value', () => {
    expect(resolveRelativeDateDefault({ rdate: { rule: '1Y' } }, undefined)).toBeUndefined();
    expect(resolveRelativeDateDefault({ rdate: { rule: '1Y' }, value: null }, null)).toBeNull();
  });
});
