import { describe, expect, it } from 'vitest';

import { projectDataVizRawRows } from '../raw-rows.js';

describe('DataViz raw rows', () => {
  it('uses Plotly table headers while preserving raw cell values', () => {
    expect(projectDataVizRawRows({
      kind: 'table',
      columns: [
        { id: 'column-0', header: '<b>desk</b>', text: 'desk' },
        { id: 'column-1', header: '<b>pnl</b>', text: 'pnl' },
      ],
      rows: [{
        kind: 'data',
        raw: { 'column-0': '<b>Rates</b>', 'column-1': 12 },
        cells: [],
      }],
      sourceRowCount: 1,
    })).toEqual({
      columns: ['desk', 'pnl'],
      rows: [{ desk: '<b>Rates</b>', pnl: 12 }],
    });
  });

  it('keeps tooltip-carried figure values and a stable series identity', () => {
    expect(projectDataVizRawRows({
      kind: 'figure',
      chart: { colorWay: [] },
      axes: [],
      series: [{
        id: 'series-1',
        sourceIndex: 0,
        traceType: 'scatter',
        identity: 'EURUSD · 10mm · bps',
        visibility: 'visible',
        axes: {},
        style: {},
        points: [{
          index: 0,
          fields: [
            { path: 'venue', raw: 'LDN', text: 'LDN' },
            { path: 'quantity', raw: 10_000_000, text: '10.0mm' },
            {
              path: 'participation',
              raw: 0.41,
              text: '41%',
              format: '.0%',
              formatKind: 'number',
            },
            { path: 'unit', raw: 'bps', text: 'bps' },
          ],
        }],
      }],
    })).toEqual({
      columns: ['venue', 'quantity', 'participation', 'unit'],
      rows: [{ venue: 'LDN', quantity: 10_000_000, participation: 41, unit: 'bps' }],
    });
  });

  it('names each row\'s series when several series are visible', () => {
    const series = (identity: string, y: number) => ({
      id: identity,
      sourceIndex: 0,
      traceType: 'scatter' as const,
      identity,
      visibility: 'visible' as const,
      axes: {},
      style: {},
      points: [{ index: 0, fields: [{ path: 'y', raw: y, text: String(y) }] }],
    });

    expect(projectDataVizRawRows({
      kind: 'figure',
      chart: { colorWay: [] },
      axes: [],
      series: [series('EURUSD', 1), series('GBPUSD', 2)],
    })).toEqual({
      columns: ['series', 'y'],
      rows: [{ series: 'EURUSD', y: 1 }, { series: 'GBPUSD', y: 2 }],
    });
  });

  it('keeps non-number and date formats raw while scaling rounded percentages', () => {
    expect(projectDataVizRawRows({
      kind: 'figure',
      chart: { colorWay: [] },
      axes: [],
      series: [{
        id: 'series-1',
        sourceIndex: 0,
        traceType: 'scatter',
        identity: 'trace 0',
        visibility: 'visible',
        axes: {},
        style: {},
        points: [{
          index: 0,
          fields: [
            {
              path: 'x',
              raw: 1_774_656_000_000,
              text: 'Mar 30',
              format: '%b %d',
              formatKind: 'date',
            },
            {
              path: 'y',
              raw: 0.1234,
              text: '12.3%',
              format: '.3p',
              formatKind: 'number',
            },
            {
              path: 'customdata',
              raw: '0.4',
              text: '40%',
              format: '.0%',
              formatKind: 'number',
            },
          ],
        }],
      }],
    })).toEqual({
      columns: ['x', 'y', 'customdata'],
      rows: [{ x: 1_774_656_000_000, y: 12.34, customdata: '0.4' }],
    });
  });

  it('fails loud for unsupported numeric tooltip formats', () => {
    expect(() => projectDataVizRawRows({
      kind: 'figure',
      chart: { colorWay: [] },
      axes: [],
      series: [{
        id: 'series-1',
        sourceIndex: 0,
        traceType: 'scatter',
        identity: 'trace 0',
        visibility: 'visible',
        axes: {},
        style: {},
        points: [{
          index: 0,
          fields: [{
            path: 'y',
            raw: 1,
            text: '1',
            format: '.2q',
            formatKind: 'number',
          }],
        }],
      }],
    })).toThrow(expect.objectContaining({
      name: 'DataVizD3FormatError',
      problem: 'unsupported-directive',
    }));
  });
});
