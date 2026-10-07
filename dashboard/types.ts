import type {
  ConfigId,
  WidgetDefinition,
  WidgetDates,
  WidgetParameterOverride,
  WidgetId,
} from '../widget/index.js';

export type DashboardKind = 'personal' | 'custom' | 'thematic';

export type DashboardPermissions = Readonly<{
  viewers: readonly string[];
  editors: readonly string[];
  administrators: readonly string[];
}>;

type DashboardWidgetIdentity = Readonly<{
  widgetId: WidgetId;
  configurationId?: ConfigId;
}>;

export type DashboardWidgetArtifact = Readonly<{
  widgetId: WidgetId;
  configurationId?: ConfigId;
  selectedContext?: string;
}>;

type DashboardDependencyFailure =
  | { kind: 'authentication-required'; realm: 'marquee' | 'research' }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };

type DashboardWidgetParameterDefinition = Readonly<Record<string, unknown> & {
  field: string;
}>;

type DashboardWidgetChild = Readonly<{
  kind: 'widget';
  childId: string;
  rank: number;
  widget: DashboardWidgetIdentity;
  widgetDefinition?: WidgetDefinition;
  widgetParameterOverrides?: readonly WidgetParameterOverride[];
  selectedContext?: string;
  widgetDates?: WidgetDates;
  name?: string;
  renderTargetId?: string;
  visualizationKind?: string;
  configurationParameters?: readonly Readonly<{ field: string; value: unknown }>[];
  parameterDefinitions?: readonly DashboardWidgetParameterDefinition[];
  parameters: readonly Readonly<{ field: string; value: unknown }>[];
  renderParameters?: Readonly<Record<string, unknown>>;
  contextParameter?: Readonly<Record<string, unknown>>;
}>;

type DashboardTextChild = Readonly<{
  kind: 'text';
  childId: string;
  rank: number;
  text: string;
}>;

export type DashboardChild = DashboardWidgetChild | DashboardTextChild;

export type DashboardSection = Readonly<{
  sectionId: string;
  name: string;
  rank: number;
  childIds: readonly string[];
}>;

export type Dashboard = Readonly<{
  dashboardId: string;
  name: string;
  kind: DashboardKind;
  author?: string;
  description?: string;
  tags: readonly string[];
  permissions: DashboardPermissions;
  children: readonly DashboardChild[];
  sections: readonly DashboardSection[];
  link: string;
}>;

export type CreatedDashboard = Readonly<Pick<Dashboard, 'dashboardId' | 'name' | 'link'>>;

export type DashboardSummary = Readonly<Pick<Dashboard, 'dashboardId' | 'name'> & {
  kind?: DashboardKind;
}>;

export type DashboardError =
  | { kind: 'not-found'; dashboardId: string }
  | { kind: 'access-denied'; dashboardId?: string }
  | { kind: 'dependency'; failure: DashboardDependencyFailure }
  | { kind: 'write-failed'; failure: DashboardDependencyFailure; isAmbiguous: boolean }
  | { kind: 'invalid-dashboard'; reason: string }
  | { kind: 'invalid-name'; name: string }
  | { kind: 'invalid-widget'; widget: Partial<DashboardWidgetArtifact> }
  | {
      kind: 'invalid-widget-placement';
      configurationId: string;
      problem:
        | 'configuration-not-found'
        | 'invalid-identity'
        | 'malformed-binding'
        | 'unsupported-configuration';
    }
  | { kind: 'dashboard-exists'; name: string; matches: readonly DashboardSummary[] }
  | { kind: 'lookup-failed'; name: string; failure: DashboardDependencyFailure }
  | { kind: 'create-failed'; name: string; failure: DashboardDependencyFailure }
  | { kind: 'ambiguous-creation'; name: string }
  | { kind: 'missing-created-id'; name: string }
  | { kind: 'permission-denied'; dashboardId: string }
  | { kind: 'invalid-mutation'; reason: string }
  | { kind: 'verification-failed'; cause: DashboardError; writeError?: DashboardError }
  | { kind: 'effect-not-observed'; reason: string };

export type DashboardResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DashboardError };

export type DashboardEditTarget = Readonly<{ kind: 'id'; dashboardId: string }>;

export type DashboardChange =
  | Readonly<{
      kind: 'remove-child';
      childId: string;
      widget?: DashboardWidgetArtifact;
      sectionId?: string;
    }>
  | Readonly<{ kind: 'remove-section'; sectionId: string }>
  | Readonly<{
      kind: 'add-widget';
      widget: DashboardWidgetArtifact;
      sectionId?: string;
      childId?: string;
    }>
  | Readonly<{ kind: 'add-section'; name: string }>
  | Readonly<{ kind: 'order-sections'; sectionIds: readonly string[] }>
  | Readonly<{
      kind: 'order-section-children';
      sectionId: string;
      childIds: readonly string[];
    }>;

export type DashboardOperationResult = Readonly<{
  change: DashboardChange;
  status: 'applied' | 'failed' | 'uncertain' | 'not-attempted';
  dashboard?: Dashboard;
  error?: DashboardError;
  note?: 'already-present';
}>;

export type DashboardEditOutcome = Readonly<{
  before: Dashboard;
  dashboard: Dashboard;
  results: readonly DashboardOperationResult[];
}>;

type DashboardCreateInput = Readonly<{
  name: string;
  widgets: readonly DashboardWidgetArtifact[];
}>;

export interface DashboardModule {
  get(dashboardId: string): Promise<DashboardResult<Dashboard>>;
  edit(
    target: DashboardEditTarget,
    changes: readonly DashboardChange[],
  ): Promise<DashboardResult<DashboardEditOutcome>>;
  create(input: DashboardCreateInput): Promise<DashboardResult<CreatedDashboard>>;
}

export type DashboardConfiguredWidgetProjection = {
  project(input: {
    widget: Readonly<{ widgetId: string; configurationId: string }>;
    purpose: 'create' | 'add';
  }): Promise<
    | {
        ok: true;
        value: Readonly<{
          widget: Readonly<{ widgetId: string; configurationId: string }>;
          bindings: readonly Readonly<{ field: string; value: unknown }>[];
          dateRangeOverride?: string;
        }>;
      }
    | {
        ok: false;
        error:
          | { kind: 'access-denied' }
          | { kind: 'not-found' }
          | { kind: 'dependency'; failure: DashboardDependencyFailure }
          | {
              kind: 'invalid-projection';
              problem: 'invalid-identity' | 'malformed-binding' | 'unsupported-configuration';
            };
      }
  >;
};
