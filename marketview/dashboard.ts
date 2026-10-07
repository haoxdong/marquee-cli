import type {
  Dashboard,
  DashboardModule,
} from '../dashboard/index.js';
import type {
  EntityFeedModule,
} from '../entity-feed/index.js';
import type { Entity, EntityModule } from '../entity/index.js';
import { prepareContextDashboardWidgets } from './dashboard-hydration.js';
import { resolveDashboardReadTarget } from './dashboard-resolution.js';
import {
  enrichDashboardWidgets,
} from './dashboard-widget-enrichment.js';
import type { MarketViewWidgetOperations } from './dashboard-widget-operations.js';
import {
  createEntityFeedDashboardWidgets,
  createSavedDashboardWidgets,
} from './dashboard-widget-projection.js';
import type {
  ContextDashboardKind,
  DashboardPresentation,
  DashboardPresentationSection,
  DashboardPresentationWidget,
  DashboardReadError,
} from './dashboard-presentation.js';
import type {
  DashboardPreferencesReader,
} from './adapters/dashboard-preferences.js';

const CONTEXT_DASHBOARD_PAGE_SIZE = 10;

type DashboardRootState = {
  cursor: { page: number; pageSize: number; total: number };
};

export type DashboardRoot = DashboardRootState & (
  | { type: 'dashboard'; dashboardId: string }
  | { type: 'entity-feed'; entityId: string; entityKind: ContextDashboardKind }
);

export type DashboardReadResult =
  | {
      ok: true;
      kind: 'dashboard';
      dashboard: Dashboard;
      window: DashboardPresentation;
      root: DashboardRoot;
    }
  | {
      ok: true;
      kind: 'entity-feed';
      entityFeed: import('../entity-feed/index.js').EntityFeed;
      window: DashboardPresentation;
      root: DashboardRoot;
    }
  | {
      ok: false;
      error: DashboardReadError;
    };

type DashboardReadDependencies = {
  widgets: MarketViewWidgetOperations;
  dashboard: DashboardModule;
  entity: Pick<EntityModule, 'resolveIdentity'>;
  entityFeed: EntityFeedModule;
  dashboardPreferences?: DashboardPreferencesReader | undefined;
};

type DashboardPreferencesResult =
  | { ok: true }
  | { ok: false; error: DashboardReadError };

function entityIdentity(entity: Entity): Record<string, unknown> {
  if (entity.kind === 'asset') {
    return {
      name: entity.label,
      assetClass: entity.assetClass,
      type: entity.assetType,
      ticker: entity.ticker,
      bbid: entity.bbid,
      exchange: entity.exchange,
      currency: entity.currency,
    };
  }
  return {
    name: entity.label,
    ...(entity.kind === 'country'
      ? { region: entity.region, subRegion: entity.subRegion }
      : {}),
    ...(entity.kind === 'portfolio' ? { currency: entity.currency } : {}),
  };
}

function contextLink(kind: ContextDashboardKind, entityId: string): string {
  if (kind === 'country') return `https://marquee.gs.com/s/marketview/country/${entityId}`;
  if (kind === 'portfolio') return `https://marquee.gs.com/s/marketview/portfolio/${entityId}`;
  return `https://marquee.gs.com/s/marketview/asset/${entityId}`;
}

async function readDashboardPreferences(
  readPreferences: DashboardPreferencesReader | undefined,
): Promise<DashboardPreferencesResult> {
  if (!readPreferences) {
    throw new Error('Dashboard preferences dependency is not configured');
  }
  const result = await readPreferences();
  if (!result.ok) {
    return { ok: false, error: { kind: 'dashboard-preferences', error: result.error } };
  }
  return { ok: true };
}

function extractDashboardSections(
  dashboard: Dashboard,
  widgets: DashboardPresentationWidget[],
): {
  widgets: DashboardPresentationWidget[];
  sections: DashboardPresentationSection[];
} | undefined {
  if (dashboard.sections.length === 0) return undefined;
  const childById = new Map(widgets.flatMap((widget) => (
    widget.childId ? [[widget.childId, widget] as const] : []
  )));
  const orderedWidgets: DashboardPresentationWidget[] = [];
  const sections: DashboardPresentationSection[] = [];
  const usedChildIds = new Set<string>();
  for (const section of [...dashboard.sections].sort((left, right) => left.rank - right.rank)) {
    const startIndex = orderedWidgets.length;
    for (const childId of section.childIds) {
      if (usedChildIds.has(childId)) continue;
      const widget = childById.get(childId);
      if (!widget) continue;
      usedChildIds.add(childId);
      orderedWidgets.push(widget);
    }
    sections.push({
      title: section.name,
      widgetCount: orderedWidgets.length - startIndex,
      startIndex,
      sectionId: section.sectionId,
    });
  }
  const ordered = new Set(orderedWidgets);
  return {
    widgets: [...orderedWidgets, ...widgets.filter((widget) => !ordered.has(widget))],
    sections,
  };
}

