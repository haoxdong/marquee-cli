import tinycolor from 'tinycolor2';

import {
  DEFAULT_PLOTLY_COLOR_WAY,
  extendPieColorWay,
  figureItemAt,
  figureValueText,
  initialSunburstColorState,
  isPlotlyColorScale,
  projectFigureRawPoints,
  resolvePieColorMaps,
  type SunburstColorState,
} from './figure-points.js';
import {
  isPlotlyCalendar,
  plotlyCalendarCoordinateText,
  plotlyDateMilliseconds,
  projectFigureTooltip,
  type FigureTooltipDateContext,
  type FigureTooltipFormat,
} from './figure-tooltip.js';
import {
  DATA_VIZ_FIGURE_TRACE_FACTS,
  findDataVizFigureTraceFacts,
  DATA_VIZ_FIGURE_TRACE_TYPES,
  type DataVizFigureAxis,
  type DataVizFigureProjection,
  type DataVizFigureRawPoint,
  type DataVizFigureSeries,
  type DataVizFigureSeriesStyle,
  type DataVizFigureTraceType,
} from './figure-types.js';

type RecordValue = Readonly<Record<string, unknown>>;
const FIGURE_TRACE_TYPES = new Set<string>(DATA_VIZ_FIGURE_TRACE_TYPES);
const CARTESIAN_AXIS = /^(xaxis|yaxis)(?:[2-9]|[1-9]\d+)?$/;
const COLOR_AXIS = /^coloraxis(?:[2-9]|[1-9]\d+)?$/;
const SCENE = /^scene(?:[2-9]|[1-9]\d+)?$/;
const POLAR = /^polar(?:[2-9]|[1-9]\d+)?$/;

const MARKER_ATTRIBUTES = new Set(
  Object.values(DATA_VIZ_FIGURE_TRACE_FACTS).flatMap(({ markerAttributes }) => [...markerAttributes]),
);
export class DataVizFigureProjectionError extends Error {
  override readonly name = 'DataVizFigureProjectionError';
  readonly problem = 'invalid-figure-payload' as const;

  constructor(readonly detail: string, options?: ErrorOptions) {
    super(`Invalid DataViz figure payload: ${detail}`, options);
  }
}

export function projectDataVizFigure(
  renderData: unknown,
): DataVizFigureProjection | undefined {
  try {
    const payload = requiredRecord(renderData, 'renderData');
    const rawData = requiredArray(payload.data, 'renderData.data');
    const rawLayout = requiredRecord(payload.layout, 'renderData.layout');
    if (isTablePayload(rawData)) return undefined;
    const { data: resolvedData, layout } = resolveTemplate(rawData, rawLayout);
    rejectUnevidencedPlotlyInternals(resolvedData, layout);
    const data = resolvedData.map((trace, sourceIndex) => (
      coerceTraceMarkerSchema(trace, sourceIndex)
    ));
    const colorWay = plotlyColorWay(layout.colorway);
    const pieColorWay = plotlyColorWay(layout.piecolorway ?? layout.colorway);
    const extendPieColors = optionalBoolean(layout.extendpiecolors, 'layout.extendpiecolors') ?? true;
    const rawSunburstColorWay = plotlyColorWay(layout.sunburstcolorway ?? layout.colorway);
    const extendSunburstColors = optionalBoolean(
      layout.extendsunburstcolors,
      'layout.extendsunburstcolors',
    ) ?? true;
    const sunburstColorWay = extendSunburstColors
      ? extendPieColorWay(rawSunburstColorWay)
      : rawSunburstColorWay;
    const pieColorMaps = resolvePieColorMaps(
      data,
      extendPieColors ? extendPieColorWay(pieColorWay) : pieColorWay,
    );
    const layoutCalendar = resolvedCalendar(layout.calendar);
    const axes = projectAxes(layout, layoutCalendar);
    const categoryValues = initialCategoryValues(layout);
    for (const trace of data) {
      if (trace.visible !== false && trace.visible !== 'legendonly') {
        registerTraceCategories(trace, axes, categoryValues, layoutCalendar);
      }
    }
    orderCategoryValues(axes, categoryValues);
    let boxPosition = 0;
    const boxPositions = data.map((trace) => findDataVizFigureTraceFacts(trace.type)?.projection === 'box' ? boxPosition++ : boxPosition);
    const sunburstColorState = initialSunburstColorState(data);
    return {
      kind: 'figure',
      chart: { colorWay },
      axes,
      series: data.map((trace, sourceIndex) => projectSeries(
        trace,
        sourceIndex,
        axes,
        optionalStringArray(layout.hiddenlabels, 'layout.hiddenlabels'),
        colorWay,
        figureItemAt(pieColorMaps, sourceIndex),
        categoryValues,
        layoutCalendar,
        figureItemAt(boxPositions, sourceIndex),
        sunburstColorWay,
        sunburstColorState,
      )),
    };
  } catch (cause) {
    if (cause instanceof DataVizFigureProjectionError) throw cause;
    throw new DataVizFigureProjectionError(errorDetail(cause), { cause });
  }
}

