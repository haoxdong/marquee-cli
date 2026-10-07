import assert from 'node:assert/strict';

import type {
  DataVizError,
  DataVizMalformedProblem,
  DataVizResult,
} from '../types.js';
import type {
  DataVizAdapter,
  DataVizOutcome,
  DataVizRouting,
} from '../module.js';
import { DataVizApi } from '../../../api/data-viz/index.js';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import {
  DataVizRenderInputError,
  renderDataVizLane,
} from '../../render-pipeline/data-viz.js';
import {
  DataVizFigureProjectionError,
  projectDataVizFigure,
} from '../figure-lane.js';
import type { DataVizFigureProjection } from '../figure-types.js';
import { DataVizD3FormatError } from '../d3-format.js';
import {
  DataVizTableLaneError,
  projectDataVizTable as projectDataVizTableLane,
} from '../table-lane.js';
import type { DataVizTableProjection } from '../table-lane.js';

type DataVizRequest = (
  endpoint: Endpoint,
  init?: {
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
    hedgeDelaysMs?: number[];
  },
) => Promise<unknown>;

const DATA_VIZ_RENDER_TIMEOUT_MS = 60_000;
// Web's widgetErrors.noData, which it shows when the render answers 416.
const WEB_RENDER_416_MESSAGE = 'There is no data available for this chart';

class DataVizRequestFailure extends Error {
  override readonly name = 'DataVizRequestFailure';

  constructor(
    readonly requestCause: MarqueeError,
    readonly isRender: boolean,
  ) {
    super('DataViz request failed', { cause: requestCause });
  }
}

export function createMarqueeDataVizAdapter(options: {
  request: DataVizRequest;
  target: unknown;
  onVisualizationFailureEvidence?: (cause: unknown) => void;
}): DataVizAdapter {
  return {
    routing(targetId) {
      return routingFromTarget(targetId, options.target);
    },
    async render(input) {
      const { widget } = input.inputs;
      let response: unknown;
      try {
        response = await renderDataVizLane(new DataVizApi({
          request: async (endpoint, init) => {
            const isRender = endpoint.method === 'POST';
            try {
              return await options.request(
                endpoint,
                isRender ? { ...init, timeoutMs: dataVizRenderTimeoutMs() } : init,
              );
            } catch (cause) {
              // ADR 0030: only classified transport failures are dependency failures; anything else propagates.
              assert(cause instanceof MarqueeError, cause as Error);
              throw new DataVizRequestFailure(cause, isRender);
            }
          },
        }), input.route === 'component'
          ? {
              mode: 'base-component',
              targetId: input.targetId,
              params: dataVizComponentParams(widget.renderParams),
            }
          : {
              mode: 'widget',
              targetId: input.targetId,
              widget,
              useSavedRenderParams: input.inputs.hasSavedRenderParams === true,
              activeEntity: input.inputs.activeEntity,
              dashboardOverrides: input.inputs.dashboardOverrides,
              ...(input.inputs.configurationId
                ? { configurationId: input.inputs.configurationId }
                : {}),
            });
      } catch (cause) {
        if (cause instanceof DataVizRenderInputError) {
          return malformed(input.targetId, 'invalid-visualization-data');
        }
        if (!(cause instanceof DataVizRequestFailure)) throw cause;
        if (input.route === 'visualization') {
          // Marquee answers a render with 416 when the chart has no data; Web
          // draws it as its no-data card, not as a failure message.
          if (cause.isRender && cause.requestCause.details?.status === 416) {
            return { ok: true, value: { kind: 'empty', message: WEB_RENDER_416_MESSAGE } };
          }
          options.onVisualizationFailureEvidence?.(cause.requestCause);
        }
        return {
          ok: false,
          error: requestError(input.targetId, cause.requestCause),
        };
      }
      return normalizeDataVizResponse(input.targetId, response);
    },
  };
}

function dataVizRenderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env.MARQUEE_WIDGET_RENDER_TIMEOUT_MS;
  if (configured !== undefined && configured.trim().length > 0) {
    const parsed = Number(configured);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DATA_VIZ_RENDER_TIMEOUT_MS;
}

function dataVizComponentParams(renderParams: unknown): unknown {
  return isRecord(renderParams) ? renderParams.component : undefined;
}

function routingFromTarget(targetId: string, target: unknown): DataVizRouting {
  const visualizationType = isRecord(target) ? target.visualizationType : undefined;
  const isDataVizTarget = targetId.startsWith('DV');
  return {
    isVisualization: isDataVizTarget && visualizationType !== 'BaseComponent',
    isComponent: isDataVizTarget && visualizationType === 'BaseComponent',
  };
}

