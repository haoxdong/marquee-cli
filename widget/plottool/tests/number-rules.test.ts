import { describe, expect, it } from 'vitest';

import {
  MINIMUM_PLOT_Y_AXIS_TICKS,
  PLOT_LABEL_FORMATS,
  PLOT_NUMBER_LOCALE,
  PLOT_Y_AXIS_TICK_SPACING_PX,
  STANDARD_PLOT_CARD_HEIGHT_PX,
  STANDARD_PLOT_Y_AXIS_TICKS,
  formatPlotToolAxisNumber,
  formatPlotToolPointNumber,
  resolvePlotToolAxisNumberRule,
  type PlotToolAxisNumberRule,
} from '../number-rules.js';

function resolveRule(
  input: Parameters<typeof resolvePlotToolAxisNumberRule>[0],
): PlotToolAxisNumberRule {
  const result = resolvePlotToolAxisNumberRule(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function formatPoint(value: number, rule: PlotToolAxisNumberRule) {
  const result = formatPlotToolPointNumber(value, rule);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('PlotTool Pro number rules', () => {
  it('pins the Web reader environment and standard card geometry', () => {
    expect(PLOT_NUMBER_LOCALE).toBe('en-US');
    expect(STANDARD_PLOT_CARD_HEIGHT_PX).toBe(339);
    expect(PLOT_Y_AXIS_TICK_SPACING_PX).toBe(40);
    expect(MINIMUM_PLOT_Y_AXIS_TICKS).toBe(3);
    expect(STANDARD_PLOT_Y_AXIS_TICKS).toBe(8);
  });

  it('declares the complete nine-format vocabulary', () => {
    expect(PLOT_LABEL_FORMATS).toEqual([
      'none',
      'bps',
      'percentage',
      'thousand',
      'million',
      'billion',
      'dollar',
      'multiple',
      'auto',
    ]);
  });

  it.each([
    ['none', 1_234.5, '1,234.50'],
    ['bps', 0.012345, '123.45 bps'],
    ['percentage', 0.12345, '12.35 %'],
    ['thousand', 1_234_500, '1,234.50 K'],
    ['million', 1_234_500, '1.23 M'],
    ['billion', 1_234_500_000, '1.23 B'],
    ['dollar', 1_234.5, '$1,234.50'],
    ['multiple', 1.2345, '1.23 x'],
  ])('scales and decorates the %s format', (labelFormat, value, expected) => {
    const rule = resolveRule({
      labelFormat,
      decimalPrecision: 2,
      dataDomains: [value, value],
    });

    expect(formatPoint(value, rule).text).toBe(expected);
  });

  it.each([
    [[-999_999, 999_999], 'none'],
    [[-1_000_000, 1], 'million'],
    [[-999_999_999, 999_999_999], 'million'],
    [[-1_000_000_000, 1], 'billion'],
  ] as const)('resolves auto magnitude for domain %j to %s', (dataDomains, expected) => {
    expect(resolveRule({ labelFormat: 'auto', dataDomains }).labelFormat).toBe(expected);
  });

  it('recomputes auto decimals in the scaled domain', () => {
    const auto = resolveRule({
      labelFormat: 'auto',
      dataDomains: [1_000_000, 2_000_000],
    });
    const explicitMagnitude = resolveRule({
      labelFormat: 'million',
      dataDomains: [1_000_000, 2_000_000],
    });

    expect(auto).toMatchObject({ labelFormat: 'million', decimals: 1 });
    expect(explicitMagnitude).toMatchObject({ labelFormat: 'million', decimals: 0 });
  });

  it('keeps auto unresolved under explicit precision and resolves each point by value', () => {
    const rule = resolveRule({
      labelFormat: 'auto',
      decimalPrecision: 2,
      dataDomains: [900_000, 2_000_000],
    });

    expect(rule).toMatchObject({
      labelFormat: 'auto',
      decimals: 2,
      precisionDomains: [900_000, 2_000_000],
    });
    expect(formatPoint(900_000, rule)).toMatchObject({
      value: 900_000,
      text: '900,000.00',
      decimals: 2,
    });
  });

  it('keeps auto unresolved under explicit precision with an authored bound', () => {
    const rule = resolveRule({
      labelFormat: 'auto',
      decimalPrecision: 2,
      dataDomains: [900_000, 900_000],
      maximum: 2_000_000,
    });

    expect(rule).toMatchObject({
      labelFormat: 'auto',
      precisionDomains: [900_000, 2_000_000],
    });
  });

  it.each([
    [[0, 7], 0],
    [[0, 0.7], 1],
    [[0.01, 0.01], 2],
    [[0, 7e-20], 15],
    [[0, 7e20], 0],
  ] as const)('derives axis decimals from tick gap for domain %j', (dataDomains, decimals) => {
    expect(resolveRule({ labelFormat: 'none', dataDomains }).decimals).toBe(decimals);
  });

  it('uses axis min and max to size bar decimals without changing auto magnitude', () => {
    const rule = resolveRule({
      labelFormat: 'auto',
      dataDomains: [1_000_000, 7_000_000],
      minimum: 0,
      maximum: 0.07,
    });

    expect(rule).toMatchObject({
      labelFormat: 'million',
      precisionDomains: [0, 0.07],
      decimals: 8,
    });
    expect(formatPoint(7_000_000, rule)).toMatchObject({ value: 7, text: '7 M', decimals: 8 });
  });

  it('reverts hidden auto-precision axes to two decimals', () => {
    const rule = resolveRule({
      labelFormat: 'auto',
      dataDomains: [1_000_000, 2_000_000],
      isHidden: true,
    });

    expect(rule).toMatchObject({ labelFormat: 'million', decimals: 2 });
  });

  it('passes unknown formats through at scale one with no decoration', () => {
    const rule = resolveRule({
      labelFormat: 'trillion',
      decimalPrecision: 2,
      dataDomains: [1_234.5, 1_234.5],
    });

    expect(rule.labelFormat).toBe('trillion');
    expect(formatPoint(1_234.5, rule)).toMatchObject({
      value: 1_234.5,
      text: '1,234.50',
    });
  });

  it('tests dollar before the per-value magnitude table', () => {
    const rule = resolveRule({ labelFormat: 'dollar', dataDomains: [0, 7_000] });

    expect(formatPoint(1_000, rule)).toMatchObject({
      text: '$1,000',
      decimals: 2,
    });
  });

  it.each([
    [0, 0],
    [1_000, 0],
    [100, 1],
    [10, 2],
    [1, 4],
    [0.1, 4],
    [0.001, 6],
    [-0.001, 6],
  ])('uses the point-table precision for %d (%d decimals)', (value, decimals) => {
    const rule = resolveRule({ labelFormat: 'none', dataDomains: [0, 7_000] });

    expect(formatPoint(value, rule).decimals).toBe(decimals);
  });

  it('floors point decimals at the resolved auto axis decimals', () => {
    const rule = resolveRule({ labelFormat: 'none', dataDomains: [0, 0.0007] });

    expect(rule.decimals).toBe(4);
    expect(formatPoint(1_000, rule)).toMatchObject({ text: '1,000', decimals: 4 });
  });

  it('strips trailing zeros under auto precision only', () => {
    const auto = resolveRule({ labelFormat: 'none', dataDomains: [0, 7_000] });
    const explicit = resolveRule({
      labelFormat: 'none',
      decimalPrecision: 4,
      dataDomains: [0, 7_000],
    });

    expect(formatPoint(1.2, auto).text).toBe('1.2');
    expect(formatPoint(1.2, explicit).text).toBe('1.2000');
  });

  it('keeps fixed decimals in the axis rule', () => {
    const rule = resolveRule({ labelFormat: 'percentage', dataDomains: [0, 0.07] });
    const result = formatPlotToolAxisNumber(0.012, rule);

    expect(result).toEqual({
      ok: true,
      value: { value: 1.2, text: '1.20 %', decimals: 2 },
    });
  });

  it('uses en-US grouping and half-away-from-zero rounding', () => {
    const rule = resolveRule({
      labelFormat: 'none',
      decimalPrecision: 1,
      dataDomains: [-2_000, 2_000],
    });

    expect(formatPoint(1_234.25, rule).text).toBe('1,234.3');
    expect(formatPoint(-1_234.25, rule).text).toBe('-1,234.3');
  });

  it('passes negative explicit precision through for the platform formatter to validate', () => {
    const rule = resolveRule({
      labelFormat: 'none',
      decimalPrecision: -1,
      dataDomains: [0, 1],
    });

    expect(rule.decimals).toBe(-1);
    expect(() => formatPoint(1, rule)).toThrow(RangeError);
  });

  it('uses Web-equivalent division for magnitude scaling', () => {
    const rule = resolveRule({
      labelFormat: 'million',
      decimalPrecision: 2,
      dataDomains: [12_345_000, 12_345_000],
    });

    expect(formatPoint(12_345_000, rule)).toMatchObject({
      value: 12.345,
      text: '12.35 M',
    });
  });

  it('returns a typed error for NaN in an auto axis domain', () => {
    expect(resolvePlotToolAxisNumberRule({
      labelFormat: 'auto',
      dataDomains: [Number.NaN, 1],
    })).toEqual({
      ok: false,
      error: {
        kind: 'nan-under-auto-precision',
        source: 'axis-domain',
        message: 'PlotTool Pro auto precision cannot format NaN',
      },
    });
  });

  it('returns a typed error for a NaN point under auto precision', () => {
    const rule = resolveRule({ labelFormat: 'none', dataDomains: [0, 7] });

    expect(formatPlotToolPointNumber(Number.NaN, rule)).toEqual({
      ok: false,
      error: {
        kind: 'nan-under-auto-precision',
        source: 'point-value',
        message: 'PlotTool Pro auto precision cannot format NaN',
      },
    });
  });

  it('preserves explicit-precision NaN formatting', () => {
    const rule = resolveRule({
      labelFormat: 'percentage',
      decimalPrecision: 2,
      dataDomains: [0, 1],
    });

    expect(formatPoint(Number.NaN, rule)).toMatchObject({
      value: Number.NaN,
      text: 'NaN %',
      decimals: 2,
    });
  });
});
