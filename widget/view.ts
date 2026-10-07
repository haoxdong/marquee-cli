import assert from 'node:assert/strict';
import type { WidgetPort } from './adapters/port.js';
import type {
  EntityError,
  EntityModule,
  EntityResolveValue,
} from '../entity/index.js';
import { isEntityNotFound } from '../entity/index.js';
import { annotateFillPolicy } from './fill-policy.js';
import { widgetParameterStates } from './parameter-state.js';
import { widgetParamRefName } from './param-ref-name.js';
import { entityIdentityKind } from './input-resolution.js';
import {
  createDataViz,
  type DataVizError,
  type DataVizInputs,
  type DataVizResult,
} from './data-viz/index.js';
import {
  buildWidgetParams,
  cleanText,
} from './parameters.js';
import {
  type Chart,
  type PlotTool,
  type PlotToolControl,
  type PlotToolDateRangeOverride,
  type PlotToolProjection,
} from './plottool/index.js';
import {
  optionalWidgetPayloadArray,
  type WidgetPayload,
} from './payload.js';
import { InvalidWidgetResponseError, WidgetSemanticFailure } from './semantic-failure.js';
import { WidgetPlotToolFailure } from './plottool-failure.js';
import { projectWidgetPlotToolResult } from './plottool-presentation.js';
import { toWidgetParameterDisplayValue } from './display-value.js';
import {
  selectWidgetRenderTarget,
  widgetRenderTargetMetadata,
  type WidgetRenderTarget,
} from './render-pipeline/target.js';
import type {
  EditableDashboard,
  WidgetPlotToolResult,
  WidgetParameterOverride,
  WidgetRenderValue,
  WidgetId,
  ConfigId,
} from './types.js';

/** The Widget Payload the Widget adapter builds for a full render: a component record and fielded parameters. */
export type SemanticWidgetPayload = WidgetPayload & Readonly<{
  renderParams: NonNullable<WidgetPayload['renderParams']> & { component: Record<string, unknown> };
  parameters: Array<NonNullable<WidgetPayload['parameters']>[number] & { field: string }>;
}>;

export type FullWidgetProjection = Readonly<{
  widget: WidgetRenderValue;
  execution: WidgetExecutionResult;
}>;

type WidgetExecutionResult =
  | Readonly<{ family: 'blank' }>
  | Readonly<{ family: 'plot'; value: WidgetPlotToolResult }>
  | Readonly<{ family: 'data-viz'; value: DataVizResult }>;

type WidgetExecutionProjection =
  | Readonly<{ family: 'blank' }>
  | Readonly<{ family: 'plot'; value: PlotToolProjection }>
  | Readonly<{ family: 'data-viz'; value: DataVizResult }>;

function failRenderedPlotToolEntityResolution(widgetId: string, error: EntityError): never {
  if (error.kind === 'dependency') {
    throw new WidgetSemanticFailure({
      kind: 'widget-load-failure',
      identity: { widgetId },
      failure: error.failure,
    });
  }
  if (error.kind === 'access-denied') {
    throw new WidgetSemanticFailure({
      kind: 'widget-access-denied',
      identity: { widgetId },
    });
  }
  throw new WidgetSemanticFailure({
    kind: 'invalid-definition',
    identity: { widgetId },
    problem: 'malformed',
  });
}

