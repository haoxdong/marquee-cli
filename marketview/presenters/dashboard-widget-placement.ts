import type { DashboardError } from '../../dashboard/index.js';

type DashboardWidgetPlacementError = Extract<
  DashboardError,
  { kind: 'invalid-widget-placement' }
>;

export function dashboardWidgetPlacementText(
  error: DashboardWidgetPlacementError,
): string {
  switch (error.problem) {
    case 'configuration-not-found':
      return `Widget configuration ${error.configurationId} was not found`;
    case 'invalid-identity':
      return 'Configured Widget identity is invalid for Dashboard placement';
    case 'malformed-binding':
      return 'Widget configuration contains a malformed parameter binding';
    case 'unsupported-configuration':
      return 'Widget configuration cannot be projected for Dashboard placement';
  }
}
