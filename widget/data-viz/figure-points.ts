import tinycolor from 'tinycolor2';

import { boxStatistics } from './box-statistics.js';
import { plotlyDateMilliseconds } from './figure-tooltip.js';
import {
  DATA_VIZ_FIGURE_TRACE_FACTS,
  findDataVizFigureTraceFacts,
  type DataVizFigureRawPoint,
  type DataVizFigureTraceType,
} from './figure-types.js';

type Trace = Readonly<Record<string, unknown>>;
export type SunburstColorState = {
  readonly labelColors: Map<string, string>;
  nextColor: number;
};

export function initialSunburstColorState(traces: readonly Trace[]): SunburstColorState {
  const labelColors = new Map<string, string>();
  for (const trace of traces) {
    if (findDataVizFigureTraceFacts(trace.type)?.colorMode !== 'hierarchy' || trace.visible === false || trace.visible === 'legendonly') continue;
    const marker = isRecord(trace.marker) ? trace.marker : undefined;
    const colors = Array.isArray(marker?.colors) ? marker.colors : [];
    const keys = Array.isArray(trace.ids) ? trace.ids : trace.labels;
    if (!Array.isArray(keys)) continue;
    keys.forEach((key, index) => {
      const color = colors[index];
      if (
        !labelColors.has(String(key))
        && typeof color === 'string'
        && tinycolor(color).isValid()
      ) labelColors.set(String(key), color);
    });
  }
  return { labelColors, nextColor: 0 };
}
type PieSlice = Readonly<{
  index: number;
  sourceIndices: readonly number[];
  label: string;
  value: number;
}>;

const POINT_ARRAYS = [
  'x',
  'y',
  'z',
  'r',
  'theta',
  'text',
  'hovertext',
  'customdata',
  'meta',
] as const;

export function projectFigureRawPoints(
  trace: Trace,
  type: DataVizFigureTraceType,
  hiddenLabels: readonly string[] | undefined = undefined,
  colorWay: readonly string[] = DEFAULT_PLOTLY_COLOR_WAY,
  pieColorMap: ReadonlyMap<string, string>,
  coordinateTypes: ReadonlyMap<'x' | 'y', string> = new Map(),
  categoryOrigins: ReadonlyMap<'x' | 'y', number> = new Map(),
  categoryLabels: ReadonlyMap<'x' | 'y', readonly string[]> = new Map(),
  boxPosition = 0,
  sunburstColorWay: readonly string[] = colorWay,
  sunburstColorState: SunburstColorState = { labelColors: new Map(), nextColor: 0 },
): readonly DataVizFigureRawPoint[] {
  const facts = DATA_VIZ_FIGURE_TRACE_FACTS[type];
  if (facts.projection === 'matrix') {
    return matrixPoints(trace, type, coordinateTypes, categoryLabels);
  }
  if (facts.projection === 'pie') return piePoints(trace, hiddenLabels, pieColorMap);
  if (facts.projection === 'hierarchy') {
    return sunburstPoints(
      trace,
      sunburstColorWay,
      sunburstColorState,
    );
  }
  if (facts.projection === 'aligned') return alignedPoints(trace, facts.pointAttributes);
  if (facts.projection === 'box') return boxPoints(trace, boxPosition, coordinateTypes);
  return cartesianPoints(trace, coordinateTypes, categoryOrigins, categoryLabels);
}

function piePoints(
  trace: Trace,
  hiddenLabels: readonly string[] | undefined,
  colorMap: ReadonlyMap<string, string>,
): readonly DataVizFigureRawPoint[] {
  const ordered = pieSlices(trace, hiddenLabels);
  const total = ordered.reduce((sum, { value }) => sum + value, 0);
  const points = ordered.map(({ index, sourceIndices, label, value }) => {
    const percent = total === 0 ? 0 : value / total;
    return rawPoint(trace, index, { label, value, percent }, undefined, undefined, sourceIndices, {
      percent: formatPiePercent(percent),
    });
  });
  return projectPieColors(ordered, points, colorMap);
}

// Plotly's pie percentLabel: three significant digits, trailing zeros dropped.
function formatPiePercent(percent: number): string {
  const rounded = (percent * 100).toPrecision(3);
  return `${rounded.includes('.') ? rounded.replace(/[.]?0+$/, '') : rounded}%`;
}

function pieSlices(
  trace: Trace,
  hiddenLabels: readonly string[] | undefined,
): readonly PieSlice[] {
  const labels = requiredArray(trace.labels, 'trace.labels');
  const values = optionalArray(trace.values, 'trace.values');
  if (values) requireAlignedLengths('pie', [labels, values]);
  if (values && !values.every((value) => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  ))) {
    return invalidPoints('pie values are not finite nonnegative numbers');
  }
  const hidden = new Set(hiddenLabels ?? []);
  const slices = new Map<string, {
    index: number;
    sourceIndices: number[];
    label: string;
    value: number;
  }>();
  labels.forEach((label, index) => {
    const key = label === undefined || label === '' ? String(index) : figureValueText(label);
    if (hidden.has(key)) return;
    const value = values === undefined ? 1 : values[index] as number;
    const existing = slices.get(key);
    if (existing) {
      existing.value += value;
      existing.sourceIndices.push(index);
    } else {
      slices.set(key, { index, sourceIndices: [index], label: key, value });
    }
  });
  const ordered = [...slices.values()];
  if (trace.sort !== false) ordered.sort((left, right) => right.value - left.value);
  return ordered;
}

export const DEFAULT_PLOTLY_COLOR_WAY = [
  '#636efa',
  '#EF553B',
  '#00cc96',
  '#ab63fa',
  '#FFA15A',
  '#19d3f3',
  '#FF6692',
  '#B6E880',
  '#FF97FF',
  '#FECB52',
] as const;

export function extendPieColorWay(colorWay: readonly string[]): readonly string[] {
  return [
    ...colorWay,
    ...colorWay.map((color) => tinycolor(color).lighten(20).toHexString()),
    ...colorWay.map((color) => tinycolor(color).darken(20).toHexString()),
  ];
}

