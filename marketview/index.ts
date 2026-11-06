import type {
  MarketViewDashboardCreateValue,
  MarketViewDashboardEditValue,
  MarketViewDashboardCreateError,
  MarketViewDashboardEditError,
  MarketViewDashboardValue,
  MarketViewDashboardRefinement,
} from './types.js';
export type {
  MarketViewDashboardValue,
  MarketViewDashboardCreateValue,
  MarketViewDashboardEditEntry,
  MarketViewDashboardEditValue,
  MarketViewDashboardCreateError,
  MarketViewDashboardEditError,
} from './types.js';
import type { ReferentRef, ReferentRegistry, Ref } from '../referent-registry/index.js';
import type {
  DashboardError,
  DashboardModule,
} from '../dashboard/index.js';
import type { EntityError, EntityModule } from '../entity/index.js';
import type { ControlGroupModule } from '../control-group/index.js';
import type {
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
  readDashboardReferent,
  type DashboardReferentDependencies,
  searchReferent,
  isMarketViewDashboardReferentPayload,
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
import {
  filterStoredDashboard,
  type StoredDashboardFilterError,
} from './dashboard-filter.js';
import type { ContextDashboardKind } from './dashboard-presentation.js';

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
  | Readonly<{ kind: 'referent-not-found'; ref: string; availableRefs: readonly string[] }>
  | Readonly<{ kind: 'wrong-referent-kind'; ref: string; referent: ReferentRef }>
  | Readonly<{ kind: 'widget'; error: WidgetError }>;

export type MarketViewDashboardGetError =
  | Readonly<{ kind: 'referent-not-found'; ref: string; availableRefs: readonly string[] }>
  | Readonly<{ kind: 'wrong-referent-kind'; ref: string; referent: ReferentRef }>
  | Readonly<{
      kind: 'invalid-refinement';
      problem: 'empty-search' | 'ref-required';
  }>
  | Readonly<{ kind: 'referent-payload-not-found'; ref: string }>
  | Readonly<{ kind: 'dashboard'; error: DashboardError }>
  | Readonly<{ kind: 'entity'; error: EntityError }>
  | Readonly<{
      kind: 'entity-not-found';
      entityKind: 'asset' | 'country' | 'portfolio';
      identifier: string;
    }>
  | Readonly<{ kind: 'entity-feed'; error: EntityFeedError }>
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
      referent?: Readonly<{ namespace: string; searchUrl: string }>;
    }>;
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
  registry: ReferentRegistry;
  searchRequester: ReturnType<Transport['provider']>;
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
        kind: 'referent-not-found',
        ref: refName,
        availableRefs: Object.keys(config.registry.getAllRefs()),
      },
    };
  }
  if (ref.type !== 'widget') {
    return { ok: false, error: { kind: 'wrong-referent-kind', ref: refName, referent: ref } };
  }
  const configId = configurationId ?? ref.configurationId;
  return {
    ok: true,
    value: {
      widgetId: ref.widgetId,
      configurationId: configId ?? undefined,
      selectedContext: ref.selectedContext ?? undefined,
    },
  };
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
  if (!resolved.ok) return Object.freeze({ result: resolved, evidence: Object.freeze([]) });
  const target = resolved.value;
  const execution = await dependencies.widget.get({
    widgetId: target.widgetId,
    configurationId: target.configurationId ?? null,
    selectedContext: input.selectedContext ?? target.selectedContext ?? null,
    parameters: [...input.overrides],
    detail: input.detail,
  });
  const providerEvidence = evidenceSince(dependencies.config, start);
  const evidence = Object.freeze([
    ...providerEvidence,
    Object.freeze({
      order: nextEvidenceOrder(providerEvidence),
      owner: 'widget',
      operation: 'get',
      outcome: execution.result.ok ? 'succeeded' as const : 'failed' as const,
      value: execution.audit,
    }),
  ]);
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
  refinement?: DashboardRefinementTarget;
}>;

