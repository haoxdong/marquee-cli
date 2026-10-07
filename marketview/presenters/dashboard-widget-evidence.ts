import type { WidgetError } from '../../widget/index.js';
import {
  createMarketViewWidgetOperations,
  type MarketViewWidgetOperations,
} from '../dashboard-widget-operations.js';
import type {
  WidgetCallLog,
  WidgetEvidenceRecorder,
} from './widget-evidence.js';

export interface DashboardWidgetEvidence {
  auditFor(error: WidgetError): WidgetCallLog | undefined;
}

export function observeDashboardWidgetOperations(
  widget: Parameters<typeof createMarketViewWidgetOperations>[0],
  recorder: WidgetEvidenceRecorder,
): {
  operations: MarketViewWidgetOperations;
  evidence: DashboardWidgetEvidence;
} {
  const semantic = createMarketViewWidgetOperations(widget);
  const failures = new WeakMap<WidgetError, WidgetCallLog>();

  async function record<T extends { ok: boolean; error?: WidgetError }>(
    run: () => Promise<T>,
  ): Promise<T> {
    const { result, audit } = await recorder.record('read', run);
    if (!result.ok && result.error) failures.set(result.error, audit);
    return result;
  }

  return {
    operations: {
      renderDashboardWidget: (
        widgetDefinition,
        parameters,
        selectedContext,
        widgetDates,
      ) => record(
        () => semantic.renderDashboardWidget(
          widgetDefinition,
          parameters,
          selectedContext,
          widgetDates,
        ),
      ),
    },
    evidence: {
      auditFor: (error) => failures.get(error),
    },
  };
}