export function resolvePieColorMaps(
  traces: readonly Trace[],
  colorWay: readonly string[],
): readonly ReadonlyMap<string, string>[] {
  const colorMap = new Map<string, string>();
  const traceSlices = traces.map((trace) => (
    findDataVizFigureTraceFacts(trace.type)?.projection === 'pie' && trace.visible !== false && trace.visible !== 'legendonly'
      ? pieSlices(trace, undefined)
      : []
  ));
  const traceExplicitColors = traces.map((trace, traceIndex) => {
    const marker = isRecord(trace.marker) ? trace.marker : undefined;
    const colors = Array.isArray(marker?.colors) ? marker.colors : [];
    const explicit = new Map<string, string>();
    for (const { label, sourceIndices } of figureItemAt(traceSlices, traceIndex)) {
      const candidate = sourceIndices.map((index) => colors[index]).find((value) => (
        typeof value === 'string' && tinycolor(value).isValid()
      ));
      if (candidate === undefined) continue;
      explicit.set(label, candidate);
      if (!colorMap.has(label)) colorMap.set(label, candidate);
    }
    return explicit;
  });
  let colorIndex = 0;
  return traceSlices.map((slices, traceIndex) => {
    const resolved = new Map<string, string>();
    const explicit = figureItemAt(traceExplicitColors, traceIndex);
    for (const { label } of slices) {
      const color = explicit.get(label) ?? colorMap.get(label);
      if (color !== undefined) {
        resolved.set(label, color);
        continue;
      }
      const fallback = figureItemAt(colorWay, colorIndex % colorWay.length);
      colorIndex += 1;
      colorMap.set(label, fallback);
      resolved.set(label, fallback);
    }
    return resolved;
  });
}

function projectPieColors(
  slices: readonly PieSlice[],
  points: readonly DataVizFigureRawPoint[],
  colorMap: ReadonlyMap<string, string>,
): readonly DataVizFigureRawPoint[] {
  const resolved = slices.map(({ label }) => colorMap.get(label));
  const [first] = resolved;
  const constant = first !== undefined && resolved.every((color) => color === first);
  return points.map((point, index) => {
    const { ['marker.colors']: _rawColor, ...values } = point.values;
    return {
      ...point,
      values: constant || resolved[index] === undefined
        ? values
        : { ...values, 'marker.colors': resolved[index] },
      ...(constant && index === 0
        ? { styleConstants: { 'marker.colors': first } }
        : {}),
    };
  });
}

function cartesianPoints(
  trace: Trace,
  coordinateTypes: ReadonlyMap<'x' | 'y', string>,
  categoryOrigins: ReadonlyMap<'x' | 'y', number>,
  categoryLabels: ReadonlyMap<'x' | 'y', readonly string[]>,
): readonly DataVizFigureRawPoint[] {
  const x = optionalArray(trace.x, 'trace.x');
  const y = optionalArray(trace.y, 'trace.y');
  const either = x ?? y;
  if (!either) return [];
  const length = x && y ? Math.min(x.length, y.length) : either.length;
  return Array.from({ length }, (_, index) => {
    const xValue = x === undefined
      ? implicitCoordinate(trace, 'x', index, coordinateTypes.get('x'), categoryOrigins.get('x'))
      : x[index];
    const yValue = y === undefined
      ? implicitCoordinate(trace, 'y', index, coordinateTypes.get('y'), categoryOrigins.get('y'))
      : y[index];
    return rawPoint(trace, index, { x: xValue, y: yValue }, undefined, undefined, undefined, {
      ...(x === undefined ? categoryDisplayValue('x', xValue, categoryLabels) : {}),
      ...(y === undefined ? categoryDisplayValue('y', yValue, categoryLabels) : {}),
    });
  });
}

function categoryDisplayValue(
  dimension: 'x' | 'y',
  value: unknown,
  labels: ReadonlyMap<'x' | 'y', readonly string[]>,
): Readonly<Record<string, unknown>> {
  const label = typeof value === 'number' ? labels.get(dimension)?.[value] : undefined;
  return label === undefined ? {} : { [dimension]: label };
}

function implicitCoordinate(
  trace: Trace,
  dimension: 'x' | 'y',
  index: number,
  axisType: string | undefined,
  categoryOrigin?: number,
): number {
  const origin = trace[`${dimension}0`] ?? 0;
  const rawStep = trace[`d${dimension}`];
  const step = rawStep ? Number(rawStep) : 1;
  if (
    !Number.isFinite(step)
  ) return invalidPoints(`trace.${dimension}0/d${dimension} is not a finite numeric sequence`);
  const calendar = typeof trace[`${dimension}calendar`] === 'string'
    ? trace[`${dimension}calendar`] as string
    : undefined;
  const numericOrigin = implicitOrigin(origin, axisType, categoryOrigin, calendar);
  if (numericOrigin === undefined || !Number.isFinite(numericOrigin)) {
    return invalidPoints(`trace.${dimension}0 is not valid for its axis`);
  }
  return numericOrigin + index * step;
}

function implicitOrigin(
  value: unknown,
  axisType: string | undefined,
  categoryOrigin: number | undefined,
  calendar?: string,
): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (axisType === 'date' || (axisType === undefined && dateLikeOrigin(value, calendar))) {
    return dateAxisOrigin(value, calendar);
  }
  if ((axisType === 'category' || axisType === 'multicategory') && typeof value === 'string') {
    return categoryOrigin;
  }
  if (categoryOrigin !== undefined) return categoryOrigin;
  const numeric = cleanPlotlyNumber(value);
  if (Number.isFinite(numeric)) return numeric;
  return axisType === undefined && typeof value === 'string' ? 0 : undefined;
}

function dateAxisOrigin(value: unknown, calendar?: string): number | undefined {
  const parsed = plotlyDateMilliseconds(value, false, calendar);
  if (parsed !== undefined) return parsed;
  const numeric = typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function cleanPlotlyNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value.replace(/^['"%,$#\s']+|[, ]|['"%,$#\s']+$/g, '');
  return cleaned.trim() === '' ? Number.NaN : Number(cleaned);
}

