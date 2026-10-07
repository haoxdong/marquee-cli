import { describe, expect, it } from 'vitest';

import {
  DataVizFigureProjectionError,
  projectDataVizFigure,
} from '../figure-lane.js';
import type { DataVizFigureSeries } from '../figure-types.js';

function figure(data: readonly unknown[], layout: Readonly<Record<string, unknown>> = {}) {
  return projectDataVizFigure({ data, layout });
}

function fieldTexts(series: DataVizFigureSeries | undefined, path: string) {
  return series?.points.map(({ fields }) => fields.find((field) => field.path === path)?.text);
}

describe('unevidenced Plotly internals', () => {
  it.each([
    {
      name: 'non-Gregorian calendars',
      data: [{ type: 'scatter', x: ['2026-08-20'], y: [1], xcalendar: 'julian' }],
      layout: {},
    },
    {
      name: 'value-aggregation category ordering',
      data: [{ type: 'bar', x: ['A'], y: [1] }],
      layout: { xaxis: { categoryorder: 'total ascending' } },
    },
    {
      name: 'sunburst numeric colorscale interpolation',
      data: [{
        type: 'sunburst',
        labels: ['Root', 'Child'],
        parents: ['', 'Root'],
        marker: { colors: [0, 1], colorscale: 'Viridis' },
      }],
      layout: {},
    },
  ])('fails loud on $name', ({ data, layout }) => {
    expect(() => figure(data, layout)).toThrow(DataVizFigureProjectionError);
  });
});

