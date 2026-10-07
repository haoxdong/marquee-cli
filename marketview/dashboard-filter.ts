import type { ArtifactRef, ArtifactRegistry } from '../artifact-registry/index.js';
import {
  enrichContextDashboardWidgets,
  type EntityFeedPageReader,
} from './dashboard-hydration.js';
import { dashboardWidgetArtifact } from './dashboard-artifact-policy.js';
import { enrichDashboardWidgets } from './dashboard-widget-enrichment.js';
import type { MarketViewWidgetOperations } from './dashboard-widget-operations.js';
import type {
  DashboardPresentation,
  DashboardPresentationWidget,
  DashboardReadError,
} from './dashboard-presentation.js';
import { createEntityFeedDashboardWidget } from './dashboard-widget-projection.js';
import { compactDashboardArtifactPayload, restoreDashboardArtifactPayload } from './dashboard-artifact-payload.js';
import {
  isMarketViewDashboardArtifactPayload,
  type MarketViewDashboardArtifactPayload,
  type MarketViewDashboardFilterMatch,
} from './facade.js';

const FILTER_RESULT_LIMIT = 30;
const FILTER_FETCH_LIMIT = 250;

function widgetTitle(widget: DashboardPresentationWidget): string {
  return widget.snippet?.title || widget.title;
}

/** Loads every Entity Feed widget the stored window still lacks, page after page. */
async function hydrateEntityFeed(
  window: DashboardPresentation,
  entityId: string,
  readEntityFeedPage: EntityFeedPageReader,
): Promise<
  | Readonly<{ ok: true; changed: boolean }>
  | Readonly<{ ok: false; error: DashboardReadError }>
> {
  let changed = false;
  const pages = Math.ceil((window.total - window.widgets.length) / FILTER_FETCH_LIMIT);
  // A page count fixed up front keeps the loop finite even if a page comes back short.
  for (const _page of Array.from({ length: pages })) {
    const offset = window.widgets.length;
    // eslint-disable-next-line no-await-in-loop -- pagination: each page starts at the first widget still missing
    const page = await readEntityFeedPage({
      entityId,
      limit: Math.min(FILTER_FETCH_LIMIT, window.total - offset),
      offset,
    });
    if (!page.ok) {
      return { ok: false, error: { kind: 'entity-feed', error: page.error } };
    }
    if (page.value.entries.length === 0) break;
    window.widgets.push(...page.value.entries.map(createEntityFeedDashboardWidget));
    changed = true;
  }
  return { ok: true, changed };
}

export type StoredDashboardFilterError =
  | Readonly<{ kind: 'artifact-payload-not-found'; ref: string }>
  | DashboardReadError;

export type StoredDashboardFilterValue = Readonly<{
  payload: MarketViewDashboardArtifactPayload;
  refs: Readonly<Record<string, ArtifactRef>>;
  matches: readonly MarketViewDashboardFilterMatch[];
  totalMatches: number;
}>;

type IndexedWidget = Readonly<{ widget: DashboardPresentationWidget; index: number }>;

function matchingWidgets(
  widgets: readonly DashboardPresentationWidget[],
  query: string,
): IndexedWidget[] {
  const lowerQuery = query.toLowerCase();
  return widgets
    .map((widget, index) => ({ widget, index }))
    .filter(({ widget }) => (
      widgetTitle(widget).toLowerCase().includes(lowerQuery)
      || widget.widgetId.toLowerCase().includes(lowerQuery)
    ));
}

/** Renders the Widget Snippet of every shown match that has none yet, as dashboard view does for its page. */
async function enrichMatches(
  value: MarketViewDashboardArtifactPayload,
  visible: readonly IndexedWidget[],
  operations: MarketViewWidgetOperations,
): Promise<Readonly<{ ok: true; changed: boolean }> | Readonly<{ ok: false; error: DashboardReadError }>> {
  const widgets = visible.map(({ widget }) => widget).filter((widget) => !widget.snippet);
  if (widgets.length === 0) return { ok: true, changed: false };
  const error = value.kind === 'entity-feed'
    ? await enrichContextDashboardWidgets(widgets, operations, value.window.title)
    : await enrichDashboardWidgets(widgets, operations);
  return error ? { ok: false, error } : { ok: true, changed: true };
}

