import { describe, expect, it } from 'vitest';

import {
  PlotToolCardinalityError,
  PlotToolProjectionError,
  projectPlotTool,
} from '../projection.js';

function series(value: Readonly<Record<string, number>>): unknown {
  return { type: 'series', values: value };
}

describe('PlotTool Pro series construction', () => {
  it('preserves numeric sorted-series coordinates from term-structure results', () => {
    const projection = projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [{ label: 'Smile', axis: 'Right' }],
        yAxesSettings: [{ id: 'Right', labelFormat: 'none' }],
      },
      results: [{
        result_type: 'term_structure',
        type: 'sortedSeries',
        values: [[-25, 4.5], [0, 4.25], [25, 4.5]],
      }],
      expressions: ['smile = fx_vol_smile("1m")'],
    });

    expect(projection.series[0]?.points).toEqual([
      { rawKey: '-25', value: 4.5 },
      { rawKey: '0', value: 4.25 },
      { rawKey: '25', value: 4.5 },
    ]);
  });

  it('applies every label fallback verbatim and leaves duplicate labels unchanged', () => {
    const results = Array.from({ length: 6 }, (_, index) => (
      series({ '2026-08-19': index })
    ));
    const projection = projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [
          { label: 'Explicit', axis: '' },
          {},
          {},
          {},
          {},
          {},
        ],
      },
      results,
      expressions: [
        'ignored # @label(Also ignored)',
        'value # @label(Authored)',
        'variable_name = Dataset()',
        'VNKY.spot()',
        '!!!',
        'value #@label(Authored)',
      ],
    });

    expect(projection.series.map(({ label, legendLabel, axisId }) => ({
      label,
      legendLabel,
      axisId,
    }))).toEqual([
      { label: 'Explicit', legendLabel: 'Explicit', axisId: 'Right' },
      { label: 'Authored', legendLabel: 'Authored', axisId: 'Right' },
      { label: 'variable_name', legendLabel: 'variable_name', axisId: 'Right' },
      { label: 'VNKY Spot', legendLabel: 'VNKY Spot', axisId: 'Right' },
      { label: '', legendLabel: 'Untitled', axisId: 'Right' },
      { label: 'Authored', legendLabel: 'Authored', axisId: 'Right' },
    ]);
  });

  it('drops unsupported, missing, empty, hidden, and ordinal-mismatched series', () => {
    const projection = projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [
          { axis: 'Right' },
          { axis: 'Right2' },
          { axis: 'Left' },
          { axis: 'Left2', hide: true },
          { axis: 'Right3' },
          { axis: 'Left3' },
        ],
        yAxesSettings: [
          { id: 'Right' },
          { id: 'Right2' },
          { id: 'Right3' },
          { id: 'Left' },
          { id: 'Left2' },
        ],
      },
      results: [
        series({ '2026-08-19': 1 }),
        { type: 'number', values: 3 },
        series({ '1.5': 100 }),
        series({ '2026-08-19': 1_000 }),
        { type: 'series', values: {} },
        { type: 'series', values: null },
      ],
      expressions: ['date', 'number', 'ordinal', 'hidden', 'empty', 'missing'],
    });

    expect(projection.series.map(({ axisId }) => axisId)).toEqual(['Right']);
    expect(projection.axes.map(({ axisId }) => axisId)).toEqual(['Right', 'Left']);
    expect(projection.axes.find(({ axisId }) => axisId === 'Left')?.dataDomains)
      .toEqual([100, 100]);
  });

  it('unwraps nested map values and preserves sortedSeries wire order', () => {
    const projection = projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [{ label: 'Nested' }, { label: 'Ordered' }],
      },
      results: [
        {
          type: 'frame',
          values: {
            '2026-08-20': [2, 20],
            '2026-08-19': [1, 10],
          },
        },
        {
          type: 'sortedSeries',
          values: [['2026-08-20', 4], ['2026-08-19', 3]],
        },
      ],
      expressions: ['nested', 'ordered'],
    });

    expect(projection.series.map(({ sourceIndex, nestedIndex, label, paletteSlot, points }) => ({
      sourceIndex,
      nestedIndex,
      label,
      paletteSlot,
      keys: points.map(({ rawKey }) => rawKey),
      values: points.map(({ value }) => value),
    }))).toEqual([
      {
        sourceIndex: 0,
        nestedIndex: 0,
        label: 'Nested',
        paletteSlot: 1,
        keys: ['2026-08-19', '2026-08-20'],
        values: [1, 2],
      },
      {
        sourceIndex: 0,
        nestedIndex: 1,
        label: 'Nested',
        paletteSlot: 1,
        keys: ['2026-08-19', '2026-08-20'],
        values: [10, 20],
      },
      {
        sourceIndex: 1,
        nestedIndex: undefined,
        label: 'Ordered',
        paletteSlot: 2,
        keys: ['2026-08-20', '2026-08-19'],
        values: [4, 3],
      },
    ]);
  });
});