function dateLikeOrigin(value: unknown, calendar?: string): boolean {
  return typeof value === 'string' && /[-Tt:]/.test(value) && (
    plotlyDateMilliseconds(value, false, calendar) !== undefined
  );
}

function boxPoints(
  trace: Trace,
  boxPosition: number,
  coordinateTypes: ReadonlyMap<'x' | 'y', string>,
): readonly DataVizFigureRawPoint[] {
  if (trace.quartilemethod !== undefined && trace.quartilemethod !== 'linear') {
    return invalidPoints(`unsupported box quartilemethod ${figureValueText(trace.quartilemethod)}`);
  }
  const marker = isRecord(trace.marker) ? trace.marker : undefined;
  const markerLine = isRecord(marker?.line) ? marker.line : undefined;
  const boxPointMode = trace.boxpoints ?? (
    marker?.outliercolor || markerLine?.outliercolor ? 'suspectedoutliers' : 'outliers'
  );
  if (!['all', 'outliers', 'suspectedoutliers', false].includes(boxPointMode as string | false)) {
    return invalidPoints(`unsupported boxpoints mode ${String(trace.boxpoints)}`);
  }
  if (trace.sizemode !== undefined && trace.sizemode !== 'quartiles' && trace.sizemode !== 'sd') {
    return invalidPoints(`unsupported box sizemode ${figureValueText(trace.sizemode)}`);
  }
  if (trace.sdmultiple !== undefined && (
    typeof trace.sdmultiple !== 'number'
    || !Number.isFinite(trace.sdmultiple)
    || trace.sdmultiple < 0
  )) {
    return invalidPoints(`invalid box sdmultiple ${figureValueText(trace.sdmultiple)}`);
  }
  const horizontal = trace.orientation === 'h'
    || (trace.orientation === undefined && Array.isArray(trace.x) && !Array.isArray(trace.y));
  const categoryDimension = horizontal ? 'y' : 'x';
  const sampleDimension = horizontal ? 'x' : 'y';
  const samplesRaw = requiredArray(trace[sampleDimension], `trace.${sampleDimension}`);
  const categoryArray = optionalArray(trace[categoryDimension], `trace.${categoryDimension}`);
  const implicitCategory = trace[`${categoryDimension}0`] ?? boxNamePosition(
    trace,
    categoryDimension,
    coordinateTypes.get(categoryDimension),
    boxPosition,
  );
  const categoriesRaw = categoryArray ?? samplesRaw.map(() => implicitCategory);
  requireAlignedLengths('box', [categoriesRaw, samplesRaw]);
  if (!categoriesRaw.every(isBoxCategory)) {
    return invalidPoints('box trace categories are invalid');
  }
  if (!samplesRaw.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return invalidPoints('box trace samples are not finite numbers');
  }
  const grouped = new Map<string, { category: string | number | boolean; samples: number[] }>();
  categoriesRaw.forEach((category, index) => {
    const key = String(category);
    const group = grouped.get(key) ?? { category: category, samples: [] };
    group.samples.push(samplesRaw[index] as number);
    grouped.set(key, group);
  });
  return [...grouped.values()].map(({ category, samples }, index) => {
    const summary = boxStatistics(samples);
    const showsMean = trace.boxmean === true || trace.boxmean === 'sd' || trace.sizemode === 'sd';
    const showsDeviation = trace.boxmean === 'sd' || trace.sizemode === 'sd';
    const deviation = summary.standardDeviation * (
      typeof trace.sdmultiple === 'number' ? trace.sdmultiple : 1
    );
    const outliers = samples.filter((sample) => (
      sample < summary.lowerFence || sample > summary.upperFence
    ));
    const lowerFarOutlier = 4 * summary.q1 - 3 * summary.q3;
    const upperFarOutlier = 4 * summary.q3 - 3 * summary.q1;
    return rawPoint(trace, index, {
      ...(horizontal
        ? { x: summary.median, y: category }
        : { x: category, y: summary.median }),
      category,
      minimum: summary.minimum,
      lowerFence: summary.lowerFence,
      q1: summary.q1,
      median: summary.median,
      ...(showsMean ? { mean: summary.mean } : {}),
      ...(showsDeviation ? { standardDeviation: deviation } : {}),
      q3: summary.q3,
      upperFence: summary.upperFence,
      maximum: summary.maximum,
      ...(boxPointMode === 'all' ? { samplePoints: samples } : {}),
      ...(boxPointMode === 'outliers' || boxPointMode === 'suspectedoutliers'
        ? { outliers }
        : {}),
      ...(boxPointMode === 'suspectedoutliers' ? {
        farOutliers: outliers.filter((sample) => (
          sample < lowerFarOutlier || sample > upperFarOutlier
        )),
      } : {}),
    });
  });
}

function boxNamePosition(
  trace: Trace,
  dimension: 'x' | 'y',
  axisType: string | undefined,
  boxPosition: number,
): unknown {
  if (trace.name === undefined) return boxPosition;
  if (axisType === undefined || ['category', 'multicategory'].includes(axisType)) {
    return trace.name;
  }
  if (axisType === 'linear' || axisType === 'log') return numericBoxName(trace.name, boxPosition);
  if (axisType === 'date') {
    const calendar = typeof trace[`${dimension}calendar`] === 'string'
      ? trace[`${dimension}calendar`] as string
      : undefined;
    return plotlyDateMilliseconds(trace.name, false, calendar) === undefined
      ? boxPosition
      : trace.name;
  }
  return boxPosition;
}