function collectFilterMatches(
  namespace: string,
  visible: readonly IndexedWidget[],
  owner: ArtifactRef | undefined,
  existingRefs: Readonly<Record<string, ArtifactRef>>,
): Readonly<{
  refs: Record<string, ArtifactRef>;
  matches: MarketViewDashboardFilterMatch[];
}> {
  const refs: Record<string, ArtifactRef> = {};
  const matches: MarketViewDashboardFilterMatch[] = [];
  const dashboardId = owner?.type === 'dashboard' ? owner.dashboardId : undefined;
  for (const { widget, index } of visible) {
    const ref = `${namespace}.w${index + 1}`;
    refs[ref] = existingRefs[ref] ?? dashboardWidgetArtifact(widget, dashboardId);
    matches.push({ index, ref, title: widgetTitle(widget) });
  }
  return { refs, matches };
}

export async function filterStoredDashboard(
  namespace: string,
  query: string,
  dependencies: Readonly<{
    registry: ArtifactRegistry;
    readEntityFeedPage: EntityFeedPageReader;
    widgets: MarketViewWidgetOperations;
  }>,
  limit = FILTER_RESULT_LIMIT,
): Promise<
  | Readonly<{ ok: true; value: StoredDashboardFilterValue }>
  | Readonly<{ ok: false; error: StoredDashboardFilterError }>
> {
  const artifact = dependencies.registry.getArtifact(namespace);
  if (!artifact || !isMarketViewDashboardArtifactPayload(artifact.payload)) {
    return { ok: false, error: { kind: 'artifact-payload-not-found', ref: namespace } };
  }
  const value = restoreDashboardArtifactPayload(artifact.payload);
  if (!value) return { ok: false, error: { kind: 'artifact-payload-not-found', ref: namespace } };
  let changed = false;
  if (value.kind === 'entity-feed') {
    const { entityId } = value.window;
    if (!entityId) return { ok: false, error: { kind: 'artifact-payload-not-found', ref: namespace } };
    const hydration = await hydrateEntityFeed(value.window, entityId, dependencies.readEntityFeedPage);
    if (!hydration.ok) return hydration;
    changed = hydration.changed;
  }
  const matched = matchingWidgets(value.window.widgets, query);
  const visible = matched.slice(0, limit);
  const enrichment = await enrichMatches(value, visible, dependencies.widgets);
  if (!enrichment.ok) return enrichment;
  if (changed || enrichment.changed) {
    dependencies.registry.setPayload(namespace, compactDashboardArtifactPayload(value));
  }
  const collected = collectFilterMatches(
    namespace,
    visible,
    artifact.root,
    artifact.refs,
  );
  const newRefs = Object.entries(collected.refs)
    .filter(([ref]) => artifact.refs[ref] === undefined);
  const newRefNames = newRefs.map(([ref]) => ref);
  let persistedRefs = collected.refs;
  if (newRefNames.length > 0) {
    const latestRefs = { ...collected.refs };
    dependencies.registry.updateRefs(newRefNames, (currentRefs) => Object.fromEntries(
      newRefs.flatMap(([ref, collectedRef]) => {
        const current = currentRefs[ref];
        if (!current) return [[ref, collectedRef]];
        latestRefs[ref] = current;
        return [];
      }),
    ));
    persistedRefs = latestRefs;
  }
  return {
    ok: true,
    value: {
      payload: value,
      refs: persistedRefs,
      matches: collected.matches,
      totalMatches: matched.length,
    },
  };
}
