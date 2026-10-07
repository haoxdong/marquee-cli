import type { MarketViewPresentationSink } from './types.js';
import type {
  RenderedWidget,
  WidgetRenderValue,
  WidgetResult,
} from '../../widget/index.js';
import { type WidgetPresentation } from './widget-types.js';
import { widgetPresentationUrl } from './widget-tree.js';
import { presentWidgetView } from './widget-view.js';
import { isObject } from '../is-object.js';
import type {
  MarketViewWidgetResult,
} from '../widget.js';
import type {
  MarketViewOperationOutcome,
  MarketViewWidgetGetError,
  MarketViewWidgetGetValue,
} from '../index.js';
import {
  formatUnknownMarketViewRef,
  writeMarketViewRefError,
  writeWrongMarketViewRef,
} from './command-errors.js';
import type { WidgetCallLog } from './widget-evidence.js';
import {
  presentWidgetChart,
  type WidgetChartText,
  type WidgetTextProjection,
} from '../../widget/text-presenter.js';
import { projectDataVizRawRows } from '../../widget/data-viz/raw-rows.js';
import type { DataVizFigureProjection } from '../../widget/data-viz/figure-types.js';
import type { DataVizTableProjection } from '../../widget/data-viz/table-lane.js';
import { WIDGET_SNIPPET_TABLE, widgetSnippetRow } from './widget-snippet.js';
import { formatJsonFields, type JsonOutputOptions } from '../../presentation/index.js';
import { renderText, type TextHint } from '../../presentation/text.js';
import {
  exitCodeForWidgetError,
  writeMarketViewErrorLine,
} from './failure-semantics.js';
import { presentWidgetError } from './widget-error.js';

type WidgetPresentationProjection = Readonly<{
  widget: WidgetRenderValue;
  data: WidgetExecutionProjection | undefined;
}>;

/** The rendered chart: raw rows for `--json data`, and the projection or empty message for text. */
type WidgetExecutionProjection = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  chart: WidgetTextProjection | Readonly<{ kind: 'empty'; message: string }>;
}>;

function widgetExecutionProjection(
  execution: Extract<RenderedWidget, { detail: 'full' }>['execution'],
): WidgetExecutionProjection | undefined {
  if (execution.family === 'plot') {
    return { rows: execution.value.rows, chart: execution.value.projection };
  }
  if (execution.family !== 'data-viz') return undefined;
  const value = execution.value;
  if (value.kind === 'empty') return { rows: [], chart: { kind: 'empty', message: value.message } };
  const projection = dataVizProjection(value.projection);
  return { rows: projectDataVizRawRows(projection).rows, chart: projection };
}

function dataVizProjection(
  value: unknown,
): DataVizFigureProjection | DataVizTableProjection {
  if (isObject(value) && (value.kind === 'figure' || value.kind === 'table')) {
    return value as DataVizFigureProjection | DataVizTableProjection;
  }
  throw new Error('DataViz execution is missing its Web-parity projection');
}

type WidgetParamOverride = { field: string; value: unknown; displayValue?: unknown };

export interface RenderMarketviewWidgetOptions extends JsonOutputOptions {
  configId?: string;
  selectedContext?: string;
  paramOverrides?: WidgetParamOverride[];
  label?: string;
  mutationFallbackRef?: string;
  isSnippet?: boolean;
  hasEditableDashboards?: boolean;
}

export type RenderMarketviewWidgetDeps = MarketViewPresentationSink;

/** `marquee marketview widget view --json` fields. */
export const MARKETVIEW_WIDGET_VIEW_JSON_FIELDS = [
  'access',
  'authors',
  'chart',
  'data',
  'description',
  'id',
  'params',
  'ref',
  'sources',
  'tags',
  'title',
  'url',
] as const;

function widgetRecord(
  widget: WidgetPresentation,
  ref: string,
  rows: readonly Readonly<Record<string, unknown>>[],
): Record<(typeof MARKETVIEW_WIDGET_VIEW_JSON_FIELDS)[number], unknown> {
  return {
    access: widget.access,
    authors: widget.authors,
    chart: widget.chartId,
    data: rows,
    description: widget.description,
    id: widget.widgetId,
    params: widget.params,
    ref: `@${ref}`,
    sources: widget.sources,
    tags: widget.tags,
    title: widget.title,
    url: widgetPresentationUrl(widget.widgetId, widget.configurationId, widget.selectedContext),
  };
}

