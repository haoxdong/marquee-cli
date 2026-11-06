import type { Result } from '../lib/result.js';
import type { MarketViewDashboardValue } from './types.js';
import type { ReferentRegistry } from '../referent-registry/index.js';
import type { DashboardModule } from '../dashboard/index.js';
import type { EntityFeedModule } from '../entity-feed/index.js';
import type { EntityModule } from '../entity/index.js';
import {
  readMarketViewDashboard,
} from './dashboard.js';
import type {
  ContextDashboardKind,
  DashboardReadError,
} from './dashboard-presentation.js';
import {
  type MarketViewSearch,
  type MarketViewSearchInput,
  type MarketViewSearchOutcome,
  type MarketViewSearchValue as MarketViewSearchApplicationValue,
} from './search/index.js';
import type { MarketViewWidgetOperations } from './dashboard-widget-operations.js';
import {
  marketViewSearchReferent,
  marketViewSearchBrowserTargets,
  marketViewSearchRefs,
  type MarketViewSearchPresentation,
} from './presenters/referent-policy.js';
import { dashboardReferentRefs } from './dashboard-referent-policy.js';
import { isObject } from './is-object.js';
import { compactDashboardReferentPayload, type MarketViewDashboardReferentPayload } from './dashboard-referent-payload.js';
export type { MarketViewDashboardReferentPayload } from './dashboard-referent-payload.js';

export function isMarketViewDashboardReferentPayload(
  value: unknown,
): value is MarketViewDashboardReferentPayload {
  if (!isObject(value) || !isObject(value.cursor)) return false;
  const { cursor } = value;
  return 'window' in value
    && typeof value.browserTarget === 'string'
    && value.browserTarget.length > 0
    && typeof cursor.page === 'number'
    && typeof cursor.pageSize === 'number'
    && typeof cursor.total === 'number'
    && ((value.kind === 'dashboard' && 'dashboard' in value)
      || (value.kind === 'entity-feed' && 'entityFeed' in value));
}

type MarketViewDashboardInput = Readonly<{
  identifier: string;
  entityKind?: ContextDashboardKind;
  namespace?: string;
  detail?: 'snippet' | 'raw';
  limit?: number;
}>;

type MarketViewSearchReferent = Readonly<{
  namespace: string;
  searchUrl: string;
}>;

type MarketViewSearchValue = Readonly<{
  page: MarketViewSearchApplicationValue['page'];
  presentation: MarketViewSearchPresentation;
  referent?: MarketViewSearchReferent;
}>;

export type DashboardReferentDependencies = Readonly<{
  dashboard: DashboardModule;
  entity: Pick<EntityModule, 'resolveIdentity'>;
  entityFeed: EntityFeedModule;
  dashboardWidgets: MarketViewWidgetOperations;
  registry: ReferentRegistry;
}>;

export async function readDashboardReferent(
  input: MarketViewDashboardInput,
  dependencies: DashboardReferentDependencies,
): Promise<Result<MarketViewDashboardValue, DashboardReadError>> {
  const result = await readMarketViewDashboard(input, {
    widgets: dependencies.dashboardWidgets,
    dashboard: dependencies.dashboard,
    entity: dependencies.entity,
    entityFeed: dependencies.entityFeed,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const namespace = input.namespace ?? dependencies.registry.claimDashboard();
  const root = result.root;
  const { cursor, ...registryRoot } = root;
  dependencies.registry.storeReferent({
    namespace,
    root: registryRoot,
    payload: compactDashboardReferentPayload(result.kind === 'dashboard'
      ? {
          kind: 'dashboard',
          dashboard: result.dashboard,
          window: result.window,
          cursor,
          browserTarget: result.window.link,
        } satisfies MarketViewDashboardReferentPayload
      : {
          kind: 'entity-feed',
          entityFeed: result.entityFeed,
          window: result.window,
          cursor,
          browserTarget: result.window.link,
        } satisfies MarketViewDashboardReferentPayload),
  });
  dependencies.registry.setRefs(
    namespace,
    dashboardReferentRefs(
      result.window,
      namespace,
      result.kind === 'dashboard' ? result.dashboard.dashboardId : undefined,
      cursor,
    ),
  );
  const referent = Object.freeze({
    namespace,
    root,
  });
  return {
    ok: true,
    value: result.kind === 'dashboard'
      ? {
          kind: 'dashboard',
          dashboard: result.dashboard,
          window: result.window,
          referent,
        }
      : {
          kind: 'entity-feed',
          entityFeed: result.entityFeed,
          window: result.window,
          referent,
        },
  };
}

export async function searchReferent(
  input: MarketViewSearchInput,
  dependencies: Readonly<{
    search: MarketViewSearch;
    registry: ReferentRegistry;
    recordSearchFailure?(operation: 'referent-policy', value: unknown): void;
  }>,
): Promise<MarketViewSearchOutcome<MarketViewSearchValue>> {
  const result = await dependencies.search.search(input);
  if (!result.ok) return result;
  const entries = [...result.value.page.results];
  const presentation = Object.freeze({ entries: Object.freeze([...result.value.resultMetadata]) });
  let referent: MarketViewSearchReferent;
  try {
    const namespace = dependencies.registry.claimSearch();
    const searchReferent = marketViewSearchReferent(input);
    dependencies.registry.storeReferent({
      namespace,
      root: searchReferent.root,
      payload: {
        entries,
        query: input.query,
        url: searchReferent.searchUrl,
        browserTarget: searchReferent.searchUrl,
        browserTargets: marketViewSearchBrowserTargets(presentation, namespace),
        continuation: result.value.page.continuation,
      },
    });
    dependencies.registry.setRefs(
      namespace,
      marketViewSearchRefs(
        presentation,
        namespace,
      ),
    );
    referent = Object.freeze({
      namespace,
      searchUrl: searchReferent.searchUrl,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'MarketView Search referent policy failed';
    dependencies.recordSearchFailure?.('referent-policy', {
      kind: 'referent-policy-failure',
      message,
    });
    return {
      ok: false,
      error: { kind: 'referent-policy-failed' },
    };
  }
  return {
    ok: true,
    value: {
      page: { ...result.value.page, results: entries },
      presentation,
      referent,
    },
  };
}
