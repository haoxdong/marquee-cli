import { createD3NumberFormatter } from './d3-format.js';

const DATA_VIZ_TABLE_LOCALE = 'en-US';

type DataVizTableCell = Readonly<{
  columnId: string;
  value: unknown;
  text: string;
  bold?: true;
  backgroundColor?: unknown;
}>;

type DataVizTableProjectionRow =
  | Readonly<{
      kind: 'data';
      raw: Readonly<Record<string, unknown>>;
      cells: readonly DataVizTableCell[];
    }>
  | Readonly<{
      kind: 'group';
      groupBy: string;
      value: unknown;
      count: number;
      expanded: boolean;
      cells: readonly DataVizTableCell[];
    }>;

type DataVizTableProjectionColumn = Readonly<{
  id: string;
  header: string;
  text: string;
}>;

type DataVizTableColumnGroupHeader = Readonly<{
  groupId: string;
  label: string;
  columnStart: number;
  columnSpan: number;
}>;

export type DataVizTableProjection = Readonly<{
  kind: 'table';
  columns: readonly DataVizTableProjectionColumn[];
  rows: readonly DataVizTableProjectionRow[];
  sourceRowCount: number;
  columnGroupHeaders?: readonly DataVizTableColumnGroupHeader[];
  emptyMessage?: 'No data available';
}>;

type TableColumn = Readonly<{
  accessorKey: string;
  header?: unknown;
  decimals?: number;
  meta?: ColumnMeta;
  aggregationFn?: unknown;
  enableSorting?: boolean;
  sortingFn?: string;
}>;

type ColumnMeta = Readonly<{
  decimals?: number;
  format?: unknown;
  bold?: boolean;
  conditionalFormatting?: Readonly<{
    enabled?: boolean;
    backgroundColorKey?: string;
  }>;
  group?: string;
}>;

type TableOptions = Readonly<{
  defaultDecimals?: number;
  enablePagination?: boolean;
  pageSize?: number;
}>;

type NativeTable = Readonly<{
  columns: readonly TableColumn[];
  data: readonly Readonly<Record<string, unknown>>[];
  options: TableOptions | undefined;
  defaultSorting: readonly Readonly<{ id: string; desc: boolean }>[] | undefined;
  pinnedColumns: Readonly<{ left: readonly string[]; right: readonly string[] }> | undefined;
  enableSorting: boolean | undefined;
  grouping: readonly string[] | undefined;
  enableGrouping: boolean | undefined;
  expandAllByDefault: boolean | undefined;
  columnGroups: Readonly<Record<string, Readonly<{ label: string }>>> | undefined;
}>;

export class DataVizTableLaneError extends Error {
  override readonly name = 'DataVizTableLaneError';
  readonly problem = 'invalid-table-payload' as const;

  constructor(readonly detail: string) {
    super(`Invalid DataViz table payload: ${detail}`);
  }
}

export function projectDataVizTable(renderPayload: unknown): DataVizTableProjection | undefined {
  if (!isRecord(renderPayload)) return undefined;
  if (renderPayload.type !== 'Table') return plotlyTableProjection(renderPayload);
  const table = nativeTable(renderPayload.table);
  const ordered = orderedColumns(table);
  const columns = ordered.map((column) => ({
    id: column.accessorKey,
    header: typeof column.header === 'string' ? column.header : '',
    text: sortedHeaderText(column, table),
  }));
  const rows = paginatedRows(
    groupedRows(table, ordered, table.data),
    table.options,
  );
  const columnGroupHeaders = projectColumnGroupHeaders(table);
  return {
    kind: 'table',
    columns,
    rows,
    sourceRowCount: table.data.length,
    ...(columnGroupHeaders ? { columnGroupHeaders } : {}),
    ...(table.data.length === 0 ? { emptyMessage: 'No data available' as const } : {}),
  };
}