async function resolveRenderedPlotToolEntities(
  entity: EntityModule,
  execution: WidgetExecutionProjection | undefined,
  widget: WidgetPayload,
  widgetId: string,
  seed: { entityMap: Record<string, string>; cgMembers: Record<string, string[]> },
): Promise<{ entityMap: Record<string, string>; cgMembers: Record<string, string[]> }> {
  const entityMap = { ...seed.entityMap };
  const cgMembers = { ...seed.cgMembers };
  if (execution?.family !== 'plot') return { entityMap, cgMembers };
  const expressionLabels = widget.metadata?.expressionLabels;
  const hasCompleteExpressionLabels = Array.isArray(expressionLabels)
    && expressionLabels.length === execution.value.series.length
    && expressionLabels.every((label) => (
      typeof label === 'string'
      && label.trim().length > 0
      && !label.split(/\b/).some((word) => entityIdentityKind(word))
    ));
  const contextSeriesIdentities = widget.contextParameter
    && !cleanText(widget.contextParameter.field)
    && widget.contextParameter.options?.length === execution.value.series.length
    ? widget.contextParameter.options
    : [];
  const identifiers = [...new Set([
    ...(hasCompleteExpressionLabels
      ? []
      : execution.value.series.map(({ label }) => label)),
    ...contextSeriesIdentities,
  ])]
    .flatMap((value) => {
      const kind = entityIdentityKind(value);
      const id = String(value);
      return kind && !entityMap[id] ? [{ kind, value: id }] : [];
    });
  if (identifiers.length === 0) return seed;
  const result = await entity.resolve(identifiers);
  if (!result.ok) return failRenderedPlotToolEntityResolution(widgetId, result.error);
  const notFound = result.value.find(isEntityNotFound);
  if (notFound) {
    return failRenderedPlotToolEntityResolution(widgetId, {
      kind: 'not-found',
      identifier: { kind: notFound.kind, value: notFound.value },
    });
  }
  for (const [index, requested] of identifiers.entries()) {
    const entityValue = result.value[index] as Exclude<EntityResolveValue, { status: 'not-found' }> | undefined;
    /* c8 ignore start -- data-layer-ignore: widget-rendered-series-kind-assert */
    if (entityValue?.kind !== requested.kind) {
      return failRenderedPlotToolEntityResolution(widgetId, {
        kind: 'malformed-entity',
        identifier: requested,
      });
    }
    /* c8 ignore stop */
    entityMap[entityValue.entityId] = entityValue.label;
    for (const alias of entityValue.aliases) entityMap[alias] = entityValue.label;
    entityMap[requested.value] = entityValue.label;
  }
  return { entityMap, cgMembers };
}

function completePlotToolExpressionLabels(
  widget: WidgetPayload,
  seriesCount: number,
): readonly string[] {
  const labels = widget.metadata?.expressionLabels;
  return Array.isArray(labels)
    && labels.length === seriesCount
    && labels.every((label) => typeof label === 'string' && label.trim().length > 0)
    ? labels as string[]
    : [];
}

function rawValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type WidgetPlotToolRead = Readonly<{
  chart: Chart;
  projection: PlotToolProjection;
}>;

async function readWebParityPlotTool(
  plotToolModule: PlotTool,
  controls: readonly PlotToolControl[],
  chartId: string,
  dateRangeOverride: PlotToolDateRangeOverride | undefined,
  now: Date,
): Promise<WidgetPlotToolRead> {
  const outcome = await plotToolModule.execute({
    chartId,
    inputs: {
      controls,
      ...(dateRangeOverride !== undefined ? { dateRangeOverride } : {}),
    },
    now,
  });
  if (!outcome.ok) throw new WidgetPlotToolFailure(outcome.error);
  return {
    chart: outcome.value.chart,
    projection: outcome.value.projection,
  };
}

function startWidgetExecution(
  target: WidgetRenderTarget,
  renderTargetDataViz: () => Promise<DataVizResult>,
  readPlot: (targetId: string) => Promise<WidgetPlotToolRead>,
): Readonly<{
  plotToolPromise: Promise<WidgetPlotToolRead | undefined>;
  executionPromise: Promise<WidgetExecutionProjection>;
}> {
  const noPlot = Promise.resolve(undefined);
  if (target.kind === 'blank') {
    return { plotToolPromise: noPlot, executionPromise: Promise.resolve({ family: 'blank' }) };
  }
  if (target.kind === 'data-viz') {
    return {
      plotToolPromise: noPlot,
      executionPromise: renderTargetDataViz().then((value) => ({ family: 'data-viz' as const, value })),
    };
  }
  const plotToolPromise = readPlot(target.targetId);
  return {
    plotToolPromise,
    executionPromise: plotToolPromise.then((plot) => ({
      family: 'plot' as const,
      value: plot.projection,
    })),
  };
}

