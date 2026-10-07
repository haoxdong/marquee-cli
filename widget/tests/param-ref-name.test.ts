// @format

import { describe, expect, it } from 'vitest';

import { widgetParamRefName } from '../param-ref-name.js';

describe('widgetParamRefName', () => {
  it.each([
    ['Relative Date', 'relativeDate'],
    ['pricingDate', 'pricingDate'],
    ['Asset', 'asset'],
    ['FX Cross', 'fxCross'],
    ['Tenor 10Y', 'tenor10y'],
    ['MarketCap Currency', 'marketCapCurrency'],
    ['baseCCY', 'baseCCY'],
  ])('names the field %s as -p %s', (field, name) => {
    expect(widgetParamRefName(field)).toBe(name);
  });
});