function nativeTable(value: unknown): NativeTable {
  if (!isRecord(value)) invalidTable('table is not a record');
  if (!Array.isArray(value.columns)) invalidTable('table.columns is not an array');
  if (!Array.isArray(value.data)) invalidTable('table.data is not an array');
  const data = tableData(value.data);
  return {
    columns: value.columns.length === 0
      ? derivedColumns(data[0])
      : value.columns.map((column, index) => tableColumn(column, index)),
    data,
    options: optionalValue(value.options, tableOptions),
    defaultSorting: optionalValue(value.defaultSorting, tableSorting),
    pinnedColumns: optionalValue(value.pinnedColumns, tablePinnedColumns),
    enableSorting: optionalBoolean(value.enableSorting, 'table.enableSorting'),
    grouping: optionalValue(value.grouping, (grouping) => (
      stringArray(grouping, 'table.grouping')
    )),
    enableGrouping: optionalBoolean(value.enableGrouping, 'table.enableGrouping'),
    expandAllByDefault: optionalBoolean(
      value.expandAllByDefault,
      'table.expandAllByDefault',
    ),
    columnGroups: optionalValue(value.columnGroups, tableColumnGroups),
  };
}

function tableColumnGroups(
  value: unknown,
): Readonly<Record<string, Readonly<{ label: string }>>> {
  if (!isRecord(value)) invalidTable('table.columnGroups is not a record');
  return Object.fromEntries(Object.entries(value).map(([groupId, group]) => {
    if (!isRecord(group)) invalidTable(`table.columnGroups.${groupId} is not a record`);
    if (group.label !== undefined && typeof group.label !== 'string') {
      invalidTable(`table.columnGroups.${groupId}.label is not a string`);
    }
    return [groupId, { label: group.label ?? '' }];
  }));
}

function tableData(value: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
  return value.map((row, index) => {
    if (!isRecord(row)) invalidTable(`table.data[${index}] is not a record`);
    return row;
  });
}

function optionalValue<T>(
  value: unknown,
  parse: (candidate: unknown) => T,
): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalidTable(`${label} is not a boolean`);
  return value;
}

function derivedColumns(row: Readonly<Record<string, unknown>> | undefined): TableColumn[] {
  if (!row) return [];
  return Object.keys(row).map((accessorKey) => ({
    accessorKey,
    header: `${accessorKey.slice(0, 1).toUpperCase()}${accessorKey.slice(1).replaceAll('_', ' ')}`,
  }));
}

function tableColumn(value: unknown, index: number): TableColumn {
  if (!isRecord(value)) invalidTable(`table.columns[${index}] is not a record`);
  if (typeof value.accessorKey !== 'string' || value.accessorKey.length === 0) {
    invalidTable(`table.columns[${index}].accessorKey is not a non-empty string`);
  }
  const enableSorting = optionalBoolean(
    value.enableSorting,
    `table.columns[${index}].enableSorting`,
  );
  if (value.sortingFn !== undefined && typeof value.sortingFn !== 'string') {
    invalidTable(`table.columns[${index}].sortingFn is not a string`);
  }
  const decimals = optionalDecimals(value.decimals);
  const meta = optionalValue(value.meta, columnMeta);
  return {
    accessorKey: value.accessorKey,
    ...(value.header !== undefined ? { header: value.header } : {}),
    ...(decimals !== undefined ? { decimals } : {}),
    ...(meta !== undefined ? { meta } : {}),
    ...(value.aggregationFn !== undefined ? { aggregationFn: value.aggregationFn } : {}),
    ...(enableSorting !== undefined ? { enableSorting } : {}),
    ...(value.sortingFn !== undefined ? { sortingFn: value.sortingFn } : {}),
  };
}

function tableOptions(value: unknown): TableOptions {
  if (!isRecord(value)) invalidTable('table.options is not a record');
  const defaultDecimals = optionalDecimals(value.defaultDecimals);
  const enablePagination = optionalBoolean(
    value.enablePagination,
    'table.options.enablePagination',
  );
  const pageSize = optionalPageSize(value.pageSize);
  return {
    ...(defaultDecimals !== undefined ? { defaultDecimals } : {}),
    ...(enablePagination !== undefined ? { enablePagination } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
  };
}

function optionalPageSize(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    invalidTable('table.options.pageSize is not a positive integer');
  }
  return value as number;
}