function rejectUnevidencedPlotlyInternals(
  data: readonly RecordValue[],
  layout: RecordValue,
): void {
  visitLayoutRecords(layout, (value, path) => {
    if (value.calendar !== undefined && value.calendar !== 'gregorian') {
      invalidFigure(`${path}.calendar uses an unevidenced non-Gregorian calendar`);
    }
    if (
      typeof value.categoryorder === 'string'
      && /^(total|sum|min|max|mean|geometric mean|median) (ascending|descending)$/.test(
        value.categoryorder,
      )
    ) {
      invalidFigure(`${path}.categoryorder uses unevidenced value aggregation`);
    }
  });
  data.forEach((trace, sourceIndex) => {
    const colorMode = findDataVizFigureTraceFacts(trace.type)?.colorMode;
    for (const coordinate of ['x', 'y', 'z'] as const) {
      const calendar = trace[`${coordinate}calendar`];
      if (calendar !== undefined && calendar !== 'gregorian') {
        invalidFigure(`trace ${sourceIndex} ${coordinate}calendar uses an unevidenced non-Gregorian calendar`);
      }
    }
    if (colorMode === 'numeric-hierarchy' && !hasOnlyNumericMarkerColors(trace.marker)) {
      invalidFigure(`trace ${sourceIndex} uses unevidenced treemap colors`);
    }
    if (colorMode === 'hierarchy' && hasUnevidencedSunburstColorScale(trace.marker)) {
      invalidFigure(`trace ${sourceIndex} uses unevidenced sunburst numeric colorscale interpolation`);
    }
  });
}

function visitLayoutRecords(
  value: RecordValue,
  visit: (record: RecordValue, path: string) => void,
  path = 'layout',
): void {
  visit(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) visitLayoutRecords(child, visit, `${path}.${key}`);
  }
}

// The recorded treemap colors every tile by a numeric color-axis value.
function hasOnlyNumericMarkerColors(marker: unknown): boolean {
  return isRecord(marker)
    && Array.isArray(marker.colors)
    && marker.colors.every((color) => typeof color === 'number');
}

function hasUnevidencedSunburstColorScale(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const colors = Array.isArray(value.colors) ? value.colors : [];
  const hasNumericColors = colors.some((color) => (
    typeof color === 'number'
    || (typeof color === 'string' && color.trim() !== '' && Number.isFinite(Number(color)))
  ));
  if (hasNumericColors) return true;
  if (colors.length > 0) return false;
  return value.colorscale !== undefined
    || value.showscale === true
    || value.cmin !== undefined
    || value.cmid !== undefined
    || value.cmax !== undefined
    || value.cauto !== undefined
    || value.colorbar !== undefined
    || value.coloraxis !== undefined;
}

function projectSeries(
  trace: RecordValue,
  sourceIndex: number,
  axes: readonly DataVizFigureAxis[],
  hiddenLabels: readonly string[] | undefined,
  colorWay: readonly string[],
  pieColorMap: ReadonlyMap<string, string>,
  categoryValues: Map<string, string[]>,
  layoutCalendar: string | undefined,
  boxPosition: number,
  sunburstColorWay: readonly string[],
  sunburstColorState: SunburstColorState,
): DataVizFigureSeries {
  const traceType = traceTypeOf(trace.type, sourceIndex);
  const participatesInCalc = trace.visible !== false && trace.visible !== 'legendonly';
  const coordinateTypes = new Map((['x', 'y'] as const).flatMap((path) => {
    const type = pointAxis(path, trace, axes)?.type
      ?? inferredTraceCoordinateType(trace, path, layoutCalendar);
    return type === undefined ? [] : [[path, type] as const];
  }));
  const categoryOrigins = new Map((['x', 'y'] as const).flatMap((path) => {
    const axis = pointAxis(path, trace, axes);
    const axisId = pointAxisId(path, trace);
    const origin = trace[`${path}0`];
    if (
      axisId === undefined
      || origin === undefined
      || origin === null
      || (
        axis?.type !== 'category'
        && axis?.type !== 'multicategory'
        && !categoryValues.has(axisId)
        && !(typeof origin === 'string' && autoCategoryValue(
          origin,
          resolvedCalendar(trace[`${path}calendar`], layoutCalendar),
        ))
      )
    ) return [];
    return [[path, categoryIndex(categoryValues, axisId, origin, participatesInCalc)] as const];
  }));
  const projectedRawPoints = projectFigureRawPoints(
    layoutCalendar === undefined ? trace : {
      ...trace,
      xcalendar: resolvedCalendar(trace.xcalendar, layoutCalendar),
      ycalendar: resolvedCalendar(trace.ycalendar, layoutCalendar),
    },
    traceType,
    hiddenLabels,
    colorWay,
    pieColorMap,
    coordinateTypes,
    categoryOrigins,
    new Map((['x', 'y'] as const).flatMap((path) => {
      const axisId = pointAxisId(path, trace);
      const values = axisId === undefined ? undefined : categoryValues.get(axisId);
      return values === undefined ? [] : [[path, values] as const];
    })),
    boxPosition,
    sunburstColorWay,
    participatesInCalc
      ? sunburstColorState
      : { labelColors: new Map(), nextColor: 0 },
  );
  const rawPoints = projectDateCoordinates(
    projectedRawPoints,
    trace,
    axes,
    coordinateTypes,
    layoutCalendar,
  );
  const template = stableTooltipTemplate(
    optionalTooltipTemplate(trace.hovertemplate, sourceIndex),
    rawPoints,
  );
  const defaultFormat = (path: string): FigureTooltipFormat | undefined => (
    pointFormat(path, trace, axes, coordinateTypes.get(path as 'x' | 'y'))
  );
  const dateContext = (path: string): FigureTooltipDateContext => (
    pointDateContext(path, trace, axes, coordinateTypes, layoutCalendar)
  );
  const tooltipProjection = projectFigureTooltip(
    trace,
    rawPoints,
    template,
    defaultFormat,
    dateContext,
  );
  const name = optionalString(trace.name, `trace ${sourceIndex} name`);
  const literalIdentity = tooltipProjection.tooltip?.literalIdentity ?? '';
  const identity = name?.trim() || literalIdentity || `trace ${sourceIndex}`;
  return {
    id: `series-${sourceIndex + 1}`,
    sourceIndex,
    traceType,
    identity,
    visibility: traceVisibility(trace.visible),
    ...optionalOrientation(resolvedOrientation(trace, traceType), sourceIndex),
    axes: traceAxes(trace, traceType),
    style: projectStyle(trace, traceType, sourceIndex, rawPoints),
    ...(tooltipProjection.tooltip === undefined ? {} : { tooltip: tooltipProjection.tooltip }),
    points: tooltipProjection.points,
  };
}

