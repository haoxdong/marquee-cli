import type { Dashboard } from '../dashboard/index.js';
import type { EntityFeedEntry } from '../entity-feed/index.js';
import type { DashboardPresentationWidget } from './dashboard-presentation.js';

type DashboardWidgetChild = Extract<Dashboard['children'][number], { kind: 'widget' }>;

export function createEntityFeedDashboardWidget(
  entry: EntityFeedEntry,
): DashboardPresentationWidget {
  return {
    widgetId: entry.widgetId,
    title: entry.title,
    ...(entry.configurationId ? { configurationId: entry.configurationId } : {}),
    widgetDefinition: entry.widgetDefinition,
    widgetParameterOverrides: entry.widgetParameterOverrides,
    selectedContext: entry.selectedContext,
    ...(entry.widgetDates ? { widgetDates: entry.widgetDates } : {}),
  };
}

export function createEntityFeedDashboardWidgets(
  entries: readonly EntityFeedEntry[],
): DashboardPresentationWidget[] {
  return entries.map(createEntityFeedDashboardWidget);
}

export function createSavedDashboardWidgets(
  dashboard: Dashboard,
): DashboardPresentationWidget[] {
  return dashboard.children
    .filter((child): child is DashboardWidgetChild => child.kind === 'widget')
    .map((child) => {
      const parameters = child.parameterDefinitions && child.parameterDefinitions.length > 0
        ? child.parameterDefinitions
        : child.parameters;
      return {
        widgetId: child.widget.widgetId,
        title: child.name ?? child.widget.widgetId,
        type: 'Widget',
        childId: child.childId,
        configurationId: child.widget.configurationId ?? null,
        ...(child.selectedContext
          ? { selectedContext: child.selectedContext }
          : {}),
        underlyingChartId: child.renderTargetId ?? null,
        configurationParameters: [...(child.configurationParameters ?? child.parameters)],
        parameters: [...parameters],
        renderParams: child.renderParameters ?? null,
        contextParameter: child.contextParameter ?? null,
        visualizationType: child.visualizationKind ?? null,
        ...(child.widgetDefinition ? { widgetDefinition: child.widgetDefinition } : {}),
        ...(child.widgetParameterOverrides
          ? { widgetParameterOverrides: child.widgetParameterOverrides }
          : {}),
        ...(child.widgetDates ? { widgetDates: child.widgetDates } : {}),
      };
    });
}
