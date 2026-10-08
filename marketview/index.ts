import type {
  MarketViewDashboardCreateValue,
  MarketViewDashboardEditValue,
  MarketViewDashboardCreateError,
  MarketViewDashboardEditError,
} from './types.js';
export type {
  MarketViewDashboardCreateValue,
  MarketViewDashboardEditEntry,
  MarketViewDashboardEditValue,
  MarketViewDashboardCreateError,
  MarketViewDashboardEditError,
} from './types.js';
import type { ArtifactRef, ArtifactRegistry, PaginatedCursor, Ref } from '../artifact-registry/index.js';
import type {
  Dashboard,
  DashboardError,
  DashboardModule,
} from '../dashboard/index.js';
import type { EntityError, EntityModule } from '../entity/index.js';
import type { ControlGroupModule } from '../control-group/index.js';
import type {
  EntityFeed,
  EntityFeedError,
  EntityFeedModule,
  EntityFeedPageReader,
} from '../entity-feed/index.js';
import type { Transport } from '../transport/index.js';
import type {
  WidgetModule,
  RenderedWidget,
  WidgetError,
  WidgetId,
  ConfigId,
} from '../widget/index.js';
import { createWidget } from '../widget/index.js';
import { parseWidgetId } from '../widget/identifiers.js';
import {
  createMarketViewCore,
  isMarketViewDashboardArtifactPayload,
  type MarketViewDashboardArtifactPayload,
} from './facade.js';
import {
  createMarketViewSearch,
  type MarketViewSearchError as MarketViewSearchOperationError,
  type MarketViewSearchInput,
  type MarketViewSearchPage,
} from './search/index.js';
import { createMarketViewWidget, type MarketViewWidget } from './widget.js';
import {
  createMarketViewDashboardCreation,
} from './dashboard-create.js';
import {
  createMarketViewDashboardEdit,
} from './dashboard-edit.js';
import {
  createWidgetEvidenceRecorder,
} from './presenters/widget-evidence.js';
import {
  observeDashboardWidgetOperations,
} from './presenters/dashboard-widget-evidence.js';
import type { WidgetCallLog } from './presenters/widget-evidence.js';
import { prepareWidgetRef } from './adapters/ref-load.js';
import {
  createDashboardPreferencesReader,
} from './adapters/dashboard-preferences.js';
import {
  filterStoredDashboard,
  type StoredDashboardFilterError,
} from './dashboard-filter.js';
import type { ContextDashboardKind, DashboardReadError } from './dashboard-presentation.js';

type MarketViewWidgetGetInput = Readonly<{
  target: string;
  configurationId?: string;
  selectedContext?: string;
  overrides: readonly Readonly<{ field: string; value: string }>[];
  detail: 'snippet' | 'full';
}>;

type MarketViewDashboardGetInput = Readonly<{
  target: string;
  search?: string;
  limit?: number;
}>;

type MarketViewDashboardEditInput = Readonly<{
  target: string;
  addWidgetRefs: readonly string[];
  removeWidgetRefs: readonly string[];
  addSectionNames: readonly string[];
  removeSectionRefs: readonly string[];
  order?: string;
}>;

type MarketViewDashboardCreateInput = Readonly<{
  name: string;
  widgetRefs: readonly string[];
}>;

type MarketViewResult<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type MarketViewProviderEvidence = Readonly<{
  order: number;
  owner: string;
  operation: string;
  outcome: 'dispatched' | 'succeeded' | 'failed' | 'cancelled';
  value?: unknown;
}>;

export type MarketViewOperationOutcome<T, E> = Readonly<{
  result: MarketViewResult<T, E>;
  evidence: readonly MarketViewProviderEvidence[];
}>;

export type MarketViewWidgetGetValue = Readonly<{
  widget: RenderedWidget;
  namespace: string;
}>;

