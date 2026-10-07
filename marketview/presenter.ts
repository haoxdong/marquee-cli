import type { MarketViewPresentationSink } from './presenters/types.js';
import { WIDGET_SNIPPET_TABLE, widgetSnippetRow } from './presenters/widget-snippet.js';
import type {
  ContextDashboardKind,
  DashboardPresentation,
  DashboardPresentationWidget,
} from './dashboard-presentation.js';
import {
  renderText,
  shellArgument,
  type TextBlock,
  type TextCell,
} from '../presentation/text.js';
import type {
  MarketViewDashboardGetError,
  MarketViewDashboardValue,
  MarketViewOperationOutcome,
  MarketViewProviderEvidence,
} from './index.js';
import { formatJsonFields, type JsonOutputOptions } from '../presentation/index.js';
import { presentDashboardReadError } from './presenters/dashboard-error.js';
import { writeMarketViewErrorLine } from './presenters/failure-semantics.js';
import {
  formatUnknownMarketViewRef,
  writeMarketViewRefError,
  writeWrongMarketViewRef,
} from './presenters/command-errors.js';
import type { WidgetCallLog } from './presenters/widget-evidence.js';

export interface DashboardFormatOptions {
  ns: string;
  cursor: { pageSize: number; total: number };
}

type DashboardTableRange = Readonly<{ title: string; startIndex: number; widgetCount: number; sectionIndex?: number }>;

/**
 * Dashboard view text (ADR 0070): fields, one widget table per section, hints.
 * Sections past the page print nothing; the `widgets` field says the page is cut.
 */
export function formatDashboardText(
  payload: DashboardPresentation,
  opts: DashboardFormatOptions,
): string {
  const { ns, cursor } = opts;
  const shown = Math.min(cursor.pageSize, cursor.total);
  const ranges = dashboardTableRanges(payload)
    .filter((range) => shown === cursor.total || range.startIndex < shown);
  const tables = ranges.map((range): TextBlock => {
    const start = range.startIndex;
    const end = Math.min(range.startIndex + range.widgetCount, shown);
    const rows = Array.from({ length: Math.max(end - start, 0) }, (_, offset) => (
      dashboardWidgetRow(presentedWidget(payload.widgets, start + offset), `${ns}.w${start + offset + 1}`)
    ));
    // A section's title carries its count once the page cuts it; the text layer omits an uncut count.
    return {
      type: 'table',
      title: range.title,
      ...(range.sectionIndex === undefined ? {} : { ref: `@${ns}.s${range.sectionIndex + 1}` }),
      ...WIDGET_SNIPPET_TABLE,
      ...(payload.sections === undefined ? {} : { count: { shown: rows.length, total: range.widgetCount } }),
      rows,
    };
  });
  return renderText([
    { type: 'field', key: 'title', value: payload.title },
    { type: 'field', key: 'ref', value: `@${ns}` },
    { type: 'field', key: 'url', value: payload.link },
    { type: 'field', key: 'tags', value: payload.tags },
    ...(payload.entityId
      ? [{ type: 'field', key: 'details', value: payload.identity ? payload.identity.split(' · ') : [] } as const]
      : []),
    {
      type: 'field',
      key: 'widgets',
      value: shown < cursor.total ? `${shown} of ${cursor.total}` : cursor.total,
    },
    ...tables,
    {
      type: 'hints',
      hints: [
        ...(shown < cursor.total
          ? [{ action: 'see more widgets', command: `marquee marketview dashboard view @${ns} -L ${cursor.total}` }]
          : []),
        { action: 'find widgets', command: `marquee marketview dashboard view @${ns} -S <query>` },
        ...(shown > 0
          ? [{ action: 'see all params, chart and data for a widget', command: 'marquee marketview widget view <ref>' }]
          : []),
      ],
    },
  ]);
}

/** Sections in page order, then any widgets outside them; a dashboard without sections has one `Widgets` table. */
function dashboardTableRanges(payload: DashboardPresentation): DashboardTableRange[] {
  const sections = payload.sections ?? [];
  const sectionedEnd = sections.reduce(
    (end, section) => Math.max(end, section.startIndex + section.widgetCount),
    0,
  );
  const unsectioned = Math.max(payload.total - sectionedEnd, 0);
  return [
    ...sections.map((section, sectionIndex) => ({ ...section, sectionIndex })),
    ...(sections.length === 0 || unsectioned > 0
      ? [{ title: 'Widgets', startIndex: sectionedEnd, widgetCount: unsectioned }]
      : []),
  ];
}

function dashboardWidgetRow(widget: DashboardPresentationWidget, ref: string): TextCell[] {
  if (!widget.snippet) {
    throw new Error(`Dashboard Widget ${widget.widgetId} is missing its authoritative snippet`);
  }
  return widgetSnippetRow(ref, widget.snippet);
}

export type RenderMarketviewDashboardOptions = JsonOutputOptions & {
  entityKind?: ContextDashboardKind;
};

export type RenderMarketviewDashboardDeps = MarketViewPresentationSink;

/** `marquee marketview dashboard view --json` fields. */
export const MARKETVIEW_DASHBOARD_VIEW_JSON_FIELDS = [
  'details',
  'ref',
  'sections',
  'tags',
  'title',
  'total',
  'url',
  'widgets',
] as const;

type DashboardRecordWidget = Readonly<{
  widget: DashboardPresentationWidget;
  index: number;
  ref: string;
  title: string;
}>;