function tableSorting(value: unknown): readonly Readonly<{ id: string; desc: boolean }>[] {
  if (!Array.isArray(value)) invalidTable('table.defaultSorting is not an array');
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      invalidTable(`table.defaultSorting[${index}] is invalid`);
    }
    if (entry.desc !== undefined && typeof entry.desc !== 'boolean') {
      invalidTable(`table.defaultSorting[${index}].desc is not a boolean`);
    }
    return { id: entry.id, desc: entry.desc === true };
  });
}

function tablePinnedColumns(
  value: unknown,
): Readonly<{ left: readonly string[]; right: readonly string[] }> {
  if (!isRecord(value)) invalidTable('table.pinnedColumns is not a record');
  return {
    left: stringArray(value.left, 'table.pinnedColumns.left'),
    right: stringArray(value.right, 'table.pinnedColumns.right'),
  };
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    invalidTable(`${label} is not a string array`);
  }
  return value;
}

function orderedColumns(table: NativeTable): readonly TableColumn[] {
  const byId = new Map(table.columns.map((column) => [column.accessorKey, column]));
  const groupingIds = table.enableGrouping === true ? table.grouping ?? [] : [];
  const leftIds = table.pinnedColumns?.left ?? [];
  const rightIds = table.pinnedColumns?.right ?? [];
  const prioritizedIds = new Set([...groupingIds, ...leftIds, ...rightIds]);
  return [
    ...groupingIds.flatMap((id) => byId.get(id) ?? []),
    ...leftIds.flatMap((id) => byId.get(id) ?? []),
    ...table.columns.filter((column) => !prioritizedIds.has(column.accessorKey)),
    ...rightIds.flatMap((id) => byId.get(id) ?? []),
  ].filter((column, index, all) => (
    all.findIndex((candidate) => candidate.accessorKey === column.accessorKey) === index
  ));
}

function projectColumnGroupHeaders(
  table: NativeTable,
): readonly DataVizTableColumnGroupHeader[] | undefined {
  const headers: DataVizTableColumnGroupHeader[] = [];
  let current: DataVizTableColumnGroupHeader | undefined;
  for (const [columnStart, column] of table.columns.entries()) {
    const groupId = column.meta?.group;
    if (!groupId) {
      current = undefined;
      continue;
    }
    if (current?.groupId === groupId) {
      current = { ...current, columnSpan: current.columnSpan + 1 };
      headers[headers.length - 1] = current;
      continue;
    }
    current = {
      groupId,
      label: table.columnGroups?.[groupId]?.label ?? '',
      columnStart,
      columnSpan: 1,
    };
    headers.push(current);
  }
  return headers.some(({ label }) => label) ? headers : undefined;
}

function groupedRows(
  table: NativeTable,
  columns: readonly TableColumn[],
  data: readonly Readonly<Record<string, unknown>>[],
): readonly DataVizTableProjectionRow[] {
  const grouping = table.enableGrouping === true ? table.grouping ?? [] : [];
  if (grouping.length === 0) {
    return sortedData(table, data).map((raw) => dataRow(raw, columns, table.options));
  }
  return groupRowsAtLevel(table, columns, data, grouping, 0);
}

function groupRowsAtLevel(
  table: NativeTable,
  columns: readonly TableColumn[],
  data: readonly Readonly<Record<string, unknown>>[],
  grouping: readonly string[],
  level: number,
): readonly DataVizTableProjectionRow[] {
  const groupBy = grouping[level];
  if (groupBy === undefined) {
    const groupedColumns = new Set(grouping);
    return sortedData(table, data).map((raw) => (
      dataRow(raw, columns, table.options, groupedColumns)
    ));
  }
  const groups = new Map<unknown, Readonly<Record<string, unknown>>[]>();
  for (const row of data) {
    const value = row[groupBy];
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }
  const expanded = table.expandAllByDefault !== false;
  return sortedGroups(table, groupBy, [...groups]).flatMap(([value, rows]) => {
    const groupRow: DataVizTableProjectionRow = {
      kind: 'group',
      groupBy,
      value,
      count: rows.length,
      expanded,
      cells: columns.map((column) => groupCell(
        column,
        groupBy,
        value,
        rows,
        expanded,
        table.options,
      )),
    };
    return expanded
      ? [groupRow, ...groupRowsAtLevel(table, columns, rows, grouping, level + 1)]
      : [groupRow];
  });
}