export type MarketViewWidgetGetError =
  | Readonly<{ kind: 'invalid-widget-id'; input: string }>
  | Readonly<{ kind: 'artifact-not-found'; ref: string; availableRefs: readonly string[] }>
  | Readonly<{ kind: 'wrong-artifact-kind'; ref: string; artifact: ArtifactRef }>
  | Readonly<{ kind: 'widget'; error: WidgetError }>;

export type MarketViewDashboardGetError =
  | Readonly<{ kind: 'artifact-not-found'; ref: string; availableRefs: readonly string[] }>
  | Readonly<{ kind: 'wrong-artifact-kind'; ref: string; artifact: ArtifactRef }>
  | Readonly<{
      kind: 'invalid-refinement';
      problem: 'empty-search' | 'ref-required';
  }>
  | Readonly<{ kind: 'artifact-payload-not-found'; ref: string }>
  | Readonly<{ kind: 'dashboard'; error: DashboardError }>
  | Readonly<{ kind: 'entity'; error: EntityError }>
  | Readonly<{
      kind: 'entity-not-found';
      entityKind: 'asset' | 'country' | 'portfolio';
      identifier: string;
    }>
  | Readonly<{ kind: 'entity-feed'; error: EntityFeedError }>
  | Readonly<{
      kind: 'dashboard-preferences';
      error:
        | Readonly<{
            kind: 'dependency';
            failure:
              | Readonly<{
                  kind: 'authentication-required';
                  realm: 'marquee' | 'research';
                }>
              | Readonly<{ kind: 'rate-limited'; retryAfterMs?: number }>
              | Readonly<{ kind: 'timeout' }>
              | Readonly<{ kind: 'cancelled' }>
              | Readonly<{ kind: 'unavailable' }>;
          }>
        | Readonly<{
            kind: 'invalid-response';
            problem: 'response' | 'pin-entry';
          }>;
    }>
  | Readonly<{ kind: 'unresolved'; identifier: string }>
  | Readonly<{
      kind: 'widget';
      action: 'widget-snippet';
      error: WidgetError;
    }>;

export type MarketViewSearchError = MarketViewSearchOperationError;

export type MarketViewSearchValue =
  Readonly<{
    kind: 'search';
    search: Readonly<{
      page: MarketViewSearchPage;
      artifact?: Readonly<{ namespace: string; searchUrl: string }>;
    }>;
  }>;

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
  entityKind?: 'asset' | 'country' | 'portfolio' | 'thematic';
  entityIdentity?: Readonly<Record<string, unknown>>;
  author: string | null;
  description: string | null;
  tags: string[];
  link: string;
  total: number;
  pageSize?: number;
  widgets: MarketViewDashboardWindowWidget[];
  sections?: Array<Readonly<{
    title: string;
    widgetCount: number;
    startIndex: number;
    sectionId?: string;
  }>>;
};

type MarketViewDashboardArtifact = Readonly<{
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

type MarketViewDashboardFilterMatch = Readonly<{
  /** Position of the matched widget in the dashboard's widget window. */
  index: number;
  ref: string;
  title: string;
}>;

type MarketViewDashboardRefinement =
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
      artifact: MarketViewDashboardArtifact;
      refinement?: MarketViewDashboardRefinement;
    }>
  | Readonly<{
      kind: 'entity-feed';
      entityFeed: EntityFeed;
      window: MarketViewDashboardWindow;
      artifact: MarketViewDashboardArtifact;
      refinement?: MarketViewDashboardRefinement;
    }>;

export interface MarketView {
  search(input: MarketViewSearchInput): Promise<
    MarketViewOperationOutcome<MarketViewSearchValue, MarketViewSearchError>
  >;
  widget: Readonly<{
    get(input: MarketViewWidgetGetInput): Promise<
      MarketViewOperationOutcome<MarketViewWidgetGetValue, MarketViewWidgetGetError>
    >;
  }>;
  dashboard: Readonly<{
    get(input: MarketViewDashboardGetInput): Promise<
      MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>
    >;
    edit(input: MarketViewDashboardEditInput): Promise<
      MarketViewOperationOutcome<MarketViewDashboardEditValue, MarketViewDashboardEditError>
    >;
    create(input: MarketViewDashboardCreateInput): Promise<
      MarketViewOperationOutcome<MarketViewDashboardCreateValue, MarketViewDashboardCreateError>
    >;
  }>;
}