function labelPlotToolExecution(
  execution: WidgetExecutionProjection,
  widgetRaw: WidgetPayload,
  entityMap: Record<string, string>,
): WidgetExecutionProjection {
  if (execution.family !== 'plot') return execution;
  const plotToolExpressionLabels = completePlotToolExpressionLabels(widgetRaw, execution.value.series.length);
  return {
    family: 'plot',
    value: {
      ...execution.value,
      series: execution.value.series.map((series) => {
        const label = plotToolExpressionLabels[series.sourceIndex] ?? entityMap[series.label];
        return label === undefined ? series : { ...series, label, legendLabel: label };
      }),
    },
  };
}

export async function buildFullWidgetProjection(
  request: WidgetPort['request'],
  entity: EntityModule,
  plotToolModule: PlotTool,
  now: Date,
  widgetRaw: SemanticWidgetPayload,
  plotToolControls: readonly PlotToolControl[],
  id: WidgetId,
  configurationId: ConfigId | null,
  presentDataVizError: (error: DataVizError, visualizationFailureEvidence?: Error) => Error,
  resolvedEntitiesPromise: Promise<{
    entityMap: Record<string, string>;
    cgMembers: Record<string, string[]>;
    parameterWidget: WidgetPayload;
  }>,
  editableDashboardsStart: (signal: AbortSignal) => Promise<EditableDashboard[]>,
  appliedParams: readonly WidgetParameterOverride[],
  dateRangeOverride?: PlotToolDateRangeOverride,
  dataVizInputs: Pick<
    DataVizInputs,
    'activeEntity' | 'dashboardOverrides' | 'hasSavedRenderParams'
  > = {},
): Promise<FullWidgetProjection> {
  const target = selectWidgetRenderTarget({
    sourceId: id,
    underlyingChartId: cleanText(widgetRaw.underlyingChartId),
    visualizationType: cleanText(widgetRaw.visualizationType),
  });
  const targetMetadata = widgetRenderTargetMetadata(target);
  const isDV = target.kind === 'data-viz';
  const renderTargetDataViz = (): Promise<DataVizResult> => renderDataViz(
    request,
    widgetRaw,
    configurationId,
    presentDataVizError,
    dataVizInputs,
  );
  const { plotToolPromise, executionPromise } = startWidgetExecution(
    target,
    renderTargetDataViz,
    (targetId) => readWebParityPlotTool(
      plotToolModule,
      plotToolControls,
      targetId,
      dateRangeOverride,
      now,
    ),
  );
  // Editable-dashboards is a hedged enrichment (see widget-module). It runs concurrently
  // with the essential calls, but must not outlive a sibling failure: abort it when an
  // essential call rejects. Observing it inside the same Promise.all handles an early
  // dashboards failure, and a genuine one fails loud (ADR 0030). The essentials' rejection
  // settles that Promise.all before the aborted request can reject.
  const dashController = new AbortController();
  const dashboardsPromise = editableDashboardsStart(dashController.signal);
  const essentials = Promise.all([
    plotToolPromise, resolvedEntitiesPromise, executionPromise,
  ]);
  essentials.catch(() => dashController.abort());

  const [[plotToolRead, resolvedEntities, execution], editableDashboards] = await Promise.all([
    essentials,
    dashboardsPromise,
  ]);
  const chart: Partial<Chart> = plotToolRead?.chart ?? {};

  const renderedEntities = await resolveRenderedPlotToolEntities(
    entity,
    execution,
    widgetRaw,
    id,
    resolvedEntities,
  );
  const { entityMap, cgMembers } = renderedEntities;
  const parameterWidget = resolvedEntities.parameterWidget;

  const params = annotateFillPolicy(
    buildWidgetParams({
      entity,
      widget: parameterWidget,
      entityMap,
      cgMembers,
      chart,
      isDV,
    }),
    parameterWidget,
  );

  const sources = entity.resolveSourceLabels([
    ...optionalWidgetPayloadArray(widgetRaw.metadata?.dataSources, 'metadata.dataSources'),
    ...optionalWidgetPayloadArray(widgetRaw.dataAttribution, 'dataAttribution'),
  ]);

  const title = cleanText(widgetRaw.metadata?.title) || cleanText(widgetRaw.title);
  const assignmentByField = new Map(
    appliedParams.map((assignment) => [assignment.field, assignment]),
  );
  const publicParams = params.map((parameter) => {
    const assignment = assignmentByField.get(parameter.field);
    const matchedOption = assignment
      ? parameter.options.find((option) => rawValuesEqual(option.rawValue, assignment.value))
      : undefined;
    const entityLabel = typeof assignment?.value === 'string'
      ? entityMap[assignment.value]
      : undefined;
    return {
      ...parameter,
      refKey: widgetParamRefName(parameter.field),
      ...(assignment
        ? {
            default: toWidgetParameterDisplayValue(
              assignment.displayValue
                ?? matchedOption?.label
                ?? entityLabel
                ?? assignment.value,
              entityMap,
            ),
            rawDefault: assignment.value,
          }
        : {}),
    };
  });
  const parameterStates = widgetParameterStates({
    widgetId: id,
    configurationId: configurationId ?? undefined,
    ...targetMetadata,
    params,
    appliedParams: [...appliedParams],
  });
  const widgetMeta = {
    widgetId: id,
    title,
    configurationId,
    ...targetMetadata,
    ...(typeof cleanText(widgetRaw.description) === 'string' && cleanText(widgetRaw.description).length > 0 ? { description: cleanText(widgetRaw.description) } : {}),
    tags: optionalWidgetPayloadArray(widgetRaw.tags, 'tags').map(String),
    ...(sources.length > 0 ? { sources } : {}),
    bindings: publicParams
      .filter((parameter) => !parameter.isNotParam)
      .map((parameter) => ({
        field: parameter.field,
        value: parameter.rawDefault ?? parameter.default,
        ...(parameter.default !== undefined ? { displayValue: parameter.default } : {}),
      })),
    parameters: publicParams,
    parameterStates,
    dashboards: editableDashboards,
  };
  const semanticExecution = labelPlotToolExecution(execution, widgetRaw, entityMap);
  return {
    widget: widgetMeta,
    execution: semanticExecution.family === 'plot'
      ? {
          family: 'plot',
          value: projectWidgetPlotToolResult(semanticExecution.value),
        }
      : semanticExecution,
  };
}