describe('DataViz figure trace projections', () => {
  it.each([
    ['bar', { x: ['A', 'B'], y: [1, 2] }, 2],
    ['scatter', { x: [1, 2], y: [3, 4] }, 2],
    ['box', { x: ['A', 'A'], y: [1, 2] }, 1],
    ['pie', { labels: ['A', 'B'], values: [60, 40] }, 2],
    ['sunburst', { labels: ['A', 'B'], parents: ['', 'A'], values: [60, 40] }, 2],
    ['heatmap', { x: ['A', 'B'], y: ['C'], z: [[1, 2]] }, 2],
    ['surface', { x: [[1, 2]], y: [[3, 4]], z: [[5, 6]] }, 2],
    ['scatterpolar', { theta: ['A', 'B'], r: [1, 2] }, 2],
    ['scatter3d', { x: [1, 2], y: [3, 4], z: [5, 6] }, 2],
  ] as const)(
    'projects %s by its trace-specific point rule',
    (type, payload, expectedPoints) => {
      const projection = figure([{ type, name: type, ...payload }]);

      expect(projection?.series).toHaveLength(1);
      expect(projection?.series[0]).toMatchObject({
        id: 'series-1',
        identity: type,
        traceType: type,
      });
      expect(projection?.series[0]?.points).toHaveLength(expectedPoints);
    },
  );

  it('uses Plotly\'s coerced trace name when provider identity fields are absent', () => {
    expect(figure([{
      type: 'scatter',
      x: [1],
      y: [2],
    }])?.series[0]?.identity).toBe('trace 0');
  });

  it('derives Plotly implicit cartesian coordinates from origin and step', () => {
    const projection = figure([{
      type: 'scatter',
      y: [10, 20, 30],
      x0: 5,
      dx: 2,
    }, {
      type: 'bar',
      x: [10, 20, 30],
      y0: 7,
      dy: 3,
    }, {
      type: 'heatmap',
      z: [[1, 2], [3, 4]],
      x0: 5,
      dx: 2,
      y0: 7,
      dy: 3,
    }, {
      type: 'surface',
      z: [[1, 2]],
      x0: 10,
      dx: 5,
    }]);
    expect(projection?.series.map(({ points }) => points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => path === 'x' || path === 'y').map(({ path, raw }) => [path, raw]),
    )))).toEqual([
      [{ x: 5, y: 10 }, { x: 7, y: 20 }, { x: 9, y: 30 }],
      [{ x: 10, y: 7 }, { x: 20, y: 10 }, { x: 30, y: 13 }],
      [{ x: 5, y: 7 }, { x: 7, y: 7 }, { x: 5, y: 10 }, { x: 7, y: 10 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    ]);
  });

  it('converts implicit date origins through their resolved axes', () => {
    const projection = figure([{
      type: 'scatter',
      y: [1, 2],
      x0: '2026-08-20',
      dx: 86_400_000,
      hovertemplate: '%{x|%Y-%m-%d}<extra></extra>',
    }], { xaxis: { type: 'date' } });
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['2026-08-20', '2026-08-21']);
  });

  it('resolves heatmap hovertext from the matching matrix cell', () => {
    const projection = figure([{
      type: 'heatmap',
      x: ['first', 'second'],
      y: ['top', 'bottom'],
      z: [[1, 2], [3, 4]],
      hovertext: [['a', 'b'], ['c', 'd']],
      hovertemplate: '%{hovertext}<extra></extra>',
    }]);

    expect(fieldTexts(projection?.series[0], 'hovertext')).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    ['1787184000000', 'date', Date.UTC(2026, 7, 20)],
    ['5', 'linear', 5],
    ['$1,000', 'linear', 1_000],
    ['A', 'category', 0],
  ])('converts implicit origin %s through a %s axis', (x0, type, expected) => {
    const projection = figure([{
      type: 'scatter',
      y: [1, 2],
      x0,
      dx: 1,
    }], { xaxis: { type } });
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([expected, expected + 1]);
  });

  it('auto-types a date-like implicit origin when the axis type is omitted', () => {
    const projection = figure([{
      type: 'scatter',
      y: [1, 2],
      x0: '2026-08-20',
      dx: 86_400_000,
      hovertemplate: '%{x|%Y-%m-%d}<extra></extra>',
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([Date.UTC(2026, 7, 20), Date.UTC(2026, 7, 21)]);
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['2026-08-20', '2026-08-21']);
  });

  it('auto-types a category implicit origin when the axis type is omitted', () => {
    const projection = figure([{
      type: 'scatter',
      y: [1, 2],
      x0: 'A',
      dx: 1,
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([0, 1]);
  });

  it('honors an explicit scaled heatmap coordinate mode over supplied arrays', () => {
    const projection = figure([{
      type: 'heatmap',
      z: [[1, 2]],
      x: [100, 200],
      xtype: 'scaled',
      x0: 5,
      dx: 2,
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([5, 7]);
  });

  it('projects heatmap edge coordinates at their cell midpoints', () => {
    const projection = figure([{
      type: 'heatmap',
      z: [[1, 2]],
      x: [0, 2, 6],
      y: [10, 14],
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => path === 'x' || path === 'y').map(({ path, raw }) => [path, raw]),
    ))).toEqual([{ x: 1, y: 12 }, { x: 4, y: 12 }]);
  });

  it('uses Plotly arithmetic hover values for log-axis heatmap edges', () => {
    const projection = figure([{
      type: 'heatmap',
      x: [1, 10, 100],
      y: [0],
      z: [[1, 2]],
    }], { xaxis: { type: 'log' } });
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([5.5, 55]);
  });

  it('preserves ragged heatmaps and transposes rectangular heatmaps', () => {
    const projection = figure([{
      type: 'heatmap',
      z: [[1, 2], [3]],
    }, {
      type: 'heatmap',
      z: [[1, 2], [3, 4]],
      transpose: true,
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'z')?.raw
    ))).toEqual([1, 2, 3]);
    expect(projection?.series[1]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'z')?.raw
    ))).toEqual([1, 3, 2, 4]);
  });

  it('projects cartesian points up to the shorter of x and y', () => {
    const projection = figure([{ type: 'scatter', x: [1, 2, 3], y: [4, 5] }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.map(({ path, raw }) => [path, raw]),
    ))).toEqual([{ x: 1, y: 4 }, { x: 2, y: 5 }]);
  });

  it('reuses prior Plotly categories for implicit origins', () => {
    const projection = figure([{
      type: 'scatter',
      x: ['A', 'B'],
      y: [1, 2],
    }, {
      type: 'scatter',
      y: [3, 4],
      x0: 'B',
      dx: 1,
    }], { xaxis: { type: 'category' } });
    expect(projection?.series[1]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([1, 2]);
  });

  it('uses an explicit Plotly category order for implicit origins', () => {
    const projection = figure([{
      type: 'scatter',
      y: [3, 4],
      x0: 'A',
      dx: 1,
      hovertemplate: '%{x}<extra></extra>',
    }], {
      xaxis: { type: 'category', categoryorder: 'array', categoryarray: ['B', 'A', 'C'] },
    });
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual([1, 2]);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.text
    ))).toEqual(['A', 'C']);
  });

  it('sorts discovered categories before resolving implicit origins', () => {
    const projection = figure([{
      type: 'scatter',
      x: ['B', 'A'],
      y: [1, 2],
    }, {
      type: 'scatter',
      y: [3],
      x0: 'A',
    }], { xaxis: { type: 'category', categoryorder: 'category ascending' } });
    expect(projection?.series[1]?.points[0]?.fields.find(({ path }) => path === 'x')).toMatchObject({
      raw: 0,
      text: 'A',
    });
  });

  it('uses Plotly lexical rather than locale category ordering', () => {
    const projection = figure([{
      type: 'scatter',
      x: ['Z', 'a'],
      y: [1, 2],
    }, {
      type: 'scatter',
      y: [3, 4],
      x0: 'Z',
    }], { xaxis: { type: 'category', categoryorder: 'category ascending' } });
    expect(projection?.series[1]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.text
    ))).toEqual(['Z', 'a']);
  });

  it('converts duplicate heatmap triplets into a last-write grid', () => {
    const projection = figure([{
      type: 'heatmap',
      x: [1, 1, 2],
      y: [0, 0, 1],
      z: [1, 2, 3],
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => ['x', 'y', 'z'].includes(path)).map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      { x: 1, y: 0, z: 2 },
      { x: 2, y: 0, z: undefined },
      { x: 1, y: 1, z: undefined },
      { x: 2, y: 1, z: 3 },
    ]);
  });

  it('bins heatmap triplets after Plotly axis conversion', () => {
    const projection = figure([{
      type: 'heatmap',
      x: [2, '1', 1],
      y: ['B', 'A', 'B'],
      z: [20, 10, 11],
    }], { yaxis: { type: 'category' } });
    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => ['x', 'y', 'z'].includes(path)).map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      { x: 1, y: 'B', z: 11 },
      { x: 2, y: 'B', z: 20 },
      { x: 1, y: 'A', z: 10 },
      { x: 2, y: 'A', z: undefined },
    ]);
  });

  it('uses Plotly calc length for unequal heatmap triplet columns', () => {
    const projection = figure([{
      type: 'heatmap',
      x: [1, 2, 3],
      y: [4, 5],
      z: [6, 7, 8],
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => ['x', 'y', 'z'].includes(path)).map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      { x: 1, y: 4, z: 6 },
      { x: 2, y: 4, z: undefined },
      { x: 1, y: 5, z: undefined },
      { x: 2, y: 5, z: 7 },
    ]);
  });

  it('applies category order and ignores uncoerced transpose on column-form heatmaps', () => {
    const projection = figure([{
      type: 'heatmap',
      x: ['B', 'A', 'B', 'A'],
      y: [1, 1, 2, 2],
      z: [1, 2, 3, 4],
    }, {
      type: 'heatmap',
      x: [0, 1, 0, 1],
      y: [0, 0, 1, 1],
      z: [1, 2, 3, 4],
      transpose: true,
    }], { xaxis: { type: 'category', categoryarray: ['A', 'B'] } });
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'x')?.raw
    ))).toEqual(['A', 'B', 'A', 'B']);
    expect(projection?.series[1]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'z')?.raw
    ))).toEqual([1, 2, 3, 4]);
  });

  it('returns no figure projection for native or Plotly tables', () => {
    expect(figure([{ type: 'table' }])).toBeUndefined();
    expect(figure([{ type: 'Table' }])).toBeUndefined();
  });

  it('fails loud for an unknown trace type', () => {
    expect(() => figure([{ type: 'violin', x: [1], y: [2] }])).toThrow(
      expect.objectContaining({
        name: 'DataVizFigureProjectionError',
        problem: 'invalid-figure-payload',
        detail: 'trace 0 has unknown trace type violin',
      }),
    );
  });

  it('preserves explicit null gaps instead of replacing them with point indices', () => {
    const projection = figure([{
      type: 'scatter',
      x: ['A', 'B'],
      y: [0.41, null],
      hovertemplate: 'value=%{y}<extra></extra>',
    }], { yaxis: { tickformat: '.0%' } });

    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'y')
    ))).toEqual([
      expect.objectContaining({ raw: 0.41, text: '41%' }),
      expect.objectContaining({ raw: null, text: '' }),
    ]);
  });

  it.each([
    [false, 'hidden'],
    ['legendonly', 'legend-only'],
    [true, 'visible'],
  ] as const)('preserves the distinct Plotly visibility state %s', (visible, visibility) => {
    expect(figure([{ type: 'scatter', x: [1], y: [2], visible }])?.series[0])
      .toMatchObject({ visibility });
  });

  it('coerces invalid Plotly visibility to visible', () => {
    expect(figure([{ type: 'scatter', x: [1], y: [2], visible: 'invalid' }])?.series[0])
      .toMatchObject({ visibility: 'visible' });
  });

  it.each([
    { type: 'pie', labels: ['A', 'B'], values: [1] },
    { type: 'sunburst', labels: ['A'], parents: ['', 'A'] },
  ])('fails loud rather than truncating malformed hierarchy cardinality', (trace) => {
    expect(() => figure([trace])).toThrow(DataVizFigureProjectionError);
  });

  it('projects pie percentages with their template format', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'B'],
      values: [3, 1],
      hovertemplate: '%{label}: %{percent:.1%}<extra></extra>',
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'percent')
    ))).toEqual([
      expect.objectContaining({ raw: 0.75, text: '75.0%' }),
      expect.objectContaining({ raw: 0.25, text: '25.0%' }),
    ]);
  });

  it('aggregates duplicate pie labels and excludes layout-hidden slices', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'A', 'B', 'Hidden'],
      values: [1, 2, 1, 100],
      hovertemplate: '%{label}: %{value} / %{percent:.0%}<extra></extra>',
    }], { hiddenlabels: ['Hidden'] });

    expect(fieldTexts(projection?.series[0], 'label')).toEqual(['A', 'B']);
    expect(fieldTexts(projection?.series[0], 'value')).toEqual(['3', '1']);
    expect(fieldTexts(projection?.series[0], 'percent')).toEqual(['75%', '25%']);
  });

  it('sorts pie slices and uses the first filled aggregate option', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'A', 'B'],
      values: [1, 2, 4],
      text: [null, 'second', 'largest'],
      hoverinfo: [null, 'label', 'value'],
      hovertemplate: '%{label}: %{text}<extra></extra>',
    }]);

    expect(fieldTexts(projection?.series[0], 'label')).toEqual(['B', 'A']);
    expect(fieldTexts(projection?.series[0], 'text')).toEqual(['largest', 'second']);
  });

  it('classifies pie colors after aggregation and sort order', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'A', 'B'],
      values: [1, 2, 4],
      marker: { colors: ['red', 'red', 'blue'] },
    }]);

    expect(projection?.series[0]?.style).not.toHaveProperty('color');
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.colors')?.raw
    ))).toEqual(['blue', 'red']);
  });

  it('resolves invalid pie colors through the Plotly colorway', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'B'],
      values: [1, 2],
      marker: { colors: [42, 'navy'] },
    }], { colorway: ['gold', 'pink'] });

    expect(projection?.chart.colorWay).toEqual(['gold', 'pink']);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.colors')?.raw
    ))).toEqual(['navy', 'gold']);
  });

  it('shares fallback pie colors by label across traces', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A'],
    }, {
      type: 'pie',
      labels: ['B', 'A'],
    }], { colorway: ['red', 'blue'] });

    expect(projection?.series.map(({ points }) => points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.colors')?.raw
    )))).toEqual([
      [undefined],
      ['blue', 'red'],
    ]);
    expect(projection?.series[0]?.style.color).toBe('red');
  });

  it.each([false, 'legendonly'])('does not allocate pie colors from visibility %s', (visible) => {
    const projection = figure([{
      type: 'pie',
      visible,
      labels: ['A'],
    }, {
      type: 'pie',
      labels: ['B'],
    }], { piecolorway: ['red', 'blue'], extendpiecolors: false });

    expect(projection?.series[0]?.style).not.toHaveProperty('color');
    expect(projection?.series[1]?.style.color).toBe('red');
  });

  it('reserves hidden pie colors and retries later valid duplicate colors', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['Hidden', 'A', 'A'],
      values: [3, 1, 1],
      marker: { colors: [42, 17, 'navy'] },
    }], {
      colorway: ['red', 'blue'],
      hiddenlabels: ['Hidden'],
    });

    expect(projection?.series[0]?.style.color).toBe('navy');
  });

  it('keeps Plotly null labels and explicit empty aggregate options', () => {
    const projection = figure([{
      type: 'pie',
      labels: [null, null, 'A', 'A'],
      values: [1, 2, 1, 1],
      text: ['null text', undefined, '', 'later text'],
      hovertemplate: '%{label}: %{text}',
      sort: false,
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      expect.objectContaining({ label: 'null', value: 3, percent: 0.6 }),
      expect.objectContaining({ label: 'A', value: 2, percent: 0.4, text: '' }),
    ]);
  });

  it('skips false when selecting Plotly aggregate pie options', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'A'],
      values: [1, 2],
      customdata: [false, 'later'],
      hovertemplate: '%{customdata}',
    }]);

    expect(fieldTexts(projection?.series[0], 'customdata')).toEqual(['later']);
  });

  it('uses unit weights when pie values are omitted', () => {
    const projection = figure([{
      type: 'pie',
      labels: ['A', 'A', 'B'],
      hovertemplate: '%{label}: %{value} / %{percent:.0%}<extra></extra>',
    }]);

    expect(fieldTexts(projection?.series[0], 'value')).toEqual(['2', '1']);
    expect(fieldTexts(projection?.series[0], 'percent')).toEqual(['67%', '33%']);
  });

  it('labels a missing or empty pie label by its source index', () => {
    const projection = figure([{
      type: 'pie',
      labels: [undefined, '', 'A'],
      values: [1, 2, 3],
    }]);

    expect(fieldTexts(projection?.series[0], 'label')).toEqual(['A', '1', '0']);
  });

  it('projects box samples into Plotly category summaries', () => {
    const projection = figure([{
      type: 'box',
      boxpoints: false,
      x: ['GBP', 'GBP', 'GBP', 'GBP', 'CAD', 'CAD', 'CAD', 'CAD', 'CAD'],
      y: [1, 2, 3, 4, 0, 0, 1, 2, 100],
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      {
        x: 'GBP',
        y: 2.5,
        category: 'GBP',
        minimum: 1,
        lowerFence: 1,
        q1: 1.5,
        median: 2.5,
        q3: 3.5,
        upperFence: 4,
        maximum: 4,
      },
      {
        x: 'CAD',
        y: 1,
        category: 'CAD',
        minimum: 0,
        lowerFence: 0,
        q1: 0,
        median: 1,
        q3: 26.5,
        upperFence: 26.5,
        maximum: 100,
      },
    ]);
  });

  it('keeps box fences on samples that sit exactly on the outlier limits', () => {
    const projection = figure([{
      type: 'box',
      boxpoints: false,
      x: Array.from({ length: 10 }, () => 'A'),
      y: [30, -10, -1, 2, 2, 2, 4, 4, 4, 7],
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.map(({ path, raw }) => [path, raw]),
    ))).toEqual([{
      x: 'A',
      y: 3,
      category: 'A',
      minimum: -10,
      lowerFence: -1,
      q1: 2,
      median: 3,
      q3: 4,
      upperFence: 7,
      maximum: 30,
    }]);
  });

  it('preserves the outlier markers shown by the default boxpoints mode', () => {
    const projection = figure([{
      type: 'box',
      x: ['A', 'A', 'A', 'A', 'A'],
      y: [0, 0, 1, 2, 100],
    }]);

    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'outliers', raw: [100] }),
    ]));
  });

  it('projects horizontal box samples with their category and value axes swapped', () => {
    const projection = figure([{
      type: 'box',
      orientation: 'h',
      x: [1, 2, 3, 4],
      y: ['GBP', 'GBP', 'GBP', 'GBP'],
    }]);

    expect(projection?.series[0]).toMatchObject({ orientation: 'h' });
    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'x', raw: 2.5 }),
      expect.objectContaining({ path: 'y', raw: 'GBP' }),
      expect.objectContaining({ path: 'median', raw: 2.5 }),
    ]));
  });

  it('summarizes a single-sample box at that sample', () => {
    const projection = figure([{ type: 'box', boxpoints: false, x: ['A'], y: [5] }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.map(({ path, raw }) => [path, raw]),
    ))).toEqual([{
      x: 'A',
      y: 5,
      category: 'A',
      minimum: 5,
      lowerFence: 5,
      q1: 5,
      median: 5,
      q3: 5,
      upperFence: 5,
      maximum: 5,
    }]);
  });

  it('projects implicit and axis-valued box categories', () => {
    const projection = figure([{
      type: 'box',
      y: [1, 2, 3, 4],
    }, {
      type: 'box',
      x: [2025, 2025, 2026, 2026],
      y: [1, 2, 3, 4],
    }]);

    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'x', raw: 0 }),
      expect.objectContaining({ path: 'median', raw: 2.5 }),
    ]));
    expect(projection?.series[1]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'category')?.raw
    ))).toEqual([2025, 2026]);
  });

  it('uses the box counter for a nonnumeric name on a linear position axis', () => {
    const projection = figure([{
      type: 'box',
      name: 'named',
      y: [1, 2, 3],
    }], { xaxis: { type: 'linear' } });
    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'category', raw: 0 }),
    ]));
    const decorated = figure([{
      type: 'box',
      name: '$1',
      y: [1, 2, 3],
    }], { xaxis: { type: 'linear' } });
    expect(decorated?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'category', raw: 0 }),
    ]));
  });

  it.each(['exclusive', 'inclusive', 'invalid']) (
    'fails loud for unsupported box quartilemethod %s',
    (quartilemethod) => {
      expect(() => figure([{
        type: 'box',
        quartilemethod,
        x: ['GBP', 'GBP'],
        y: [1, 2],
      }])).toThrow(DataVizFigureProjectionError);
    },
  );

  it.each([true, 'invalid']) (
    'fails loud for unsupported boxpoints mode %s',
    (boxpoints) => {
      expect(() => figure([{
        type: 'box',
        boxpoints,
        x: ['GBP', 'GBP'],
        y: [1, 2],
      }])).toThrow(DataVizFigureProjectionError);
    },
  );

  it('preserves all and suspected box sample-point modes', () => {
    const projection = figure([{
      type: 'box',
      x: ['A', 'A', 'A', 'A', 'A'],
      y: [1, 2, 3, 4, 100],
      boxpoints: 'all',
    }, {
      type: 'box',
      x: ['A', 'A', 'A', 'A', 'A'],
      y: [1, 2, 3, 4, 100],
      boxpoints: 'suspectedoutliers',
    }]);
    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'samplePoints', raw: [1, 2, 3, 4, 100] }),
    ]));
    expect(projection?.series[1]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'outliers', raw: [100] }),
      expect.objectContaining({ path: 'farOutliers', raw: [] }),
    ]));
  });

  it('uses marker-driven suspected box defaults', () => {
    const projection = figure([{
      type: 'box',
      x: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'],
      y: [1, 2, 3, 4, 5, 6, 7, 8, 100],
      marker: {
        outliercolor: 'red',
        line: { outliercolor: 'navy', outlierwidth: 2 },
      },
    }]);
    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'outliers', raw: [100] }),
      expect.objectContaining({ path: 'farOutliers', raw: [100] }),
    ]));
  });
});