describe('PlotTool Pro axis election', () => {
  it.each([
    ['line', 'Line axis', 'line'],
    ['bar', 'Bar axis', 'bar'],
  ] as const)('reads the %s settings array only', (chartType, label, expected) => {
    const projection = projectPlotTool({
      definition: {
        chartType,
        expressions: [{}],
        yAxesSettings: [{ id: 'Right', label: 'Line axis' }],
        yAxesSettingsBar: [{ id: 'Right', label: 'Bar axis' }],
      },
      results: [series({ '2026-08-19': 1 })],
      expressions: ['value'],
    });

    expect(projection.chartType).toBe(expected);
    expect(projection.axes[0]?.label).toBe(label);
  });

  it('derives scatter settings and elects one x and one y axis without sides', () => {
    const projection = projectPlotTool({
      definition: {
        chartType: 'scatter',
        expressions: [{ axis: 'Right' }, { axis: 'Right2' }],
        yAxesSettings: [
          { id: 'Right' },
          { id: 'Right2' },
          { id: 'Right3' },
          { id: 'Left', label: 'Scatter y', decimalPrecision: 12 },
          { id: 'Left2' },
          { id: 'Left3' },
        ],
        xAxisSettings: {
          label: 'Scatter x',
          labelFormat: 'percentage',
          decimalPrecision: 8,
        },
      },
      results: [
        series({ '2026-08-19': 1, '2026-08-20': 3 }),
        series({ '2026-08-19': 9, '2026-08-20': 5 }),
      ],
      expressions: ['x', 'y'],
    });

    expect(projection.axes).toEqual([
      expect.objectContaining({
        axisId: 'x',
        dimension: 'x',
        label: 'Scatter x',
        labelFormat: 'percentage',
        dataDomains: [1, 3],
        decimalPrecision: 8,
        isHidden: false,
        isInverted: false,
        numberRule: expect.objectContaining({ precision: 'auto' }),
      }),
      expect.objectContaining({
        axisId: 'Left',
        dimension: 'y',
        label: 'Scatter y',
        dataDomains: [5, 9],
        decimalPrecision: 12,
        isHidden: false,
        isInverted: false,
        numberRule: expect.objectContaining({ precision: 'auto' }),
      }),
    ]);
    expect(projection.axes.every((axis) => axis.side === undefined)).toBe(true);
  });

  it('fails loud on malformed drawable results and unsupported chart types', () => {
    expect(() => projectPlotTool({
      definition: { chartType: 'line' },
      results: [{ type: 'series', values: { date: 'not-a-number' } }],
      expressions: ['value'],
    })).toThrow(PlotToolProjectionError);
    expect(() => projectPlotTool({
      definition: { chartType: 'line' },
      results: [{ type: 'series', values: { category: 1 } }],
      expressions: ['value'],
    })).toThrowError(expect.objectContaining({
      name: 'PlotToolProjectionError',
      message: 'Invalid PlotTool Pro projection payload: ordinal point key category is not numeric',
    }));
    expect(() => projectPlotTool({
      definition: { chartType: 'pie' },
      results: [],
      expressions: [],
    })).toThrow('chartType pie is unsupported');
    expect(() => projectPlotTool({
      definition: { chartType: ['pie'] },
      results: [],
      expressions: [],
    })).toThrow('chartType ["pie"] is unsupported');
  });

  it.each([
    { results: [], expressions: ['USD.one()'], message: 'PlotTool Pro returned 0 results for 1 expressions' },
    {
      results: [
        { type: 'series', values: { '2026-01-01': 1 } },
        { type: 'series', values: { '2026-01-01': 2 } },
      ],
      expressions: ['USD.one()'],
      message: 'PlotTool Pro returned 2 results for 1 expressions',
    },
  ])('fails loud when result and expression cardinality differ', ({ results, expressions, message }) => {
    expect(() => projectPlotTool({
      definition: { chartType: 'line' },
      results,
      expressions,
    })).toThrow(PlotToolCardinalityError);
    expect(() => projectPlotTool({
      definition: { chartType: 'line' },
      results,
      expressions,
    })).toThrowError(expect.objectContaining({ name: 'PlotToolCardinalityError', message }));
  });

  it('treats an omitted chart type as the provider default line chart', () => {
    expect(projectPlotTool({
      definition: {},
      results: [{ type: 'series', values: { '2026-01-01': 1 } }],
      expressions: ['USD.one()'],
    }).chartType).toBe('line');
  });

  it('treats an omitted result type as the provider default series', () => {
    expect(projectPlotTool({
      definition: { chartType: 'line' },
      results: [{ values: { '2026-01-01': 1 } }],
      expressions: ['USD.one()'],
    }).series).toHaveLength(1);
  });
});
