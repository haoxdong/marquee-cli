export type DataVizFigureValue = Readonly<{
  raw: unknown;
  text: string;
}>;

export type DataVizFigurePointField = DataVizFigureValue & Readonly<{
  path: string;
  format?: string;
  formatKind?: 'number' | 'date';
  /** Epoch milliseconds when the projection read this coordinate as a date. */
  date?: number;
}>;

export type DataVizFigurePoint = Readonly<{
  index: number;
  row?: number;
  column?: number;
  fields: readonly DataVizFigurePointField[];
}>;

export type DataVizFigureTooltipField = Readonly<{
  path: string;
  format?: string;
  values: readonly DataVizFigureValue[];
}>;

export type DataVizFigureTooltip = Readonly<{
  mainTemplate?: string;
  literalIdentity: string;
  constants: readonly DataVizFigureTooltipField[];
  pointFields: readonly DataVizFigureTooltipField[];
}>;

/** Only the traits Web shows in the legend: colour and line style. */
export type DataVizFigureSeriesStyle = Readonly<{
  color?: string | number;
  paletteSlot?: number;
  line?: Readonly<{ dash?: string }>;
}>;

export type DataVizFigureSeries = Readonly<{
  id: string;
  sourceIndex: number;
  traceType: DataVizFigureTraceType;
  identity: string;
  visibility: 'visible' | 'hidden' | 'legend-only';
  orientation?: 'h' | 'v';
  axes: Readonly<Record<string, string>>;
  style: DataVizFigureSeriesStyle;
  tooltip?: DataVizFigureTooltip;
  points: readonly DataVizFigurePoint[];
}>;

export type DataVizFigureAxis = Readonly<{
  id: string;
  dimension: 'x' | 'y' | 'z' | 'radial' | 'angular' | 'color';
  title?: string;
  type?: string;
  hoverFormat?: string;
  tickFormat?: string;
  tickPrefix?: string;
  tickSuffix?: string;
  range?: readonly unknown[];
  categoryOrder?: string;
  calendar?: string;
  visible: boolean;
}>;

export type DataVizFigureProjection = Readonly<{
  kind: 'figure';
  chart: Readonly<{ colorWay: readonly string[] }>;
  axes: readonly DataVizFigureAxis[];
  series: readonly DataVizFigureSeries[];
}>;

/** Plotly capabilities and presentation hints shared by projection and text output. */
type DataVizFigureTraceFacts = Readonly<{
  axes: 'cartesian' | 'scene' | 'polar' | 'none';
  markerAttributes: ReadonlySet<string>;
  markerColor: 'color' | 'colors';
  colorMode: 'marker' | 'pie' | 'hierarchy' | 'numeric-hierarchy';
  markerColorArray?: true;
  lineColorArray?: true;
  traceColorScale?: 'c' | 'z';
  textPositionArray?: true;
  textFontArray?: true;
  textRequiresMode?: true;
  coordinates: readonly string[];
  horizontalCoordinates?: readonly string[];
  horizontalCategory?: string;
} & (
  | Readonly<{ projection: 'aligned'; pointAttributes: readonly string[] }>
  | Readonly<{ projection: 'cartesian' | 'box' | 'matrix' | 'pie' | 'hierarchy' }>
)>;

const COLOR_SCALE_ATTRIBUTES = [
  'colorscale', 'cauto', 'cmin', 'cmid', 'cmax', 'autocolorscale',
  'reversescale', 'showscale', 'coloraxis', 'colorbar',
];
const SCATTER_MARKER_ATTRIBUTES = new Set([
  'symbol', 'size', 'opacity', 'color', 'line', 'sizemode', 'sizeref', 'sizemin',
  ...COLOR_SCALE_ATTRIBUTES,
]);