async function readContextDashboard(
  identifier: string,
  kind: ContextDashboardKind,
  resolved: Entity | undefined,
  operations: MarketViewWidgetOperations,
  entity: Pick<EntityModule, 'resolveIdentity'>,
  entityFeed: EntityFeedModule,
  enrich: boolean,
  pageSize: number,
): Promise<DashboardReadResult> {
  const identified = resolved
    ? { ok: true as const, value: resolved }
    : await entity.resolveIdentity({ kind, value: identifier });
  if (!identified.ok) {
    return { ok: false, error: { kind: 'entity', error: identified.error } };
  }
  if (!identified.value || identified.value.kind !== kind) {
    return { ok: false, error: { kind: 'entity-not-found', entityKind: kind, identifier } };
  }
  const feedResult = await entityFeed.get({ entity: identified.value, limit: pageSize });
  if (!feedResult.ok) {
    return { ok: false, error: { kind: 'entity-feed', error: feedResult.error } };
  }
  const feed = feedResult.value;
  const entityId = feed.entity.entityId;
  const identity = entityIdentity(feed.entity);
  const widgetList = createEntityFeedDashboardWidgets(
    feed.entries,
  );
  const total = feed.total;
  const preparedResult = await prepareContextDashboardWidgets(
    widgetList.slice(0, pageSize),
    {
      identifier,
      entity: feed.entity,
      operations,
      enrich,
    },
  );
  if (!preparedResult.ok) return { ok: false, error: preparedResult.error };
  const { prepared } = preparedResult;

  const window: DashboardPresentation = {
    title: prepared.title,
    identity: prepared.identityLine,
    entityId,
    entityKind: kind,
    entityIdentity: identity,
    author: null,
    description: null,
    tags: [],
    link: contextLink(kind, entityId),
    total,
    widgets: [...prepared.widgets, ...widgetList.slice(pageSize)],
  };
  return {
    ok: true,
    kind: 'entity-feed',
    entityFeed: feed,
    window,
    root: {
      type: 'entity-feed',
      entityId,
      entityKind: kind,
      cursor: { page: 1, pageSize, total },
    },
  };
}

async function loadSavedDashboard(
  dashboard: Dashboard,
  operations: MarketViewWidgetOperations,
  hydrateSnippets: boolean,
  pageSize: number,
): Promise<DashboardReadResult> {
  const dashboardWidgets = createSavedDashboardWidgets(dashboard);
  const sectioned = extractDashboardSections(dashboard, dashboardWidgets);
  const widgetList = sectioned?.widgets ?? dashboardWidgets;
  const total = widgetList.length;
  const pageOneWidgets = widgetList.slice(0, pageSize);
  if (hydrateSnippets) {
    const enrichError = await enrichDashboardWidgets(
      pageOneWidgets,
      operations,
    );
    if (enrichError) return { ok: false, error: enrichError };
  }

  return {
    ok: true,
    kind: 'dashboard',
    dashboard,
    window: {
      title: dashboard.name,
      author: dashboard.author ?? null,
      description: dashboard.description ?? null,
      tags: [...dashboard.tags],
      link: dashboard.link,
      total,
      widgets: widgetList,
      ...(sectioned ? { sections: sectioned.sections } : {}),
    },
    root: {
      type: 'dashboard',
      dashboardId: dashboard.dashboardId,
      cursor: { page: 1, pageSize, total },
    },
  };
}

async function loadSavedDashboardById(
  id: string,
  dashboard: DashboardModule,
  operations: MarketViewWidgetOperations,
  dashboardPreferences: DashboardPreferencesReader | undefined,
  hydrateSnippets: boolean,
  pageSize: number,
): Promise<DashboardReadResult> {
  const [dashboardResult, preferencesResult] = await Promise.all([
    dashboard.get(id),
    readDashboardPreferences(dashboardPreferences),
  ]);
  if (!dashboardResult.ok) {
    return { ok: false, error: { kind: 'dashboard', error: dashboardResult.error } };
  }
  if (!preferencesResult.ok) return { ok: false, error: preferencesResult.error };
  return loadSavedDashboard(
    dashboardResult.value,
    operations,
    hydrateSnippets,
    pageSize,
  );
}

export async function readMarketViewDashboard(
  input: {
    identifier: string;
    entityKind?: ContextDashboardKind;
    detail?: 'snippet' | 'raw';
    limit?: number;
  },
  dependencies: DashboardReadDependencies,
): Promise<DashboardReadResult> {
  const {
    widgets,
    dashboard,
    entity,
    entityFeed,
    dashboardPreferences,
  } = dependencies;
  const resolution = await resolveDashboardReadTarget(input, { entity });
  if (!resolution.ok) return { ok: false, error: resolution.error };
  if (resolution.target.kind === 'context') {
    return readContextDashboard(
      resolution.target.identifier,
      resolution.target.entityKind,
      resolution.target.entity,
      widgets,
      entity,
      entityFeed,
      input.detail !== 'raw',
      input.limit ?? CONTEXT_DASHBOARD_PAGE_SIZE,
    );
  }
  return loadSavedDashboardById(
    resolution.target.dashboardId,
    dashboard,
    widgets,
    dashboardPreferences,
    input.detail !== 'raw',
    input.limit ?? CONTEXT_DASHBOARD_PAGE_SIZE,
  );
}