function widgetIdValidationMessage(id: string): string {
  return `marketview widget expects a widget ID like MW..., got "${id}". Use \`marquee marketview search "${id}"\` to find widgets by query.`;
}

function withMutationFallback(message: string, fallbackRef?: string): string {
  if (
    !fallbackRef
    || message.includes('marquee browser open')
    || message.startsWith('ambiguous ')
    || message.startsWith('no ')
  ) {
    return message;
  }
  return `${message}. Use \`marquee browser open @${fallbackRef}\` to adjust this widget in Marquee UI or try another option.`;
}

function hasRelativeDateRule(value: unknown): boolean {
  return isObject(value) && isObject(value.rdate) && typeof value.rdate.rule === 'string';
}

const STALE_DATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A `YYYY-MM-DD` calendar date from year 100 on, at UTC midnight; any other value or impossible date is undefined.
 * Years below 100 stay rejected, as `Date.UTC` maps them to 19xx; an invalid date fails the year check too.
 */
function calendarDate(value: unknown): Date | undefined {
  const date = new Date(String(value));
  return date.getUTCFullYear() >= 100 && date.toISOString().slice(0, 10) === value ? date : undefined;
}

function isCurrentOrUpcomingWidget(widget: Pick<WidgetPresentation, 'title' | 'description'>): boolean {
  const text = `${widget.title} ${widget.description ?? ''}`;
  return /\b(upcoming|current|today|tomorrow|next\s+(week|month|quarter)|this\s+(week|month|quarter))\b/i.test(text);
}

/** Hints for a stale absolute Date param on a current or upcoming widget. */
function staleDateParamHints(widget: WidgetPresentation, namespace: string): TextHint[] {
  if (!isCurrentOrUpcomingWidget(widget)) {
    return [];
  }

  const hints: TextHint[] = [];
  for (const param of widget.params) {
    if (param.type !== 'Date' || hasRelativeDateRule(param.rawDefault)) {
      continue;
    }
    const date = calendarDate(param.rawDefault) ?? calendarDate(param.default);
    if (!date || Date.now() - date.getTime() <= STALE_DATE_MS) {
      continue;
    }
    if (param.fillBlocked?.reason === 'quickpoll-survey-date') {
      hints.push({
        action: `pick a current ${param.field} in Marquee`,
        command: `marquee browser open @${namespace}`,
      });
      continue;
    }
    hints.push({
      action: `refresh ${param.field} from ${date.toISOString().slice(0, 10)}`,
      command: `marquee marketview widget view @${namespace} -p ${param.refKey ?? param.field}=0b`,
    });
  }
  return hints;
}

export function widgetPresentationProjection(
  result: WidgetResult<RenderedWidget>,
): WidgetPresentationProjection | undefined {
  if (!result.ok || result.value.detail !== 'full') return undefined;
  return {
    widget: result.value.widget,
    data: widgetExecutionProjection(result.value.execution),
  };
}

function nonEmptyStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 ? value.map(String) : undefined;
}

function widgetPresentation(
  widget: WidgetRenderValue,
  configurationId: string | undefined,
): WidgetPresentation {
  return {
    title: widget.title,
    widgetId: widget.widgetId,
    authors: widget.authors,
    access: widget.access,
    configurationId: widget.configurationId ?? configurationId,
    selectedContext: widget.selectedContext ?? undefined,
    chartId: typeof widget.chartId === 'string' ? widget.chartId : undefined,
    params: [...widget.parameters],
    description: widget.description || undefined,
    tags: nonEmptyStrings(widget.tags),
    sources: nonEmptyStrings(widget.sources),
    dashboards: widget.dashboards,
  };
}

function widgetAuditFromOutcome(
  outcome: MarketViewOperationOutcome<MarketViewWidgetGetValue, MarketViewWidgetGetError>,
): WidgetCallLog | undefined {
  const value = [...outcome.evidence].reverse().find((entry) => (
    entry.owner === 'widget' && entry.operation === 'get'
  ))?.value;
  return isObject(value) && Array.isArray(value.calls)
    ? value as WidgetCallLog
    : undefined;
}

