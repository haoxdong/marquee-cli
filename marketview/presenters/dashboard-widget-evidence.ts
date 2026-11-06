import { presentDashboardWidgetError } from './dashboard-widget-error.js';
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

  async function record(
    run: () => ReturnType<MarketViewWidgetOperations['renderDashboardWidget']>,
  ): ReturnType<MarketViewWidgetOperations['renderDashboardWidget']> {
    const { result, audit } = await recorder.record('read', run);
    if (!result.ok) {
      failures.set(result.error, audit);
      return { ...result, presentation: presentDashboardWidgetError(result.error, audit, result.presentation) };
    }
    return result;
  }

  return {
    operations: {
      renderDashboardWidget: (...args) => record(() => semantic.renderDashboardWidget(...args)),
    },
    evidence: {
      auditFor: (error) => failures.get(error),
    },
  };
}
