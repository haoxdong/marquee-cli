import type {
  ArtifactRef,
  ArtifactRegistry,
} from '../artifact-registry/index.js';
import type { DashboardModule } from '../dashboard/index.js';
import type { EntityFeedModule } from '../entity-feed/index.js';
import type { EntityFeed } from '../entity-feed/index.js';
import type { EntityModule } from '../entity/index.js';
import type { DashboardPreferencesReader } from './adapters/dashboard-preferences.js';
import {
  readMarketViewDashboard,
  type DashboardRoot,
} from './dashboard.js';
import type {
  ContextDashboardKind,
  DashboardPresentation,
  DashboardReadError,
} from './dashboard-presentation.js';
import {
  type MarketViewSearch,
  type MarketViewSearchError,
  type MarketViewSearchInput,
  type MarketViewSearchOutcome,
  type MarketViewSearchValue as MarketViewSearchApplicationValue,
} from './search/index.js';
import type { MarketViewWidgetOperations } from './dashboard-widget-operations.js';
import type {
  DashboardWidgetEvidence,
} from './presenters/dashboard-widget-evidence.js';
import type { WidgetCallLog } from './presenters/widget-evidence.js';
import {
  marketViewSearchArtifact,
  marketViewSearchBrowserTargets,
  marketViewSearchRefs,
  type MarketViewSearchPresentation,
} from './presenters/artifact-policy.js';
import { dashboardArtifactRefs } from './dashboard-artifact-policy.js';
import { isObject } from './is-object.js';
import { compactDashboardArtifactPayload, type MarketViewDashboardArtifactPayload } from './dashboard-artifact-payload.js';
export type { MarketViewDashboardArtifactPayload } from './dashboard-artifact-payload.js';

type MarketViewDashboardArtifact = Readonly<{
  namespace: string;
  root: DashboardRoot;
}>;