function numericBoxName(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isBoxCategory(value: unknown): value is string | number | boolean {
  return typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function sunburstPoints(
  trace: Trace,
  colorWay: readonly string[],
  colorState: SunburstColorState,
): readonly DataVizFigureRawPoint[] {
  const { labels, parents, values, ids, hierarchy } = sunburstInput(trace);
  // Treemap colors are numeric color-axis values: marker.colors carries them.
  const colors = DATA_VIZ_FIGURE_TRACE_FACTS[trace.type as DataVizFigureTraceType].colorMode === 'numeric-hierarchy'
    ? undefined
    : sunburstColors(trace, hierarchy, colorWay, colorState);
  return hierarchy.flatMap((node, index) => node.visible ? [rawPoint(trace, index, {
    label: labels[index],
    parent: parents[index],
    ...(values ? { value: values[index] } : {}),
    ...(ids ? { id: ids[index] } : {}),
    currentPath: node.currentPath,
    entry: node.entry,
    root: node.root,
    ...(colors ? { color: colors[index] } : {}),
    percentParent: node.percentParent,
    percentEntry: node.percentEntry,
    percentRoot: node.percentRoot,
  })] : []);
}

function sunburstInput(trace: Trace): Readonly<{
  labels: readonly string[];
  parents: readonly string[];
  values?: readonly unknown[];
  ids?: readonly unknown[];
  hierarchy: readonly SunburstHoverValues[];
}> {
  const labels = requiredArray(trace.labels, 'trace.labels');
  const parents = requiredArray(trace.parents, 'trace.parents');
  const values = optionalArray(trace.values, 'trace.values');
  const ids = optionalArray(trace.ids, 'trace.ids');
  requireAlignedLengths('sunburst', [labels, parents, ...(values ? [values] : []), ...(ids ? [ids] : [])]);
  if (!labels.every((value) => typeof value === 'string')) {
    return invalidPoints('sunburst labels are not strings');
  }
  if (!parents.every((value) => typeof value === 'string')) {
    return invalidPoints('sunburst parents are not strings');
  }
  if (values && !values.every((value) => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  ))) {
    return invalidPoints('sunburst values are not finite nonnegative numbers');
  }
  const stringLabels = labels;
  const stringParents = parents;
  return {
    labels: stringLabels,
    parents: stringParents,
    ...(values === undefined ? {} : { values }),
    ...(ids === undefined ? {} : { ids }),
    hierarchy: sunburstHierarchy(trace, stringLabels, stringParents, values, ids),
  };
}

type SunburstHoverValues = Readonly<{
  visible: boolean;
  parentIndex?: number;
  syntheticRootChild: boolean;
  key: string;
  value: number;
  currentPath: string;
  entry: string;
  root: string;
  percentParent: number;
  percentEntry: number;
  percentRoot: number;
}>;

function sunburstHierarchy(
  trace: Trace,
  labels: readonly string[],
  parents: readonly string[],
  rawValues: readonly unknown[] | undefined,
  rawIds: readonly unknown[] | undefined,
): readonly SunburstHoverValues[] {
  const keys = (rawIds ?? labels).map(String);
  const byKey = new Map(keys.map((key, index) => [key, index]));
  if (byKey.size !== keys.length) return invalidPoints('sunburst hierarchy keys are not unique');
  const explicitRootCount = parents.filter((parent) => parent === '').length;
  const missingParents = new Set(parents.filter((parent) => (
    parent !== '' && !byKey.has(parent)
  )));
  if (
    (explicitRootCount > 0 && missingParents.size > 0)
    || (explicitRootCount === 0 && missingParents.size !== 1)
  ) {
    return invalidPoints('sunburst hierarchy has invalid implied roots');
  }
  const parentIndices = parents.map((parent) => parent === '' ? undefined : byKey.get(parent));
  const children = keys.map(() => [] as number[]);
  parentIndices.forEach((parentIndex, index) => parentIndex === undefined
    ? undefined
    : figureItemAt(children, parentIndex).push(index));
  const values = sunburstValues(trace, children, rawValues);
  const roots = keys.map((_, index) => index).filter((index) => parentIndices[index] === undefined);
  const rootValue = roots.reduce((total, index) => total + figureItemAt(values, index), 0);
  const level = typeof trace.level === 'string' ? byKey.get(trace.level) : undefined;
  const entryValue = level === undefined ? rootValue : figureItemAt(values, level);
  const maxDepth = typeof trace.maxdepth === 'number'
    && Number.isInteger(trace.maxdepth)
    && trace.maxdepth >= 0
    ? trace.maxdepth
    : Infinity;
  const hasImpliedRoot = explicitRootCount === 0;
  return keys.map((key, index) => {
    const parentIndex = parentIndices[index];
    const parentValue = parentIndex === undefined ? rootValue : figureItemAt(values, parentIndex);
    const root = sunburstRootLabel(index, parentIndices, parents, labels);
    const value = figureItemAt(values, index);
    return {
      visible: sunburstPointDepth(index, level, parentIndices, hasImpliedRoot) < maxDepth,
      ...(parentIndex === undefined ? {} : { parentIndex }),
      syntheticRootChild: parentIndex === undefined && (hasImpliedRoot || explicitRootCount > 1),
      key,
      value,
      currentPath: sunburstCurrentPath(index, parents, byKey, labels),
      entry: level === undefined ? root : figureItemAt(labels, level),
      root,
      percentParent: safeRatio(value, parentValue),
      percentEntry: safeRatio(value, entryValue),
      percentRoot: safeRatio(value, rootValue),
    };
  });
}

function sunburstColors(
  trace: Trace,
  hierarchy: readonly SunburstHoverValues[],
  colorWay: readonly string[],
  colorState: SunburstColorState,
): readonly string[] {
  const marker = isRecord(trace.marker) ? trace.marker : undefined;
  const rawColors = Array.isArray(marker?.colors) ? marker.colors : [];
  const root = isRecord(trace.root) ? trace.root : undefined;
  const rootColor = typeof root?.color === 'string' && tinycolor(root.color).isValid()
    ? root.color
    : 'rgba(0,0,0,0)';
  // Stryker disable next-line ArrayDeclaration: the forEach below assigns every index before any read
  const resolved: (string | undefined)[] = [];
  hierarchy.forEach(({ key }, index) => {
    const explicit = rawColors[index];
    if (typeof explicit === 'string' && tinycolor(explicit).isValid()) {
      resolved[index] = explicit;
    } else {
      resolved[index] = colorState.labelColors.get(key);
    }
  });
  const colorChildren = hierarchy
    .map((item, index) => ({ ...item, index }))
    .filter(({ parentIndex, syntheticRootChild }) => (
      syntheticRootChild || (
        parentIndex !== undefined
        && hierarchy[parentIndex]?.parentIndex === undefined
        && hierarchy[parentIndex]?.syntheticRootChild === false
      )
    ));
  if (trace.sort !== false) colorChildren.sort((left, right) => right.value - left.value);
  colorChildren.forEach(({ index, key }) => {
    if (resolved[index] !== undefined) return;
    const color = figureItemAt(colorWay, colorState.nextColor % colorWay.length);
    colorState.nextColor += 1;
    resolved[index] = color;
    colorState.labelColors.set(key, color);
  });
  const resolve = (index: number): string => {
    if (resolved[index] !== undefined) return resolved[index];
    const parentIndex = hierarchy[index]?.parentIndex;
    resolved[index] = parentIndex === undefined ? rootColor : resolve(parentIndex);
    return resolved[index];
  };
  return hierarchy.map((_, index) => resolve(index));
}

export function isPlotlyColorScale(value: unknown): boolean {
  if (typeof value === 'string') return PLOTLY_COLOR_SCALE_NAMES.has(value);
  if (!Array.isArray(value) || value.length < 2) return false;
  let previous = -Infinity;
  for (const entry of value) {
    const stop = Array.isArray(entry) ? Number(entry[0]) : Number.NaN;
    if (
      !Array.isArray(entry)
      || entry.length !== 2
      || !Number.isFinite(stop)
      || stop < previous
      || typeof entry[1] !== 'string'
      || !tinycolor(entry[1]).isValid()
    ) return false;
    previous = stop;
  }
  return Number(value[0][0]) === 0 && Number(value[value.length - 1][0]) === 1;
}

const PLOTLY_COLOR_SCALE_NAMES = new Set([
  'Blackbody',
  'Bluered',
  'Blues',
  'Cividis',
  'Earth',
  'Electric',
  'Greens',
  'Greys',
  'Hot',
  'Jet',
  'Picnic',
  'Portland',
  'Rainbow',
  'RdBu',
  'Reds',
  'Viridis',
  'YlGnBu',
  'YlOrRd',
]);

function sunburstRootLabel(
  index: number,
  parentIndices: readonly (number | undefined)[],
  parents: readonly string[],
  labels: readonly string[],
): string {
  let root = index;
  for (let parent = parentIndices[root]; parent !== undefined; parent = parentIndices[root]) root = parent;
  return parents[root] || figureItemAt(labels, root);
}

function sunburstPointDepth(
  index: number,
  level: number | undefined,
  parentIndices: readonly (number | undefined)[],
  hasImpliedRoot: boolean,
): number {
  let depth = 0;
  let current: number | undefined = index;
  while (current !== undefined && current !== level) {
    current = parentIndices[current];
    depth += 1;
  }
  if (level !== undefined) return current === level ? depth : Infinity;
  return depth - 1 + Number(hasImpliedRoot);
}

function sunburstValues(
  trace: Trace,
  children: readonly (readonly number[])[],
  rawValues: readonly unknown[] | undefined,
): readonly number[] {
  const resolved = Array<number>(children.length);
  const visiting = new Set<number>();
  const count = typeof trace.count === 'string' ? trace.count.split('+') : ['leaves'];
  const resolve = (index: number): number => {
    if (resolved[index] !== undefined) return resolved[index];
    if (visiting.has(index)) return invalidPoints('sunburst hierarchy contains a cycle');
    visiting.add(index);
    const nodeChildren = figureItemAt(children, index);
    const descendants = nodeChildren.reduce((total, child) => total + resolve(child), 0);
    const own = rawValues === undefined
      ? nodeChildren.length === 0
        ? Number(count.includes('leaves'))
        : Number(count.includes('branches'))
      : rawValues[index] as number;
    if (rawValues !== undefined && trace.branchvalues === 'total') {
      const directChildren = nodeChildren.reduce((total, child) => (
        total + (rawValues[child] as number)
      ), 0);
      if (own < directChildren * (1 - 1e-6)) {
        return invalidPoints('sunburst total branch is smaller than its children');
      }
    }
    const value = rawValues !== undefined && trace.branchvalues === 'total'
      ? own
      : own + descendants;
    visiting.delete(index);
    resolved[index] = value;
    return value;
  };
  children.forEach((_, index) => resolve(index));
  return resolved;
}

function sunburstCurrentPath(
  index: number,
  parentKeys: readonly string[],
  byKey: ReadonlyMap<string, number>,
  labels: readonly string[],
): string {
  const path: string[] = [];
  let parentKey = parentKeys[index];
  while (parentKey) {
    const parentIndex = byKey.get(parentKey);
    path.unshift(parentIndex === undefined ? parentKey : figureItemAt(labels, parentIndex));
    if (parentIndex === undefined) break;
    parentKey = parentKeys[parentIndex];
  }
  return `${path.join('/')}/`;
}

function safeRatio(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}

function alignedPoints(
  trace: Trace,
  required: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
  strict = false,
): readonly DataVizFigureRawPoint[] {
  const arrays = required.map((path) => [path, requiredArray(trace[path], `trace.${path}`)] as const);
  if (strict) requireAlignedLengths('trace', arrays.map(([, value]) => value));
  const length = Math.min(...arrays.map(([, value]) => value.length));
  return Array.from({ length }, (_, index) => rawPoint(
    trace,
    index,
    Object.fromEntries(arrays.map(([path, value]) => [aliases[path] ?? path, value[index]])),
  ));
}

function requireAlignedLengths(
  label: string,
  arrays: readonly (readonly unknown[])[],
): void {
  const length = arrays[0]?.length ?? 0;
  if (arrays.some((value) => value.length !== length)) {
    invalidPoints(`${label} point arrays have unequal lengths`);
  }
}

function matrixPoints(
  trace: Trace,
  type: DataVizFigureTraceType,
  coordinateTypes: ReadonlyMap<'x' | 'y', string>,
  categoryLabels: ReadonlyMap<'x' | 'y', readonly string[]>,
): readonly DataVizFigureRawPoint[] {
  if (type === 'heatmap' && Array.isArray(trace.z) && trace.z.every((value) => !Array.isArray(value))) {
    return heatmapTriplets(trace, trace.z, coordinateTypes, categoryLabels);
  }
  const originalMatrix = requiredMatrix(trace.z, 'trace.z');
  const matrix = type === 'heatmap' && trace.transpose === true
    ? transposeMatrix(originalMatrix)
    : originalMatrix;
  const width = Math.max(0, ...matrix.map((row) => row.length));
  if (type === 'surface' && matrix.some((row) => row.length !== width)) {
    return invalidPoints(`${type} trace z matrix is ragged`);
  }
  const surfaceColors = type === 'surface' && Array.isArray(trace.surfacecolor)
    ? requiredMatrix(trace.surfacecolor, 'trace.surfacecolor')
    : undefined;
  if (surfaceColors !== undefined && (
    surfaceColors.length !== matrix.length
    || surfaceColors.some((row) => row.length !== width)
  )) return invalidPoints('surface trace surfacecolor matrix does not match z');
  const x = matrixCoordinates(
    trace,
    trace.x,
    matrix.length,
    width,
    'x',
    type === 'heatmap' ? coordinateTypes.get('x') : undefined,
    type === 'heatmap',
  );
  const y = matrixCoordinates(
    trace,
    trace.y,
    matrix.length,
    width,
    'y',
    type === 'heatmap' ? coordinateTypes.get('y') : undefined,
    type === 'heatmap',
  );
  return matrix.flatMap((row, rowIndex) => row.map((z, columnIndex) => rawPoint(
    trace,
    rowIndex * width + columnIndex,
    {
      x: x(rowIndex, columnIndex),
      y: y(rowIndex, columnIndex),
      z,
      ...(surfaceColors === undefined
        ? {}
        : { surfacecolor: figureItemAt(surfaceColors, rowIndex)[columnIndex] }),
    },
    rowIndex,
    columnIndex,
  )));
}

function transposeMatrix(matrix: readonly (readonly unknown[])[]): readonly (readonly unknown[])[] {
  const width = Math.max(0, ...matrix.map((row) => row.length));
  return Array.from({ length: width }, (_, column) => (
    matrix.map((row) => row[column])
  ));
}

function heatmapTriplets(
  trace: Trace,
  z: readonly unknown[],
  coordinateTypes: ReadonlyMap<'x' | 'y', string>,
  categoryLabels: ReadonlyMap<'x' | 'y', readonly string[]>,
): readonly DataVizFigureRawPoint[] {
  const x = requiredArray(trace.x, 'trace.x');
  const y = requiredArray(trace.y, 'trace.y');
  const length = Math.min(x.length, y.length, z.length);
  const xColumn = x.slice(0, length);
  const yColumn = y.slice(0, length);
  const xCoordinates = heatmapTripletCoordinates(
    xColumn,
    coordinateTypes.get('x'),
    categoryLabels.get('x'),
    typeof trace.xcalendar === 'string' ? trace.xcalendar : undefined,
  );
  const yCoordinates = heatmapTripletCoordinates(
    yColumn,
    coordinateTypes.get('y'),
    categoryLabels.get('y'),
    typeof trace.ycalendar === 'string' ? trace.ycalendar : undefined,
  );
  const cells = new Map<string, Readonly<{ sourceIndex: number; value: unknown }>>();
  z.slice(0, length).forEach((value, sourceIndex) => {
    cells.set(`${xCoordinates.indices[sourceIndex]}\u0000${yCoordinates.indices[sourceIndex]}`, {
      sourceIndex,
      value,
    });
  });
  return yCoordinates.values.flatMap((yValue, row) => (
    xCoordinates.values.map((xValue, column) => {
      const cell = cells.get(`${column}\u0000${row}`);
      return rawPoint(trace, row * xCoordinates.values.length + column, {
        x: xValue,
        y: yValue,
        z: cell?.value,
      }, row, column, cell === undefined ? [] : [cell.sourceIndex]);
    })
  ));
}

function heatmapTripletCoordinates(
  coordinates: readonly unknown[],
  axisType: string | undefined,
  categoryLabels?: readonly string[],
  calendar?: string,
): Readonly<{ values: readonly unknown[]; indices: readonly number[] }> {
  const effectiveType = axisType ?? inferredCoordinateType(coordinates, calendar);
  if (effectiveType === 'category' || effectiveType === 'multicategory') {
    const encountered = [...new Set(coordinates.map(String))];
    const values = categoryLabels === undefined
      ? encountered
      : [...categoryLabels.filter((value) => encountered.includes(value)), ...encountered.filter(
          (value) => !categoryLabels.includes(value),
        )];
    return { values, indices: coordinates.map((value) => values.indexOf(String(value))) };
  }
  const converted = coordinates.map((value) => coordinateNumber(value, effectiveType, calendar));
  if (converted.some((value) => !Number.isFinite(value))) {
    return invalidPoints('heatmap triplet coordinates are not valid for their axes');
  }
  const values = [...new Set(converted)].sort((left, right) => left - right);
  return { values, indices: converted.map((value) => values.indexOf(value)) };
}

function inferredCoordinateType(coordinates: readonly unknown[], calendar?: string): string {
  if (autoCategoryCoordinates(coordinates, calendar)) return 'category';
  const dates = coordinates.map((value) => plotlyDateMilliseconds(value, false, calendar));
  if (
    coordinates.length > 0
    && coordinates.every((value) => typeof value === 'string' && /[-Tt:]/.test(value))
    && dates.every((value) => value !== undefined)
  ) return 'date';
  return 'linear';
}

function matrixCoordinates(
  trace: Trace,
  value: unknown,
  height: number,
  width: number,
  dimension: 'x' | 'y',
  axisType: string | undefined,
  scaled: boolean,
): (row: number, column: number) => unknown {
  const mode = trace[`${dimension}type`];
  const usesScaledCoordinates = scaled && (
    mode === 'scaled' || value === undefined || (Array.isArray(value) && value.length === 0)
  );
  if (usesScaledCoordinates) return defaultMatrixCoordinates(trace, dimension, axisType, true);
  if (value === undefined) return defaultMatrixCoordinates(trace, dimension, axisType, false);
  const coordinates = requiredArray(value, `trace.${dimension}`);
  const calendar = typeof trace[`${dimension}calendar`] === 'string'
    ? trace[`${dimension}calendar`] as string
    : undefined;
  if (coordinates.every(Array.isArray)) {
    if (scaled) return invalidPoints(`heatmap trace.${dimension} coordinates are not one-dimensional`);
    return matrixCoordinateGrid(
      coordinates as readonly (readonly unknown[])[],
      height,
      width,
      dimension,
    );
  }
  return matrixCoordinateVector(coordinates, height, width, dimension, scaled, axisType, calendar);
}

function defaultMatrixCoordinates(
  trace: Trace,
  dimension: 'x' | 'y',
  axisType: string | undefined,
  scaled: boolean,
): (row: number, column: number) => number {
  if (!scaled) return dimension === 'x' ? (_row, column) => column : (row) => row;
  return dimension === 'x'
    ? (_row, column) => implicitCoordinate(trace, dimension, column, axisType)
    : (row) => implicitCoordinate(trace, dimension, row, axisType);
}

function matrixCoordinateGrid(
  matrix: readonly (readonly unknown[])[],
  height: number,
  width: number,
  dimension: 'x' | 'y',
): (row: number, column: number) => unknown {
  if (matrix.length !== height || matrix.some((row) => row.length !== width)) {
    return invalidPoints(`trace.${dimension} matrix does not match trace.z`);
  }
  // Stryker disable next-line ArrowFunction: rawPoint falls back to trace.x/y[row][column], the same cell of this shape-checked matrix
  return (row, column) => figureItemAt(matrix, row)[column];
}

function matrixCoordinateVector(
  coordinates: readonly unknown[],
  height: number,
  width: number,
  dimension: 'x' | 'y',
  allowsEdges: boolean,
  axisType: string | undefined,
  calendar?: string,
): (row: number, column: number) => unknown {
  const expected = dimension === 'x' ? width : height;
  const values = matrixCoordinateValues(
    coordinates,
    expected,
    dimension,
    allowsEdges,
    axisType,
    calendar,
  );
  return dimension === 'x'
    ? (_row, column) => values[column]
    : (row) => values[row];
}

function matrixCoordinateValues(
  coordinates: readonly unknown[],
  expected: number,
  dimension: 'x' | 'y',
  allowsEdges: boolean,
  axisType: string | undefined,
  calendar?: string,
): readonly unknown[] {
  if (!allowsEdges) return exactCoordinateValues(coordinates, expected, dimension);
  const bounded = coordinates.length > expected + 1
    ? coordinates.slice(0, expected + 1)
    : coordinates;
  if (bounded.length === expected + 1) {
    return edgeCoordinateCenters(bounded, dimension, axisType, calendar);
  }
  if (bounded.length >= 1 && bounded.length < expected) {
    return extrapolatedCoordinateValues(bounded, expected, dimension, axisType, calendar);
  }
  return exactCoordinateValues(bounded, expected, dimension);
}

function edgeCoordinateCenters(
  coordinates: readonly unknown[],
  dimension: 'x' | 'y',
  axisType: string | undefined,
  calendar?: string,
): readonly unknown[] {
  const categoryEdges = axisType === 'category' || axisType === 'multicategory' || (
    axisType === undefined && autoCategoryCoordinates(coordinates, calendar)
  );
  if (categoryEdges) return coordinates.slice(0, -1);
  return coordinates.slice(0, -1).map((value, index) => (
    coordinateMidpoint(value, coordinates[index + 1], axisType, dimension, calendar)
  ));
}

function extrapolatedCoordinateValues(
  coordinates: readonly unknown[],
  expected: number,
  dimension: 'x' | 'y',
  axisType: string | undefined,
  calendar?: string,
): readonly unknown[] {
  const expanded = [...coordinates];
  while (expanded.length < expected) {
    const current = coordinateNumber(expanded.at(-1), axisType, calendar);
    const previous = previousCoordinate(expanded, current, axisType, calendar);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) {
      return invalidPoints(`trace.${dimension} coordinates cannot be extrapolated`);
    }
    expanded.push(axisType === 'log'
      ? current * (current / previous)
      : current + (current - previous));
  }
  return expanded;
}

