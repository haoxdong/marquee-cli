import type { DashboardError } from '../../dashboard/index.js';
import type {
  MarketViewDashboardCreateValue,
  MarketViewDashboardCreateError,
  MarketViewOperationOutcome,
} from '../index.js';
import type { MarketViewDashboardCreateResult } from '../types.js';
import { renderText } from '../../presentation/text.js';
import { dashboardProviderDiagnostic } from './dashboard-provider-evidence.js';
import { dashboardWidgetPlacementText } from './dashboard-widget-placement.js';

export type MarketViewDashboardCreatePresentation = {
  text: string;
  exitCode?: 1 | 2 | 4;
};

type DashboardDependencyFailure = Extract<DashboardError, { kind: 'dependency' }>['failure'];

function dependencyExitCode(failure: DashboardDependencyFailure): 1 | 2 | 4 {
  if (failure.kind === 'cancelled') return 2;
  return failure.kind === 'authentication-required' ? 4 : 1;
}

function withErrorPrefix(message: string): string {
  return /^Error:/i.test(message) ? message : `Error: ${message}`;
}

function dashboardError(
  error: DashboardError,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0],
): MarketViewDashboardCreatePresentation {
  const diagnostic = dashboardProviderDiagnostic(evidence);
  switch (error.kind) {
    case 'invalid-name':
      return { text: 'Error: dashboard name must not be empty', exitCode: 1 };
    case 'invalid-widget':
      return { text: 'Error: configured widget identity requires MW and WC IDs', exitCode: 1 };
    case 'invalid-widget-placement':
      return {
        text: `Error: ${dashboardWidgetPlacementText(error)}`,
        exitCode: 1,
      };
    case 'dashboard-exists':
      return {
        text: `Error: dashboard "${error.name}" already exists: ${error.matches
          .map((match) => `${match.name} (${match.dashboardId})`)
          .join(', ')}`,
        exitCode: 1,
      };
    case 'lookup-failed':
      return {
        text: `Error: could not verify existing dashboards titled "${error.name}" (${diagnostic ?? 'lookup failed'}); refusing to create a possible duplicate`,
        exitCode: dependencyExitCode(error.failure),
      };
    case 'access-denied':
      return { text: withErrorPrefix(diagnostic ?? 'permission denied while creating dashboard'), exitCode: 1 };
    case 'create-failed':
      return {
        text: withErrorPrefix(diagnostic ?? `failed to create dashboard ${error.name}`),
        exitCode: dependencyExitCode(error.failure),
      };
    case 'ambiguous-creation':
      return {
        text: withErrorPrefix(diagnostic ?? `dashboard ${error.name} creation outcome is uncertain`),
        exitCode: 1,
      };
    case 'missing-created-id':
      return { text: 'Unsupported dashboard create response shape: missing dashboard id', exitCode: 1 };
    case 'invalid-dashboard':
      return { text: error.reason, exitCode: 1 };
    case 'not-found':
      return { text: withErrorPrefix(diagnostic ?? `dashboard ${error.dashboardId} not found`), exitCode: 1 };
    case 'dependency':
      return {
        text: withErrorPrefix(diagnostic ?? 'dashboard dependency failed'),
        exitCode: dependencyExitCode(error.failure),
      };
    case 'write-failed':
      return {
        text: withErrorPrefix(diagnostic ?? 'dashboard write failed'),
        exitCode: dependencyExitCode(error.failure),
      };
    case 'permission-denied':
      return { text: `Error: permission denied for dashboard ${error.dashboardId}`, exitCode: 1 };
    case 'invalid-mutation':
    case 'effect-not-observed':
      return { text: withErrorPrefix(error.reason), exitCode: 1 };
    case 'verification-failed':
      return dashboardError(error.cause, evidence);
  }
}

const WRONG_ARTIFACT_GUIDANCE: Readonly<
  Record<Extract<MarketViewDashboardCreateError, { kind: 'wrong-artifact' }>['artifactType'], string>
> = {
  dashboard: ' — use `marquee marketview dashboard view ...`',
  'entity-feed': ' — use `marquee marketview dashboard view ...`',
  section: ' — use `marquee marketview dashboard edit ...`',
  document: ' — use `marquee content view ...`',
  search: ' — use the search result\'s Widget ref',
};

function wrongArtifact(error: Extract<MarketViewDashboardCreateError, { kind: 'wrong-artifact' }>): string {
  return `Error: ref @${error.refName} is a ${error.artifactType}${WRONG_ARTIFACT_GUIDANCE[error.artifactType]}`;
}

export function presentMarketViewDashboardCreate(
  result: MarketViewDashboardCreateResult,
  evidence: Parameters<typeof dashboardProviderDiagnostic>[0] = [],
): MarketViewDashboardCreatePresentation {
  if (result.ok) {
    return {
      text: renderText([
        { type: 'field', key: 'ref', value: `@${result.value.ref}` },
        { type: 'field', key: 'url', value: result.value.dashboard.link },
        { type: 'field', key: 'widgets', value: result.value.seededWidgetCount },
      ]).trimEnd(),
    };
  }
  if (result.error.kind === 'unknown-ref') {
    return {
      text: `Error: ref @${result.error.refName} not found\nHint: run the previous command again or use one of the refs printed above.`,
      exitCode: 1,
    };
  }
  if (result.error.kind === 'wrong-artifact') {
    return { text: wrongArtifact(result.error), exitCode: 1 };
  }
  return dashboardError(result.error.error, evidence);
}

export function renderMarketViewDashboardCreate(
  outcome: MarketViewOperationOutcome<
    MarketViewDashboardCreateValue,
    MarketViewDashboardCreateError
  >,
): MarketViewDashboardCreatePresentation {
  return presentMarketViewDashboardCreate(outcome.result, outcome.evidence);
}
