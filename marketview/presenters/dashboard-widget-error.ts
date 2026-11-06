import type { WidgetError } from '../../widget/index.js';
import type { MarketViewErrorPresentation } from './types.js';
import type { WidgetCallLog } from './widget-evidence.js';
import { presentWidgetError } from './widget-error.js';
import { exitCodeForWidgetError } from './failure-semantics.js';

export function presentDashboardWidgetError(
  error: WidgetError,
  audit?: WidgetCallLog,
  presentation?: { message: string },
): MarketViewErrorPresentation {
  return {
    message: presentation?.message ?? presentWidgetError(error, audit).message,
    exitCode: exitCodeForWidgetError(error),
  };
}