describe('DataViz figure tooltip decomposition', () => {
  it('keeps bare meta point-scoped and indexed meta trace-scoped', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1, 2],
      y: [3, 4],
      meta: ['Desk A', 'USD'],
      hovertemplate: '%{meta}: %{meta[0]} %{meta[1]} %{y}<extra></extra>',
    }]);

    expect(projection?.series[0]?.tooltip).toMatchObject({
      constants: [
        { path: 'meta[0]', values: [{ text: 'Desk A' }, { text: 'Desk A' }] },
        { path: 'meta[1]', values: [{ text: 'USD' }, { text: 'USD' }] },
      ],
      pointFields: [
        { path: 'meta', values: [{ text: 'Desk A' }, { text: 'USD' }] },
        { path: 'y', values: [{ text: '3' }, { text: '4' }] },
      ],
    });

    const nested = figure([{
      type: 'scatter',
      x: [1, 2],
      y: [3, 4],
      meta: [{ desk: 'Desk A' }, { desk: 'Desk B' }],
      hovertemplate: '%{meta} %{meta.desk}<extra></extra>',
    }]);
    expect(fieldTexts(nested?.series[0], 'meta')).toEqual(['[object Object]', '[object Object]']);
    expect(fieldTexts(nested?.series[0], 'meta.desk')).toEqual(['Desk A', 'Desk B']);

    const nulls = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      meta: [null],
      customdata: [null],
      hovertemplate:
        '%{meta}/%{customdata}/%{customdata:.2f}/%{customdata|%Y}<extra></extra>',
    }]);
    expect(nulls?.series[0]?.tooltip?.constants.map(({ path, format, values }) => (
      [path, format, values[0]?.text]
    ))).toEqual([
      ['meta', undefined, 'null'],
      ['customdata', undefined, 'null'],
      ['customdata', '.2f', '0.00'],
      ['customdata', '%Y', '0NaN'],
    ]);
  });

  it('puts literals and repeated fields on the series while formatting varying fields per point', () => {
    const projection = figure([
      {
        type: 'bar',
        name: null,
        x: ['1m', '3m'],
        y: [0.12345, 0.2],
        customdata: [1_000_000, 1_000_000],
        hovertemplate:
          'Spread Benchmark — %{customdata:,.0f} EUR @ %{y:,.2f} dpm<extra></extra>',
      },
      {
        type: 'bar',
        name: null,
        x: ['1m', '3m'],
        y: [0.22345, 0.3],
        customdata: [1_000_000, 1_000_000],
        hovertemplate:
          'Spread Analyze — %{customdata:,.0f} EUR @ %{y:,.2f} dpm<extra></extra>',
      },
    ]);

    expect(projection?.series.map(({ id, identity }) => ({ id, identity }))).toEqual([
      { id: 'series-1', identity: 'Spread Benchmark — EUR @ dpm' },
      { id: 'series-2', identity: 'Spread Analyze — EUR @ dpm' },
    ]);
    expect(projection?.series[0]?.tooltip).toMatchObject({
      literalIdentity: 'Spread Benchmark — EUR @ dpm',
      constants: [
        {
          path: 'customdata',
          format: ',.0f',
          values: [
            { raw: 1_000_000, text: '1,000,000' },
            { raw: 1_000_000, text: '1,000,000' },
          ],
        },
      ],
      pointFields: [
        {
          path: 'y',
          format: ',.2f',
          values: [
            { raw: 0.12345, text: '0.12' },
            { raw: 0.2, text: '0.20' },
          ],
        },
      ],
    });
  });

  it('formats recorded numeric and date directives and nested customdata paths', () => {
    const projection = figure([
      {
        type: 'scatter',
        x: ['2026-08-20T00:00:00Z'],
        y: [0.126],
        customdata: [['EURUSD', { rank: 4 }]],
        hovertemplate:
          '%{x|%d-%b-%Y}: %{y:.1%} %{customdata[0]} %{customdata[1].rank}<extra>desk</extra>',
      },
    ]);

    expect(projection?.series[0]?.tooltip?.constants.map(({ path, values }) => (
      [path, values[0]?.text]
    ))).toEqual([
      ['x', '20-Aug-2026'],
      ['y', '12.6%'],
      ['customdata[0]', 'EURUSD'],
      ['customdata[1].rank', '4'],
    ]);
  });

  it('uses the axis format when a numeric tooltip placeholder omits a directive', () => {
    const projection = figure([
      {
        type: 'bar',
        x: ['Example option'],
        y: [0.4123456789],
        text: ['41%'],
        hovertemplate: 'answer=%{x}<br>votes=%{y}<br>text=%{text}<extra></extra>',
      },
    ], { yaxis: { tickformat: '.0%' } });

    expect(projection?.series[0]?.tooltip?.constants).toContainEqual(
      expect.objectContaining({
        path: 'y',
        format: '.0%',
        values: [{ raw: 0.4123456789, text: '41%' }],
      }),
    );
  });

  it.each([
    ['2026-08-20T00:00:00Z', '20-Aug-2026'],
    [Date.UTC(2026, 7, 20), '20-Aug-2026'],
  ])('uses a date-axis format for an unqualified tooltip value %s', (value, expected) => {
    const projection = figure([{
      type: 'scatter',
      x: [value],
      y: [1],
      hovertemplate: 'date=%{x}<extra></extra>',
    }], { xaxis: { type: 'date', tickformat: '%d-%b-%Y' } });

    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'x', raw: value, text: expected }),
    ]));
  });

  it.each([
    ['1', '0NaN-NaN-NaN NaN'],
    ['0', '0NaN-NaN-NaN NaN'],
    ['2020-01-01 12:00:00', '2020-01-01 12'],
  ])('uses Plotly strict UTC date parsing for %s', (value, expected) => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      customdata: [value],
      hovertemplate: '%{customdata|%Y-%m-%d %H}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'customdata')).toEqual([expected]);
  });

  it.each([
    [2020, '2020'],
    [1787184000000, '0NaN'],
  ])('uses Plotly date grammar for numeric auxiliary value %s', (value, expected) => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      customdata: [value],
      hovertemplate: '%{customdata|%Y}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'customdata')).toEqual([expected]);
  });

  it.each([
    [2020, '2020'],
    [1787184000000, '0NaN'],
  ])('uses Plotly date grammar for numeric linear coordinate %s', (value, expected) => {
    const projection = figure([{
      type: 'scatter',
      x: [value],
      y: [2],
      hovertemplate: '%{x|%Y}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'x')).toEqual([expected]);
  });

  it.each(['scatter3d', 'surface'] as const)(
    'uses a date-typed scene axis for %s coordinate epochs',
    (type) => {
      const epoch = Date.UTC(2026, 7, 20);
      const trace = type === 'surface'
        ? { type, x: [epoch], y: [1], z: [[2]] }
        : { type, x: [epoch], y: [1], z: [2] };
      const projection = figure([{
        ...trace,
        hovertemplate: '%{x|%Y}<extra></extra>',
      }], { scene: { xaxis: { type: 'date' } } });
      expect(fieldTexts(projection?.series[0], 'x')).toEqual(['2026']);
    },
  );

  it('resolves numbered scene and polar axes', () => {
    const epoch = Date.UTC(2026, 7, 20);
    const projection = figure([{
      type: 'scatter3d',
      scene: 'scene2',
      x: [epoch],
      y: [1],
      z: [2],
      hovertemplate: '%{x|%Y}<extra></extra>',
    }, {
      type: 'scatterpolar',
      subplot: 'polar2',
      r: [epoch],
      theta: [1],
      hovertemplate: '%{r|%Y}<extra></extra>',
    }], {
      scene2: { xaxis: { type: 'date' } },
      polar2: { radialaxis: { type: 'date' } },
    });
    expect(projection?.series.map(({ axes, points }) => ({
      axes,
      text: points[0]?.fields.find(({ path }) => path === 'x' || path === 'r')?.text,
    })))
      .toEqual([
        {
          axes: { x: 'scene2.xaxis', y: 'scene2.yaxis', z: 'scene2.zaxis' },
          text: '2026',
        },
        {
          axes: { radial: 'polar2.radialaxis', angular: 'polar2.angularaxis' },
          text: '2026',
        },
      ]);
  });

  it.each(['scene0', 'scene1', 'scene01'])(
    'coerces invalid Plotly scene counter %s to the default scene',
    (scene) => {
      const projection = figure([{
        type: 'scatter3d',
        scene,
        x: [Date.UTC(2026, 7, 20)],
        y: [1],
        z: [2],
        hovertemplate: '%{x|%Y}<extra></extra>',
      }], { scene: { xaxis: { type: 'date' } } });
      expect(projection?.series[0]?.axes).toMatchObject({ x: 'scene.xaxis' });
      expect(fieldTexts(projection?.series[0], 'x')).toEqual(['2026']);
    },
  );

  it('normalizes the Plotly layout.scene1 alias with matching trace fallback', () => {
    const projection = figure([{
      type: 'scatter3d',
      scene: 'scene1',
      x: [Date.UTC(2026, 7, 20)],
      y: [1],
      z: [2],
      hovertemplate: '%{x|%Y}<extra></extra>',
    }], {
      template: { layout: { scene: { xaxis: { type: 'linear' } } } },
      scene1: { xaxis: { type: 'date' } },
    });
    expect(projection?.series[0]?.axes).toMatchObject({ x: 'scene.xaxis' });
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['2026']);
  });

  it.each([
    ['x', 'xaxis1', 'xaxis'],
    ['y', 'yaxis1', 'yaxis'],
  ] as const)(
    'normalizes the Plotly layout.%saxis1 alias',
    (dimension, alias, canonical) => {
      const projection = figure([{
        type: 'scatter',
        [`${dimension}axis`]: `${dimension}1`,
        x: [Date.UTC(2026, 7, 20)],
        y: [Date.UTC(2026, 7, 20)],
        hovertemplate: `%{${dimension}|%Y}<extra></extra>`,
      }], { [alias]: { type: 'date' } });
      expect(projection?.series[0]?.axes).toMatchObject({ [dimension]: canonical });
      expect(fieldTexts(projection?.series[0], dimension)).toEqual(['2026']);
    },
  );

  it('uses Plotly truthiness when cleaning layout axis aliases', () => {
    const ignored = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
    }], {
      xaxis: null,
      xaxis1: null,
      coloraxis: null,
      scene: null,
      scene1: null,
      polar: null,
    });
    expect(ignored?.axes).toEqual([]);

    const promoted = figure([{
      type: 'scatter',
      xaxis: 'x1',
      x: [Date.UTC(2026, 7, 20)],
      y: [1],
      hovertemplate: '%{x|%Y}<extra></extra>',
    }], { xaxis: null, xaxis1: { type: 'date' } });
    expect(fieldTexts(promoted?.series[0], 'x')).toEqual(['2026']);
  });

  it.each(['x0', 'x1', 'x01'])(
    'coerces invalid Plotly cartesian counter %s to the default axis',
    (xaxis) => {
      const projection = figure([{
        type: 'scatter',
        xaxis,
        x: [Date.UTC(2026, 7, 20)],
        y: [1],
        hovertemplate: '%{x|%Y}<extra></extra>',
      }], { xaxis: { type: 'date' } });
      expect(projection?.series[0]?.axes).toMatchObject({ x: 'xaxis' });
      expect(fieldTexts(projection?.series[0], 'x')).toEqual(['2026']);
    },
  );

  it('preserves Plotly sub-millisecond date rounding', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      customdata: ['2020-01-01 00:00:00.99999'],
      hovertemplate: '%{customdata|%S.%L}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'customdata')).toEqual(['01.000']);
  });

  it('supports the full d3 date vocabulary and Plotly extensions', () => {
    const projection = figure([{
      type: 'scatter',
      x: ['2026-08-20 13:05:06.123'],
      y: [2],
      hovertemplate: '%{x|%I %p %q %Z %h %3f}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['01 PM 3 +0000 2 123']);
  });

  it('matches Plotly half-year formatting for an invalid date', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      customdata: [null],
      hovertemplate: '%{customdata|%h}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'customdata')).toEqual(['1']);
  });

  it('preserves point-specific hover templates', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1, 2],
      y: [3, 4],
      hovertemplate: [
        'left=%{y:.1f}<extra>A</extra>',
        'right=%{x}<extra>B</extra>',
      ],
    }]);
    expect(projection?.series[0]?.tooltip).toEqual({
      literalIdentity: '',
      constants: [],
      pointFields: [
        { path: 'y', format: '.1f', values: [{ raw: 3, text: '3.0' }, { raw: 4, text: '' }] },
        { path: 'x', values: [{ raw: 1, text: '' }, { raw: 2, text: '2' }] },
      ],
    });
  });

  it('does not extend a short stable hovertemplate array or validate unused formats', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1, 2, 3],
      y: [4, 5, 6],
      customdata: [1.25, 'not numeric', 3],
      hovertemplate: ['%{customdata:.1f}', 'literal'],
    }]);
    expect(fieldTexts(projection?.series[0], 'customdata')).toEqual(['1.3', undefined, undefined]);
  });

  it('fails loud when a numeric directive receives a non-number', () => {
    expect(() => figure([
      {
        type: 'scatter',
        x: [1],
        y: ['not-a-number'],
        hovertemplate: '%{y:.2f}',
      },
    ])).toThrow(DataVizFigureProjectionError);
  });

  it('keeps all 12 unnamed traces with hovertemplate identities', () => {
    const notionals = [1_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 75_000_000];
    const traces = [...notionals, ...notionals].map((notional, index) => {
      const pointCount = index < 6 ? 24 : 1;
      return {
        type: 'bar',
        name: null,
        x: Array.from({ length: pointCount }, (_, point) => String(point + 1)),
        y: Array.from({ length: pointCount }, (_, point) => index + point + 0.125),
        customdata: Array.from({ length: pointCount }, () => notional),
        hovertemplate:
          `<b>Spread ${index < 6 ? 'Benchmark' : 'Analyze'}</b><br>%{customdata:,.0f} EUR @ %{y:,.2f} dpm<extra></extra>`,
      };
    });

    const projection = figure(traces);

    expect(projection?.series).toHaveLength(12);
    expect(projection?.series.map(({ id }) => id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `series-${index + 1}`),
    );
    expect(projection?.series.map(({ identity }) => identity)).toEqual(
      Array.from({ length: 12 }, (_, index) => (
        `Spread ${index < 6 ? 'Benchmark' : 'Analyze'} EUR @ dpm`
      )),
    );
    expect(projection?.series.map(({ tooltip }) => tooltip?.constants[0]?.values[0]?.raw)).toEqual([
      ...notionals,
      ...notionals,
    ]);
    expect(projection?.series.map(({ points }) => points.length)).toEqual([
      24, 24, 24, 24, 24, 24, 1, 1, 1, 1, 1, 1,
    ]);
    expect(fieldTexts(projection?.series[0], 'y')?.[0]).toBe('0.13');
    expect(fieldTexts(projection?.series[6], 'y')).toEqual(['6.13']);
  });
});