function writeWidgetFacadeError(
  error: Exclude<MarketViewWidgetGetError, { kind: 'widget' }>,
  deps: RenderMarketviewWidgetDeps,
): void {
  if (error.kind === 'invalid-widget-id') {
    writeMarketViewErrorLine(deps, `Error: ${widgetIdValidationMessage(error.input)}`);
    return;
  }
  if (error.kind === 'artifact-not-found') {
    writeMarketViewRefError(deps, formatUnknownMarketViewRef(error.ref, error.availableRefs));
    return;
  }
  writeWrongMarketViewRef(deps, error.ref, error.artifact);
}

type WidgetFailure = Extract<MarketViewWidgetResult['result'], { ok: false }>['error'];

function requireWidgetAudit(
  outcome: MarketViewOperationOutcome<MarketViewWidgetGetValue, MarketViewWidgetGetError>,
): MarketViewWidgetResult['audit'] {
  const audit = widgetAuditFromOutcome(outcome);
  if (!audit) throw new Error('MarketView Widget outcome is missing provider evidence');
  return audit;
}

function writeWidgetFailure(
  error: WidgetFailure,
  audit: MarketViewWidgetResult['audit'],
  options: RenderMarketviewWidgetOptions,
  deps: RenderMarketviewWidgetDeps,
): void {
  const presented = presentWidgetError(error, audit);
  let message = presented.message;
  if (options.isSnippet) {
    if (options.configId && (
      error.kind === 'configuration-mismatch' || audit.failure?.path === undefined
    )) {
      message = `Adapter "marketview.widget-snippet" failed: ${message}`;
    }
  } else if ((options.paramOverrides ?? []).length > 0 && (
    audit.calls.length > 0
    || (error.kind === 'invalid-input' && error.problem === 'incompatible-dependent-input')
  )) {
    message = withMutationFallback(message, options.mutationFallbackRef);
  }
  writeMarketViewErrorLine(deps, `Error: ${message}`, exitCodeForWidgetError(error));
}

function writeWidgetSnippet(
  value: MarketViewWidgetGetValue['widget'],
  ns: string,
  deps: RenderMarketviewWidgetDeps,
): void {
  if (value.detail !== 'snippet') {
    writeMarketViewErrorLine(deps, 'Error: Widget snippet unavailable');
    return;
  }
  deps.write(renderText([{
    type: 'table',
    ...WIDGET_SNIPPET_TABLE,
    rows: [widgetSnippetRow(ns, value.snippet)],
  }]));
}

export async function renderMarketviewWidgetTab(
  outcome: MarketViewOperationOutcome<MarketViewWidgetGetValue, MarketViewWidgetGetError>,
  options: RenderMarketviewWidgetOptions,
  deps: RenderMarketviewWidgetDeps,
): Promise<void> {
  const { write } = deps;
  if (!outcome.result.ok) {
    const error = outcome.result.error;
    if (error.kind === 'widget') {
      writeWidgetFailure(error.error, requireWidgetAudit(outcome), options, deps);
    } else {
      writeWidgetFacadeError(error, deps);
    }
    return;
  }
  requireWidgetAudit(outcome);
  const { widget, namespace: ns } = outcome.result.value;

  if (options.isSnippet) {
    writeWidgetSnippet(widget, ns, deps);
    return;
  }

  const view = widgetPresentationProjection({ ok: true, value: widget });
  if (!view) {
    writeMarketViewErrorLine(deps, 'Error: Widget view unavailable');
    return;
  }
  for (const echo of view.widget.inputEchoes ?? []) {
    deps.writeError(`${echo}\n`);
  }
  const presentation = widgetPresentation(view.widget, options.configId);

  if (options.json !== undefined) {
    const formatted = await formatJsonFields(
      widgetRecord(presentation, ns, view.data?.rows ?? []),
      options,
    );
    if (!formatted.ok) {
      writeMarketViewErrorLine(deps, `Error: ${formatted.error}`);
      return;
    }
    write(`${formatted.output}\n`);
    return;
  }
  write(renderText(presentWidgetView({
    widget: presentation,
    ref: ns,
    ...(view.data === undefined ? {} : { chart: widgetChart(view.data.chart) }),
    hints: staleDateParamHints(presentation, ns),
  })));
}

function widgetChart(chart: WidgetExecutionProjection['chart']): WidgetChartText {
  if (chart.kind !== 'empty') return presentWidgetChart(chart);
  // Stryker disable next-line ArrayDeclaration: renderText prints a rowless table as "There are no rows" without its headers
  return { data: { headers: [], rows: [] }, message: chart.message };
}
