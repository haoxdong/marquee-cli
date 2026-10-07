import { MarketViewApi } from '../../api/marketview/index.js';
import { WidgetApi } from '../../api/widget/index.js';
import type { DashboardReadError } from '../dashboard-presentation.js';
import type { MarketViewErrorPresentation } from './types.js';
import { presentDashboardWidgetError } from './dashboard-widget-error.js';
import type { WidgetCallLog } from './widget-evidence.js';
import { dashboardProviderDiagnostic } from './dashboard-provider-evidence.js';
import {
  exitCodeForDashboardError,
  exitCodeForDashboardPreferencesError,
  exitCodeForEntityError,
  exitCodeForEntityFeedError,
} from './failure-semantics.js';

function requestDiagnostic(
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
  owner: string,
  operation: string,
): string | undefined {
  return dashboardProviderDiagnostic(
    evidence,
    (entry) => entry.owner === owner && entry.operation === operation,
  );
}

function dashboardFailureMessage(
  error: Extract<DashboardReadError, { kind: 'dashboard' }>['error'],
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): string {
  const diagnostic = dashboardProviderDiagnostic(evidence);
  if (error.kind === 'not-found') return diagnostic ?? `dashboard ${error.dashboardId} not found`;
  if (error.kind === 'access-denied') {
    return diagnostic ?? `Access denied: dashboard ${error.dashboardId ?? ''}`.trim();
  }
  if (error.kind === 'invalid-dashboard') return error.reason;
  return diagnostic ?? 'Dashboard read failed';
}

function presentDashboardFailure(
  error: Extract<DashboardReadError, { kind: 'dashboard' }>['error'],
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): MarketViewErrorPresentation {
  const baseMessage = dashboardFailureMessage(error, evidence);
  const message = error.kind === 'invalid-dashboard'
    ? `Adapter "marketview.dashboard" failed: ${baseMessage.replace('Unsupported Dashboard', 'Unsupported dashboard')}; record a Scenario before accepting this fallback.`
    : baseMessage;
  return { message, exitCode: exitCodeForDashboardError(error) };
}

function presentEntityFeedFailure(
  error: Extract<DashboardReadError, { kind: 'entity-feed' }>['error'],
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): MarketViewErrorPresentation {
  const { method, path } = error.kind === 'dependency' && error.source === 'preferences'
    ? MarketViewApi.preferences
    : WidgetApi.widgets;
  const diagnostic = requestDiagnostic(evidence, 'entity-feed.request', `${method} ${path}`);
  const message = diagnostic ?? (error.kind === 'invalid-feed'
    ? error.problem === 'response'
      ? 'Malformed Entity Feed response'
      : 'Malformed Entity Feed Widget entry'
    : error.failure.kind === 'authentication-required'
      ? `Not authenticated. Run: marquee auth login at upstream path ${path}`
      : 'Entity Feed read failed');
  return { message, exitCode: exitCodeForEntityFeedError(error) };
}

function presentDashboardPreferencesFailure(
  error: Extract<DashboardReadError, { kind: 'dashboard-preferences' }>['error'],
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): MarketViewErrorPresentation {
  const { method, path } = MarketViewApi.preferences;
  const diagnostic = requestDiagnostic(evidence, 'dashboard-preferences.request', `${method} ${path}`);
  const message = diagnostic ?? (error.kind === 'invalid-response'
    ? error.problem === 'response'
      ? 'Malformed Dashboard preferences response'
      : 'Malformed Dashboard preference pin'
    : error.failure.kind === 'authentication-required'
      ? `Not authenticated. Run: marquee auth login at upstream path ${path}`
      : 'Dashboard preferences read failed');
  return { message, exitCode: exitCodeForDashboardPreferencesError(error) };
}

function presentEntityFailure(
  failure: Extract<DashboardReadError, { kind: 'entity' }>,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): MarketViewErrorPresentation {
  const message = failure.error.kind === 'dependency'
    && failure.error.failure.kind === 'authentication-required'
    ? dashboardProviderDiagnostic(evidence, (entry) => entry.owner === 'entity.request')
      ?? 'Not authenticated. Run: marquee auth login'
    : `Entity resolution failed: ${failure.error.kind}`;
  return { message, exitCode: exitCodeForEntityError(failure.error) };
}

export function presentDashboardReadError(
  failure: DashboardReadError,
  audit?: WidgetCallLog,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0] = [],
): MarketViewErrorPresentation {
  if (failure.kind === 'widget') {
    return presentDashboardWidgetError(
      failure.error,
      audit,
      failure.presentation,
    );
  }
  if (failure.kind === 'unresolved') {
    return {
      message: `could not resolve dashboard "${failure.identifier}"; use a Dashboard ID, alias, or MarketView Search result Ref`,
      exitCode: 1,
    };
  }
  if (failure.kind === 'entity-not-found') {
    return { message: `could not resolve dashboard "${failure.identifier}"`, exitCode: 1 };
  }
  if (failure.kind === 'entity') return presentEntityFailure(failure, evidence);
  if (failure.kind === 'dashboard') {
    return presentDashboardFailure(failure.error, evidence);
  }
  if (failure.kind === 'entity-feed') return presentEntityFeedFailure(failure.error, evidence);
  return presentDashboardPreferencesFailure(failure.error, evidence);
}
