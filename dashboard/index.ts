import type { Transport } from '../transport/index.js';
import { createDashboardProductionPort } from './adapters/production.js';
import { createDashboardModuleFromPort } from './module.js';
import type {
  DashboardConfiguredWidgetProjection,
  DashboardModule,
} from './types.js';
export type {
  DashboardWidgetArtifact,
  Dashboard,
  CreatedDashboard,
  DashboardError,
  DashboardResult,
  DashboardEditTarget,
  DashboardChange,
  DashboardEditOutcome,
  DashboardModule,
} from './types.js';

export function createDashboardModule(
  transport: Pick<Transport, 'request'>,
  projection: DashboardConfiguredWidgetProjection,
): DashboardModule {
  return createDashboardModuleFromPort(createDashboardProductionPort(transport, projection));
}
