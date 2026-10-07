import type { DataVizFigureProjection } from './figure-types.js';
import type { DataVizTableProjection } from './table-lane.js';
import { projectD3NumberValue } from './d3-format.js';

export type DataVizRawRows = Readonly<{
  columns: readonly string[];
  rows: readonly Readonly<Record<string, unknown>>[];
}>;

export function projectDataVizRawRows(
  projection: DataVizFigureProjection | DataVizTableProjection,
): DataVizRawRows {
  const rows = projection.kind === 'table'
    ? tableRows(projection)
    : figureRows(projection);
  return {
    columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
    rows,
  };
}

function tableRows(
  projection: DataVizTableProjection,
): readonly Readonly<Record<string, unknown>>[] {
  const keys: string[] = [];
  for (const column of projection.columns) {
    const preferred = /^column-\d+$/u.test(column.id) && column.text
      ? column.text
      : column.id;
    keys.push(uniqueFieldName(Object.fromEntries(keys.map((key) => [key, true])), preferred));
  }
  return projection.rows.flatMap((row) => row.kind === 'data'
    ? [Object.fromEntries(projection.columns.map((column, index) => [
        keys[index],
        row.raw[column.id],
      ]))]
    : []);
}

function figureRows(
  projection: DataVizFigureProjection,
): readonly Readonly<Record<string, unknown>>[] {
  const visible = projection.series.filter(({ visibility }) => visibility === 'visible');
  const includeSeries = visible.length > 1;
  return visible.flatMap((series) => series.points.map((point) => {
    const fields: Record<string, unknown> = {};
    for (const field of point.fields) {
      fields[uniqueFieldName(fields, field.path)] = jsonFigureValue(field);
    }
    return {
      ...(includeSeries ? { series: series.identity } : {}),
      ...fields,
    };
  }));
}

function jsonFigureValue(
  field: DataVizFigureProjection['series'][number]['points'][number]['fields'][number],
): unknown {
  if (typeof field.raw !== 'number' || field.format === undefined) return field.raw;
  if (field.formatKind === 'date') return field.raw;
  return projectD3NumberValue(field.format, field.raw);
}

function uniqueFieldName(
  row: Readonly<Record<string, unknown>>,
  field: string,
): string {
  if (!Object.hasOwn(row, field)) return field;
  let suffix = 2;
  while (Object.hasOwn(row, `${field}_${suffix}`)) suffix += 1;
  return `${field}_${suffix}`;
}