function projectDateCoordinates(
  points: readonly DataVizFigureRawPoint[],
  trace: RecordValue,
  axes: readonly DataVizFigureAxis[],
  coordinateTypes: ReadonlyMap<'x' | 'y', string>,
  layoutCalendar: string | undefined,
): readonly DataVizFigureRawPoint[] {
  return points.map((point) => {
    const dates = (['x', 'y'] as const).flatMap((path) => {
      if (coordinateTypes.get(path) !== 'date') return [];
      const context = pointDateContext(path, trace, axes, coordinateTypes, layoutCalendar);
      const milliseconds = plotlyDateMilliseconds(point.values[path], true, context.inputCalendar);
      return milliseconds === undefined ? [] : [{
        path,
        milliseconds,
        text: plotlyCalendarCoordinateText(milliseconds, context.outputCalendar),
      }];
    });
    return {
      ...point,
      dates: Object.fromEntries(dates.map(({ path, milliseconds }) => [path, milliseconds])),
      displayValues: {
        ...point.displayValues,
        ...Object.fromEntries(dates.map(({ path, text }) => [path, text])),
      },
    };
  });
}

function pointDateContext(
  path: string,
  trace: RecordValue,
  axes: readonly DataVizFigureAxis[],
  coordinateTypes: ReadonlyMap<'x' | 'y', string>,
  layoutCalendar: string | undefined,
): FigureTooltipDateContext {
  const coordinate = ['x', 'y', 'z'].includes(path) ? path as 'x' | 'y' | 'z' : undefined;
  const axis = pointAxis(path, trace, axes);
  const traceCalendar = coordinate === undefined
    ? undefined
    : resolvedCalendar(trace[`${coordinate}calendar`], layoutCalendar);
  const outputCalendar = resolvedCalendar(axis?.calendar, layoutCalendar);
  return {
    allowEpoch: axis?.type === 'date' || coordinateTypes.get(path as 'x' | 'y') === 'date',
    ...(traceCalendar ? { inputCalendar: traceCalendar } : {}),
    ...(outputCalendar ? { outputCalendar } : {}),
  };
}

function resolvedCalendar(value: unknown, fallback?: string): string | undefined {
  return isPlotlyCalendar(value) ? value : fallback;
}

function inferredTraceCoordinateType(
  trace: RecordValue,
  path: 'x' | 'y',
  layoutCalendar?: string,
): string | undefined {
  const calendar = resolvedCalendar(trace[`${path}calendar`], layoutCalendar);
  const values = trace[path];
  if (Array.isArray(values)) {
    const dates = values.filter((value) => (
      typeof value === 'string'
      && /[-Tt:]/.test(value)
      && plotlyDateMilliseconds(value, false, calendar) !== undefined
    ));
    const numerics = values.filter((value) => cleanAxisNumber(value) !== undefined);
    if (dates.length > numerics.length * 2) return 'date';
    if (autoCategoryValues(values, calendar)) return 'category';
  }
  const value = trace[`${path}0`];
  if (typeof value !== 'string') return undefined;
  if (/[-Tt:]/.test(value) && plotlyDateMilliseconds(value, false, calendar) !== undefined) return 'date';
  return autoCategoryValue(value, calendar) ? 'category' : undefined;
}