function normalizeDataVizResponse(
  targetId: string,
  response: unknown,
): DataVizOutcome {
  const normalizedRenderData = dataVizRenderData(response);
  if (!normalizedRenderData.ok) return malformed(targetId, normalizedRenderData.problem);
  const renderData = normalizedRenderData.value;

  const emptyMessage = dataVizEmptyResultMessage(
    renderData.data,
    renderData.layout,
  );
  if (emptyMessage) {
    return { ok: true, value: { kind: 'empty', message: emptyMessage } };
  }

  const projection = projectDataVizProjection(targetId, renderData);
  if (!projection.ok) return projection;
  if (projection.value.kind === 'table') {
    return {
      ok: true,
      value: { kind: 'table', projection: projection.value },
    };
  }

  const value: DataVizResult = { kind: 'visualization', projection: projection.value };
  return { ok: true, value };
}

function projectDataVizProjection(
  targetId: string,
  renderData: Readonly<{ data: readonly unknown[]; layout: Readonly<Record<string, unknown>> }>,
): { ok: true; value: DataVizTableProjection | DataVizFigureProjection }
  | { ok: false; error: DataVizError } {
  try {
    const table = projectDataVizTableLane(renderData);
    if (table) return { ok: true, value: table };
    const figure = projectDataVizFigure(renderData);
    if (figure) return { ok: true, value: figure };
    return malformed(targetId, 'invalid-visualization-data');
  } catch (cause) {
    if (
      cause instanceof DataVizD3FormatError
      || cause instanceof DataVizTableLaneError
      || cause instanceof DataVizFigureProjectionError
    ) {
      return malformed(targetId, 'invalid-display-format');
    }
    throw cause;
  }
}

function dataVizRenderData(response: unknown):
  | { ok: true; value: { data: unknown[]; layout: Record<string, unknown> } }
  | { ok: false; problem: DataVizMalformedProblem } {
  if (!isRecord(response)) return { ok: false, problem: 'missing-render-data' };
  const renderData = normalizeRenderData(response.renderData);
  if (
    !renderData.ok
    || !isTableData(renderData.value.data)
    // A render Marquee computes fresh answers detailedRenderData: null; a cached one omits it.
    || response.detailedRenderData == null
  ) {
    return renderData;
  }
  // Web draws a table's detailedRenderData, which carries the columns and
  // per-group titles that the compact renderData drops.
  const detailedRenderData = normalizeRenderData(response.detailedRenderData);
  if (!detailedRenderData.ok) return detailedRenderData;
  return isTableData(detailedRenderData.value.data)
    && detailedRenderData.value.data.length === renderData.value.data.length
    ? detailedRenderData
    : { ok: false, problem: 'invalid-visualization-data' };
}

function isTableData(data: readonly unknown[]): boolean {
  return data.every((trace) => isRecord(trace) && trace.type === 'table');
}

function normalizeRenderData(renderData: unknown):
  | { ok: true; value: { data: unknown[]; layout: Record<string, unknown> } }
  | { ok: false; problem: DataVizMalformedProblem } {
  if (!isRecord(renderData)) return { ok: false, problem: 'missing-render-data' };
  if (!Array.isArray(renderData.data)) {
    return { ok: false, problem: 'invalid-visualization-data' };
  }
  if (!isRecord(renderData.layout)) {
    return { ok: false, problem: 'invalid-visualization-layout' };
  }
  return { ok: true, value: { data: renderData.data, layout: renderData.layout } };
}

function dataVizEmptyResultMessage(
  data: readonly unknown[],
  layout: Record<string, unknown>,
): string | undefined {
  if (data.length !== 1 || !isRecord(data[0])) return undefined;
  const trace = data[0];
  if (
    trace.type !== 'bar'
    || !isZeroPair(trace.x)
    || !isZeroPair(trace.y)
    || !isPlaceholderAxis(layout.xaxis, 'x')
    || !isPlaceholderAxis(layout.yaxis, 'y')
    || !Array.isArray(layout.annotations)
    || layout.annotations.length !== 2
  ) {
    return undefined;
  }
  const messages = layout.annotations.map((annotation) => (
    isRecord(annotation)
    && annotation.showarrow === false
    && annotation.xref === 'x domain'
    && annotation.yref === 'y domain'
    && typeof annotation.text === 'string'
      ? annotation.text.trim()
      : ''
  ));
  return messages[0] && messages[0] === messages[1] ? messages[0] : undefined;
}

function isZeroPair(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => entry === 0);
}

function isPlaceholderAxis(value: unknown, title: string): boolean {
  if (!isRecord(value) || value.showticklabels !== false || value.showgrid !== false) return false;
  return isRecord(value.title) && value.title.text === title;
}

function malformed(
  targetId: string,
  problem: DataVizMalformedProblem,
): { ok: false; error: DataVizError } {
  return {
    ok: false,
    error: { kind: 'malformed-result', targetId, problem },
  };
}

function requestError(targetId: string, cause: MarqueeError): DataVizError {
  const status = cause.details?.status;
  if (status === 404) return { kind: 'target-not-found', targetId };
  if (status === 403) return { kind: 'target-access-denied', targetId };
  return { kind: 'render-failure', targetId, failure: cause.dependencyFailure() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