function sortedGroups(
  table: NativeTable,
  groupBy: string,
  groups: readonly Readonly<[
    unknown,
    readonly Readonly<Record<string, unknown>>[],
  ]>[],
): typeof groups {
  const sorting = sortableSorting(table);
  if (sorting.length === 0) return groups;
  return groups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => {
      for (const { sorting: state, column } of sorting) {
        const compared = compareTableValues(
          groupSortingValue(column, groupBy, left.group),
          groupSortingValue(column, groupBy, right.group),
          column.sortingFn,
        );
        if (compared !== 0) return state.desc ? -compared : compared;
      }
      return left.index - right.index;
    })
    .map(({ group }) => group);
}

function groupSortingValue(
  column: TableColumn,
  groupBy: string,
  [groupValue, rows]: Readonly<[
    unknown,
    readonly Readonly<Record<string, unknown>>[],
  ]>,
): unknown {
  return column.accessorKey === groupBy
    ? groupValue
    : aggregateValue(column.aggregationFn, column.accessorKey, rows)?.value;
}

function dataRow(
  raw: Readonly<Record<string, unknown>>,
  columns: readonly TableColumn[],
  options: TableOptions | undefined,
  groupedColumns: ReadonlySet<string> = new Set(),
): DataVizTableProjectionRow {
  return {
    kind: 'data',
    raw,
    cells: columns.map((column) => (
      groupedColumns.has(column.accessorKey)
        ? { columnId: column.accessorKey, value: raw[column.accessorKey], text: '' }
        : tableCell(column, raw, options)
    )),
  };
}

function groupCell(
  column: TableColumn,
  groupBy: string,
  groupValue: unknown,
  rows: readonly Readonly<Record<string, unknown>>[],
  expanded: boolean,
  options: TableOptions | undefined,
): DataVizTableCell {
  if (column.accessorKey === groupBy) {
    const formatted = tableCell(column, { [groupBy]: groupValue }, options);
    return {
      ...formatted,
      text: `${expanded ? '▼' : '▶'} ${formatted.text} (${rows.length})`,
    };
  }
  const aggregate = aggregateValue(column.aggregationFn, column.accessorKey, rows);
  const meta = column.meta ?? {};
  return {
    columnId: column.accessorKey,
    value: aggregate?.value,
    text: aggregate ? `${aggregate.name}: ${String(aggregate.value)}` : '',
    ...(meta.bold ? { bold: true as const } : {}),
  };
}

function aggregateValue(
  fn: unknown,
  columnId: string,
  rows: readonly Readonly<Record<string, unknown>>[],
): Readonly<{ name: string; value: unknown }> | undefined {
  if (typeof fn !== 'string') return undefined;
  const values = rows.map((row) => row[columnId]);
  const numbers = values.filter((value): value is number => typeof value === 'number');
  let value: unknown;
  switch (fn) {
    case 'sum': value = numbers.reduce((total, item) => total + item, 0); break;
    case 'min': value = numbers.length > 0 ? Math.min(...numbers) : undefined; break;
    case 'max': value = numbers.length > 0 ? Math.max(...numbers) : undefined; break;
    case 'mean': value = meanValue(values); break;
    case 'count': value = values.length; break;
    case 'uniqueCount': value = new Set(values).size; break;
    case 'extent': value = numbers.length > 0
      ? [Math.min(...numbers), Math.max(...numbers)]
      : [undefined, undefined]; break;
    default: return undefined;
  }
  return { name: fn, value };
}

function meanValue(values: readonly unknown[]): number | undefined {
  const numbers = values.flatMap((value) => {
    if (value === null || value === undefined) return [];
    const number = Number(value);
    return Number.isNaN(number) ? [] : [number];
  });
  return numbers.length > 0
    ? numbers.reduce((total, item) => total + item, 0) / numbers.length
    : undefined;
}

