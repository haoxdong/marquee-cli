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

const CONTEXT_DASHBOARD_PAGE_SIZE = 10;

type DashboardRootState = {
  cursor: { page: number; pageSize: number; total: number };
};

type DashboardRoot = DashboardRootState & (
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
};

function contextLink(kind: ContextDashboardKind, entityId: string): string {
  if (kind === 'country') return `https://marquee.gs.com/s/marketview/country/${entityId}`;
  if (kind === 'portfolio') return `https://marquee.gs.com/s/marketview/portfolio/${entityId}`;
  return `https://marquee.gs.com/s/marketview/asset/${entityId}`;
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
  const { entityId } = feed.entity;
  const widgetList = createEntityFeedDashboardWidgets(feed.entries);
  const prepared = await prepareContextDashboardWidgets(
    widgetList.slice(0, pageSize),
    { identifier, entity: feed.entity, operations, enrich },
  );
  if (!prepared.ok) return { ok: false, error: prepared.error };
  return {
    ok: true,
    kind: 'entity-feed',
    entityFeed: feed,
    window: {
      title: prepared.prepared.title,
      identity: prepared.prepared.identityLine,
      entityId,
      tags: [],
      link: contextLink(kind, entityId),
      total: feed.total,
      widgets: [...prepared.prepared.widgets, ...widgetList.slice(pageSize)],
    },
    root: {
      type: 'entity-feed',
      entityId,
      entityKind: kind,
      cursor: { page: 1, pageSize, total: feed.total },
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
  const enrichError = hydrateSnippets ? await enrichDashboardWidgets(pageOneWidgets, operations) : undefined;
  if (enrichError) return { ok: false, error: enrichError };

  return {
    ok: true,
    kind: 'dashboard',
    dashboard,
    window: {
      title: dashboard.name,
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
  const saved = await dashboard.get(resolution.target.dashboardId);
  if (!saved.ok) return { ok: false, error: { kind: 'dashboard', error: saved.error } };
  return loadSavedDashboard(
    saved.value,
    widgets,
    input.detail !== 'raw',
    input.limit ?? CONTEXT_DASHBOARD_PAGE_SIZE,
  );
}