function previousCoordinate(
  coordinates: readonly unknown[],
  current: number,
  axisType: string | undefined,
  calendar?: string,
): number {
  if (coordinates.length > 1) return coordinateNumber(coordinates.at(-2), axisType, calendar);
  return axisType === 'log' ? current / 10 : current - 1;
}

function exactCoordinateValues(
  coordinates: readonly unknown[],
  expected: number,
  dimension: 'x' | 'y',
): readonly unknown[] {
  if (coordinates.length !== expected) {
    return invalidPoints(`trace.${dimension} coordinates do not match trace.z`);
  }
  return coordinates;
}

function coordinateNumber(value: unknown, axisType: string | undefined, calendar?: string): number {
  if (axisType === 'date') return plotlyDateMilliseconds(value, true, calendar) ?? Number.NaN;
  return cleanPlotlyNumber(value);
}

function coordinateMidpoint(
  start: unknown,
  end: unknown,
  axisType: string | undefined,
  dimension: 'x' | 'y',
  calendar?: string,
): number {
  const firstDate = plotlyDateMilliseconds(start, true, calendar);
  const secondDate = plotlyDateMilliseconds(end, true, calendar);
  const usesDates = axisType === 'date' || (
    axisType === undefined
    && typeof start === 'string'
    && typeof end === 'string'
    && /[-Tt:]/.test(start)
    && /[-Tt:]/.test(end)
    && firstDate !== undefined
    && secondDate !== undefined
  );
  const first = usesDates ? firstDate : cleanPlotlyNumber(start);
  const second = usesDates ? secondDate : cleanPlotlyNumber(end);
  if (first === undefined || second === undefined || !Number.isFinite(first) || !Number.isFinite(second)) {
    return invalidPoints(`trace.${dimension} edge coordinates are not numeric`);
  }
  return (first + second) / 2;
}

