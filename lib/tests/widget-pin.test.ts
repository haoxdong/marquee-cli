import { describe, expect, it } from 'vitest';
import { decodeWidgetPin, normalizedId } from '../widget-pin.js';

describe('normalizedId', () => {
  it.each([
    ['mw_abc1', 'MW_ABC1'],
    ['wc42', 'WC42'],
    ['xmw1', 'xmw1'],
    ['mw1-x', 'mw1-x'],
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizedId(value)).toBe(expected);
  });
});

describe('decodeWidgetPin', () => {
  it.each([
    ['  mw1:wc23  ', { widgetId: 'MW1', configurationId: 'WC23' }],
    ['MW1-WC2', { widgetId: 'MW1', configurationId: 'WC2' }],
    ['MW1?WC2', { widgetId: 'MW1', configurationId: 'WC2' }],
    ['MW1|WC2', { widgetId: 'MW1', configurationId: 'WC2' }],
    ['mw1', { widgetId: 'MW1' }],
  ])('decodes the string pin %j', (value, expected) => {
    expect(decodeWidgetPin(value)).toStrictEqual(expected);
  });

  it.each([
    'xMW1',
    'MW1:WC2!',
    'MW1/WC2',
    'MW1:WC',
  ])('rejects the string pin %j', (value) => {
    expect(decodeWidgetPin(value)).toBeUndefined();
  });

  it.each([
    [{ widgetId: ' mw9 ', configurationId: 'wc8' }, { widgetId: 'MW9', configurationId: 'WC8' }],
    [{ id: 'MW9', configId: 'wc8' }, { widgetId: 'MW9', configurationId: 'WC8' }],
    [{ id: 'MW9' }, { widgetId: 'MW9' }],
  ])('decodes the object pin %j', (value, expected) => {
    expect(decodeWidgetPin(value)).toStrictEqual(expected);
  });

  it('rejects an object pin without a widget id', () => {
    expect(decodeWidgetPin({ widgetId: ' ', configurationId: 'WC8' })).toBeUndefined();
  });
});
