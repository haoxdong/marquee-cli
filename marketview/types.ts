import type { ArtifactRef } from '../artifact-registry/index.js';
import type { CreatedDashboard, Dashboard, DashboardChange, DashboardError } from '../dashboard/index.js';

type DashboardCreateOperationError =
  | { kind: 'unknown-ref'; refName: string }
  | { kind: 'wrong-artifact'; refName: string; artifactType: Exclude<ArtifactRef['type'], 'widget'> }
  | { kind: 'dashboard'; error: DashboardError };

export type MarketViewDashboardCreateResult =
  | { ok: true; value: { dashboard: CreatedDashboard; ref: string; seededWidgetCount: number } }
  | { ok: false; error: DashboardCreateOperationError };

type DashboardEditOperationError =
  | { kind: 'unknown-ref'; refName: string }
  | { kind: 'wrong-target'; refName: string; artifactType: ArtifactRef['type'] }
  | { kind: 'wrong-change-ref'; refName: string; artifactType: ArtifactRef['type'] }
  | { kind: 'foreign-ref'; refName: string; dashboardId: string }
  | {
      kind: 'invalid-input';
      reason: 'blank-section' | 'empty-order' | 'free-text-target' | 'no-mutations' | 'section-add-section';
      targetLabel?: string;
    }
  | { kind: 'dashboard'; error: DashboardError };

type DashboardEditOperationEntry = Readonly<{
  change: DashboardChange;
  action: string;
  target: string | readonly string[];
  status: 'applied' | 'failed' | 'uncertain' | 'not-attempted';
  note?: 'already-present';
  error?: DashboardError;
}>;

export type MarketViewDashboardEditResult =
  | {
      ok: true;
      value: {
        ref: string;
        dashboard: Dashboard;
        entries: readonly DashboardEditOperationEntry[];
      };
    }
  | { ok: false; error: DashboardEditOperationError };

export type MarketViewDashboardCreateValue = Readonly<
  Extract<MarketViewDashboardCreateResult, { ok: true }>['value']
>;

export type MarketViewDashboardEditEntry = MarketViewDashboardEditValue['entries'][number];

export type MarketViewDashboardEditValue = Readonly<
  Extract<MarketViewDashboardEditResult, { ok: true }>['value']
>;

export type MarketViewDashboardCreateError = Readonly<
  Extract<MarketViewDashboardCreateResult, { ok: false }>['error']
>;

export type MarketViewDashboardEditError = Readonly<
  Extract<MarketViewDashboardEditResult, { ok: false }>['error']
>;
