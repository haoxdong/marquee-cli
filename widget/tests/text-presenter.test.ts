// @format

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectDataVizFigure } from '../data-viz/figure-lane.js';
import { projectDataVizTable } from '../data-viz/table-lane.js';
import { projectPlotTool } from '../plottool/projection.js';
import {
  presentWidgetChart,
  WidgetTextPresenterError,
} from '../text-presenter.js';

function series(values: Readonly<Record<string, number>>) {
  return { type: 'series', values };
}

function figure(input: Parameters<typeof projectDataVizFigure>[0]) {
  const projection = projectDataVizFigure(input);
  if (projection === undefined) throw new Error('expected a figure projection');
  return presentWidgetChart(projection);
}

function table(input: Parameters<typeof projectDataVizTable>[0]) {
  const projection = projectDataVizTable(input);
  if (projection === undefined) throw new Error('expected a table projection');
  return presentWidgetChart(projection);
}

describe('Widget chart tables', () => {
  it('prints the captured intraday row in reader-local time without a chart-zone suffix', () => {
    const captured: unknown = JSON.parse(readFileSync(
      join(process.cwd(), 'contract/regressions/widget-plot-reader-local-label.json'),
      'utf8',
    ));
    assert(typeof captured === 'object' && captured !== null && !Array.isArray(captured));
    assert('results' in captured && 'expressions' in captured && 'definition' in captured);
    assert(Array.isArray(captured.results));
    assert(Array.isArray(captured.expressions));
    const expressions = captured.expressions.map((label: unknown) => {
      assert(typeof label === 'string');
      return label;
    });
    const projection = projectPlotTool({
      definition: captured.definition,
      results: captured.results,
      expressions,
    });

    expect(process.env.TZ).toBe('UTC');
    expect(projection.timeZone).toBe('Asia/Hong_Kong');
    expect(presentWidgetChart(projection).data).toEqual({
      dateOrdered: true,
      headers: ['date', 'NKY Spot', 'NKY 1m 110 call vs 90 put ', '1m ATM Implied Vol'],
      rows: [
        ['8 Oct 03:00AM', '69,373.40', undefined, undefined],
        ['8 Oct 03:21AM', undefined, '0.79', '25.39'],
      ],
    });
  });


  it('prints PlotTool Pro axes, series and point-rule values as tables', () => {
    const chart = presentWidgetChart(projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [
          { label: 'Rice' },
          { label: 'Fish' },
          { label: 'Vegg' },
          { label: 'Fruit' },
        ],
        yAxesSettings: [
          { id: 'Right', labelFormat: 'percentage', decimalPrecision: 2 },
        ],
      },
      results: [
        series({ '2026-07-31': 17.00201207 }),
        series({ '2026-07-31': 7.8261 }),
        series({ '2026-07-31': 8.4321 }),
        series({ '2026-07-31': 4.321 }),
      ],
      expressions: ['rice', 'fish', 'vegg', 'fruit'],
    }));

    expect(chart).toEqual({
      axes: { headers: ['axis', 'label', 'min', 'max'], rows: [] },
      series: {
        headers: ['series', 'type', 'axis', 'color', 'line style'],
        rows: [
          ['Rice', 'line', 'Right', '#16B8C8', undefined],
          ['Fish', 'line', 'Right', '#E48A2E', undefined],
          ['Vegg', 'line', 'Right', '#7B61C4', undefined],
          ['Fruit', 'line', 'Right', '#D9A514', undefined],
        ],
      },
      data: {
        dateOrdered: true,
        headers: ['date', 'Rice', 'Fish', 'Vegg', 'Fruit'],
        rows: [['31 Jul 2026', '1,700.20 %', '782.61 %', '843.21 %', '432.10 %']],
      },
    });
  });

  it('keeps repeated PlotTool Pro keys as separate rows and nested vectors under their label', () => {
    const repeated = presentWidgetChart(projectPlotTool({
      definition: { chartType: 'line', expressions: [{ label: 'Repeated' }] },
      results: [{ type: 'sortedSeries', values: [['2026-08-20', 1], ['2026-08-20', 2]] }],
      expressions: ['repeated'],
    }));
    expect(repeated.data).toEqual({
      dateOrdered: true,
      headers: ['date', 'Repeated'],
      rows: [['20 Aug 2026', '1'], ['20 Aug 2026', '2']],
    });

    const nested = presentWidgetChart(projectPlotTool({
      definition: { chartType: 'line', expressions: [{ label: 'Nested' }] },
      results: [{ type: 'frame', values: { '2026-08-19': [1, 10], '2026-08-20': [2, 20] } }],
      expressions: ['nested'],
    }));
    expect(nested.data).toEqual({
      dateOrdered: true,
      headers: ['date', 'Nested', 'Nested'],
      rows: [['19 Aug 2026', '1', '10'], ['20 Aug 2026', '2', '20']],
    });
  });

  it('prints a missing PlotTool Pro point as a missing cell, never a placeholder', () => {
    const chart = presentWidgetChart(projectPlotTool({
      definition: { chartType: 'line', expressions: [{ label: 'A' }, { label: 'B' }] },
      results: [series({ '2026-08-19': 1, '2026-08-20': 2 }), series({ '2026-08-20': 3 })],
      expressions: ['a', 'b'],
    }));
    expect(chart.data).toEqual({
      dateOrdered: true,
      headers: ['date', 'A', 'B'],
      rows: [['19 Aug 2026', '1', undefined], ['20 Aug 2026', '2', '3']],
    });
  });

  it('keeps raw midnight keys for scatter and bar rows and reader-local line timestamps', () => {
    const scatter = presentWidgetChart(projectPlotTool({
      definition: {
        chartType: 'scatter',
        expressions: [{ label: 'X', axis: 'Right' }, { label: 'Y', axis: 'Right2' }],
        yAxesSettings: [{ id: 'Right' }, { id: 'Right2' }, { id: 'Right3' }, { id: 'Left' }],
      },
      results: [series({ '2026-08-20': 1 }), series({ '2026-08-20': 2 })],
      expressions: ['x', 'y'],
    }));
    expect(scatter.series?.rows.map((row) => row.slice(0, 3))).toEqual([
      ['X', 'scatter', 'x'],
      ['Y', 'scatter', 'Left'],
    ]);
    expect(scatter.data).toMatchObject({ rows: [['2026-08-20', '1', '2']] });

    const line = presentWidgetChart(projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [{ label: 'Line' }],
        timeSettings: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
      },
      results: [series({ '2026-08-20T14:30:45Z': 1 })],
      expressions: ['line'],
    }));
    expect(process.env.TZ).toBe('UTC');
    expect(line.data).toMatchObject({ rows: [['20 Aug 02:30PM', '1']] });

    const zoneless = presentWidgetChart(projectPlotTool({
      definition: { chartType: 'line', expressions: [{ label: 'Line' }] },
      results: [series({ '2026-08-20T14:30:45Z': 1 })],
      expressions: ['line'],
    }));
    expect(zoneless.data).toMatchObject({ rows: [['20 Aug 02:30PM', '1']] });
  });

  it('prints no PlotTool Pro label format, which Web does not show', () => {
    const authored = presentWidgetChart(projectPlotTool({
      definition: {
        chartType: 'line',
        expressions: [{}],
        yAxesSettings: [{ id: 'Right', labelFormat: 'none', label: 'Yield' }],
      },
      results: [series({ '2026-08-20': 1 })],
      expressions: ['value'],
    }));
    expect(authored.axes).toEqual({
      headers: ['axis', 'label', 'min', 'max'],
      rows: [['Right', 'Yield', undefined, undefined]],
    });
  });

  it('fails loud when a PlotTool Pro series has no elected formatting axis', () => {
    const projection = projectPlotTool({
      definition: { chartType: 'line', expressions: [{}] },
      results: [series({ '2026-08-20': 1 })],
      expressions: ['value'],
    });

    expect(() => presentWidgetChart({ ...projection, axes: [] })).toThrow(
      WidgetTextPresenterError,
    );
    expect(() => presentWidgetChart({ ...projection, axes: [] })).toThrow(
      'Invalid Widget text projection: PlotTool Pro series 0 has no elected axis',
    );
  });

  it('fails loud when a PlotTool Pro series has neither a color nor a palette slot', () => {
    const projection = projectPlotTool({
      definition: { chartType: 'line', expressions: [{}] },
      results: [series({ '2026-08-20': 1 })],
      expressions: ['value'],
    });
    const colorless = {
      ...projection,
      series: projection.series.map(({ color: _color, paletteSlot: _paletteSlot, ...entry }) => entry),
    };

    expect(() => presentWidgetChart(colorless)).toThrow(
      'Invalid Widget text projection: PlotTool Pro series 0 has no color',
    );
  });

  it('sorts date-keyed PlotTool Pro rows by date and keeps category rows in provider order', () => {
    const dated = presentWidgetChart(projectPlotTool({
      definition: { chartType: 'line', expressions: [{ label: 'A' }, { label: 'B' }] },
      results: [series({ '2026-09-07': 1, '2026-09-25': 2 }), series({ '2025-11-27': 3, '2026-09-10': 4 })],
      expressions: ['a', 'b'],
    }));
    expect(dated.data).toEqual({
      dateOrdered: true,
      headers: ['date', 'A', 'B'],
      rows: [
        ['27 Nov 2025', undefined, '3'],
        ['07 Sep 2026', '1', undefined],
        ['10 Sep 2026', undefined, '4'],
        ['25 Sep 2026', '2', undefined],
      ],
    });

    const categories = presentWidgetChart(projectPlotTool({
      definition: { chartType: 'bar', expressions: [{ label: 'Tenor' }] },
      results: [{ type: 'sortedSeries', values: [['30', 1], ['7', 2], ['365', 3]] }],
      expressions: ['tenor'],
    }));
    expect(categories.data).toEqual({
      headers: ['category', 'Tenor'],
      rows: [['30', '1'], ['7', '2'], ['365', '3']],
    });
  });

  it('fails loud on an unreadable PlotTool Pro date key instead of misplacing its row', () => {
    const projection = projectPlotTool({
      definition: { chartType: 'line', expressions: [{}] },
      results: [series({ '2026-08-20': 1, '2026-08-21': 2 })],
      expressions: ['value'],
    });
    const unreadable = {
      ...projection,
      series: projection.series.map((entry) => ({
        ...entry,
        points: entry.points.map((point, index) => (index === 1 ? { ...point, rawKey: 'not-a-date' } : point)),
      })),
    };

    expect(() => presentWidgetChart(unreadable)).toThrow('unreadable date key "not-a-date"');
  });

  it('turns DataViz tooltip fields, constants included, into data columns under the series label', () => {
    const chart = figure({
      data: [
        {
          type: 'bar',
          name: null,
          x: ['1m', '3m'],
          y: [0.12345, 0.2],
          customdata: [1_000_000, 1_000_000],
          marker: { color: '#D62728' },
          hovertemplate:
            'Spread Benchmark — %{customdata:,.0f} EUR @ %{y:,.2f} dpm<extra></extra>',
        },
        {
          type: 'bar',
          name: null,
          x: ['1m', '3m'],
          y: [0.22345, 0.3],
          customdata: [1_000_000, 1_000_000],
          marker: { color: '#1F77B4' },
          hovertemplate:
            'Spread Analyze — %{customdata:,.0f} EUR @ %{y:,.2f} dpm<extra></extra>',
        },
      ],
      layout: {},
    });

    expect(chart.series?.rows).toEqual([
      ['Spread Benchmark — EUR @ dpm', 'bar', ['xaxis', 'yaxis'], '#D62728', undefined],
      ['Spread Analyze — EUR @ dpm', 'bar', ['xaxis', 'yaxis'], '#1F77B4', undefined],
    ]);
    expect(chart.data).toEqual({
      headers: [
        'category',
        'Spread Benchmark — EUR @ dpm: EUR @',
        'Spread Benchmark — EUR @ dpm: dpm',
        'Spread Analyze — EUR @ dpm: EUR @',
        'Spread Analyze — EUR @ dpm: dpm',
      ],
      rows: [
        ['1m', '1,000,000', '0.12', '1,000,000', '0.22'],
        ['3m', '1,000,000', '0.20', '1,000,000', '0.30'],
      ],
    });
  });

  it('prints DataViz table rule text and grouping rows, with no styles or group header row', () => {
    expect(table({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'desk', header: 'Desk', meta: { group: 'metrics', bold: true } },
          { accessorKey: 'score', header: 'Score', aggregationFn: 'mean' },
        ],
        columnGroups: { metrics: { label: 'Metrics' } },
        data: [{ desk: 'A', score: 10 }, { desk: 'A', score: 20 }],
        grouping: ['desk'],
        enableGrouping: true,
        defaultSorting: [{ id: 'score', desc: true }],
      },
    })).toEqual({
      data: {
        headers: ['Desk', 'Score ↓'],
        rows: [['▼ A (2)', 'mean: 15'], ['', '20'], ['', '10']],
      },
    });

    expect(table({
      type: 'Table',
      table: { columns: [{ accessorKey: 'desk', header: 'Desk' }], data: [] },
    })).toEqual({
      data: { headers: ['Desk'], rows: [] },
      message: 'No data available',
    });
  });

  it('keeps only visible, Web-shown axis traits and series line style', () => {
    const chart = figure({
      data: [{
        type: 'scatter',
        name: 'Rates',
        x: ['2026-08-20'],
        y: [0.0123],
        yaxis: 'y2',
        line: { color: 'navy', dash: 'dash' },
      }],
      layout: {
        xaxis: {},
        yaxis2: {
          title: { text: '<b>Yield</b>' },
          tickformat: '.2%',
          range: [1, -1],
          showticklabels: false,
        },
      },
    });

    expect(chart).toEqual({
      axes: {
        headers: ['axis', 'label', 'format', 'min', 'max'],
        rows: [['yaxis2', 'Yield', '.2%', 1, -1]],
      },
      series: {
        headers: ['series', 'type', 'axis', 'color', 'line style'],
        rows: [['Rates', 'scatter', ['xaxis', 'yaxis2'], 'navy', 'dash']],
      },
      data: { dateOrdered: true, headers: ['date', 'Rates'], rows: [['2026-08-20', '1.23%']] },
    });
  });

  it('drops hidden traces and prints mixed coordinate schemas long with a series column', () => {
    const chart = figure({
      data: [
        { type: 'scatter', name: 'Hidden', visible: false, x: [1], y: [1] },
        {
          type: 'scatter',
          name: 'Two dimensional',
          x: [1, 2],
          y: [2, 3],
          hovertemplate: '%{y:.1f} value',
        },
        {
          type: 'scatter3d',
          name: 'Three dimensional',
          x: [1, 2],
          y: [2, 3],
          z: [3, 4],
          hovertemplate: '%{z:.2f} depth',
        },
      ],
      layout: {},
    });

    expect(chart.series?.rows.map(([label]) => label)).toEqual([
      'Two dimensional',
      'Three dimensional',
    ]);
    expect(chart.data).toEqual({
      headers: ['series', 'x', 'y', 'value', 'depth'],
      rows: [
        ['Two dimensional', '1', undefined, '2.0', undefined],
        ['Two dimensional', '2', undefined, '3.0', undefined],
        ['Three dimensional', '1', '2', undefined, '3.00'],
        ['Three dimensional', '2', '3', undefined, '4.00'],
      ],
    });
  });

  it('names a shared tooltip column once for each distinct series label', () => {
    const segment = (name: string, x: number, label: string) => ({
      type: 'scatter',
      name,
      x: [x],
      y: [x * 10],
      hovertemplate: `%{y} ${label}`,
    });
    const chart = figure({
      data: [
        segment('Net', 1, 'net'),
        segment('Added', 1, 'added'),
        segment('Net', 2, 'net'),
        segment('Added', 2, 'added'),
      ],
      layout: {},
    });

    expect(chart.data).toMatchObject({ headers: ['series', 'x', 'Net: net', 'Added: added'] });
  });

  it('keeps format-qualified tooltip tokens distinct', () => {
    const chart = figure({
      data: [{
        type: 'bar',
        name: 'Bars',
        x: ['A', 'B'],
        y: [1.234, 2.345],
        hovertemplate: '%{y:.1f} / %{y:.2f}',
      }],
      layout: {},
    });

    expect(chart.data).toEqual({
      headers: ['category', 'Bars: y:.1f', 'Bars: y:.2f'],
      rows: [['A', '1.2', '1.23'], ['B', '2.3', '2.35']],
    });
  });

  it.each(['scatterpolar', 'scatter'])('presents hover labels and literal percent in %s tables', (type) => {
    const chart = figure({
      data: [{
        type, name: 'Rates', ...(type === 'scatterpolar'
          ? { theta: ['A', 'B'], r: [2, 3] } : { x: ['A', 'B'], y: [2, 3] }),
        text: ['2026-09-01', '2026-09-02'],
        customdata: [[2.25, '2026-09-01'], [3.5, '2026-09-02']],
        hovertemplate: 'Rate: %{customdata[0]:.2f}%<br><i>as of %{customdata[1]}</i><extra></extra>',
      }], layout: {},
    });
    expect(chart.data).toEqual({
      headers: [type === 'scatterpolar' ? 'angle' : 'category', 'Rates: ' + (type === 'scatterpolar' ? 'r' : 'y'), 'Rates: Rate', 'Rates: as of'],
      rows: [['A', '2', '2.25%', '2026-09-01'], ['B', '3', '3.50%', '2026-09-02']],
    });
  });

  it.each([
    { text: ['different', '2026-09-02'], bound: false,
      rows: [['A', '2', 'different', '2026-09-01'], ['B', '3', '2026-09-02', '2026-09-02']] },
    { text: ['2026-09-01'], bound: false,
      rows: [['A', '2', '2026-09-01', '2026-09-01'], ['B', '3', undefined, '2026-09-02']] },
    { text: ['2026-09-01', '2026-09-02'], bound: true,
      rows: [['A', '2', '2026-09-01', '2026-09-01'], ['B', '3', '2026-09-02', '2026-09-02']] },
  ])('preserves differing, partial, or explicitly bound text $text $bound', ({ text, bound, rows }) => {
    const chart = figure({
      data: [{ type: 'scatterpolar', name: 'Rates', theta: ['A', 'B'], r: [2, 3], text,
        customdata: [['2026-09-01'], ['2026-09-02']],
        hovertemplate: 'Date: %{customdata[0]}' + (bound ? '<br>Note: %{text}' : ''),
      }], layout: {},
    });
    expect(chart.data).toEqual({
      headers: bound ? ['angle', 'Rates: r', 'Rates: Date', 'Rates: Note']
        : ['angle', 'Rates: r', 'Rates: text', 'Rates: Date'],
      rows,
    });
  });

  it('uses the exact formatted token for literal percent without scaling it twice', () => {
    const chart = figure({ data: [{ type: 'bar', name: 'Rates', x: ['A'], y: [0.25],
      hovertemplate: '%{y:.1f} / %{y:.2f}% / %{y:.0%}',
    }], layout: {} });
    expect(chart.data).toEqual({
      headers: ['category', 'Rates: y:.1f', 'Rates: y:.2f', 'Rates: y:.0%'],
      rows: [['A', '0.3', '0.25%', '25%']],
    });
  });

  it('uses unformatted template tokens when the projection resolves an axis format', () => {
    expect(figure({ data: [{ type: 'bar', name: 'Rates', x: ['A'], y: [2.5],
      hovertemplate: 'Rate: %{y}%',
    }], layout: { yaxis: { hoverformat: '.2f' } } }).data).toEqual({
      headers: ['category', 'Rates'], rows: [['A', '2.50%']],
    });
  });

  it('keeps text for its own long-table series while blanking its duplicate elsewhere', () => {
    expect(figure({ data: [
      { type: 'scatterpolar', name: 'Polar', theta: ['A'], r: [2], text: ['2026-09-01'],
        customdata: [['2026-09-01', 2.5]],
        hovertemplate: '<i>as of %{customdata[0]}</i><br>Vol: %{customdata[1]:.2f}%',
      },
      { type: 'scatter', name: 'Cartesian', x: ['B'], y: [3], text: ['note'] },
    ], layout: {} }).data).toEqual({
      headers: ['series', 'theta', 'r', 'x', 'y', 'text', 'as of', 'Vol'],
      rows: [
        ['Polar', 'A', '2', undefined, undefined, undefined, '2026-09-01', '2.50%'],
        ['Cartesian', undefined, undefined, 'B', '3', 'note', undefined, undefined],
      ],
    });
  });

  it('keeps the Data key header with no rows when no series is visible', () => {
    const chart = figure({
      data: [{ type: 'bar', name: 'Toggled off', visible: 'legendonly', x: ['A'], y: [1] }],
      layout: {},
    });

    expect(chart.data).toEqual({ headers: ['category'], rows: [] });
  });

  it('keys treemap rows by tile label', () => {
    const chart = figure({
      data: [{ type: 'treemap', labels: ['A', 'B'], parents: ['', 'A'], marker: { colors: [1, 2] } }],
      layout: {},
    });

    expect(chart.data.headers[0]).toBe('category');
    expect(chart.data.rows.map((row) => row[0])).toEqual(['A', 'B']);
  });

  it('keeps a Data table with no known columns when the figure has no series', () => {
    expect(figure({ data: [], layout: {} }).data).toEqual({ headers: [], rows: [] });
  });

  it('sorts date-keyed DataViz rows by date and keeps category rows in provider order', () => {
    const dated = figure({
      data: [
        { type: 'scatter', name: 'A', x: ['2026-09-07', '2026-09-25', '2025-11-27'], y: [1, 2, 3] },
        { type: 'scatter', name: 'B', x: ['2026-09-07', '2026-09-25', '2025-11-27'], y: [4, 5, 6] },
      ],
      layout: {},
    });
    expect(dated.data).toEqual({
      dateOrdered: true,
      headers: ['date', 'A', 'B'],
      rows: [
        ['2025-11-27', '3', '6'],
        ['2026-09-07', '1', '4'],
        ['2026-09-25', '2', '5'],
      ],
    });

    const categories = figure({
      data: [{ type: 'bar', name: 'Tenor', x: ['3m', '1m', '1y'], y: [1, 2, 3] }],
      layout: {},
    });
    expect(categories.data).toEqual({
      headers: ['category', 'Tenor'],
      rows: [['3m', '1'], ['1m', '2'], ['1y', '3']],
    });
  });

  it('marks long Data rows date-ordered only when their dates never go back', () => {
    const segment = (name: string, x: string, hovertemplate: string) => ({
      type: 'scatter',
      name,
      x: [x],
      y: [1],
      hovertemplate,
    });
    const segments = (xs: readonly string[]) => figure({
      data: xs.map((x, index) => (
        index % 2 === 0 ? segment('Net', x, '%{y} net') : segment('Added', x, '%{x} period')
      )),
      layout: {},
    }).data;

    const marker = (xs: readonly string[]) => {
      const { headers, dateOrdered } = segments(xs);
      return [headers[0], dateOrdered];
    };

    expect(marker(['2021-12-31T00:00:00', '2021-12-31', '2022-03-31T00:00:00', '2022-03-31']))
      .toEqual(['series', true]);
    expect(marker(['2022-03-31', '2021-12-31'])).toEqual(['series', undefined]);
    expect(marker(['1', '2'])).toEqual(['series', undefined]);
  });

  it('marks long Data rows date-ordered by every x the figure projects as a date', () => {
    const volumes = (x: readonly unknown[], layout: Readonly<Record<string, unknown>> = {}) => figure({
      data: [{
        type: 'bar',
        name: 'dailyVolume',
        x,
        y: [12345, 6789],
        xhoverformat: '%a %d %b %y',
        hovertemplate: '%{x}: %{y} lots',
      }],
      layout,
    }).data;
    const formatted = [['dailyVolume', 'Mon 30 Sep 24', '12345'], ['dailyVolume', 'Tue 01 Oct 24', '6789']];

    expect(volumes(['2024-09-30T00:00:00', '2024-10-01T00:00:00']))
      .toMatchObject({ dateOrdered: true, rows: formatted });
    expect(volumes(['2024-9-30', '2024-10-1'])).toMatchObject({ dateOrdered: true, rows: formatted });
    expect(volumes([1727654400000, 1727740800000], { xaxis: { type: 'date' } }))
      .toMatchObject({ dateOrdered: true, rows: formatted });
    expect(volumes([1727654400000, 1727740800000], { yaxis: { type: 'date' }, xaxis: {} }))
      .not.toHaveProperty('dateOrdered');
  });

  it('keys wide Data rows by every x the figure projects as a date', () => {
    const volumes = (x: readonly unknown[], layout: Readonly<Record<string, unknown>> = {}) => figure({
      data: [{ type: 'scatter', name: 'Volume', x, y: [2, 1], xhoverformat: '%d %b %y' }],
      layout,
    }).data;
    const sorted = {
      dateOrdered: true,
      headers: ['date', 'Volume'],
      rows: [['30 Sep 24', '1'], ['01 Oct 24', '2']],
    };

    expect(volumes(['2024-10-01', '2024-09-30'])).toEqual(sorted);
    expect(volumes(['2024-10-1', '2024-9-30'])).toEqual(sorted);
    expect(volumes([1727740800000, 1727654400000], { xaxis: { type: 'date' } })).toEqual(sorted);
    expect(figure({ data: [{ type: 'scatter', name: 'Volume', x: [2, 1], y: [2, 1] }], layout: {} }).data)
      .toEqual({ headers: ['category', 'Volume'], rows: [['2', '2'], ['1', '1']] });
  });

  it('shows projected x dates as normalized text and keeps undated x keys in provider order', () => {
    const volumes = (x: readonly unknown[]) => figure({
      data: [{ type: 'scatter', name: 'Volume', x, y: x.map((_, index) => index) }],
      layout: {},
    }).data;

    expect(volumes(['2024-10-1', '2024-9-30'])).toEqual({
      dateOrdered: true,
      headers: ['date', 'Volume'],
      rows: [['2024-09-30', '1'], ['2024-10-01', '0']],
    });
    expect(volumes(['2024-10-01', '2024-09-30', 'total'])).toEqual({
      headers: ['category', 'Volume'],
      rows: [['2024-10-01', '0'], ['2024-09-30', '1'], ['total', '2']],
    });
    expect(figure({ data: [{ type: 'heatmap', x: ['a', 'b'], y: ['c'], z: [[1, 2]] }], layout: {} }).data)
      .toEqual({ headers: ['category', 'y', 'trace 0'], rows: [['a', 'c', '1'], ['b', 'c', '2']] });
  });

  it('never marks long Data rows without x values date-ordered', () => {
    const pie = figure({
      data: [{
        type: 'pie',
        labels: ['2026-01-01', '2026-02-01'],
        values: [2, 1],
        hovertemplate: '%{label}: %{value}',
      }],
      layout: {},
    });
    expect(pie.data).not.toHaveProperty('dateOrdered');
  });

  it('uses y categories and x values for horizontal bars', () => {
    expect(figure({
      data: [{ type: 'bar', orientation: 'h', x: [10, 20], y: ['A', 'B'] }],
      layout: { barmode: 'stack' },
    })).toEqual({
      axes: { headers: ['axis', 'label', 'format', 'min', 'max'], rows: [] },
      series: {
        headers: ['series', 'type', 'axis', 'color', 'line style'],
        rows: [['trace 0', 'bar', ['xaxis', 'yaxis'], '#636efa', undefined]],
      },
      data: { headers: ['category', 'trace 0'], rows: [['A', '10'], ['B', '20']] },
    });
  });
});


