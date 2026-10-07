import type { DashboardError } from '../../dashboard/index.js';
import { renderText } from '../../presentation/text.js';
import type {
  MarketViewDashboardEditEntry,
  MarketViewDashboardEditError,
  MarketViewDashboardEditValue,
  MarketViewOperationOutcome,
} from '../index.js';
import type { MarketViewDashboardEditResult } from '../types.js';
import { dashboardProviderDiagnostic } from './dashboard-provider-evidence.js';
import { dashboardWidgetPlacementText } from './dashboard-widget-placement.js';

export type MarketViewDashboardEditPresentation = Readonly<{
  text: string;
  exitCode?: 1 | 2 | 4;
}>;

function dependencyExitCode(error: DashboardError | undefined): 1 | 2 | 4 {
  if (error?.kind === 'verification-failed') return dependencyExitCode(error.cause);
  if (!error || !('failure' in error)) return 1;
  if (error.failure.kind === 'cancelled') return 2;
  return error.failure.kind === 'authentication-required' ? 4 : 1;
}

function dashboardErrorText(
  error: DashboardError,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0] = [],
): string {
  const diagnostic = dashboardProviderDiagnostic(evidence);
  switch (error.kind) {
    case 'permission-denied':
      return `permission denied for dashboard ${error.dashboardId}`;
    case 'invalid-mutation':
    case 'effect-not-observed':
      return error.reason;
    case 'verification-failed':
      return dashboardErrorText(error.cause, evidence);
    case 'not-found':
      return diagnostic ?? `dashboard ${error.dashboardId} not found`;
    case 'access-denied':
      return diagnostic ?? `permission denied for dashboard ${error.dashboardId ?? ''}`.trim();
    case 'dependency':
      return diagnostic ?? 'dashboard dependency failed';
    case 'write-failed':
      return diagnostic ?? 'dashboard write failed';
    case 'invalid-dashboard':
      return error.reason;
    case 'invalid-name':
      return 'dashboard name must not be empty';
    case 'invalid-widget':
      return 'configured widget identity requires MW and WC IDs';
    case 'invalid-widget-placement':
      return dashboardWidgetPlacementText(error);
    case 'dashboard-exists':
      return `dashboard "${error.name}" already exists`;
    case 'lookup-failed':
      return diagnostic ?? `dashboard lookup failed for ${error.name}`;
    case 'create-failed':
      return diagnostic ?? `failed to create dashboard ${error.name}`;
    case 'ambiguous-creation':
      return diagnostic ?? `dashboard ${error.name} creation outcome is uncertain`;
    case 'missing-created-id':
      return 'dashboard creation returned no id';
  }
}

function invalidInputPresentation(
  error: Extract<MarketViewDashboardEditError, { kind: 'invalid-input' }>,
): MarketViewDashboardEditPresentation {
  if (error.reason === 'blank-section') return { text: 'Error: section title must not be empty', exitCode: 1 };
  if (error.reason === 'empty-order') return { text: 'Error: --order requires a comma-separated list of refs', exitCode: 1 };
  if (error.reason === 'free-text-target') {
    return {
      text: `Error: dashboard edit does not accept free-text title "${error.targetLabel ?? ''}"; use a Dashboard ID, alias, or ref`,
      exitCode: 1,
    };
  }
  if (error.reason === 'section-add-section') {
    const target = error.targetLabel ? ` ${error.targetLabel}` : '';
    return {
      text: `Error: --add-section cannot target section${target}; target its dashboard instead`,
      exitCode: 1,
    };
  }
  return {
    text: 'Error: dashboard edit requires at least one --add-widget, --remove-widget, --add-section, --remove-section, or --order mutation',
    exitCode: 1,
  };
}

function errorPresentation(
  error: MarketViewDashboardEditError,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): MarketViewDashboardEditPresentation {
  if (error.kind === 'invalid-input') return invalidInputPresentation(error);
  if (error.kind === 'unknown-ref') {
    return {
      text: `Error: ref @${error.refName} not found\nHint: run the previous command again or use one of the refs printed above.`,
      exitCode: 1,
    };
  }
  if (error.kind === 'wrong-target') {
    return { text: `Error: @${error.refName} is not a dashboard or dashboard section ref`, exitCode: 1 };
  }
  if (error.kind === 'wrong-change-ref') {
    return { text: `Error: @${error.refName} is not a dashboard tile or section ref`, exitCode: 1 };
  }
  if (error.kind === 'foreign-ref') {
    return { text: `Error: @${error.refName} belongs to a different dashboard`, exitCode: 1 };
  }
  return {
    text: `Error: ${dashboardErrorText(error.error, evidence)}`,
    exitCode: dependencyExitCode(error.error),
  };
}

/** The Applied table's `result`: the status, with the reason when a change did not apply. */
function resultText(
  entry: MarketViewDashboardEditEntry,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): string {
  if (entry.error) return `${entry.status}: ${dashboardErrorText(entry.error, evidence)}`;
  return entry.note ?? entry.status;
}

function mutationExitCode(entries: readonly MarketViewDashboardEditEntry[]): 1 | 2 | 4 | undefined {
  const failures = entries.filter(({ status }) => status === 'failed' || status === 'uncertain');
  if (failures.some(({ error }) => dependencyExitCode(error) === 4)) return 4;
  if (failures.some(({ error }) => dependencyExitCode(error) === 2)) return 2;
  return failures.length > 0 ? 1 : undefined;
}

export function presentMarketViewDashboardEdit(
  result: MarketViewDashboardEditResult,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0] = [],
): MarketViewDashboardEditPresentation {
  if (!result.ok) return errorPresentation(result.error, evidence);
  const text = renderText([
    { type: 'field', key: 'ref', value: `@${result.value.ref}` },
    { type: 'field', key: 'url', value: result.value.dashboard.link },
    {
      type: 'table',
      title: 'Applied',
      noun: 'changes',
      headers: ['action', 'target', 'result'],
      rows: result.value.entries.map((entry) => [entry.action, entry.target, resultText(entry, evidence)]),
    },
  ]).trimEnd();
  const exitCode = mutationExitCode(result.value.entries);
  return { text, ...(exitCode !== undefined ? { exitCode } : {}) };
}

export function renderMarketViewDashboardEdit(
  outcome: MarketViewOperationOutcome<MarketViewDashboardEditValue, MarketViewDashboardEditError>,
): MarketViewDashboardEditPresentation {
  return presentMarketViewDashboardEdit(outcome.result, outcome.evidence);
}