function autoCategoryCoordinates(values: readonly unknown[], calendar?: string): boolean {
  const categories = new Set(values.filter((value) => (
    typeof value === 'string'
    && !dateLikeOrigin(value, calendar)
    && !Number.isFinite(cleanPlotlyNumber(value))
  )).map(String));
  const numerics = new Set(values.filter((value) => Number.isFinite(cleanPlotlyNumber(value))).map(String));
  return categories.size > numerics.size * 2;
}

function rawPoint(
  trace: Trace,
  index: number,
  values: Readonly<Record<string, unknown>>,
  row?: number,
  column?: number,
  sourceIndices?: readonly number[],
  displayValues?: Readonly<Record<string, unknown>>,
): DataVizFigureRawPoint {
  const resolved = { ...values };
  const sourceCount = sourcePointCount(trace);
  for (const path of POINT_ARRAYS) {
    if (resolved[path] !== undefined) continue;
    const value = pointArrayValue(trace[path], index, row, column, sourceIndices);
    if (value !== undefined) resolved[path] = value;
  }
  Object.assign(resolved, pointStyleValues(
    trace,
    index,
    row,
    column,
    sourceCount,
    sourceIndices,
  ));
  return {
    index,
    ...(sourceIndices === undefined ? {} : { sourceIndices }),
    ...(row === undefined ? {} : { row }),
    ...(column === undefined ? {} : { column }),
    values: resolved,
    ...(displayValues === undefined || Object.keys(displayValues).length === 0
      ? {}
      : { displayValues }),
  };
}