export interface MarketViewConfig {
  controlGroup: ControlGroupModule;
  dashboard: DashboardModule;
  entity: EntityModule;
  entityFeed: EntityFeedModule;
  readEntityFeedPage: EntityFeedPageReader;
  registry: ArtifactRegistry;
  searchRequester: ReturnType<Transport['provider']>;
  dashboardPreferencesRequester: ReturnType<Transport['provider']>;
  widgetTransport: Pick<Transport, 'request'>;
  widget?: WidgetModule;
  evidence?: Readonly<{
    reserve?(
      call: Readonly<{ owner: string; operation: string }>,
      signal?: AbortSignal,
    ): Readonly<{
      succeed(value?: unknown): void;
      fail(value?: unknown): void;
      cancel(value?: unknown): void;
    }> | undefined;
    snapshot(): readonly MarketViewProviderEvidence[];
  }>;
}

async function withEvidence<T, E>(
  evidence: MarketViewConfig['evidence'],
  operation: () => Promise<MarketViewResult<T, E>>,
): Promise<MarketViewOperationOutcome<T, E>> {
  const start = evidence?.snapshot().length ?? 0;
  const result = await operation();
  const entries = evidence?.snapshot().slice(start) ?? [];
  return Object.freeze({
    result,
    evidence: Object.freeze([...entries]),
  });
}

type ResolvedWidgetTarget = Readonly<{
  widgetId: WidgetId;
  configurationId?: ConfigId | undefined;
  selectedContext?: string | undefined;
}>;

async function resolveWidgetTarget(
  input: MarketViewWidgetGetInput,
  config: Pick<MarketViewConfig, 'entity' | 'registry'>,
): Promise<MarketViewResult<ResolvedWidgetTarget, MarketViewWidgetGetError>> {
  // An explicit --config is not pattern-checked: Marquee's config-detail read
  // validates it and fails loud (Contract widget-explicit-config-intent).
  const configurationId = input.configurationId as ConfigId | undefined;
  if (!input.target.startsWith('@')) {
    const widgetId = parseWidgetId(
      config.entity.resolveCanonicalIdentity(input.target),
    );
    return widgetId
      ? { ok: true, value: { widgetId, configurationId } }
      : { ok: false, error: { kind: 'invalid-widget-id', input: input.target } };
  }
  const refName = config.registry.refName(input.target);
  const ref = config.registry.resolveRef(refName);
  if (!ref) {
    return {
      ok: false,
      error: {
        kind: 'artifact-not-found',
        ref: refName,
        availableRefs: Object.keys(config.registry.getAllRefs()),
      },
    };
  }
  if (ref.type !== 'widget') {
    return { ok: false, error: { kind: 'wrong-artifact-kind', ref: refName, artifact: ref } };
  }
  const prepared = await prepareWidgetRef(ref, configurationId);
  return {
    ok: true,
    value: {
      widgetId: prepared.widgetId,
      configurationId: prepared.configId,
      selectedContext: prepared.contextIdentity,
    },
  };
}

function widgetAuditEvidence(
  evidence: readonly MarketViewProviderEvidence[],
  audit: WidgetCallLog,
  isSuccess: boolean,
): readonly MarketViewProviderEvidence[] {
  return Object.freeze([
    ...evidence,
    Object.freeze({
      order: nextEvidenceOrder(evidence),
      owner: 'widget',
      operation: 'get',
      outcome: isSuccess ? 'succeeded' as const : 'failed' as const,
      value: audit,
    }),
  ]);
}