describe('DataViz figure metadata granularity', () => {
  it('merges inherited Plotly layout defaults with explicit axis settings', () => {
    const projection = figure([{ type: 'scatter', x: [1], y: [2] }], {
      template: {
        layout: {
          paper_bgcolor: 'transparent',
          xaxis: {
            showline: true,
            showgrid: true,
            title: { font: { size: 12 } },
          },
        },
      },
      xaxis: {
        showgrid: false,
        title: { text: 'Tenor' },
      },
    });

    expect(projection?.axes).toContainEqual(expect.objectContaining({
      id: 'xaxis',
      title: 'Tenor',
    }));
  });

  it('cycles inherited Plotly trace defaults before projecting series metadata', () => {
    const projection = figure([
      { type: 'scatter', x: [1], y: [2] },
      { type: 'scatter', x: [2], y: [3] },
      { type: 'scatter', x: [3], y: [4] },
    ], {
      template: {
        data: {
          scatter: [
            {
              hovertemplate: 'inherited=%{y:.1f}<extra></extra>',
              marker: { sizemode: 'area', sizeref: 0 },
            },
            { marker: { symbol: 'diamond' } },
          ],
        },
      },
    });

    expect(projection?.series.map(({ tooltip }) => tooltip?.mainTemplate)).toEqual([
      'inherited=%{y:.1f}',
      undefined,
      'inherited=%{y:.1f}',
    ]);
    expect(projection?.series.map((series) => fieldTexts(series, 'y'))).toEqual([
      ['2.0'],
      ['3'],
      ['4.0'],
    ]);
  });

  it('defaults an omitted trace type to scatter before selecting its template', () => {
    const projection = figure([{ x: [1], y: [2] }], {
      template: {
        data: {
          scatter: [{ hovertemplate: 'inherited=%{y:.1f}<extra></extra>' }],
        },
      },
    });

    expect(projection?.series[0]).toMatchObject({
      traceType: 'scatter',
      tooltip: { mainTemplate: 'inherited=%{y:.1f}' },
    });
    expect(fieldTexts(projection?.series[0], 'y')).toEqual(['2.0']);
  });

  it('uses Plotly template values when explicit nested values are null', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      hovertemplate: null,
    }], {
      template: {
        layout: { xaxis: { tickformat: '.1f' } },
        data: {
          scatter: [{ hovertemplate: 'inherited=%{y:.1f}<extra></extra>' }],
        },
      },
      xaxis: { tickformat: null },
    });

    expect(projection?.axes).toContainEqual(expect.objectContaining({
      id: 'xaxis',
      tickFormat: '.1f',
    }));
    expect(projection?.series[0]?.tooltip?.mainTemplate).toBe('inherited=%{y:.1f}');
    expect(fieldTexts(projection?.series[0], 'y')).toEqual(['2.0']);
  });

  it('preserves explicit null metadata instead of inheriting template metadata', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      meta: null,
    }], {
      template: {
        data: {
          scatter: [{
            meta: 'inherited',
            hovertemplate: 'meta=%{meta}<extra></extra>',
          }],
        },
      },
    });

    expect(fieldTexts(projection?.series[0], 'meta')).toEqual(['null']);
  });

  it('projects varying basic text presentation at point granularity', () => {
    const projection = figure([{
      type: 'bar',
      x: ['A', 'B'],
      y: [1, 2],
      textposition: ['inside', 'outside'],
      textfont: {
        family: ['Inter', 'Arial'],
        size: [12, 14],
        color: ['navy', 'gold'],
        weight: [400, 'bold'],
        style: ['normal', 'italic'],
      },
    }]);
    expect(projection?.series[0]?.style).not.toHaveProperty('textPosition');
    expect(projection?.series[0]?.style).not.toHaveProperty('textFont');
    expect(projection?.series[0]?.points[1]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'textposition', raw: 'outside' }),
      expect.objectContaining({ path: 'textfont.family', raw: 'Arial' }),
      expect.objectContaining({ path: 'textfont.size', raw: 14 }),
      expect.objectContaining({ path: 'textfont.color', raw: 'gold' }),
      expect.objectContaining({ path: 'textfont.weight', raw: 'bold' }),
      expect.objectContaining({ path: 'textfont.style', raw: 'italic' }),
    ]));
  });

  it('omits varying basic text styles on individually hidden points', () => {
    const projection = figure([{
      type: 'bar',
      x: ['A', 'B'],
      y: [1, 2],
      textposition: ['none', 'outside'],
      textfont: { color: ['red', 'blue'] },
    }]);
    expect(projection?.series[0]?.points[0]?.fields).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'textfont.color' }),
    ]));
    expect(projection?.series[0]?.points[1]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'textfont.color', raw: 'blue' }),
    ]));
  });

  it('projects surfacecolor with c-domain semantics', () => {
    const projection = figure([{
      type: 'surface',
      z: [[0, 0]],
      surfacecolor: [[0, 100]],
      coloraxis: 'coloraxis',
    }, {
      type: 'surface',
      z: [[0, 10]],
      surfacecolor: [[0, 10]],
      cmin: 0,
      cmax: 100,
      colorscale: [[0, 'red'], [1, 'blue']],
    }], {
      coloraxis: { cauto: true, colorscale: [[0, 'red'], [1, 'blue']] },
    });
    expect(projection?.series[0]?.points.map((point) => (
      point.fields.find(({ path }) => path === 'surfacecolor')?.raw
    ))).toEqual([0, 100]);
    expect(figure([{
      type: 'surface', z: [[0, 10]], surfacecolor: null,
    }])?.series[0]?.points.map((point) => (
      point.fields.find(({ path }) => path === 'z')?.raw
    ))).toEqual([0, 10]);
  });

  it('prefers trace hover formats over axis tick formats', () => {
    const projection = figure([{
      type: 'scatter',
      x: [0.415],
      y: [2],
      xhoverformat: '.1%',
      hovertemplate: '%{x}<extra></extra>',
    }], { xaxis: { tickformat: '.0%' } });
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['41.5%']);
  });

  it('recognizes the full Plotly date vocabulary in a trace hover format', () => {
    const projection = figure([{
      type: 'scatter',
      x: ['2026-08-20'],
      y: [1],
      xhoverformat: '%q',
      hovertemplate: '%{x}<extra></extra>',
    }]);
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['3']);
  });

  it('prefers an axis hover format over its tick format', () => {
    const projection = figure([{
      type: 'scatter',
      x: [0.415],
      y: [1],
      hovertemplate: '%{x}<extra></extra>',
    }], { xaxis: { hoverformat: '.1%', tickformat: '.0%' } });
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['41.5%']);
  });

  it('falls back from an empty axis hover format to its tick format', () => {
    const projection = figure([{
      type: 'scatter',
      x: [0.415],
      y: [1],
      hovertemplate: '%{x}<extra></extra>',
    }], { xaxis: { hoverformat: '', tickformat: '.0%' } });
    expect(fieldTexts(projection?.series[0], 'x')).toEqual(['42%']);
  });

  it('projects the sunburst path and percentage fields', () => {
    const projection = figure([{
      type: 'sunburst',
      labels: ['Root', 'Child'],
      parents: ['', 'Root'],
      values: [100, 25],
      branchvalues: 'total',
    }]);

    expect(Object.fromEntries(projection?.series[0]?.points[1]?.fields.map(({ path, raw }) => (
      [path, raw]
    )) ?? [])).toMatchObject({
      currentPath: 'Root/',
      percentParent: 0.25,
      percentEntry: 0.25,
      percentRoot: 0.25,
    });
    expect(projection?.series[0]?.points[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'currentPath', raw: '/' }),
    ]));
    // Plotly leaves the root uncoloured and gives its child the default template's first colour.
    expect(fieldTexts(projection?.series[0], 'color')).toEqual(['rgba(0,0,0,0)', '#636efa']);
  });

  it('fails loud when a numeric directive receives a non-string, non-number value', () => {
    expect(() => figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      customdata: [[true]],
      hovertemplate: '%{customdata[0]:.2f}',
    }])).toThrow(DataVizFigureProjectionError);
  });

  it('retains hover templates independently from none and skip hoverinfo', () => {
    const projection = figure([
      {
        type: 'scatter',
        x: [1],
        y: [2],
        hoverinfo: 'none',
        hovertemplate: 'value=%{y}<extra></extra>',
      },
      {
        type: 'sunburst',
        labels: ['A'],
        parents: [''],
        values: [1],
        hoverinfo: 'skip',
        hovertemplate: 'value=%{value}<extra></extra>',
      },
    ]);

    expect(projection?.series.map(({ tooltip }) => tooltip?.mainTemplate)).toEqual([
      'value=%{y}',
      'value=%{value}',
    ]);
  });

  it.each([
    {
      labels: ['Root', 'Orphan'],
      parents: ['', 'Missing'],
      values: [1, 1],
    },
    {
      labels: ['A', 'B'],
      parents: ['Missing A', 'Missing B'],
      values: [1, 1],
    },
    {
      labels: ['Root', 'Child'],
      parents: ['', 'Root'],
      values: [1, 2],
      branchvalues: 'total',
    },
  ])('fails loud when Plotly cannot build a sunburst hierarchy', (trace) => {
    expect(() => figure([{ type: 'sunburst', ...trace }])).toThrow(DataVizFigureProjectionError);
  });

  it.each([
    { type: 'pie', labels: ['A', 'B'], values: [3, 1] },
    { type: 'sunburst', labels: ['A', 'B'], parents: ['', 'A'] },
  ])('binds no axes to a $type trace', (trace) => {
    expect(figure([trace])?.series[0]?.axes).toEqual({});
  });

  it('projects treemap tiles with the hover measures their template binds', () => {
    const link = '<a style="color:black" href="https://example.com/s/products/FAKE/summary">EXAM HK</a>';
    const series = figure([{
      type: 'treemap',
      branchvalues: 'total',
      labels: ['Banks', link, 'TEST HK'],
      parents: ['', 'Banks', 'Banks'],
      ids: ['Banks', `Banks/${link}`, 'Banks/TEST HK'],
      values: [0.1, 0.0123456789, 0.0876543210],
      customdata: [[12.345678901, '(?)'], [98.76, 0.0123456789], [15.43, 0.0876543210]],
      marker: { colors: [12.345678901, 98.76, 15.43], coloraxis: 'coloraxis' },
      hovertemplate: '<b>%{label}</b><br><b>Returns: %{customdata[0]:.2f}%</b><br><b>Net Weight: %{customdata[1]:.4f}</b>',
    }], { coloraxis: { cmid: 0, showscale: false } })?.series[0];

    expect(series?.traceType).toBe('treemap');
    expect(series?.axes).toEqual({});
    expect(series?.style).toEqual({});
    expect(fieldTexts(series, 'label')).toEqual(['Banks', 'EXAM HK', 'TEST HK']);
    expect(fieldTexts(series, 'id')).toEqual(['Banks', 'Banks/EXAM HK', 'Banks/TEST HK']);
    expect(series?.points[1]?.fields.find(({ path }) => path === 'label')?.raw).toBe(link);
    expect(fieldTexts(series, 'customdata[0]')).toEqual(['12.35', '98.76', '15.43']);
    // Web's Plotly formats the '(?)' aggregate sentinel as NaN.
    expect(fieldTexts(series, 'customdata[1]')).toEqual(['NaN', '0.0123', '0.0877']);
    expect(fieldTexts(series, 'currentPath')).toEqual(['/', 'Banks/', 'Banks/']);
    expect(fieldTexts(series, 'marker.colors')).toEqual(['12.345678901', '98.76', '15.43']);
    expect(series?.points[1]?.fields.map(({ path }) => path)).not.toContain('color');
  });

  it.each([
    { name: 'no marker', marker: undefined },
    { name: 'no colors', marker: {} },
    { name: 'palette colors', marker: { colors: ['red', 'blue'] } },
    { name: 'mixed colors', marker: { colors: [1, 'red'] } },
  ])('fails loud on unevidenced treemap colors: $name', ({ marker }) => {
    expect(() => figure([{
      type: 'treemap',
      labels: ['A', 'B'],
      parents: ['', 'A'],
      ...(marker === undefined ? {} : { marker }),
    }])).toThrow('trace 0 uses unevidenced treemap colors');
  });

  it('sums remainder sunburst branches from their own value and their children', () => {
    const projection = figure([{
      type: 'sunburst',
      labels: ['Root', 'A', 'B'],
      parents: ['', 'Root', 'Root'],
      values: [1, 2, 3],
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'percentParent')?.raw
    ))).toEqual([1, 2 / 6, 3 / 6]);
  });

  it('counts sunburst leaves when values are omitted', () => {
    const projection = figure([{
      type: 'sunburst',
      labels: ['Root', 'A', 'B'],
      parents: ['', 'Root', 'Root'],
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'percentParent')?.raw
    ))).toEqual([1, 0.5, 0.5]);
  });

  it('shares sunburst label colors across traces, keeping the first explicit color', () => {
    const colors = (projection: ReturnType<typeof figure>) => projection?.series.map(({ points }) => (
      points.map(({ fields }) => fields.find(({ path }) => path === 'color')?.raw)
    ));

    expect(colors(figure([
      { type: 'sunburst', labels: ['A', 'B'], parents: ['', ''], marker: { colors: ['red', 'blue'] } },
      { type: 'sunburst', labels: ['A'], parents: [''], marker: { colors: ['green'] } },
      { type: 'sunburst', labels: ['A', 'B'], parents: ['', ''] },
    ], { sunburstcolorway: ['gold'] }))).toEqual([['red', 'blue'], ['green'], ['red', 'blue']]);
    expect(colors(figure([
      { type: 'sunburst', labels: ['A', 'B'], parents: ['', ''] },
      { type: 'sunburst', labels: ['B', 'C'], parents: ['', ''] },
    ], { colorway: ['red', 'blue', 'gold'] }))).toEqual([['red', 'blue'], ['blue', 'gold']]);
  });

  it('materializes a single implied sunburst root in currentPath', () => {
    const projection = figure([{
      type: 'sunburst',
      labels: ['Child'],
      parents: ['Root'],
      values: [1],
      hovertemplate: '%{currentPath}<extra></extra>',
    }]);

    expect(fieldTexts(projection?.series[0], 'currentPath')).toEqual(['Root/']);
  });

  it('projects only sunburst sectors visible within maxdepth and level', () => {
    const projection = figure([{
      type: 'sunburst',
      ids: ['A', 'B', 'C', 'D'],
      labels: ['A', 'B', 'C', 'D'],
      parents: ['', 'A', 'B', 'A'],
      values: [10, 4, 2, 4],
      level: 'B',
      maxdepth: 2,
      textfont: { size: [10, 10, 20, 30] },
    }]);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'id')?.raw
    ))).toEqual(['B', 'C']);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'textfont.size')?.raw
    ))).toEqual([10, 20]);
  });

  it.each([
    { colorscale: [[0, 'red'], [1, 'blue']], style: {} },
    { colorscale: [[0.1, 'red'], [1, 'blue']], style: { paletteSlot: 1 } },
    { colorscale: [[0, 'red'], [0.9, 'blue']], style: { paletteSlot: 1 } },
  ])('colors a heatmap by a colorscale only when its stops run from 0 to 1 %#', ({ colorscale, style }) => {
    const projection = figure([{ type: 'heatmap', z: [[null, null]], colorscale }]);

    expect(projection?.series[0]?.style).toEqual(style);
  });

  it('activates a shared color axis from a heatmap matrix', () => {
    const projection = figure([{
      type: 'heatmap',
      z: [[1, 2]],
      coloraxis: 'coloraxis',
    }], {
      coloraxis: { reversescale: true, showscale: false },
    });

    expect(projection?.series[0]?.style).not.toHaveProperty('paletteSlot');
    expect(projection?.series[0]?.axes).toMatchObject({ color: 'coloraxis' });
    expect(projection?.axes[0]).toMatchObject({ id: 'coloraxis', dimension: 'color' });
  });

  it('keeps axis metadata once, series style once, and varying colors per point', () => {
    const projection = figure([
      {
        type: 'scatter',
        name: 'Carry',
        legendgroup: 'rates',
        x: [1, 2],
        y: [0.1, 0.2],
        marker: { color: ['red', 'blue'], symbol: 'circle', size: [6, 10] },
        line: { color: '#123456', dash: 'dash', width: 1.5 },
        xaxis: 'x2',
        yaxis: 'y',
      },
    ], {
      xaxis2: {
        title: { text: 'Tenor' },
        tickformat: ',.1f',
        range: [0, 3],
        visible: false,
      },
      yaxis: { title: { text: 'Carry' }, tickformat: '.1%' },
    });

    expect(projection?.axes).toEqual([
      expect.objectContaining({
        id: 'xaxis2',
        dimension: 'x',
        title: 'Tenor',
        tickFormat: ',.1f',
        visible: false,
      }),
      expect.objectContaining({ id: 'yaxis', dimension: 'y', title: 'Carry', tickFormat: '.1%' }),
    ]);
    expect(projection?.series[0]).toMatchObject({
      identity: 'Carry',
      axes: { x: 'xaxis2', y: 'yaxis' },
      style: {
        color: '#123456',
        line: { dash: 'dash' },
      },
      visibility: 'visible',
    });
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.color')?.raw
    ))).toEqual(['red', 'blue']);
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.size')?.raw
    ))).toEqual([6, 10]);
  });

  it('accepts Plotly named colors while rejecting malformed CSS colors', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      marker: { color: 'rebeccapurple' },
    }]);

    expect(projection?.series[0]?.style).toMatchObject({ color: 'rebeccapurple' });
    expect(() => figure([{
      type: 'scatter',
      x: [1],
      y: [2],
      marker: { color: 'rgb(bogus)' },
    }])).toThrow(DataVizFigureProjectionError);
  });

  it('classifies marker color arrays at series or point granularity', () => {
    const projection = figure([
      {
        type: 'bar',
        x: ['A', 'B'],
        y: [1, 2],
        marker: { color: ['#980c13', '#980c13'] },
      },
      {
        type: 'bar',
        x: ['A', 'B'],
        y: [1, 2],
        marker: { color: ['blue', 'red'] },
      },
    ]);

    expect(projection?.series[0]?.style).toMatchObject({ color: '#980c13' });
    expect(projection?.series[0]?.points.every(({ fields }) => (
      fields.every(({ path }) => path !== 'marker.color')
    ))).toBe(true);
    expect(projection?.series[1]?.style).not.toHaveProperty('paletteSlot');
    expect(projection?.series[1]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.color')?.raw
    ))).toEqual(['blue', 'red']);
  });

  it('preserves numeric marker colors', () => {
    const projection = figure([
      {
        type: 'scatter',
        x: [1, 2],
        y: [3, 4],
        marker: {
          color: [2, 2],
          cmin: 0,
          cmax: 4,
          colorscale: 'Viridis',
          coloraxis: 'coloraxis2',
          line: {
            color: [1, 3],
            cmin: 0,
            cmid: 2,
            cmax: 4,
            colorscale: [[0, 'goldenrod'], [1, 'navy']],
            reversescale: true,
          },
        },
      },
      {
        type: 'scatter',
        x: [1, 2],
        y: [3, 4],
        marker: { line: { color: [1, 3], coloraxis: 'coloraxis3' } },
      },
    ]);

    expect(projection?.series[0]?.style).toMatchObject({ color: 2 });
    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.line.color')?.raw
    ))).toEqual([1, 3]);
  });

  it('keeps short arrayOk marker styles on the populated points', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1, 2],
      y: [3, 4],
      marker: {
        opacity: [0.5],
        line: { color: ['navy'], width: [2] },
      },
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => path.startsWith('marker.')).map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      {
        'marker.opacity': 0.5,
        'marker.line.color': 'navy',
        'marker.line.width': 2,
      },
      {},
    ]);
  });

  it('projects scatter3d arrayOk line colors and marker symbols per point', () => {
    const projection = figure([{
      type: 'scatter3d',
      x: [1, 2],
      y: [3, 4],
      z: [5, 6],
      line: {
        color: [1, 2],
        cmin: 0,
        cmax: 3,
        colorscale: 'Viridis',
      },
      marker: { symbol: ['circle', 'square'] },
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => Object.fromEntries(
      fields.filter(({ path }) => path === 'line.color' || path === 'marker.symbol')
        .map(({ path, raw }) => [path, raw]),
    ))).toEqual([
      { 'line.color': 1, 'marker.symbol': 'circle' },
      { 'line.color': 2, 'marker.symbol': 'square' },
    ]);
  });

  it('activates a sunburst shared color axis with string marker.colors', () => {
    const projection = figure([{
      type: 'sunburst',
      labels: ['Root', 'Child'],
      parents: ['', 'Root'],
      values: [2, 1],
      marker: {
        colors: ['red', 'blue'],
        coloraxis: 'coloraxis',
      },
    }], {
      coloraxis: { reversescale: true, showscale: false },
    });

    expect(projection?.axes[0]).toMatchObject({ id: 'coloraxis', dimension: 'color' });
  });

  it.each([
    { type: 'bar', marker: { symbol: 'diamond' }, coordinates: { x: ['A'], y: [1] } },
    { type: 'bar', marker: { size: 9 }, coordinates: { x: ['A'], y: [1] } },
    { type: 'heatmap', marker: { color: 'red' }, coordinates: { z: [[1]] } },
    { type: 'heatmap', marker: { opacity: 0.5 }, coordinates: { z: [[1]] } },
    { type: 'pie', marker: { color: ['red', 'blue'] }, coordinates: { labels: ['A', 'B'] } },
  ])('ignores trace-unsupported scalar marker settings %#', ({ type, marker, coordinates }) => {
    expect(figure([{ type, marker, ...coordinates }])).toEqual(figure([{ type, ...coordinates }]));
  });

  it('fails loud for a trace-invalid box marker color array', () => {
    expect(() => figure([{
      type: 'box',
      x: ['A', 'A'],
      y: [1, 2],
      marker: { color: ['red', 'blue'] },
    }])).toThrow(DataVizFigureProjectionError);
  });

  it('projects box mean and scaled deviation for sizemode sd', () => {
    const projection = figure([{
      type: 'box',
      x: ['A', 'A', 'A'],
      y: [1, 2, 3],
      sizemode: 'sd',
      sdmultiple: 2,
    }]);
    const fields = Object.fromEntries(projection?.series[0]?.points[0]?.fields.map(({ path, raw }) => (
      [path, raw]
    )) ?? []);

    expect(fields.mean).toBe(2);
    expect(fields.standardDeviation).toBeCloseTo(1.6329931619);
  });

  it.each([
    { option: { quartilemethod: 'exclusive' }, detail: 'unsupported box quartilemethod exclusive' },
    { option: { sizemode: 'area' }, detail: 'unsupported box sizemode area' },
    { option: { sdmultiple: 'wide' }, detail: 'invalid box sdmultiple wide' },
    { option: { sdmultiple: -1 }, detail: 'invalid box sdmultiple -1' },
  ])('names the unsupported box option: $detail', ({ option, detail }) => {
    expect(() => figure([{ type: 'box', x: ['A'], y: [1], ...option }])).toThrow(
      expect.objectContaining({ detail }),
    );
  });

  it('keeps a short marker-size array on its populated point', () => {
    const projection = figure([{
      type: 'scatter',
      x: [1, 2],
      y: [3, 4],
      marker: { size: [8] },
    }]);

    expect(projection?.series[0]?.points.map(({ fields }) => (
      fields.find(({ path }) => path === 'marker.size')?.raw
    ))).toEqual([8, undefined]);
  });

});


