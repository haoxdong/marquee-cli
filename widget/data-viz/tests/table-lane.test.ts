import { describe, expect, it } from 'vitest';

import { DataVizTableLaneError, projectDataVizTable } from '../table-lane.js';

describe('DataViz table lane', () => {
  it('applies the Web table-rule decimal cascade without scaling percentages', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'columnDecimals', header: 'Column', decimals: 1 },
          { accessorKey: 'metaDecimals', header: 'Meta', meta: { decimals: 2 } },
          { accessorKey: 'defaultDecimals', header: 'Default' },
          { accessorKey: 'percent', header: 'Percent', meta: { format: 'percent' } },
        ],
        data: [{
          columnDecimals: 1_234.56,
          metaDecimals: 1_234.567,
          defaultDecimals: 1_234.5678,
          percent: 42.5678,
        }],
        options: { defaultDecimals: 3 },
      },
    });

    expect(projection?.rows).toEqual([{
      kind: 'data',
      raw: {
        columnDecimals: 1_234.56,
        metaDecimals: 1_234.567,
        defaultDecimals: 1_234.5678,
        percent: 42.5678,
      },
      cells: [
        { columnId: 'columnDecimals', value: 1_234.56, text: '1,234.6' },
        { columnId: 'metaDecimals', value: 1_234.567, text: '1,234.57' },
        { columnId: 'defaultDecimals', value: 1_234.5678, text: '1,234.568' },
        { columnId: 'percent', value: 42.5678, text: '42.568%' },
      ],
    }]);
  });

  it('derives columns from only the first row with Web header casing', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [],
        data: [
          { first_name: 'Ada', _risk_score: 0.123456 },
          { first_name: 'Grace', _risk_score: 0.987654, later_only: true },
        ],
        options: { defaultDecimals: 2 },
      },
    });

    expect(projection?.columns).toEqual([
      { id: 'first_name', header: 'First name', text: 'First name' },
      { id: '_risk_score', header: '_risk score', text: '_risk score' },
    ]);
    expect(projection?.rows[0]?.cells).toEqual([
      { columnId: 'first_name', value: 'Ada', text: 'Ada' },
      { columnId: '_risk_score', value: 0.123456, text: '0.12' },
    ]);
  });

  it('applies pinning, default sorting, and the pager-less 50-row page', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'name', header: 'Name' },
          { accessorKey: 'rank', header: 'Rank' },
          { accessorKey: 'risk', header: 'Risk' },
        ],
        data: Array.from({ length: 55 }, (_, rank) => ({
          name: `row-${rank}`,
          rank,
          risk: rank / 10,
        })),
        defaultSorting: [{ id: 'rank', desc: true }],
        pinnedColumns: { left: ['risk'], right: ['name'] },
        options: { enablePagination: true },
      },
    });

    expect(projection?.columns).toEqual([
      { id: 'risk', header: 'Risk', text: 'Risk' },
      { id: 'rank', header: 'Rank', text: 'Rank ↓' },
      { id: 'name', header: 'Name', text: 'Name' },
    ]);
    expect(projection?.rows).toHaveLength(50);
    expect(projection?.rows[0]).toMatchObject({ kind: 'data', raw: { rank: 54 } });
    expect(projection?.rows[49]).toMatchObject({ kind: 'data', raw: { rank: 5 } });
    expect(projection?.sourceRowCount).toBe(55);
  });

  it('renders expanded group rows and raw aggregate cells with grouped columns first', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'score', header: 'Score', aggregationFn: 'mean' },
          { accessorKey: 'tag', header: 'Tag' },
          {
            accessorKey: 'department',
            header: 'Department',
            meta: { decimals: 1, format: 'percent' },
          },
        ],
        data: [
          { department: 1.25, score: 10, tag: 'a' },
          { department: 1.25, score: 20, tag: 'b' },
          { department: 2.5, score: 5, tag: 'c' },
        ],
        grouping: ['department'],
        enableGrouping: true,
      },
    });

    expect(projection?.columns.map(({ id }) => id)).toEqual([
      'department',
      'score',
      'tag',
    ]);
    expect(projection?.rows).toEqual([
      {
        kind: 'group',
        groupBy: 'department',
        value: 1.25,
        count: 2,
        expanded: true,
        cells: [
          { columnId: 'department', value: 1.25, text: '▼ 1.3% (2)' },
          { columnId: 'score', value: 15, text: 'mean: 15' },
          { columnId: 'tag', value: undefined, text: '' },
        ],
      },
      {
        kind: 'data',
        raw: { department: 1.25, score: 10, tag: 'a' },
        cells: [
          { columnId: 'department', value: 1.25, text: '' },
          { columnId: 'score', value: 10, text: '10' },
          { columnId: 'tag', value: 'a', text: 'a' },
        ],
      },
      {
        kind: 'data',
        raw: { department: 1.25, score: 20, tag: 'b' },
        cells: [
          { columnId: 'department', value: 1.25, text: '' },
          { columnId: 'score', value: 20, text: '20' },
          { columnId: 'tag', value: 'b', text: 'b' },
        ],
      },
      expect.objectContaining({
        kind: 'group',
        value: 2.5,
        count: 1,
      }),
      expect.objectContaining({
        kind: 'data',
        raw: { department: 2.5, score: 5, tag: 'c' },
      }),
    ]);
  });

  it('paginates the expanded grouped row model after calculating complete aggregates', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'desk', header: 'Desk' },
          { accessorKey: 'score', header: 'Score', aggregationFn: 'mean' },
        ],
        data: [
          { desk: 'A', score: 10 },
          { desk: 'A', score: 20 },
          { desk: 'B', score: 30 },
        ],
        grouping: ['desk'],
        enableGrouping: true,
        options: { enablePagination: true, pageSize: 2 },
      },
    });

    expect(projection?.rows).toEqual([
      {
        kind: 'group',
        groupBy: 'desk',
        value: 'A',
        count: 2,
        expanded: true,
        cells: [
          { columnId: 'desk', value: 'A', text: '▼ A (2)' },
          { columnId: 'score', value: 15, text: 'mean: 15' },
        ],
      },
      expect.objectContaining({ kind: 'data', raw: { desk: 'A', score: 10 } }),
    ]);
  });

  it('preserves bold and conditional background styles from sibling row values', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [{
          accessorKey: 'score',
          header: 'Score',
          meta: {
            bold: true,
            conditionalFormatting: {
              enabled: true,
              backgroundColorKey: 'scoreColor',
            },
          },
        }],
        data: [
          { score: 10, scoreColor: '#ff0000' },
          { score: 20, scoreColor: '' },
        ],
      },
    });

    expect(projection?.rows[0]?.cells[0]).toEqual({
      columnId: 'score',
      value: 10,
      text: '10',
      bold: true,
      backgroundColor: '#ff0000',
    });
    expect(projection?.rows[1]?.cells[0]).toEqual({
      columnId: 'score',
      value: 20,
      text: '20',
      bold: true,
    });
  });

  it('honors sorting controls and named sorting functions', () => {
    const disabled = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [{ accessorKey: 'rank', header: 'Rank' }],
        data: [{ rank: 2 }, { rank: 1 }],
        defaultSorting: [{ id: 'rank', desc: false }],
        enableSorting: false,
      },
    });
    const columnDisabled = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [{ accessorKey: 'rank', header: 'Rank', enableSorting: false }],
        data: [{ rank: 2 }, { rank: 1 }],
        defaultSorting: [{ id: 'rank', desc: false }],
      },
    });
    const basic = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [{ accessorKey: 'rank', header: 'Rank', sortingFn: 'basic' }],
        data: [{ rank: '2' }, { rank: '10' }],
        defaultSorting: [{ id: 'rank', desc: false }],
      },
    });

    expect(disabled?.columns[0]?.text).toBe('Rank');
    expect(disabled?.rows.map((row) => row.kind === 'data' && row.raw.rank)).toEqual([2, 1]);
    expect(columnDisabled?.columns[0]?.text).toBe('Rank');
    expect(columnDisabled?.rows.map((row) => row.kind === 'data' && row.raw.rank)).toEqual([2, 1]);
    expect(basic?.rows.map((row) => row.kind === 'data' && row.raw.rank)).toEqual(['10', '2']);
  });

  it.each([
    {
      sortingFn: 'datetime',
      values: ['Mar 1, 2026', 'Jan 15, 2026', 'Feb 10, 2026'],
      sorted: ['Jan 15, 2026', 'Feb 10, 2026', 'Mar 1, 2026'],
    },
    { sortingFn: 'text', values: ['B', '_', 'a'], sorted: ['_', 'a', 'B'] },
    { sortingFn: 'text', values: ['_', 'B', 'a'], sorted: ['_', 'a', 'B'] },
  ])('sorts by the $sortingFn sorting function', ({ sortingFn, values, sorted }) => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [{ accessorKey: 'value', header: 'Value', sortingFn }],
        data: values.map((value) => ({ value })),
        defaultSorting: [{ id: 'value', desc: false }],
      },
    });

    expect(projection?.rows.map((row) => row.kind === 'data' && row.raw.value)).toEqual(sorted);
  });

  it('renders an empty Plotly table header as blank text', () => {
    const projection = projectDataVizTable({
      data: [{
        type: 'table',
        header: { values: [null, 'Price'] },
        cells: { values: [['ABC'], [1]] },
      }],
    });

    expect(projection?.columns.map(({ text }) => text)).toEqual(['', 'Price']);
  });

  it('uses merged d3 formatting for recorded Plotly table cells', () => {
    const projection = projectDataVizTable({
      data: [{
        type: 'table',
        header: { values: ['Ticker', '<b>Probability</b>', 'Spread'] },
        cells: {
          values: [['ABC', 'XYZ'], [0.847, 0.125], [1234.5, -2]],
          format: ['', '.1%', ',.2f'],
        },
      }],
    });

    expect(projection).toEqual({
      kind: 'table',
      columns: [
        { id: 'column-0', header: 'Ticker', text: 'Ticker' },
        { id: 'column-1', header: 'Probability', text: 'Probability' },
        { id: 'column-2', header: 'Spread', text: 'Spread' },
      ],
      rows: [
        {
          kind: 'data',
          raw: { 'column-0': 'ABC', 'column-1': 0.847, 'column-2': 1234.5 },
          cells: [
            { columnId: 'column-0', value: 'ABC', text: 'ABC' },
            { columnId: 'column-1', value: 0.847, text: '84.7%' },
            { columnId: 'column-2', value: 1234.5, text: '1,234.50' },
          ],
        },
        {
          kind: 'data',
          raw: { 'column-0': 'XYZ', 'column-1': 0.125, 'column-2': -2 },
          cells: [
            { columnId: 'column-0', value: 'XYZ', text: 'XYZ' },
            { columnId: 'column-1', value: 0.125, text: '12.5%' },
            { columnId: 'column-2', value: -2, text: '−2.00' },
          ],
        },
      ],
      sourceRowCount: 2,
    });
  });

  it('prints unset and non-number values with the Web table-rule branches', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'unset', meta: { format: 'percent' } },
          { accessorKey: 'boolean', meta: { format: 'percent' } },
          { accessorKey: 'array' },
          { accessorKey: 'object' },
          { accessorKey: 'rounded' },
        ],
        data: [{
          unset: null,
          boolean: true,
          array: ['a', 'b'],
          object: { answer: 42 },
          rounded: 0.123456,
        }],
      },
    });

    expect(projection?.rows[0]?.cells.map(({ text }) => text)).toEqual([
      '',
      'true',
      'a,b',
      '[object Object]',
      '0.123',
    ]);
  });

  it.each([
    { options: { defaultDecimals: -1 }, detail: 'decimals is not a non-negative integer' },
    { options: { enablePagination: 'yes' }, detail: 'table.options.enablePagination is not a boolean' },
    { options: { pageSize: 0 }, detail: 'table.options.pageSize is not a positive integer' },
  ])('fails loud for malformed native table options: $detail', ({ options, detail }) => {
    expect(() => projectDataVizTable({
      type: 'Table',
      table: { columns: [], data: [], options },
    })).toThrow(expect.objectContaining({ name: 'DataVizTableLaneError', problem: 'invalid-table-payload', detail }));
  });

  it.each([
    { headers: ['Only one'], values: [[1], [2]] },
    { headers: ['One', 'Two'], values: [[1]] },
  ])('fails loud when Plotly headers and cells have different widths', ({ headers, values }) => {
    expect(() => projectDataVizTable({
      data: [{
        type: 'table',
        header: { values: headers },
        cells: { values },
      }],
    })).toThrow(new DataVizTableLaneError(
      'Plotly table header and cell column counts differ',
    ));
  });

  it.each([
    {
      column: { accessorKey: 'value', decimals: -1 },
      detail: 'decimals is not a non-negative integer',
    },
    {
      column: { accessorKey: 'value', meta: 'invalid' },
      detail: 'column meta is not a record',
    },
  ])('validates native column metadata even when the table is empty', ({ column, detail }) => {
    expect(() => projectDataVizTable({
      type: 'Table',
      table: { columns: [column], data: [] },
    })).toThrow(new DataVizTableLaneError(detail));
  });

  it('projects Web empty-table text and positional grouped headers', () => {
    const empty = projectDataVizTable({
      type: 'Table',
      table: { columns: [], data: [] },
    });
    const groupedHeaders = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'a', meta: { group: 'left' } },
          { accessorKey: 'b', meta: { group: 'left' } },
          { accessorKey: 'gap' },
          { accessorKey: 'c', meta: { group: 'right' } },
          { accessorKey: 'd', meta: { group: 'left' } },
        ],
        columnGroups: {
          left: { label: 'Left group', order: 99 },
          right: {},
        },
        pinnedColumns: { left: ['gap'] },
        data: [{ a: 1, b: 2, gap: 3, c: 4, d: 5 }],
      },
    });

    expect(empty).toMatchObject({ emptyMessage: 'No data available' });
    expect(groupedHeaders?.columns.map(({ id }) => id)).toEqual([
      'gap',
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(groupedHeaders?.columnGroupHeaders).toEqual([
      { groupId: 'left', label: 'Left group', columnStart: 0, columnSpan: 2 },
      { groupId: 'right', label: '', columnStart: 3, columnSpan: 1 },
      { groupId: 'left', label: 'Left group', columnStart: 4, columnSpan: 1 },
    ]);
  });

  it('leaves mixed Plotly figures for the figure lane', () => {
    expect(projectDataVizTable({
      data: [
        {
          type: 'table',
          header: { values: ['Value'] },
          cells: { values: [[1]] },
        },
        { type: 'scatter', x: [1], y: [2] },
      ],
    })).toBeUndefined();
  });

  it('projects side-by-side Plotly table traces as one table in trace order', () => {
    const projection = projectDataVizTable({
      data: [
        {
          type: 'table',
          header: { values: ['<b>08-10 (Mon)</b>'] },
          cells: { values: [['EXAM', '']] },
        },
        {
          type: 'table',
          header: { values: ['<b>08-11 (Tue)</b>'] },
          cells: { values: [['', '']] },
        },
      ],
    });

    expect(projection?.columns).toEqual([
      { id: 'column-0', header: '08-10 (Mon)', text: '08-10 (Mon)' },
      { id: 'column-1', header: '08-11 (Tue)', text: '08-11 (Tue)' },
    ]);
    expect(projection?.rows.map((row) => (row.kind === 'data' ? row.raw : undefined))).toEqual([
      { 'column-0': 'EXAM', 'column-1': '' },
      { 'column-0': '', 'column-1': '' },
    ]);
  });

  it('fails loud when side-by-side Plotly table traces have different row counts', () => {
    expect(() => projectDataVizTable({
      data: [
        { type: 'table', header: { values: ['A'] }, cells: { values: [[1]] } },
        { type: 'table', header: { values: ['B'] }, cells: { values: [[1, 2]] } },
      ],
    })).toThrow(new DataVizTableLaneError('Plotly table columns have different row counts'));
  });

  it.each([
    {
      problem: 'titled Plotly table traces have different headers',
      secondHeaders: ['Pre', 'During'],
      annotations: [
        { text: '08-10 (Mon)', x: 0.2, xref: 'paper' },
        { text: '08-11 (Tue)', x: 0.8, xref: 'paper' },
      ],
    },
    {
      problem: 'Plotly table trace has no title annotation',
      secondHeaders: ['Pre', 'Post'],
      annotations: [{ text: '08-10 (Mon)', x: 0.2, xref: 'paper' }],
    },
    {
      problem: 'Plotly table trace has several title annotations',
      secondHeaders: ['Pre', 'Post'],
      annotations: [
        { text: '08-10 (Mon)', x: 0.1, xref: 'paper' },
        { text: '08-11 (Tue)', x: 0.3, xref: 'paper' },
      ],
    },
  ])('fails loud when titled Plotly table traces are malformed: $problem', ({
    problem,
    secondHeaders,
    annotations,
  }) => {
    expect(() => projectDataVizTable({
      data: [
        { type: 'table', header: { values: ['Pre', 'Post'] }, cells: { values: [['A'], ['']] }, domain: { x: [0, 0.4] } },
        { type: 'table', header: { values: secondHeaders }, cells: { values: [['B'], ['']] }, domain: { x: [0.6, 1] } },
      ],
      layout: { annotations },
    })).toThrow(new DataVizTableLaneError(problem));
  });

  it('fails loud when a titled Plotly table trace has fewer headers than the first', () => {
    expect(() => projectDataVizTable({
      data: [
        { type: 'table', header: { values: ['Pre', 'Post'] }, cells: { values: [['A'], ['']] }, domain: { x: [0, 0.4] } },
        { type: 'table', header: { values: ['Pre'] }, cells: { values: [['B']] }, domain: { x: [0.6, 1] } },
      ],
      layout: {
        annotations: [
          { text: '08-10 (Mon)', x: 0.2, xref: 'paper' },
          { text: '08-11 (Tue)', x: 0.8, xref: 'paper' },
        ],
      },
    })).toThrow(new DataVizTableLaneError('titled Plotly table traces have different headers'));
  });

  const titledTraces = [
    { type: 'table', header: { values: ['Pre'] }, cells: { values: [['A']] }, domain: { x: [0.2, 0.4] } },
    { type: 'table', header: { values: ['Pre'] }, cells: { values: [['B']] }, domain: { x: [0.6, 0.8] } },
  ];

  it('titles a Plotly table trace only from a numeric paper annotation within its domain edges', () => {
    const projection = projectDataVizTable({
      data: titledTraces,
      layout: {
        annotations: [
          null,
          { text: 'Legend', x: 0.3 },
          { text: 'Unplaced', x: '0.3', xref: 'paper' },
          { text: '08-10 (Mon)', x: 0.2, xref: 'paper' },
          { text: '08-11 (Tue)', x: 0.8, xref: 'paper' },
        ],
      },
    });

    expect(projection?.rows.map((row) => (row.kind === 'data' ? row.raw : undefined))).toEqual([
      { 'column-0': '08-10 (Mon)', 'column-1': 'A' },
      { 'column-0': '08-11 (Tue)', 'column-1': 'B' },
    ]);
  });

  it.each([
    { edge: 'before the start', x: 0.19 },
    { edge: 'after the end', x: 0.41 },
  ])('does not title a Plotly table trace from an annotation just $edge of its domain', ({ x }) => {
    expect(() => projectDataVizTable({
      data: titledTraces,
      layout: {
        annotations: [
          { text: '08-10 (Mon)', x, xref: 'paper' },
          { text: '08-11 (Tue)', x: 0.7, xref: 'paper' },
        ],
      },
    })).toThrow(new DataVizTableLaneError('Plotly table trace has no title annotation'));
  });

  it('sorts grouped rows by aggregate values and ignores non-numeric aggregate inputs', () => {
    const projection = projectDataVizTable({
      type: 'Table',
      table: {
        columns: [
          { accessorKey: 'desk', header: 'Desk' },
          { accessorKey: 'score', header: 'Score', aggregationFn: 'mean' },
          { accessorKey: 'amount', header: 'Amount', aggregationFn: 'sum' },
        ],
        data: [
          { desk: 'A', score: 0, amount: null },
          { desk: 'A', score: 100, amount: 5 },
          { desk: 'B', score: 60, amount: 'ignored' },
          { desk: 'B', score: 60, amount: 7 },
        ],
        grouping: ['desk'],
        enableGrouping: true,
        defaultSorting: [{ id: 'score', desc: true }],
      },
    });

    expect(projection?.rows.filter(({ kind }) => kind === 'group')).toEqual([
      expect.objectContaining({
        value: 'B',
        cells: [
          expect.anything(),
          { columnId: 'score', value: 60, text: 'mean: 60' },
          { columnId: 'amount', value: 7, text: 'sum: 7' },
        ],
      }),
      expect.objectContaining({
        value: 'A',
        cells: [
          expect.anything(),
          { columnId: 'score', value: 50, text: 'mean: 50' },
          { columnId: 'amount', value: 5, text: 'sum: 5' },
        ],
      }),
    ]);
    expect(projection?.rows.flatMap((row) => (
      row.kind === 'data' ? [row.raw.score] : []
    ))).toEqual([60, 60, 100, 0]);
  });
});
