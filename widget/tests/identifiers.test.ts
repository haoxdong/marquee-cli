import { describe, expect, it } from 'vitest';
import {
  type ConfigId,
  type ConfiguredWidgetIdentity,
  type WidgetId,
} from '../index.js';
import { parseConfigId, parseWidgetId } from '../identifiers.js';

describe('Widget identifiers', () => {
  it('parses a Widget ID and a Config ID from their Marquee forms', () => {
    expect(parseWidgetId('MWTEST0001')).toBe('MWTEST0001');
    expect(parseConfigId('WCTEST0001')).toBe('WCTEST0001');
  });

  it('rejects a Config ID as a Widget ID and a Widget ID as a Config ID', () => {
    expect(parseWidgetId('WCTEST0001')).toBeUndefined();
    expect(parseConfigId('MWTEST0001')).toBeUndefined();
    expect(parseWidgetId('')).toBeUndefined();
    expect(parseWidgetId('MW 5A7')).toBeUndefined();
  });

  it('rejects text around an otherwise valid Widget ID or Config ID', () => {
    expect(parseWidgetId('xMWTEST0001')).toBeUndefined();
    expect(parseWidgetId('MWTEST0001?config=WCTEST0001')).toBeUndefined();
    expect(parseConfigId('xWCTEST0001')).toBeUndefined();
    expect(parseConfigId('WCTEST0001&x=1')).toBeUndefined();
  });

  it('makes swapping a Widget ID and a Config ID a type error', () => {
    const widgetId = parseWidgetId('MWTEST0001') as WidgetId;
    const configurationId = parseConfigId('WCTEST0001') as ConfigId;
    const swapped: ConfiguredWidgetIdentity = {
      // @ts-expect-error a Config ID is not a Widget ID
      widgetId: configurationId,
      // @ts-expect-error a Widget ID is not a Config ID
      configurationId: widgetId,
    };
    // @ts-expect-error an unparsed string is not a Widget ID
    const unparsed: WidgetId = 'MWTEST0001';
    expect([swapped, unparsed]).toHaveLength(2);
  });
});