function pointStyleValues(
  trace: Trace,
  index: number,
  row: number | undefined,
  column: number | undefined,
  sourceCount: number,
  sourceIndices?: readonly number[],
): Readonly<Record<string, unknown>> {
  const traceType = typeof trace.type === 'string' ? trace.type as DataVizFigureTraceType : 'scatter';
  const facts = DATA_VIZ_FIGURE_TRACE_FACTS[traceType];
  const marker = isRecord(trace.marker) ? trace.marker : undefined;
  const textFont = isRecord(trace.textfont) ? trace.textfont : undefined;
  const varying = (parent: unknown, key: string) => varyingNestedPointValue(
    parent,
    key,
    index,
    row,
    column,
    sourceCount,
    sourceIndices,
  );
  const textModeVisible = !facts.textRequiresMode
    || (typeof trace.mode === 'string' && trace.mode.split('+').includes('text'));
  const pointTextPosition = Array.isArray(trace.textposition)
    ? pointArrayValue(trace.textposition, index, row, column, sourceIndices)
    : trace.textposition;
  const pointTextVisible = textModeVisible && pointTextPosition !== 'none';
  const entries: readonly (readonly [string, unknown])[] = [
    ['marker.color', varying(trace.marker, 'color')],
    ['marker.symbol', varying(trace.marker, 'symbol')],
    ['marker.colors', varying(trace.marker, 'colors')],
    ['marker.size', varying(trace.marker, 'size')],
    ['marker.opacity', varying(trace.marker, 'opacity')],
    ['marker.line.color', varying(marker?.line, 'color')],
    ['marker.line.width', varying(marker?.line, 'width')],
    ['line.color', varying(trace.line, 'color')],
    ...(textModeVisible && facts.textPositionArray ? [
      ['textposition', varying(trace, 'textposition')],
    ] as const : []),
    ...(pointTextVisible && facts.textFontArray ? [
      ['textfont.family', varying(textFont, 'family')],
      ['textfont.size', varying(textFont, 'size')],
      ['textfont.color', varying(textFont, 'color')],
      ['textfont.weight', varying(textFont, 'weight')],
      ['textfont.style', varying(textFont, 'style')],
    ] as const : []),
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function varyingNestedPointValue(
  parent: unknown,
  key: string,
  index: number,
  row: number | undefined,
  column: number | undefined,
  sourceCount: number,
  sourceIndices?: readonly number[],
): unknown {
  if (!isRecord(parent) || !Array.isArray(parent[key])) return undefined;
  const values = parent[key];
  if (
    sourceCount > 0
    && values.length >= sourceCount
    && values.slice(0, sourceCount).every((value) => value === values[0])
  ) return undefined;
  return pointArrayValue(values, index, row, column, sourceIndices);
}

function sourcePointCount(trace: Trace): number {
  if (Array.isArray(trace.labels)) return trace.labels.length;
  if (Array.isArray(trace.z) && trace.z.every(Array.isArray)) {
    return trace.z.reduce((total, row) => total + (row as readonly unknown[]).length, 0);
  }
  const aligned = ['x', 'y', 'z', 'r', 'theta']
    .map((key) => trace[key])
    .filter(Array.isArray);
  return aligned.length === 0 ? 0 : Math.min(...aligned.map((value) => value.length));
}

function pointArrayValue(
  value: unknown,
  index: number,
  row: number | undefined,
  column: number | undefined,
  sourceIndices?: readonly number[],
): unknown {
  if (!Array.isArray(value)) return undefined;
  if (sourceIndices !== undefined) {
    return sourceIndices.map((sourceIndex) => value[sourceIndex]).find(isPlotlyFilledValue);
  }
  if (row !== undefined && column !== undefined && Array.isArray(value[row])) {
    return value[row][column];
  }
  return value[index];
}

function isPlotlyFilledValue(value: unknown): boolean {
  return Boolean(value) || value === 0 || value === '';
}

function requiredMatrix(value: unknown, label: string): readonly (readonly unknown[])[] {
  const rows = requiredArray(value, label);
  if (!rows.every(Array.isArray)) return invalidPoints(`${label} is not a matrix`);
  return rows as readonly (readonly unknown[])[];
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalidPoints(`${label} is not an array`);
  return value;
}

function optionalArray(value: unknown, label: string): readonly unknown[] | undefined {
  return value === undefined ? undefined : requiredArray(value, label);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidPoints(detail: string): never {
  throw new Error(detail);
}

export function figureItemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  // Stryker disable next-line StringLiteral: every caller indexes an array built in step with the index, so this never throws
  if (item === undefined) return invalidPoints(`figure item ${index} is missing`);
  return item;
}

export function figureValueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