type DashboardRefinementTarget = Readonly<{
  search: string;
  refName: Ref;
  ref: Extract<ReferentRef, { type: 'dashboard' | 'entity-feed' }>;
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
        kind: 'referent-not-found',
        ref: refName,
        availableRefs: Object.keys(config.registry.getAllRefs()),
      },
    };
  }
  if (ref.type !== 'dashboard' && ref.type !== 'entity-feed') {
    return { ok: false, error: { kind: 'wrong-referent-kind', ref: refName, referent: ref } };
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

type DashboardGetDependencies = Readonly<{
  config: MarketViewConfig;
  dashboardReferents: DashboardReferentDependencies;
  dashboardWidgets: ReturnType<typeof observeDashboardWidgetOperations>['operations'];
  dashboardWidgetEvidence: ReturnType<typeof observeDashboardWidgetOperations>['evidence'];
  readEntityFeedPage: EntityFeedPageReader;
}>;

async function refineMarketViewDashboard(
  limit: number | undefined,
  target: DashboardTarget,
  { search: query, refName, ref }: DashboardRefinementTarget,
  start: number,
  dependencies: DashboardGetDependencies,
): Promise<MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>> {
  if (!isMarketViewDashboardReferentPayload(dependencies.config.registry.getPayload(refName))) {
    const hydrated = await readDashboardReferent({
      identifier: target.identifier,
      namespace: refName,
      ...(target.entityKind ? { entityKind: target.entityKind } : {}),
    }, dependencies.dashboardReferents);
    if (!hydrated.ok) {
      return Object.freeze({
        result: { ok: false, error: publicDashboardError(hydrated.error) },
        evidence: evidenceSince(dependencies.config, start),
      });
    }
  }
  const filtered = await filterStoredDashboard(refName, query, {
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
  const { payload, matches, totalMatches } = filtered.value;
  const refinement: MarketViewDashboardRefinement = { kind: 'filter', query, matches, totalMatches };
  const referent = Object.freeze({
    namespace: refName,
    root: ref.type === 'dashboard'
      ? { type: 'dashboard' as const, dashboardId: ref.dashboardId, cursor: payload.cursor }
      : { type: 'entity-feed' as const, entityId: ref.entityId, entityKind: ref.entityKind, cursor: payload.cursor },
  });
  const value: MarketViewDashboardValue = payload.kind === 'dashboard'
    ? { kind: 'dashboard', dashboard: payload.dashboard, window: payload.window, referent, refinement }
    : { kind: 'entity-feed', entityFeed: payload.entityFeed, window: payload.window, referent, refinement };
  return Object.freeze({ result: { ok: true, value }, evidence });
}

async function getMarketViewDashboard(
  input: MarketViewDashboardGetInput,
  dependencies: DashboardGetDependencies,
): Promise<MarketViewOperationOutcome<MarketViewDashboardValue, MarketViewDashboardGetError>> {
  const start = dependencies.config.evidence?.snapshot().length ?? 0;
  const target = resolveDashboardTarget(input, dependencies.config);
  if (!target.ok) return Object.freeze({ result: target, evidence: Object.freeze([]) });
  if (target.value.refinement) {
    return refineMarketViewDashboard(
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
  const result = await readDashboardReferent(
    input.limit === undefined ? read : { ...read, limit: input.limit },
    dependencies.dashboardReferents,
  );
  const providerEvidence = dependencies.config.evidence?.snapshot().slice(start) ?? [];
  const audit = !result.ok && result.error.kind === 'widget'
    ? dependencies.dashboardWidgetEvidence.auditFor(result.error.error)
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
  operation: Awaited<ReturnType<typeof searchReferent>>,
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
    config: MarketViewConfig;
    search: ReturnType<typeof createMarketViewSearch>;
  }>,
): Promise<MarketViewOperationOutcome<MarketViewSearchValue, MarketViewSearchError>> {
  const start = dependencies.config.evidence?.snapshot().length ?? 0;
  const operationInput = operationSearchInput(input);
  const operation = await searchReferent(operationInput, {
    search: dependencies.search,
    registry: dependencies.config.registry,
    recordSearchFailure: (operation, value) => {
      dependencies.config.evidence?.reserve?.({ owner: 'marketview-search', operation })?.fail(value);
    },
  });
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
          ...(operation.value.referent ? { referent: operation.value.referent } : {}),
        },
      },
    },
    evidence,
  });
}

export function createMarketView(config: MarketViewConfig): MarketView {
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
      config.evidence?.reserve?.({ owner: 'marketview-search.adapter', operation })?.fail(value);
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
      search,
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
        config,
        dashboardReferents: {
          dashboard: config.dashboard,
          entity: config.entity,
          entityFeed: config.entityFeed,
          registry: config.registry,
          dashboardWidgets: dashboardWidgets.operations,
        },
        dashboardWidgetEvidence: dashboardWidgets.evidence,
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
