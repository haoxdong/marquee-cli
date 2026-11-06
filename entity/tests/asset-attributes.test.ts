import { describe, expect, it } from 'vitest';
import { assetFromAttributes } from '../asset-attributes.js';

describe('assetFromAttributes', () => {
  it('decodes every present attribute and derives the exchange from the bbid', () => {
    expect(assetFromAttributes({
      name: 'Example Corp',
      bbid: ' AAPL UW ',
      ticker: 'AAPL',
      assetClass: 'Equity',
      type: 'Single Stock',
      currency: 'USD',
    }, 'MA_AAPL')).toStrictEqual({
      kind: 'asset',
      entityId: 'MA_AAPL',
      label: 'Example Corp',
      aliases: ['AAPL UW', 'AAPL'],
      assetClass: 'Equity',
      assetType: 'Single Stock',
      ticker: 'AAPL',
      bbid: 'AAPL UW',
      exchange: 'NASD',
      currency: 'USD',
    });
  });

  it('omits absent attributes and keeps a given exchange', () => {
    expect(assetFromAttributes({ short_name: 'Example Corp', exchange: 'XNAS' }, 'MA1')).toStrictEqual({
      kind: 'asset',
      entityId: 'MA1',
      label: 'Example Corp',
      aliases: [],
      exchange: 'XNAS',
    });
  });

  it('needs an entity id and a label', () => {
    expect(assetFromAttributes({ name: 'Example Corp' }, undefined)).toBeUndefined();
    expect(assetFromAttributes({}, 'MA1')).toBeUndefined();
  });

  it('labels by id when nothing else names the asset', () => {
    expect(assetFromAttributes({ id: 'MA1' }, 'MA1')?.label).toBe('MA1');
  });

  it('labels by the xref bbid when no short name or bbid is given', () => {
    expect(assetFromAttributes({ xref: { bbid: 'Apple US Equity' } }, 'MA1')?.label).toBe('Apple US Equity');
  });

  it.each([
    ['a raw market code', 'AAPL UW', 'Example Corp'],
    ['a raw asset code', 'AAPL', 'Example Corp'],
    ['an asset code that only embeds a Marquee id prefix', 'XMW1', 'Example Corp'],
    ['a readable short name', 'Apple Computer', 'Apple Computer'],
    ['a market code with a lowercase lead', 'aAAPL UW', 'aAAPL UW'],
    ['a market code with a lowercase tail', 'AAPL UWxy', 'AAPL UWxy'],
    ['an asset code with a lowercase lead', 'aAAPL', 'aAAPL'],
    ['an asset code with a symbol tail', 'AAPL!', 'AAPL!'],
    ['a Marquee widget id', 'MW1', 'MW1'],
    ['a Marquee id with letters before its digit', 'MWA1', 'MWA1'],
    ['a Marquee id with letters after its digit', 'MW1A', 'MW1A'],
  ])('prefers the name over %s', (_label, shortName, expected) => {
    expect(assetFromAttributes({ name: 'Example Corp', short_name: shortName }, 'MA1')?.label).toBe(expected);
  });

  it('aliases only raw codes, once each', () => {
    expect(assetFromAttributes({
      name: 'Example Corp',
      short_name: 'AAPL',
      bbid: 'AAPL UW',
      xref: { bbid: 'AAPL UW' },
      ticker: 'Apple',
    }, 'MA1')?.aliases).toStrictEqual(['AAPL', 'AAPL UW']);
  });

  it('reads the exchange from the last bbid token', () => {
    expect(assetFromAttributes({ name: 'Berkshire', bbid: 'BRK B UN' }, 'MA1')?.exchange).toBe('NYSE');
  });

  it.each([
    ['UW', 'NASD'],
    ['UQ', 'NASD'],
    ['UR', 'NASD'],
    ['UN', 'NYSE'],
    ['US', 'NYSE'],
    ['UF', 'ARCA'],
    ['UP', 'ARCA'],
    ['LN', 'LSE'],
    ['LI', 'LSE'],
    ['FP', 'EPA'],
    ['GR', 'XETR'],
    ['GY', 'XETR'],
    ['HK', 'HKEX'],
    ['JP', 'TSE'],
    ['JT', 'TSE'],
    ['AU', 'ASX'],
    ['CN', 'TSX'],
    ['SS', 'SSE'],
    ['SZ', 'SZSE'],
    ['SW', 'SWX'],
    ['IM', 'BIT'],
    ['SM', 'BME'],
    ['NA', 'ENXT'],
    ['ZZ', undefined],
  ])('maps the bbid suffix %s to %s', (suffix, exchange) => {
    expect(assetFromAttributes({ name: 'X', bbid: `X ${suffix.toLowerCase()}` }, 'MA1')?.exchange).toBe(exchange);
  });
});