async function renderDataViz(
  request: WidgetPort['request'],
  widget: SemanticWidgetPayload,
  configurationId: string | null,
  presentError: (error: DataVizError, visualizationFailureEvidence?: Error) => Error,
  executionInputs: Pick<
    DataVizInputs,
    'activeEntity' | 'dashboardOverrides' | 'hasSavedRenderParams'
  >,
): Promise<DataVizResult> {
  const targetId = String(widget.underlyingChartId);
  let visualizationFailureEvidence: Error | undefined;
  const dataViz = createDataViz({
    request,
    target: widget,
    onVisualizationFailureEvidence(cause) {
      if (cause instanceof Error) visualizationFailureEvidence = cause;
    },
  });
  assert(
    configurationId !== null,
    new InvalidWidgetResponseError({ source: 'widget', problem: 'data-viz-configuration-missing' }),
  );
  const outcome = await dataViz.render({
    targetId,
    inputs: {
      widget: semanticDataVizWidget(widget),
      configurationId: configurationId as `WC${string}`,
      ...executionInputs,
    },
  });
  if (!outcome.ok) throw presentError(outcome.error, visualizationFailureEvidence);
  return outcome.value;
}

function semanticDataVizWidget(
  widget: SemanticWidgetPayload,
): DataVizInputs['widget'] {
  const parameterFields = new Set(widget.parameters.map(({ field }) => field));
  return JSON.parse(JSON.stringify({
    parameters: [
      ...widget.parameters,
      ...Object.entries(widget.renderParams.component).flatMap(([field, value]) => (
        parameterFields.has(field) ? [] : [{ field, values: { default: value } }]
      )),
    ],
    contextParameter: widget.contextParameter,
    renderParams: widget.renderParams,
  })) as DataVizInputs['widget'];
}