function sortedHeaderText(
  column: TableColumn,
  table: NativeTable,
): string {
  const header = typeof column.header === 'string' ? column.header : '';
  if (!columnCanSort(table, column)) return header;
  const state = table.defaultSorting?.find((entry) => entry.id === column.accessorKey);
  return state ? `${header} ${state.desc ? '↓' : '↑'}` : header;
}

function sortedData(
  table: NativeTable,
  data: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  if (table.enableSorting === false || !table.defaultSorting?.length) return data;
  const sortable = sortableSorting(table);
  if (sortable.length === 0) return data;
  const indexed = data.map((row, index) => ({ row, index }));
  indexed.sort((left, right) => {
    for (const { sorting, column } of sortable) {
      const compared = compareTableValues(
        left.row[sorting.id],
        right.row[sorting.id],
        column.sortingFn,
      );
      if (compared !== 0) return sorting.desc ? -compared : compared;
    }
    return left.index - right.index;
  });
  return indexed.map(({ row }) => row);
}

function sortableSorting(table: NativeTable): readonly Readonly<{
  sorting: Readonly<{ id: string; desc: boolean }>;
  column: TableColumn;
}>[] {
  return (table.defaultSorting ?? []).flatMap((sorting) => {
    const column = table.columns.find(({ accessorKey }) => accessorKey === sorting.id);
    return column && columnCanSort(table, column) ? [{ sorting, column }] : [];
  });
}

function columnCanSort(table: NativeTable, column: TableColumn): boolean {
  return table.enableSorting !== false && column.enableSorting !== false;
}

function compareTableValues(left: unknown, right: unknown, sortingFn?: string): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (sortingFn === 'datetime') {
    const difference = new Date(webCellText(left)).getTime() - new Date(webCellText(right)).getTime();
    if (!Number.isNaN(difference)) return difference;
  }
  if (sortingFn === 'text') {
    return basicCompare(webCellText(left).toLowerCase(), webCellText(right).toLowerCase());
  }
  if (sortingFn === 'textCaseSensitive' || sortingFn === 'basic') {
    return basicCompare(left, right);
  }
  const caseSensitive = sortingFn === 'alphanumericCaseSensitive';
  if (sortingFn === 'alphanumeric' || caseSensitive || sortingFn === undefined || sortingFn === 'auto') {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return webCellText(left).localeCompare(webCellText(right), DATA_VIZ_TABLE_LOCALE, {
      numeric: true,
      sensitivity: caseSensitive ? 'variant' : 'base',
    });
  }
  return basicCompare(left, right);
}

function basicCompare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) > String(right) ? 1 : -1;
}

function paginatedRows<Row>(
  rows: readonly Row[],
  options: TableOptions | undefined,
): readonly Row[] {
  if (options?.enablePagination !== true) return rows;
  return rows.slice(0, options.pageSize ?? 50);
}

function tableCell(
  column: TableColumn,
  row: Readonly<Record<string, unknown>>,
  options: TableOptions | undefined,
): DataVizTableCell {
  const meta = column.meta ?? {};
  const value = row[column.accessorKey];
  const decimals = optionalDecimals(
    column.decimals ?? meta.decimals ?? options?.defaultDecimals,
  );
  const backgroundColor = cellBackgroundColor(row, meta.conditionalFormatting);
  return {
    columnId: column.accessorKey,
    value,
    text: formatTableValue(value, decimals, meta.format),
    ...(meta.bold ? { bold: true as const } : {}),
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
  };
}

function columnMeta(value: unknown): ColumnMeta {
  if (!isRecord(value)) invalidTable('column meta is not a record');
  const decimals = optionalDecimals(value.decimals);
  const bold = optionalBoolean(value.bold, 'column meta bold');
  const conditionalFormatting = optionalValue(
    value.conditionalFormatting,
    tableConditionalFormatting,
  );
  if (value.group !== undefined && typeof value.group !== 'string') {
    invalidTable('column meta group is not a string');
  }
  return {
    ...(decimals !== undefined ? { decimals } : {}),
    ...(value.format !== undefined ? { format: value.format } : {}),
    ...(bold !== undefined ? { bold } : {}),
    ...(conditionalFormatting !== undefined ? { conditionalFormatting } : {}),
    ...(value.group !== undefined ? { group: value.group } : {}),
  };
}