function registerTraceCategories(
  trace: RecordValue,
  axes: readonly DataVizFigureAxis[],
  categoryValues: Map<string, string[]>,
  layoutCalendar?: string,
): void {
  for (const path of ['x', 'y'] as const) {
    const axis = pointAxis(path, trace, axes);
    const axisId = pointAxisId(path, trace);
    if (axisId === undefined) continue;
    const values = trace[path];
    if (!Array.isArray(values)) continue;
    const isCategoryAxis = axis?.type === 'category' || axis?.type === 'multicategory' || (
      axis?.type === undefined && autoCategoryValues(
        values,
        resolvedCalendar(trace[`${path}calendar`], layoutCalendar),
      )
    );
    if (!isCategoryAxis) continue;
    for (const value of values) {
      if (value !== undefined && value !== null) categoryIndex(categoryValues, axisId, value);
    }
  }
}

function orderCategoryValues(
  axes: readonly DataVizFigureAxis[],
  categoryValues: Map<string, string[]>,
): void {
  for (const [axisId, values] of categoryValues) {
    const order = axes.find(({ id }) => id === axisId)?.categoryOrder;
    if (order === 'category ascending') values.sort();
    if (order === 'category descending') values.sort().reverse();
  }
}

function autoCategoryValues(values: readonly unknown[], calendar?: string): boolean {
  const categories = new Set(values.filter((value) => autoCategoryValue(value, calendar)).map(String));
  const numerics = new Set(values.filter((value) => cleanAxisNumber(value) !== undefined).map(String));
  return categories.size > numerics.size * 2;
}

function autoCategoryValue(value: unknown, calendar?: string): boolean {
  if (typeof value !== 'string') return false;
  if (/[-Tt:]/.test(value) && plotlyDateMilliseconds(value, false, calendar) !== undefined) return false;
  return cleanAxisNumber(value) === undefined;
}

function cleanAxisNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const numeric = Number(value.replace(/^['"%,$#\s']+|[, ]|['"%,$#\s']+$/g, ''));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function categoryIndex(
  categoryValues: Map<string, string[]>,
  axisId: string,
  value: unknown,
  reserve = true,
): number {
  const values = categoryValues.get(axisId) ?? [];
  const key = String(value);
  const existing = values.indexOf(key);
  if (existing >= 0) return existing;
  const index = values.length;
  if (reserve) {
    values.push(key);
    categoryValues.set(axisId, values);
  }
  return index;
}

function initialCategoryValues(layout: RecordValue): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const [key, value] of Object.entries(layout)) {
    if (!/^[xy]axis(?:[2-9]|[1-9]\d+)?$/.test(key) || !isRecord(value)) continue;
    if (
      (value.categoryorder !== undefined && value.categoryorder !== 'array')
      || !Array.isArray(value.categoryarray)
    ) continue;
    const categories = value.categoryarray
      .filter((item) => item !== undefined && item !== null)
      .map(String);
    if (categories.length > 0) values.set(key, [...new Set(categories)]);
  }
  return values;
}

function stableTooltipTemplate(
  template: string | readonly string[] | undefined,
  points: readonly Readonly<{ index: number; sourceIndices?: readonly number[] }>[],
): string | readonly string[] | undefined {
  if (template === undefined || typeof template === 'string') return template;
  const selected = points.map((point) => (
    (point.sourceIndices ?? [point.index]).map((index) => template[index]).find((value) => (
      value !== undefined
    ))
  ));
  return selected.length > 0 && selected.every((value) => (
    value !== undefined && value === selected[0]
  )) ? selected[0] : template;
}

function traceTypeOf(value: unknown, sourceIndex: number): DataVizFigureTraceType {
  if (value === undefined) return 'scatter';
  if (typeof value !== 'string' || !FIGURE_TRACE_TYPES.has(value)) {
    return invalidFigure(`trace ${sourceIndex} has unknown trace type ${figureValueText(value)}`);
  }
  return value as DataVizFigureTraceType;
}

function optionalTooltipTemplate(
  value: unknown,
  sourceIndex: number,
): string | readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return invalidFigure(`trace ${sourceIndex} hovertemplate is not a string or string array`);
}