export function isMarketViewDashboardArtifactPayload(
  value: unknown,
): value is MarketViewDashboardArtifactPayload {
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

export type MarketViewDashboardFilterMatch = Readonly<{
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

type MarketViewDashboardValue =
  | Readonly<{
      kind: 'dashboard';
      dashboard: import('../dashboard/index.js').Dashboard;
      window: DashboardPresentation;
      artifact: MarketViewDashboardArtifact;
      refinement?: MarketViewDashboardRefinement;
    }>
  | Readonly<{
      kind: 'entity-feed';
      entityFeed: EntityFeed;
      window: DashboardPresentation;
      artifact: MarketViewDashboardArtifact;
      refinement?: MarketViewDashboardRefinement;
    }>;

type MarketViewDashboardResult =
  | Readonly<{ ok: true; value: MarketViewDashboardValue }>
  | Readonly<{ ok: false; error: DashboardReadError }>;

type MarketViewDashboardInput = Readonly<{
  identifier: string;
  entityKind?: ContextDashboardKind;
  namespace?: string;
  detail?: 'snippet' | 'raw';
  limit?: number;
}>;

type MarketViewResult<T> =
  | Readonly<{ ok: true; value: T; evidence?: unknown }>
  | Readonly<{
      ok: false;
      error: MarketViewSearchError;
      evidence?: Extract<
        MarketViewSearchOutcome<never>,
        { ok: false }
      >['evidence'];
    }>;

type MarketViewSearchArtifact = Readonly<{
  namespace: string;
  searchUrl: string;
}>;

type MarketViewSearchValue = Readonly<{
  page: MarketViewSearchApplicationValue['page'];
  presentation: MarketViewSearchPresentation;
  artifact?: MarketViewSearchArtifact;
}>;

function searchPresentation(
  value: MarketViewSearchApplicationValue,
): MarketViewSearchPresentation {
  return Object.freeze({ entries: Object.freeze([...value.resultMetadata]) });
}

export interface MarketViewCore {
  readDashboard(input: MarketViewDashboardInput): Promise<MarketViewDashboardResult>;
  dashboardWidgetEvidence?(error: DashboardReadError): WidgetCallLog | undefined;
  search(input: MarketViewSearchInput): Promise<MarketViewResult<MarketViewSearchValue>>;
}

export type MarketViewCoreDependencies = Readonly<{
  dashboard?: DashboardModule;
  entity?: Pick<EntityModule, 'resolveIdentity'>;
  entityFeed?: EntityFeedModule;
  dashboardPreferences?: DashboardPreferencesReader;
  dashboardWidgets?: MarketViewWidgetOperations;
  dashboardWidgetEvidence?: DashboardWidgetEvidence;
  recordSearchFailure?(operation: 'artifact-policy', value: unknown): void;
  search: MarketViewSearch;
  registry: ArtifactRegistry;
}>;

export function createMarketViewCore(
  dependencies: MarketViewCoreDependencies,
): MarketViewCore {
  const marketView: MarketViewCore = {
    async readDashboard(input: MarketViewDashboardInput): Promise<MarketViewDashboardResult> {
      if (!dependencies.dashboard
        || !dependencies.entity
        || !dependencies.entityFeed
        || !dependencies.dashboardWidgets) {
        throw new Error('MarketView Dashboard dependencies are not configured');
      }
      const result = await readMarketViewDashboard(input, {
        widgets: dependencies.dashboardWidgets,
        dashboard: dependencies.dashboard,
        entity: dependencies.entity,
        entityFeed: dependencies.entityFeed,
        dashboardPreferences: dependencies.dashboardPreferences,
      });
      if (!result.ok) return { ok: false, error: result.error };

      const namespace = input.namespace ?? dependencies.registry.claimDashboard();
      const root = result.root;
      const registryRoot: ArtifactRef = root.type === 'dashboard'
        ? { type: 'dashboard', dashboardId: root.dashboardId }
        : {
            type: 'entity-feed',
            entityId: root.entityId,
            entityKind: root.entityKind,
          };
      dependencies.registry.storeArtifact({
        namespace,
        root: registryRoot,
        payload: compactDashboardArtifactPayload(result.kind === 'dashboard'
          ? {
              kind: 'dashboard',
              dashboard: result.dashboard,
              window: result.window,
              cursor: root.cursor,
              browserTarget: result.window.link,
            } satisfies MarketViewDashboardArtifactPayload
          : {
              kind: 'entity-feed',
              entityFeed: result.entityFeed,
              window: result.window,
              cursor: root.cursor,
              browserTarget: result.window.link,
            } satisfies MarketViewDashboardArtifactPayload),
      });
      dependencies.registry.setRefs(
        namespace,
        dashboardArtifactRefs(
          result.window,
          namespace,
          result.kind === 'dashboard' ? result.dashboard.dashboardId : undefined,
          root.cursor,
        ),
      );
      const artifact = Object.freeze({
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
              artifact,
            }
          : {
              kind: 'entity-feed',
              entityFeed: result.entityFeed,
              window: result.window,
              artifact,
            },
      };
    },
    dashboardWidgetEvidence(error) {
      return error.kind === 'widget'
        ? dependencies.dashboardWidgetEvidence?.auditFor(error.error)
        : undefined;
    },
    async search(
      input: MarketViewSearchInput,
    ): Promise<MarketViewResult<MarketViewSearchValue>> {
      const result = await dependencies.search.search(input);
      if (!result.ok) return result;
      const entries = [...result.value.page.results];
      const presentation = searchPresentation(result.value);
      let artifact: MarketViewSearchArtifact;
      try {
        const namespace = dependencies.registry.claimSearch();
        const searchArtifact = marketViewSearchArtifact(input);
        dependencies.registry.storeArtifact({
          namespace,
          root: searchArtifact.root,
          payload: {
            entries,
            query: input.query,
            url: searchArtifact.searchUrl,
            browserTarget: searchArtifact.searchUrl,
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
        artifact = Object.freeze({
          namespace,
          searchUrl: searchArtifact.searchUrl,
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'MarketView Search artifact policy failed';
        dependencies.recordSearchFailure?.('artifact-policy', {
          kind: 'artifact-policy-failure',
          message,
        });
        return {
          ok: false,
          error: { kind: 'artifact-policy-failed' },
        };
      }
      return {
        ok: true,
        value: {
          page: { ...result.value.page, results: entries },
          presentation,
          artifact,
        },
      };
    },
  };
  return Object.freeze(marketView);
}
