import type {
  DashboardPresentationWidget,
  DashboardReadError,
} from './dashboard-presentation.js';
import type { MarketViewWidgetOperations } from './dashboard-widget-operations.js';

type DashboardWidgetReadError = Extract<DashboardReadError, { kind: 'widget' }>;

/** Widgets rendered concurrently; larger windows render batch after batch. */
const DASHBOARD_ENRICHMENT_BATCH = 20;

class DashboardWidgetFailure extends Error {
  constructor(readonly failure: DashboardWidgetReadError) {
    super('Dashboard Widget operation failed');
  }
}

async function enrichWidgetViaRender(
  widget: DashboardPresentationWidget,
  operations: MarketViewWidgetOperations,
): Promise<DashboardWidgetReadError | undefined> {
  if (!widget.widgetDefinition) {
    throw new Error('Direct Product Surface Widget rendering is not configured');
  }
  const result = await operations.renderDashboardWidget(
    widget.widgetDefinition,
    widget.widgetParameterOverrides ?? [],
    widget.selectedContext ?? null,
    widget.widgetDates,
  );
  if (!result.ok) {
    return {
      kind: 'widget',
      action: 'widget-snippet',
      error: result.error,
      ...(result.presentation ? { presentation: result.presentation } : {}),
    };
  }
  if (result.value.configurationId) {
    widget.configurationId = result.value.configurationId;
  }
  widget.snippet = result.value.snippet;
  return undefined;
}

export async function enrichDashboardWidgets(
  widgets: DashboardPresentationWidget[],
  operations: MarketViewWidgetOperations,
): Promise<DashboardWidgetReadError | undefined> {
  const candidates = widgets.filter((widget) => !widget.snippet);
  const run = async (widget: DashboardPresentationWidget) => {
    const error = await enrichWidgetViaRender(widget, operations);
    if (error) throw new DashboardWidgetFailure(error);
  };
  try {
    for (let offset = 0; offset < candidates.length; offset += DASHBOARD_ENRICHMENT_BATCH) {
      const batch = candidates.slice(offset, offset + DASHBOARD_ENRICHMENT_BATCH);
      // eslint-disable-next-line no-await-in-loop -- bounds concurrency to one batch of widgets at a time
      await Promise.all(batch.map(run));
    }
  } catch (error) {
    if (error instanceof DashboardWidgetFailure) return error.failure;
    throw error;
  }
  return undefined;
}