function traceAxes(
  trace: RecordValue,
  traceType: DataVizFigureTraceType,
): Readonly<Record<string, string>> {
  const axes = DATA_VIZ_FIGURE_TRACE_FACTS[traceType].axes;
  if (axes === 'polar') {
    const subplot = plotlySubplotId(trace.subplot, 'polar');
    return { radial: `${subplot}.radialaxis`, angular: `${subplot}.angularaxis` };
  }
  if (axes === 'scene') {
    const scene = plotlySubplotId(trace.scene, 'scene');
    return { x: `${scene}.xaxis`, y: `${scene}.yaxis`, z: `${scene}.zaxis` };
  }
  if (axes === 'none') return {};
  return {
    x: plotlyAxisId(trace.xaxis, 'x'),
    y: plotlyAxisId(trace.yaxis, 'y'),
    ...(typeof trace.coloraxis === 'string' ? { color: trace.coloraxis } : {}),
  };
}

function plotlySubplotId(
  value: unknown,
  prefix: 'scene' | 'polar',
): string {
  if (value === undefined) return prefix;
  if (typeof value !== 'string') return prefix;
  return new RegExp(`^${prefix}(?:[2-9]|[1-9]\\d+)?$`).test(value) ? value : prefix;
}

function plotlyAxisId(value: unknown, dimension: 'x' | 'y'): string {
  if (value === undefined) return `${dimension}axis`;
  if (typeof value !== 'string') return `${dimension}axis`;
  if (!new RegExp(`^${dimension}(?:[2-9]|[1-9]\\d+)?$`).test(value)) return `${dimension}axis`;
  return `${dimension}axis${value.slice(1)}`;
}

function pointFormat(
  path: string,
  trace: RecordValue,
  axes: readonly DataVizFigureAxis[],
  inferredType?: string,
): FigureTooltipFormat | undefined {
  const axis = pointAxis(path, trace, axes);
  const axisType = axis?.type ?? inferredType;
  const hoverFormat = trace[`${path}hoverformat`];
  if (typeof hoverFormat === 'string' && hoverFormat !== '') {
    return {
      format: hoverFormat,
      kind: axisType === 'date' || (axisType === undefined && isDateFormat(hoverFormat))
        ? 'date'
        : 'number',
    };
  }
  const axisFormat = axis?.hoverFormat || axis?.tickFormat;
  if (axisFormat === undefined) return undefined;
  return {
    format: axisFormat,
    kind: axisType === 'date' || (axisType === undefined && isDateFormat(axisFormat))
      ? 'date'
      : 'number',
  };
}

function isDateFormat(format: string): boolean {
  return /%[-_0]?[A-Za-z%]/.test(format);
}

function pointAxis(
  path: string,
  trace: RecordValue,
  axes: readonly DataVizFigureAxis[],
): DataVizFigureAxis | undefined {
  const axisId = pointAxisId(path, trace);
  return axes.find(({ id }) => id === axisId);
}

function pointAxisId(path: string, trace: RecordValue): string | undefined {
  const axes = findDataVizFigureTraceFacts(trace.type)?.axes;
  if (axes === 'scene') {
    const scene = plotlySubplotId(trace.scene, 'scene');
    return ['x', 'y', 'z'].includes(path) ? `${scene}.${path}axis` : undefined;
  }
  if (axes === 'polar') {
    const polar = plotlySubplotId(trace.subplot, 'polar');
    if (path === 'r') return `${polar}.radialaxis`;
    return path === 'theta' ? `${polar}.angularaxis` : undefined;
  }
  if (path === 'x' || path === 'y') return plotlyAxisId(trace[`${path}axis`], path);
  return path === 'z' && typeof trace.coloraxis === 'string' ? trace.coloraxis : undefined;
}

function projectStyle(
  trace: RecordValue,
  traceType: DataVizFigureTraceType,
  sourceIndex: number,
  rawPoints: readonly DataVizFigureRawPoint[],
): DataVizFigureSeriesStyle {
  const facts = DATA_VIZ_FIGURE_TRACE_FACTS[traceType];
  if (facts.colorMode === 'numeric-hierarchy') return {};
  const pointCount = rawPoints.length;
  const marker = optionalRecord(trace.marker, `trace ${sourceIndex} marker`);
  const line = optionalRecord(trace.line, `trace ${sourceIndex} line`);
  const markerColorValue = marker?.[facts.markerColor];
  const color = facts.colorMode === 'pie'
    ? rawPoints[0]?.styleConstants?.['marker.colors']
    : projectConstantColor(
        markerColorValue,
        `trace ${sourceIndex} marker.${facts.markerColor}`,
        pointCount,
        facts.markerColorArray === true,
      ) ?? projectLineColor(line?.color, traceType, sourceIndex, pointCount);
  const hasExplicitColor = facts.colorMode === 'pie'
    || markerColorValue !== undefined
    || line?.color !== undefined
    || hasTraceColorStyle(trace, traceType);
  const dash = optionalString(line?.dash, `trace ${sourceIndex} line.dash`);
  return {
    ...(color === undefined
      ? hasExplicitColor ? {} : { paletteSlot: sourceIndex + 1 }
      : { color }),
    ...(dash === undefined ? {} : { line: { dash } }),
  };
}