/** The dashboard as its text prints it: the same widgets, with the same refs. */
function dashboardRecord(
  payload: DashboardPresentation,
  ns: string,
  total: number,
  shown: readonly DashboardRecordWidget[],
): Record<(typeof MARKETVIEW_DASHBOARD_VIEW_JSON_FIELDS)[number], unknown> {
  const ranges = dashboardTableRanges(payload);
  const widgets = shown.map(({ widget, index, ref, title }) => ({
    id: widget.widgetId,
    params: widget.snippet?.parameterLines,
    ref: `@${ref}`,
    // Ranges tile the widgets in order from 0, so the first range ending past the index holds it.
    section: ranges.find((range) => index < range.startIndex + range.widgetCount)?.title,
    title,
  }));
  return {
    details: payload.entityId && payload.identity ? payload.identity.split(' · ') : undefined,
    ref: `@${ns}`,
    sections: (payload.sections ?? []).map((section, index) => ({ ref: `@${ns}.s${index + 1}`, title: section.title })),
    tags: payload.tags,
    title: payload.title,
    total,
    url: payload.link,
    widgets,
  };
}

function presentedWidget(
  widgets: readonly DashboardPresentationWidget[],
  index: number,
): DashboardPresentationWidget {
  const widget = widgets[index];
  if (!widget) throw new Error(`Dashboard presentation has no widget at position ${index + 1}`);
  return widget;
}

function pageRecordWidgets(
  payload: DashboardPresentation,
  opts: DashboardFormatOptions,
): DashboardRecordWidget[] {
  const shown = Math.min(opts.cursor.pageSize, opts.cursor.total);
  return Array.from({ length: shown }, (_, index) => {
    const widget = presentedWidget(payload.widgets, index);
    if (!widget.snippet) {
      throw new Error(`Dashboard Widget ${widget.widgetId} is missing its authoritative snippet`);
    }
    return { widget, index, ref: `${opts.ns}.w${index + 1}`, title: widget.snippet.title };
  });
}

/** `-S` matches: dashboard view's widget table, one Widget Snippet row per match; no match prints nothing. */
function formatDashboardFilter(
  namespace: string,
  refinement: Extract<NonNullable<MarketViewDashboardValue['refinement']>, { kind: 'filter' }>,
  widgets: readonly DashboardPresentationWidget[],
): string {
  const { query, matches, totalMatches } = refinement;
  if (totalMatches === 0) return '';
  return renderText([
    {
      type: 'table',
      title: `Matches for "${query}"`,
      ...WIDGET_SNIPPET_TABLE,
      count: { shown: matches.length, total: totalMatches },
      rows: matches.map((match) => dashboardWidgetRow(presentedWidget(widgets, match.index), match.ref)),
    },
    {
      type: 'hints',
      hints: matches.length < totalMatches
        ? [{
            action: 'see more matches',
            command: `marquee marketview dashboard view @${namespace} -S ${shellArgument(query)} -L ${totalMatches}`,
          }]
        : [],
    },
  ]);
}

function presentDashboardGetError(
  error: MarketViewDashboardGetError,
  evidence: readonly MarketViewProviderEvidence[],
  deps: RenderMarketviewDashboardDeps,
): void {
  switch (error.kind) {
    case 'artifact-not-found':
      writeMarketViewRefError(
        deps,
        formatUnknownMarketViewRef(error.ref, error.availableRefs),
      );
      return;
    case 'wrong-artifact-kind':
      writeWrongMarketViewRef(deps, error.ref, error.artifact);
      return;
    case 'invalid-refinement':
      writeMarketViewRefError(
        deps,
        error.problem === 'empty-search'
          ? 'Error: -S requires a non-empty query'
          : 'Error: -S requires a dashboard ref such as @d1',
      );
      return;
    case 'artifact-payload-not-found':
      writeMarketViewRefError(deps, `Error: ref @${error.ref} payload not cached. Re-run \`marquee marketview dashboard view <ID>\`.`);
      return;
    default: {
      const audit = evidence.find((entry) => (
        entry.owner === 'dashboard-widget' && entry.operation === 'hydrate'
      ))?.value as WidgetCallLog | undefined;
      const { message, exitCode } = presentDashboardReadError(
        error,
        audit,
        evidence,
      );
      writeMarketViewErrorLine(deps, `Error: ${message}`, exitCode);
    }
  }
}

export async function renderMarketviewDashboardTab(
  outcome: MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>,
  options: RenderMarketviewDashboardOptions,
  deps: RenderMarketviewDashboardDeps,
): Promise<void> {
  const { write } = deps;
  const result = outcome.result;
  if (!result.ok) {
    presentDashboardGetError(result.error, outcome.evidence, deps);
    return;
  }

  const { artifact, refinement } = result.value;
  const window = result.value.window as DashboardPresentation;
  const format = { ns: artifact.namespace, cursor: artifact.root.cursor };

  if (options.json !== undefined) {
    const shown = refinement?.kind === 'filter'
      ? refinement.matches.map((match) => ({
          widget: presentedWidget(window.widgets, match.index),
          index: match.index,
          ref: match.ref,
          title: match.title,
        }))
      : pageRecordWidgets(window, format);
    const formatted = await formatJsonFields(
      dashboardRecord(window, format.ns, format.cursor.total, shown),
      options,
    );
    if (!formatted.ok) {
      writeMarketViewErrorLine(deps, `Error: ${formatted.error}`);
      return;
    }
    write(`${formatted.output}\n`);
    return;
  }

  if (refinement?.kind === 'filter') {
    write(formatDashboardFilter(artifact.namespace, refinement, window.widgets));
    return;
  }

  write(formatDashboardText(window, format));
}
