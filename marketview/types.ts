import type { EntityFeed } from '../entity-feed/index.js';
import type { ReferentRef } from '../referent-registry/index.js';
import type { CreatedDashboard, Dashboard, DashboardChange, DashboardError } from '../dashboard/index.js';

type DashboardCreateOperationError =
  | { kind: 'unknown-ref'; refName: string }
  | { kind: 'wrong-referent'; refName: string; referentType: Exclude<ReferentRef['type'], 'widget'> }
  | { kind: 'dashboard'; error: DashboardError };

export type MarketViewDashboardCreateResult =
  | { ok: true; value: { dashboard: CreatedDashboard; ref: string; seededWidgetCount: number } }
  | { ok: false; error: DashboardCreateOperationError };

type DashboardEditOperationError =
  | { kind: 'unknown-ref'; refName: string }
  | { kind: 'wrong-target'; refName: string; referentType: ReferentRef['type'] }
  | { kind: 'wrong-change-ref'; refName: string; referentType: ReferentRef['type'] }
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
  note?: 'already-present' | 'confirmed-by-re-read';
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

type MarketViewDashboardWindowWidget = Readonly<{
  widgetId: string;
  title: string;
  childId?: string;
  configurationId?: string | null;
  selectedContext?: string | null;
  snippet?: Readonly<{
    title: string;
    isTitleResolved: boolean;
    parameterLines: readonly string[];
  }>;
}>;

type MarketViewDashboardWindow = {
  title: string;
  identity?: string | null;
  entityId?: string | null;
  tags: string[];
  link: string;
  total: number;
  widgets: MarketViewDashboardWindowWidget[];
  sections?: Array<Readonly<{
    title: string;
    widgetCount: number;
    startIndex: number;
    sectionId?: string;
  }>>;
};

type MarketViewDashboardReferent = Readonly<{
  namespace: string;
  root:
    | Readonly<{
        type: 'dashboard';
        dashboardId: string;
        cursor: Readonly<{ page: number; pageSize: number; total: number }>;
      }>
    | Readonly<{
        type: 'entity-feed';
        entityId: string;
        entityKind: 'asset' | 'country' | 'portfolio';
        cursor: Readonly<{ page: number; pageSize: number; total: number }>;
      }>;
}>;

export type MarketViewDashboardFilterMatch = Readonly<{
  /** Position of the matched widget in the dashboard's widget window. */
  index: number;
  ref: string;
  title: string;
}>;

export type MarketViewDashboardRefinement =
  | Readonly<{
      kind: 'filter';
      query: string;
      matches: readonly MarketViewDashboardFilterMatch[];
      totalMatches: number;
    }>;

export type MarketViewDashboardValue =
  | Readonly<{
      kind: 'dashboard';
      dashboard: Dashboard;
      window: MarketViewDashboardWindow;
      referent: MarketViewDashboardReferent;
      refinement?: MarketViewDashboardRefinement;
    }>
  | Readonly<{
      kind: 'entity-feed';
      entityFeed: EntityFeed;
      window: MarketViewDashboardWindow;
      referent: MarketViewDashboardReferent;
      refinement?: MarketViewDashboardRefinement;
    }>;