function coerceMarkerSchema(
  marker: RecordValue | undefined,
  traceType: DataVizFigureTraceType,
): RecordValue | undefined {
  if (marker === undefined) return undefined;
  const coerced = Object.fromEntries(Object.entries(marker).filter(([field]) => (
    !MARKER_ATTRIBUTES.has(field) || DATA_VIZ_FIGURE_TRACE_FACTS[traceType].markerAttributes.has(field)
  )));
  return Object.keys(coerced).length === 0 ? undefined : coerced;
}

function coerceTraceMarkerSchema(trace: RecordValue, sourceIndex: number): RecordValue {
  if (trace.marker === undefined) return trace;
  const marker = coerceMarkerSchema(
    optionalRecord(trace.marker, `trace ${sourceIndex} marker`),
    traceTypeOf(trace.type, sourceIndex),
  );
  if (marker !== undefined) return { ...trace, marker };
  return Object.fromEntries(Object.entries(trace).filter(([field]) => field !== 'marker'));
}

function resolveTemplate(
  data: readonly unknown[],
  layout: RecordValue,
): Readonly<{ data: readonly RecordValue[]; layout: RecordValue }> {
  const traces = data.map((value, index) => (
    requiredRecord(value, `renderData.data[${index}]`)
  ));
  const normalizedLayout = normalizeLayoutAxisAliases(layout);
  if (normalizedLayout.template === undefined) return { data: traces, layout: normalizedLayout };
  const template = requiredRecord(normalizedLayout.template, 'renderData.layout.template');
  const inheritedLayout = template.layout === undefined
    ? {}
    : normalizeLayoutAxisAliases(requiredRecord(
      template.layout,
      'renderData.layout.template.layout',
    ));
  const explicitLayout = normalizeLayoutAxisAliases(Object.fromEntries(
    Object.entries(normalizedLayout).filter(([key]) => key !== 'template'),
  ));
  const shapes = resolveShapeTemplates(
    inheritedLayout.shapes,
    explicitLayout.shapes,
    inheritedLayout.shapedefaults,
  );
  return {
    data: resolveTraceTemplates(traces, template.data),
    layout: mergeRecords(
      inheritedLayout,
      shapes === undefined ? explicitLayout : { ...explicitLayout, shapes },
    ),
  };
}

function resolveShapeTemplates(
  inherited: unknown,
  explicit: unknown,
  defaultValue: unknown,
): readonly RecordValue[] | undefined {
  if (inherited === undefined && explicit === undefined) return undefined;
  const defaults = defaultValue === undefined
    ? {}
    : requiredRecord(defaultValue, 'renderData.layout.template.layout.shapedefaults');
  const templateShapes = inherited === undefined
    ? []
    : requiredArray(inherited, 'renderData.layout.template.layout.shapes').map((shape, index) => (
        requiredRecord(shape, `renderData.layout.template.layout.shapes[${index}]`)
      ));
  const usedNames = new Set<string>();
  const shapes = (explicit === undefined ? [] : requiredArray(
    explicit,
    'renderData.layout.shapes',
  )).map((shape, index) => {
    const item = requiredRecord(shape, `renderData.layout.shapes[${index}]`);
    if (typeof item.templateitemname !== 'string' || item.templateitemname.length === 0) {
      return mergeRecords(defaults, item);
    }
    const base = templateShapes.find(({ name }) => (
      typeof name === 'string' && name.length > 0 && name === item.templateitemname
    ));
    if (base === undefined) return item.visible === true
      ? item
      : { ...item, visible: false };
    usedNames.add(item.templateitemname);
    return mergeRecords(base, item);
  });
  const emittedNames = new Set<string>();
  return [
    ...shapes,
    ...templateShapes
      .filter(({ name }) => {
        if (
          typeof name !== 'string'
          || name.length === 0
          || usedNames.has(name)
          || emittedNames.has(name)
        ) return false;
        emittedNames.add(name);
        return true;
      })
      .map((shape) => shape),
  ];
}

function resolveTraceTemplates(
  traces: readonly RecordValue[],
  value: unknown,
): readonly RecordValue[] {
  if (value === undefined) return traces;
  const templateData = requiredRecord(value, 'renderData.layout.template.data');
  const indices = new Map<string, number>();
  return traces.map((trace, sourceIndex) => {
    const traceType = traceTypeOf(trace.type, sourceIndex);
    if (templateData[traceType] === undefined) return trace;
    const candidates = requiredArray(
      templateData[traceType],
      `renderData.layout.template.data.${traceType}`,
    ).map((candidate, index) => requiredRecord(
      candidate,
      `renderData.layout.template.data.${traceType}[${index}]`,
    ));
    if (candidates.length === 0) return trace;
    const index = indices.get(traceType) ?? 0;
    indices.set(traceType, index + 1);
    return mergeRecords(figureItemAt(candidates, index % candidates.length), trace);
  });
}