async function getMarketViewWidget(
  input: MarketViewWidgetGetInput,
  dependencies: Readonly<{
    config: MarketViewConfig;
    widget: MarketViewWidget;
  }>,
): Promise<MarketViewOperationOutcome<MarketViewWidgetGetValue, MarketViewWidgetGetError>> {
  const start = dependencies.config.evidence?.snapshot().length ?? 0;
  const resolved = await resolveWidgetTarget(input, dependencies.config);
  // Resolving a Widget target reads only the Artifact Registry, so it records no provider evidence.
  if (!resolved.ok) return Object.freeze({ result: resolved, evidence: Object.freeze([]) });
  const target = resolved.value;
  const execution = await dependencies.widget.get({
    widgetId: target.widgetId,
    configurationId: target.configurationId ?? null,
    selectedContext: input.selectedContext ?? target.selectedContext ?? null,
    parameters: [...input.overrides],
    detail: input.detail,
  });
  const providerEvidence = dependencies.config.evidence?.snapshot().slice(start) ?? [];
  const evidence = widgetAuditEvidence(providerEvidence, execution.audit, execution.result.ok);
  if (!execution.result.ok) {
    return Object.freeze({
      result: { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence,
    });
  }
  const namespace = dependencies.config.registry.claimWidget();
  const configured = execution.result.value.widget;
  dependencies.config.registry.setRefs(namespace, {
    [namespace]: {
      type: 'widget',
      widgetId: configured.widgetId,
      configurationId: configured.configurationId ?? null,
      selectedContext: configured.selectedContext ?? null,
    },
  });
  return Object.freeze({
    result: {
      ok: true,
      value: {
        widget: execution.result.value,
        namespace,
      },
    },
    evidence,
  });
}

type DashboardTarget = Readonly<{
  identifier: string;
  entityKind?: ContextDashboardKind;
  /** A `-S` search of a Dashboard Ref. */
  refinement?: DashboardRefinementTarget;
}>;

type DashboardRefinementTarget = Readonly<{
  search: string;
  refName: Ref;
  ref: Extract<ArtifactRef, { type: 'dashboard' | 'entity-feed' }>;
}>;

function resolveDashboardTarget(
  input: MarketViewDashboardGetInput,
  config: Pick<MarketViewConfig, 'entity' | 'registry'>,
): MarketViewResult<DashboardTarget, MarketViewDashboardGetError> {
  if (input.search !== undefined && !input.search.trim()) {
    return { ok: false, error: { kind: 'invalid-refinement', problem: 'empty-search' } };
  }
  if (input.search !== undefined && !input.target.startsWith('@')) {
    return { ok: false, error: { kind: 'invalid-refinement', problem: 'ref-required' } };
  }
  if (!input.target.startsWith('@')) {
    return {
      ok: true,
      value: { identifier: config.entity.resolveCanonicalIdentity(input.target) },
    };
  }
  const refName = config.registry.refName(input.target);
  const ref = config.registry.resolveRef(refName);
  if (!ref) {
    return {
      ok: false,
      error: {
        kind: 'artifact-not-found',
        ref: refName,
        availableRefs: Object.keys(config.registry.getAllRefs()),
      },
    };
  }
  if (ref.type !== 'dashboard' && ref.type !== 'entity-feed') {
    return { ok: false, error: { kind: 'wrong-artifact-kind', ref: refName, artifact: ref } };
  }
  return {
    ok: true,
    value: {
      ...(ref.type === 'dashboard'
        ? { identifier: ref.dashboardId }
        : { identifier: ref.entityId, entityKind: ref.entityKind }),
      ...(input.search === undefined ? {} : { refinement: { search: input.search, refName, ref } }),
    },
  };
}

function storedDashboardValue(
  stored: Readonly<{
    ref: Extract<ArtifactRef, { type: 'dashboard' | 'entity-feed' }>;
    namespace: string;
    cursor: PaginatedCursor;
    payload: MarketViewDashboardArtifactPayload;
  }>,
  refinement: MarketViewDashboardRefinement,
): MarketViewDashboardValue {
  const window = stored.payload.window;
  const artifact = Object.freeze({
    namespace: stored.namespace,
    root: stored.ref.type === 'dashboard'
      ? {
          type: 'dashboard' as const,
          dashboardId: stored.ref.dashboardId,
          cursor: stored.cursor,
        }
      : {
          type: 'entity-feed' as const,
          entityId: stored.ref.entityId,
          entityKind: stored.ref.entityKind,
          cursor: stored.cursor,
        },
  });
  if (stored.payload.kind === 'dashboard') {
    return {
      kind: 'dashboard',
      dashboard: stored.payload.dashboard,
      window,
      artifact,
      refinement,
    };
  }
  return {
    kind: 'entity-feed',
    entityFeed: stored.payload.entityFeed,
    window,
    artifact,
    refinement,
  };
}

function evidenceSince(
  config: MarketViewConfig,
  start: number,
): readonly MarketViewProviderEvidence[] {
  return Object.freeze([...(config.evidence?.snapshot().slice(start) ?? [])]);
}

function nextEvidenceOrder(evidence: readonly MarketViewProviderEvidence[]): number {
  return evidence.reduce((highest, entry) => Math.max(highest, entry.order), 0) + 1;
}

function publicDashboardError(
  error: MarketViewDashboardGetError | StoredDashboardFilterError,
): MarketViewDashboardGetError {
  if (error.kind !== 'widget') return error;
  return {
    kind: 'widget',
    action: error.action,
    error: error.error,
  };
}

/**
 * Reads a Dashboard Ref whose payload is not cached back into its Artifact, returning the read's
 * failure. The read stores the root the Ref holds, since it reads by that root's ID.
 */
async function hydrateDashboardRefinementTarget(
  target: DashboardTarget,
  refinement: DashboardRefinementTarget,
  dependencies: Readonly<{
    application: ReturnType<typeof createMarketViewCore>;
    config: MarketViewConfig;
  }>,
): Promise<DashboardReadError | undefined> {
  const payload = dependencies.config.registry.getPayload(refinement.refName);
  if (isMarketViewDashboardArtifactPayload(payload)) return undefined;
  const hydrated = await dependencies.application.readDashboard({
    identifier: target.identifier,
    namespace: refinement.refName,
    ...(target.entityKind ? { entityKind: target.entityKind } : {}),
  });
  return hydrated.ok ? undefined : hydrated.error;
}

type DashboardGetDependencies = Readonly<{
  application: ReturnType<typeof createMarketViewCore>;
  config: MarketViewConfig;
  dashboardWidgets: ReturnType<typeof observeDashboardWidgetOperations>['operations'];
  readEntityFeedPage: EntityFeedPageReader;
}>;

async function filterMarketViewDashboard(
  query: string,
  limit: number | undefined,
  namespace: string,
  ref: Extract<ArtifactRef, { type: 'dashboard' | 'entity-feed' }>,
  start: number,
  dependencies: DashboardGetDependencies,
): Promise<MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>> {
  const filtered = await filterStoredDashboard(namespace, query, {
    registry: dependencies.config.registry,
    readEntityFeedPage: dependencies.readEntityFeedPage,
    widgets: dependencies.dashboardWidgets,
  }, limit);
  const evidence = evidenceSince(dependencies.config, start);
  if (!filtered.ok) {
    return Object.freeze({
      result: { ok: false, error: publicDashboardError(filtered.error) },
      evidence,
    });
  }
  const refinement: MarketViewDashboardRefinement = {
    kind: 'filter',
    query,
    matches: filtered.value.matches,
    totalMatches: filtered.value.totalMatches,
  };
  const value = storedDashboardValue({
    ref,
    namespace,
    cursor: filtered.value.payload.cursor,
    payload: filtered.value.payload,
  }, refinement);
  return Object.freeze({ result: { ok: true, value }, evidence });
}

async function searchMarketViewDashboard(
  limit: number | undefined,
  target: DashboardTarget,
  refinement: DashboardRefinementTarget,
  start: number,
  dependencies: DashboardGetDependencies,
): Promise<MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>> {
  const failure = await hydrateDashboardRefinementTarget(target, refinement, dependencies);
  if (failure) {
    return Object.freeze({
      result: { ok: false, error: publicDashboardError(failure) },
      evidence: evidenceSince(dependencies.config, start),
    });
  }
  return filterMarketViewDashboard(
    refinement.search,
    limit,
    refinement.refName,
    refinement.ref,
    start,
    dependencies,
  );
}

async function getMarketViewDashboard(
  input: MarketViewDashboardGetInput,
  dependencies: DashboardGetDependencies,
): Promise<MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>> {
  const start = dependencies.config.evidence?.snapshot().length ?? 0;
  const target = resolveDashboardTarget(input, dependencies.config);
  // Resolving a Dashboard target reads only the Artifact Registry, so it records no provider evidence.
  if (!target.ok) return Object.freeze({ result: target, evidence: Object.freeze([]) });
  if (target.value.refinement) {
    return searchMarketViewDashboard(
      input.limit,
      target.value,
      target.value.refinement,
      start,
      dependencies,
    );
  }
  const read = {
    identifier: target.value.identifier,
    ...(target.value.entityKind ? { entityKind: target.value.entityKind } : {}),
    detail: 'snippet' as const,
  };
  const result = await dependencies.application.readDashboard(
    input.limit === undefined ? read : { ...read, limit: input.limit },
  );
  const providerEvidence = dependencies.config.evidence?.snapshot().slice(start) ?? [];
  const audit = !result.ok
    ? dependencies.application.dashboardWidgetEvidence?.(result.error)
    : undefined;
  return Object.freeze({
    result: result.ok
      ? result
      : { ok: false, error: publicDashboardError(result.error) },
    evidence: Object.freeze([
      ...providerEvidence,
      ...(audit
        ? [{
            order: nextEvidenceOrder(providerEvidence),
            owner: 'dashboard-widget',
            operation: 'hydrate',
            outcome: 'failed' as const,
            value: audit,
          }]
        : []),
    ]),
  });
}

function operationSearchInput(input: MarketViewSearchInput): MarketViewSearchInput {
  return {
    query: input.query,
    selectors: [...input.selectors],
    limit: input.limit,
  };
}

function publicSearchError(error: MarketViewSearchOperationError): MarketViewSearchError {
  switch (error.kind) {
    case 'discovery-failed':
    case 'widget-hydration-failed':
      return error;
    default:
      return { kind: error.kind };
  }
}

function searchFailureReferenceEvidence(
  operation: Awaited<ReturnType<ReturnType<typeof createMarketViewCore>['search']>>,
  providerEvidence: readonly MarketViewProviderEvidence[],
): MarketViewProviderEvidence[] {
  if (operation.ok || operation.evidence?.kind !== 'discovery-call') return [];
  const providerCall = providerEvidence.filter((entry) => (
    entry.owner === 'marketview-search'
    && entry.operation === 'GET /v1/marketview/search'
  ))[operation.evidence.index];
  return [{
    order: nextEvidenceOrder(providerEvidence),
    owner: 'marketview-search',
    operation: 'failure-reference',
    outcome: 'succeeded',
    value: {
      kind: 'discovery-failure-reference',
      selectors: [...operation.evidence.selectors],
      ...(providerCall ? { providerEvidenceOrder: providerCall.order } : {}),
    },
  }];
}

async function searchMarketView(
  input: MarketViewSearchInput,
  dependencies: Readonly<{
    application: ReturnType<typeof createMarketViewCore>;
    config: MarketViewConfig;
  }>,
): Promise<MarketViewOperationOutcome<MarketViewSearchValue, MarketViewSearchError>> {
  const start = dependencies.config.evidence?.snapshot().length ?? 0;
  const operationInput = operationSearchInput(input);
  const operation = await dependencies.application.search(operationInput);
  const providerEvidence = dependencies.config.evidence?.snapshot().slice(start) ?? [];
  const failureReferenceEvidence = searchFailureReferenceEvidence(operation, providerEvidence);
  const presentationEvidence = operation.ok
    ? [{
        order: nextEvidenceOrder(providerEvidence),
        owner: 'marketview-search',
        operation: 'presentation',
        outcome: 'succeeded' as const,
        value: operation.value.presentation,
      }]
    : [];
  const evidence = Object.freeze([
    ...providerEvidence,
    ...failureReferenceEvidence,
    ...presentationEvidence,
  ]);
  if (!operation.ok) {
    return Object.freeze({
      result: { ok: false, error: publicSearchError(operation.error) },
      evidence,
    });
  }
  return Object.freeze({
    result: {
      ok: true,
      value: {
        kind: 'search',
        search: {
          page: operation.value.page,
          ...(operation.value.artifact ? { artifact: operation.value.artifact } : {}),
        },
      },
    },
    evidence,
  });
}

export function createMarketView(config: MarketViewConfig): MarketView {
  const recordSearchFailure = (
    owner: string,
    operation: string,
    value: unknown,
  ): void => {
    config.evidence?.reserve?.({ owner, operation })?.fail(value);
  };
  const recorder = createWidgetEvidenceRecorder(config.widgetTransport);
  const widget = config.widget
    ?? createWidget(recorder.port, {
      controlGroup: config.controlGroup,
      entity: config.entity,
    });
  const marketViewWidget = createMarketViewWidget(
    widget,
    recorder,
  );
  const dashboardWidgets = observeDashboardWidgetOperations(
    widget,
    recorder,
  );
  const search = createMarketViewSearch({
    requester: config.searchRequester,
    widget,
    recordAdapterFailure: (operation, value) => {
      recordSearchFailure('marketview-search.adapter', operation, value);
    },
  });
  const application = createMarketViewCore({
    dashboard: config.dashboard,
    entity: config.entity,
    entityFeed: config.entityFeed,
    dashboardPreferences: createDashboardPreferencesReader(
      config.dashboardPreferencesRequester,
    ),
    registry: config.registry,
    search,
    dashboardWidgets: dashboardWidgets.operations,
    dashboardWidgetEvidence: dashboardWidgets.evidence,
    recordSearchFailure: (operation, value) => {
      recordSearchFailure('marketview-search', operation, value);
    },
  });
  const dashboardCreation = createMarketViewDashboardCreation({
    dashboard: config.dashboard,
    registry: config.registry,
  });
  const dashboardEdit = createMarketViewDashboardEdit({
    dashboard: config.dashboard,
    registry: config.registry,
  });
  return Object.freeze({
    search: (input: MarketViewSearchInput) => searchMarketView(input, {
      application,
      config,
    }),
    widget: Object.freeze({
      get: (input: MarketViewWidgetGetInput) => getMarketViewWidget(input, {
        config,
        widget: marketViewWidget,
      }),
    }),
    dashboard: Object.freeze({
      get: (input: MarketViewDashboardGetInput) => getMarketViewDashboard(input, {
        application,
        config,
        dashboardWidgets: dashboardWidgets.operations,
        readEntityFeedPage: config.readEntityFeedPage,
      }),
      edit: (input: MarketViewDashboardEditInput) => withEvidence(
        config.evidence,
        () => dashboardEdit.edit({
          target: input.target,
          addWidgetRefs: input.addWidgetRefs,
          removeWidgetRefs: input.removeWidgetRefs,
          addSectionNames: input.addSectionNames,
          removeSectionRefs: input.removeSectionRefs,
          ...(input.order === undefined
            ? {}
            : {
                orderRefs: input.order
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              }),
        }),
      ),
      create: (input: MarketViewDashboardCreateInput) => withEvidence(
        config.evidence,
        () => dashboardCreation.create(input),
      ),
    }),
  });
}