describe('DataViz trace display boundaries', () => {
  it('reports a non-string trace name as an unknown trace type', () => {
    expect(() => figure([{ type: ['treemap'] }])).toThrow('has unknown trace type');
  });

  it('numbers unnamed boxes independently of intervening trace types', () => {
    const projection = figure([
      { type: 'scatter', x: [1], y: [2] },
      { type: 'box', y: [1, 3] },
      { type: 'bar', x: ['A'], y: [2] },
      { type: 'box', y: [4, 6] },
    ]);
    expect(fieldTexts(projection?.series[1], 'x')).toEqual(['0']);
    expect(fieldTexts(projection?.series[3], 'x')).toEqual(['1']);
  });

  it('keeps an empty pie out of the default series palette', () => {
    expect(figure([{ type: 'pie', labels: [], values: [] }])?.series[0]?.style).toEqual({});
  });

  it.each([
    { type: 'surface', cmin: 0, cmax: 1, style: {} },
    { type: 'surface', zmin: 0, zmax: 1, style: { paletteSlot: 1 } },
    { type: 'heatmap', zmin: 0, zmax: 1, style: {} },
    { type: 'heatmap', cmin: 0, cmax: 1, style: { paletteSlot: 1 } },
  ])('elects the $type color domain from its own scale bounds', ({ style, ...trace }) => {
    expect(figure([{ ...trace, z: [[null]] }])?.series[0]?.style).toEqual(style);
  });

  it('does not treat arbitrary scatter z values as a trace color scale', () => {
    expect(figure([{
      type: 'scatter', x: [1], y: [2], z: [3],
    }])?.series[0]?.style).toEqual({ paletteSlot: 1 });
  });

  it('rejects array line colors on a two-dimensional scatter', () => {
    expect(() => figure([{
      type: 'scatter', x: [1, 2], y: [3, 4], line: { color: ['red', 'blue'] },
    }])).toThrow('line.color is not array-valued for this trace');
  });

  it.each([false, 'legendonly'])(
    'does not seed visible sunburst colors from a trace with visibility %s',
    (visible) => {
      const projection = figure([
        { type: 'sunburst', visible, labels: ['A'], parents: [''], marker: { colors: ['red'] } },
        { type: 'sunburst', labels: ['A', 'B'], parents: ['', ''] },
      ], { sunburstcolorway: ['gold'], extendsunburstcolors: false });
      expect(fieldTexts(projection?.series[1], 'color')).toEqual(['gold', 'gold']);
    },
  );

  it('does not seed sunburst colors from a pie with the same label', () => {
    const projection = figure([
      { type: 'pie', labels: ['A'], values: [1], marker: { colors: ['red'] } },
      { type: 'sunburst', labels: ['A', 'B'], parents: ['', ''] },
    ], { sunburstcolorway: ['gold'], extendsunburstcolors: false });
    expect(fieldTexts(projection?.series[1], 'color')).toEqual(['gold', 'gold']);
  });

  it('omits varying text positions when the scatter mode has no text', () => {
    const projection = figure([{
      type: 'scatter', x: [1, 2], y: [3, 4], mode: 'markers',
      textposition: ['top left', 'bottom right'],
    }]);
    expect(fieldTexts(projection?.series[0], 'textposition')).toEqual([undefined, undefined]);
  });
});