function mergeRecords(base: RecordValue, override: RecordValue): RecordValue {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null && key !== 'meta' && result[key] !== undefined) continue;
    result[key] = isRecord(result[key]) && isRecord(value)
      ? mergeRecords(result[key], value)
      : value;
  }
  return result;
}

function hasTraceColorStyle(trace: RecordValue, traceType: DataVizFigureTraceType): boolean {
  const colorScale = DATA_VIZ_FIGURE_TRACE_FACTS[traceType].traceColorScale;
  if (colorScale === 'c') {
    return hasActiveColorScale(
      trace,
      'c',
      Array.isArray(trace.surfacecolor) ? 'surfacecolor' : 'z',
    );
  }
  return colorScale === 'z' && hasActiveColorScale(trace, 'z', 'z');
}

function hasActiveColorScale(
  container: RecordValue,
  letter: 'c' | 'z',
  colorKey = 'color',
): boolean {
  const minimum = container[`${letter}min`];
  const maximum = container[`${letter}max`];
  return hasNumericColorArray(container[colorKey])
    || container.showscale === true
    || (
      typeof minimum === 'number'
      && Number.isFinite(minimum)
      && typeof maximum === 'number'
      && Number.isFinite(maximum)
    )
    || isPlotlyColorScale(container.colorscale)
    || isRecord(container.colorbar);
}

function isCssColor(value: unknown): value is string {
  return typeof value === 'string' && tinycolor(value).isValid();
}

function plotlyColorWay(value: unknown): readonly string[] {
  if (value === undefined) return DEFAULT_PLOTLY_COLOR_WAY;
  if (!Array.isArray(value) || value.length === 0 || !value.every(isCssColor)) {
    return invalidFigure('layout.colorway is invalid');
  }
  return value;
}

function projectAxes(
  layout: RecordValue,
  layoutCalendar: string | undefined,
): readonly DataVizFigureAxis[] {
  const axes: DataVizFigureAxis[] = [];
  for (const [id, value] of Object.entries(layout)) {
    if (!value) continue;
    const cartesian = CARTESIAN_AXIS.exec(id);
    const color = COLOR_AXIS.exec(id);
    const scene = SCENE.exec(id);
    const polar = POLAR.exec(id);
    if (cartesian) {
      axes.push(projectAxis(id, cartesian[1] === 'xaxis' ? 'x' : 'y', value, layoutCalendar));
    } else if (color) {
      axes.push(projectAxis(id, 'color', value, layoutCalendar));
    } else if (scene) {
      axes.push(...nestedAxes(value, id, ['xaxis', 'yaxis', 'zaxis'], layoutCalendar));
    } else if (polar) {
      axes.push(...nestedAxes(value, id, ['radialaxis', 'angularaxis'], layoutCalendar));
    }
  }
  return axes;
}

function normalizeLayoutAxisAliases(layout: RecordValue): RecordValue {
  const normalized = { ...layout };
  for (const [alias, canonical] of [
    ['xaxis1', 'xaxis'],
    ['yaxis1', 'yaxis'],
    ['scene1', 'scene'],
  ] as const) {
    const aliasValue = normalized[alias];
    if (!aliasValue) continue;
    if (!normalized[canonical]) normalized[canonical] = aliasValue;
    delete normalized[alias];
  }
  return normalized;
}

function nestedAxes(
  value: unknown,
  parentId: string,
  keys: readonly string[],
  layoutCalendar: string | undefined,
): readonly DataVizFigureAxis[] {
  if (!value) return [];
  const parent = requiredRecord(value, `layout.${parentId}`);
  return keys.flatMap((key) => !parent[key]
    ? []
    : [projectAxis(
      `${parentId}.${key}`,
      axisDimension(key),
      parent[key],
      layoutCalendar,
    )]);
}

function axisDimension(key: string): DataVizFigureAxis['dimension'] {
  if (key === 'xaxis') return 'x';
  if (key === 'yaxis') return 'y';
  if (key === 'zaxis') return 'z';
  if (key === 'radialaxis') return 'radial';
  return 'angular';
}

function projectAxis(
  id: string,
  dimension: DataVizFigureAxis['dimension'],
  value: unknown,
  layoutCalendar?: string,
): DataVizFigureAxis {
  const axis = requiredRecord(value, `layout.${id}`);
  const range = optionalArray(axis.range, `layout.${id}.range`);
  const calendar = resolvedCalendar(axis.calendar, layoutCalendar);
  return {
    id,
    dimension,
    ...optionalAxisTitle(axis.title, id),
    ...optionalAxisString(axis.type, 'type', id),
    ...optionalAxisString(axis.hoverformat, 'hoverFormat', id),
    ...optionalAxisString(axis.tickformat, 'tickFormat', id),
    ...optionalAxisString(axis.tickprefix, 'tickPrefix', id),
    ...optionalAxisString(axis.ticksuffix, 'tickSuffix', id),
    ...(range === undefined ? {} : { range }),
    ...optionalAxisString(axis.categoryorder, 'categoryOrder', id),
    ...(calendar === undefined ? {} : { calendar }),
    visible: optionalBoolean(axis.visible, `layout.${id}.visible`) ?? true,
  };
}