describe('DataViz coordinate headers', () => {
  it.each([
    {
      trace: { type: 'box', x: ['A', 'A'], y: [1, 3] },
      headers: ['category'], coordinates: ['A'],
    },
    {
      trace: { type: 'box', orientation: 'h', x: [1, 3], y: ['B', 'B'] },
      headers: ['y'], coordinates: ['B'],
    },
    {
      trace: { type: 'pie', labels: ['A'], values: [2] },
      headers: ['category'], coordinates: ['A'],
    },
    {
      trace: { type: 'sunburst', labels: ['A'], parents: [''], values: [2] },
      headers: ['category'], coordinates: ['A'],
    },
    {
      trace: { type: 'scatter3d', x: [1], y: [2], z: [3] },
      headers: ['category', 'y'], coordinates: ['1', '2'],
    },
    {
      trace: { type: 'scatterpolar', theta: [90], r: [2] },
      headers: ['angle'], coordinates: ['90'],
    },
    {
      trace: { type: 'surface', x: [[1]], y: [[2]], z: [[3]] },
      headers: ['category', 'y'], coordinates: ['1', '2'],
    },
  ])('prints $trace.type coordinates with their axis headers', ({ trace, headers, coordinates }) => {
    const chart = figure({ data: [trace], layout: {} });
    expect(chart.data.headers.slice(0, headers.length)).toEqual(headers);
    expect(chart.data.rows[0]?.slice(0, coordinates.length)).toEqual(coordinates);
  });
});
