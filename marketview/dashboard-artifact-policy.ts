import type { ArtifactRef } from '../artifact-registry/index.js';
import type {
  DashboardPresentation,
  DashboardPresentationWidget,
} from './dashboard-presentation.js';

type DashboardCursor = Readonly<{
  page: number;
  pageSize: number;
  total: number;
}>;

/** The Ref identity of a Dashboard Widget, placed in its saved Dashboard when it has one. */
export function dashboardWidgetArtifact(
  widget: DashboardPresentationWidget,
  dashboardId: string | undefined,
): ArtifactRef {
  const identity = {
    type: 'widget',
    widgetId: widget.widgetId,
    ...(widget.configurationId ? { configurationId: widget.configurationId } : {}),
    ...(widget.selectedContext ? { selectedContext: widget.selectedContext } : {}),
  } as const;
  return widget.childId && dashboardId
    ? { ...identity, childId: widget.childId, dashboardId }
    : identity;
}

/**
 * Refs for every Section of a saved Dashboard and for the Widgets of the cursor's page. Pages
 * count widgets in page order across sections (sections first, then widgets outside them), so a
 * limit can cut a section partway when viewing a Dashboard.
 */
export function dashboardArtifactRefs(
  payload: DashboardPresentation,
  namespace: string,
  dashboardId: string | undefined,
  cursor: DashboardCursor,
): Record<string, ArtifactRef> {
  const refs: Record<string, ArtifactRef> = {};
  if (dashboardId) {
    for (const [index, section] of (payload.sections ?? []).entries()) {
      refs[`${namespace}.s${index + 1}`] = {
        type: 'section',
        dashboardId,
        sectionId: section.sectionId ?? String(index + 1),
      };
    }
  }
  const start = (cursor.page - 1) * cursor.pageSize;
  for (const [offset, widget] of payload.widgets.slice(start, start + cursor.pageSize).entries()) {
    refs[`${namespace}.w${start + offset + 1}`] = dashboardWidgetArtifact(widget, dashboardId);
  }
  return refs;
}