function optionalAxisTitle(value: unknown, id: string): Pick<DataVizFigureAxis, 'title'> {
  if (value === undefined) return {};
  if (typeof value === 'string') return { title: value };
  const title = requiredRecord(value, `layout.${id}.title`);
  if (title.text === undefined) return {};
  if (typeof title.text !== 'string') return invalidFigure(`layout.${id}.title.text is not a string`);
  return { title: title.text };
}

function projectConstantColor(
  value: unknown,
  label: string,
  pointCount: number,
  arrayOk: boolean,
): string | number | undefined {
  if (!Array.isArray(value)) {
    if (value === undefined) return undefined;
    return requiredCssColor(value, label);
  }
  if (!arrayOk) return invalidFigure(`${label} is not array-valued for this trace`);
  if (!value.every(isMarkerColorValue)) return invalidFigure(`${label} is invalid`);
  if (pointCount === 0 || value.length < pointCount) return undefined;
  const visible = value.slice(0, pointCount);
  return visible.every((item) => item === visible[0]) ? visible[0] : undefined;
}

function projectLineColor(
  value: unknown,
  traceType: DataVizFigureTraceType,
  sourceIndex: number,
  pointCount: number,
): string | number | undefined {
  return projectConstantColor(
    value,
    `trace ${sourceIndex} line.color`,
    pointCount,
    DATA_VIZ_FIGURE_TRACE_FACTS[traceType].lineColorArray === true,
  );
}

function isMarkerColorValue(value: unknown): value is string | number {
  return typeof value === 'number'
    ? Number.isFinite(value)
    : isCssColor(value) || isPlotlyNumericString(value);
}

function isPlotlyNumericString(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() !== ''
    && Number.isFinite(Number(value));
}

function hasNumericColorArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => (
    typeof item === 'number'
      ? Number.isFinite(item)
      : isPlotlyNumericString(item) || hasNumericColorArray(item)
  ));
}

function requiredCssColor(value: unknown, label: string): string {
  if (!isCssColor(value)) return invalidFigure(`${label} is invalid`);
  return value;
}

function traceVisibility(value: unknown): DataVizFigureSeries['visibility'] {
  if (value === undefined || value === true) return 'visible';
  if (value === false) return 'hidden';
  if (value === 'legendonly') return 'legend-only';
  return 'visible';
}

function optionalOrientation(
  value: unknown,
  sourceIndex: number,
): Pick<DataVizFigureSeries, 'orientation'> {
  if (value === undefined) return {};
  if (value !== 'h' && value !== 'v') return invalidFigure(`trace ${sourceIndex} orientation is invalid`);
  return { orientation: value };
}

function resolvedOrientation(
  trace: RecordValue,
  traceType: DataVizFigureTraceType,
): unknown {
  if (trace.orientation !== undefined || (traceType !== 'bar' && traceType !== 'box')) {
    return trace.orientation;
  }
  if (Array.isArray(trace.x) && !Array.isArray(trace.y)) return 'h';
  if (Array.isArray(trace.y)) return 'v';
  return undefined;
}

function optionalAxisString(
  value: unknown,
  key: 'type' | 'hoverFormat' | 'tickFormat' | 'tickPrefix' | 'tickSuffix' | 'categoryOrder' | 'calendar',
  id: string,
): Partial<Pick<
  DataVizFigureAxis,
  'type' | 'hoverFormat' | 'tickFormat' | 'tickPrefix' | 'tickSuffix' | 'categoryOrder' | 'calendar'
>> {
  if (value === undefined) return {};
  if (typeof value !== 'string') return invalidFigure(`layout.${id}.${key} is not a string`);
  return { [key]: value };
}

function optionalRecord(value: unknown, label: string): RecordValue | undefined {
  return value === undefined ? undefined : requiredRecord(value, label);
}

function requiredRecord(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) return invalidFigure(`${label} is not a record`);
  return value;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalidFigure(`${label} is not an array`);
  return value;
}

function optionalArray(value: unknown, label: string): readonly unknown[] | undefined {
  return value === undefined ? undefined : requiredArray(value, label);
}

function optionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  const array = optionalArray(value, label);
  if (array === undefined) return undefined;
  if (!array.every((item) => typeof item === 'string')) {
    return invalidFigure(`${label} is not a string array`);
  }
  return array;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return invalidFigure(`${label} is not a string`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  return value === undefined ? undefined : requiredBoolean(value, label);
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return invalidFigure(`${label} is not a boolean`);
  return value;
}

function isTablePayload(data: readonly unknown[]): boolean {
  return data.length > 0 && data.every((trace) => (
    isRecord(trace) && (trace.type === 'table' || trace.type === 'Table')
  ));
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function invalidFigure(detail: string): never {
  throw new DataVizFigureProjectionError(detail);
}