function tableConditionalFormatting(
  value: unknown,
): NonNullable<ColumnMeta['conditionalFormatting']> {
  if (!isRecord(value)) invalidTable('column meta conditionalFormatting is not a record');
  const enabled = optionalBoolean(
    value.enabled,
    'column meta conditionalFormatting.enabled',
  );
  if (
    value.backgroundColorKey !== undefined
    && typeof value.backgroundColorKey !== 'string'
  ) {
    invalidTable('column meta conditionalFormatting.backgroundColorKey is not a string');
  }
  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(value.backgroundColorKey !== undefined
      ? { backgroundColorKey: value.backgroundColorKey }
      : {}),
  };
}

function cellBackgroundColor(
  row: Readonly<Record<string, unknown>>,
  conditionalFormatting: ColumnMeta['conditionalFormatting'],
): unknown {
  const key = conditionalFormatting?.backgroundColorKey;
  return conditionalFormatting?.enabled && key ? row[key] || undefined : undefined;
}

function optionalDecimals(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    invalidTable('decimals is not a non-negative integer');
  }
  return value as number;
}

function formatTableValue(
  value: unknown,
  decimals: number | undefined,
  format: unknown,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number') return webCellText(value);
  const text = new Intl.NumberFormat(DATA_VIZ_TABLE_LOCALE, decimals === undefined
    ? undefined
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return format === 'percent' ? `${text}%` : text;
}

function plotlyTableProjection(
  renderPayload: Readonly<Record<string, unknown>>,
): DataVizTableProjection | undefined {
  if (!Array.isArray(renderPayload.data) || renderPayload.data.length === 0) return undefined;
  const traces = renderPayload.data.filter(isRecord);
  if (traces.length !== renderPayload.data.length || traces.some((trace) => trace.type !== 'table')) {
    return undefined;
  }
  const traceColumns = traces.map(plotlyTableTraceColumns);
  const [firstColumns] = traceColumns;
  const titles = traces.map((trace) => plotlyTableTitle(trace, renderPayload.layout));
  const { headers, cellRows } = firstColumns && titles.some((title) => title !== undefined)
    ? titledPlotlyTable(firstColumns.headers, traceColumns, titles)
    : sideBySidePlotlyTable(traceColumns);
  const columns = headers.map((header, index) => ({ id: `column-${index}`, header, text: header }));
  const rows = cellRows.map((cells) => ({
    kind: 'data' as const,
    raw: Object.fromEntries(cells.map(({ value }, index) => [`column-${index}`, value])),
    cells: cells.map((cell, index) => ({ columnId: `column-${index}`, ...cell })),
  }));
  return { kind: 'table', columns, rows, sourceRowCount: rows.length };
}

type PlotlyTableColumns = ReturnType<typeof plotlyTableTraceColumns>;
type PlotlyTableCells = readonly (readonly Readonly<{ value: unknown; text: string }>[])[];

// Web draws side-by-side table traces (e.g. one per weekday) as adjacent columns.
function sideBySidePlotlyTable(traceColumns: readonly PlotlyTableColumns[]) {
  return {
    headers: traceColumns.flatMap(({ headers }) => headers),
    cellRows: plotlyTableCells(
      traceColumns.flatMap(({ values }) => values),
      traceColumns.flatMap(({ formats }) => formats),
    ),
  };
}

// Web titles each of several same-header table traces (e.g. one per weekday)
// with an annotation above it; each titled row leads with its title.
function titledPlotlyTable(
  headers: PlotlyTableColumns['headers'],
  traceColumns: readonly PlotlyTableColumns[],
  titles: readonly (string | undefined)[],
) {
  if (traceColumns.some((columns) => (
    columns.headers.length !== headers.length
    || columns.headers.some((header, index) => header !== headers[index])
  ))) {
    invalidTable('titled Plotly table traces have different headers');
  }
  return {
    headers: ['', ...headers],
    cellRows: traceColumns.flatMap(({ values, formats }, traceIndex) => {
      const title = titles[traceIndex];
      if (title === undefined) invalidTable('Plotly table trace has no title annotation');
      return plotlyTableCells(values, formats).map((cells) => [{ value: title, text: title }, ...cells]);
    }),
  };
}

function plotlyTableCells(
  columnValues: readonly (readonly unknown[])[],
  formats: readonly string[],
): PlotlyTableCells {
  const rowCount = columnValues[0]?.length ?? 0;
  if (columnValues.some((values) => values.length !== rowCount)) {
    invalidTable('Plotly table columns have different row counts');
  }
  return Array.from({ length: rowCount }, (_, rowIndex) => columnValues.map((values, columnIndex) => ({
    value: values[rowIndex],
    text: formatPlotlyCell(values[rowIndex], formats[columnIndex]),
  })));
}

function plotlyTableTitle(
  trace: Readonly<Record<string, unknown>>,
  layout: unknown,
): string | undefined {
  const domain = isRecord(trace.domain) ? trace.domain.x : undefined;
  if (!Array.isArray(domain) || !isRecord(layout) || !Array.isArray(layout.annotations)) {
    return undefined;
  }
  const [start, end] = domain;
  const titles = layout.annotations.filter((annotation) => (
    isRecord(annotation)
    && annotation.xref === 'paper'
    && typeof annotation.x === 'number'
    && annotation.x >= start
    && annotation.x <= end
  )).map((annotation) => plotlyText(annotation.text));
  if (titles.length > 1) invalidTable('Plotly table trace has several title annotations');
  return titles[0];
}

function plotlyTableTraceColumns(trace: Readonly<Record<string, unknown>>): Readonly<{
  values: readonly unknown[][];
  headers: readonly string[];
  formats: readonly string[];
}> {
  if (!isRecord(trace.header) || !Array.isArray(trace.header.values)) {
    invalidTable('Plotly table header.values is not an array');
  }
  if (!isRecord(trace.cells) || !Array.isArray(trace.cells.values)) {
    invalidTable('Plotly table cells.values is not an array');
  }
  const values = trace.cells.values.map((column, index) => {
    if (!Array.isArray(column)) {
      invalidTable(`Plotly table cells.values[${index}] is not an array`);
    }
    return column;
  });
  if (trace.header.values.length !== values.length) {
    invalidTable('Plotly table header and cell column counts differ');
  }
  return {
    values,
    headers: trace.header.values.map(plotlyHeaderText),
    formats: plotlyFormats(trace.cells.format, values.length),
  };
}

function plotlyHeaderText(value: unknown): string {
  const candidate = Array.isArray(value)
    ? [...value].reverse().find((entry) => plotlyText(entry))
    : value;
  return plotlyText(candidate);
}

function plotlyFormats(value: unknown, columnCount: number): readonly string[] {
  if (value === undefined) return Array.from({ length: columnCount }, () => '');
  if (typeof value === 'string') return Array.from({ length: columnCount }, () => value);
  if (!Array.isArray(value)) invalidTable('Plotly table cells.format is invalid');
  return Array.from({ length: columnCount }, (_, index) => (
    typeof value[index] === 'string' ? value[index] : ''
  ));
}

function formatPlotlyCell(value: unknown, format: string | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && format) return createD3NumberFormatter(format)(value);
  return plotlyText(value);
}

function plotlyText(value: unknown): string {
  return webCellText(value ?? '')
    .replace(/<br\s*\/?>/giu, ', ')
    .replace(/<[^>]*>/gu, '')
    .trim();
}

// Web renders a cell with JavaScript's String(), so an object cell reads "[object Object]"
// and an array cell joins its entries with commas.
function webCellText(value: unknown): string {
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidTable(detail: string): never {
  throw new DataVizTableLaneError(detail);
}