const TRACE_FACTS = {
  bar: {
    projection: 'cartesian', axes: 'cartesian',
    markerAttributes: new Set(['opacity', 'color', 'line', ...COLOR_SCALE_ATTRIBUTES]),
    markerColor: 'color', colorMode: 'marker', markerColorArray: true,
    textPositionArray: true, textFontArray: true,
    coordinates: ['x'],
    horizontalCoordinates: ['y'], horizontalCategory: 'y',
  },
  box: {
    projection: 'box', axes: 'cartesian',
    markerAttributes: new Set(['symbol', 'size', 'opacity', 'color', 'line']),
    markerColor: 'color', colorMode: 'marker',
    coordinates: ['x'], horizontalCoordinates: ['y'],
  },
  heatmap: {
    projection: 'matrix', axes: 'cartesian', markerAttributes: new Set<string>(),
    markerColor: 'color', colorMode: 'marker',
    traceColorScale: 'z',
    coordinates: ['x', 'y'],
  },
  pie: {
    projection: 'pie', axes: 'none', markerAttributes: new Set(['colors', 'line']),
    markerColor: 'colors', colorMode: 'pie',
    textPositionArray: true, textFontArray: true,
    coordinates: ['label'],
  },
  scatter: {
    projection: 'cartesian', axes: 'cartesian',
    markerAttributes: SCATTER_MARKER_ATTRIBUTES,
    markerColor: 'color', colorMode: 'marker', markerColorArray: true,
    textPositionArray: true, textFontArray: true, textRequiresMode: true,
    coordinates: ['x'],
  },
  scatter3d: {
    projection: 'aligned', pointAttributes: ['x', 'y', 'z'], axes: 'scene',
    markerAttributes: SCATTER_MARKER_ATTRIBUTES,
    markerColor: 'color', colorMode: 'marker', markerColorArray: true, lineColorArray: true,
    textPositionArray: true, textFontArray: true, textRequiresMode: true,
    coordinates: ['x', 'y'],
  },
  scatterpolar: {
    projection: 'aligned', pointAttributes: ['theta', 'r'], axes: 'polar',
    markerAttributes: SCATTER_MARKER_ATTRIBUTES,
    markerColor: 'color', colorMode: 'marker', markerColorArray: true,
    textPositionArray: true, textFontArray: true, textRequiresMode: true,
    coordinates: ['theta'],
  },
  sunburst: {
    projection: 'hierarchy', axes: 'none',
    markerAttributes: new Set(['colors', 'line', ...COLOR_SCALE_ATTRIBUTES]),
    markerColor: 'colors', colorMode: 'hierarchy', markerColorArray: true,
    textFontArray: true,
    coordinates: ['label'],
  },
  surface: {
    projection: 'matrix', axes: 'scene', markerAttributes: new Set<string>(),
    markerColor: 'color', colorMode: 'marker',
    traceColorScale: 'c',
    coordinates: ['x', 'y'],
  },
  treemap: {
    projection: 'hierarchy', axes: 'none', markerAttributes: new Set(['colors']),
    markerColor: 'colors', colorMode: 'numeric-hierarchy',
    coordinates: ['label'],
  },
} satisfies Readonly<Record<string, DataVizFigureTraceFacts>>;

export type DataVizFigureTraceType = keyof typeof TRACE_FACTS;

export const DATA_VIZ_FIGURE_TRACE_FACTS: Readonly<Record<DataVizFigureTraceType, DataVizFigureTraceFacts>> = TRACE_FACTS;
export const DATA_VIZ_FIGURE_TRACE_TYPES: readonly DataVizFigureTraceType[] = Object.keys(TRACE_FACTS) as DataVizFigureTraceType[];

/** Raw traces are checked before their supported type is established. */
export function findDataVizFigureTraceFacts(type: unknown): DataVizFigureTraceFacts | undefined {
  return typeof type === 'string' ? DATA_VIZ_FIGURE_TRACE_FACTS[type as DataVizFigureTraceType] : undefined;
}

export type DataVizFigureRawPoint = Readonly<{
  index: number;
  sourceIndices?: readonly number[];
  row?: number;
  column?: number;
  values: Readonly<Record<string, unknown>>;
  displayValues?: Readonly<Record<string, unknown>>;
  dates?: Readonly<Record<string, number>>;
  styleConstants?: Readonly<Record<string, string | number>>;
}>;
