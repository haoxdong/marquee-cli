import { isObject } from './is-object.js';
import type { WidgetDefinition } from '../widget/index.js';
import type { EntityFeed } from '../entity-feed/index.js';
import type { DashboardPresentation } from './dashboard-presentation.js';

export type MarketViewDashboardArtifactPayload = (
  | Readonly<{
      kind: 'dashboard';
      dashboard: import('../dashboard/index.js').Dashboard;
      window: DashboardPresentation;
      cursor: Readonly<{ page: number; pageSize: number; total: number }>;
      browserTarget: string;
    }>
  | Readonly<{
      kind: 'entity-feed';
      entityFeed: EntityFeed;
      window: DashboardPresentation;
      cursor: Readonly<{ page: number; pageSize: number; total: number }>;
      browserTarget: string;
    }>) & Readonly<{ widgetOptionArrays?: readonly (readonly unknown[])[] }>;


/** Only the Dashboard's resumable definitions share option universes; returned API values stay whole. */
function mapDefinitions(
  payload: MarketViewDashboardArtifactPayload,
  map: (definition: WidgetDefinition) => WidgetDefinition,
): MarketViewDashboardArtifactPayload {
  const window = {
    ...payload.window,
    widgets: payload.window.widgets.map((widget) => ({
      ...widget,
      ...(widget.widgetDefinition ? { widgetDefinition: map(widget.widgetDefinition) } : {}),
    })),
  };
  return payload.kind === 'entity-feed'
    ? { ...payload, window, entityFeed: {
        ...payload.entityFeed,
        entries: payload.entityFeed.entries.map((entry) => ({
          ...entry, widgetDefinition: map(entry.widgetDefinition),
        })),
      } }
    : { ...payload, window, dashboard: {
        ...payload.dashboard,
        children: payload.dashboard.children.map((child) => ({
          ...child,
          ...(child.kind === 'widget' && child.widgetDefinition !== undefined
            ? { widgetDefinition: map(child.widgetDefinition) }
            : {}),
        })),
      } };
}

function mapOptions(
  definition: WidgetDefinition,
  map: (options: unknown) => unknown,
): WidgetDefinition {
  return {
    ...definition,
    ...('supportedContexts' in definition
      ? { supportedContexts: map(definition.supportedContexts) }
      : {}),
    ...(isObject(definition.contextParameter) && 'options' in definition.contextParameter
      ? { contextParameter: {
          ...definition.contextParameter,
          options: map(definition.contextParameter.options),
        } }
      : {}),
  };
}

export function compactDashboardArtifactPayload(
  payload: MarketViewDashboardArtifactPayload,
): MarketViewDashboardArtifactPayload {
  const arrays: unknown[][] = [];
  const indices = new Map<string, number>();
  const compact = mapDefinitions(payload, (definition) => mapOptions(definition, (options) => {
    if (!Array.isArray(options)) return options;
    const key = JSON.stringify(options);
    let index = indices.get(key);
    if (index === undefined) {
      index = arrays.length;
      indices.set(key, index);
      arrays.push(options);
    }
    return { widgetOptionArray: index };
  }));
  return { ...compact, widgetOptionArrays: arrays };
}

export function restoreDashboardArtifactPayload(
  payload: MarketViewDashboardArtifactPayload,
): MarketViewDashboardArtifactPayload | undefined {
  if (payload.widgetOptionArrays === undefined) return payload;
  const { widgetOptionArrays, ...stored } = payload;
  if (!Array.isArray(widgetOptionArrays) || widgetOptionArrays.some((array) => !Array.isArray(array))) {
    return undefined;
  }
  const invalidIndices: unknown[] = [];
  const restored = mapDefinitions(stored, (definition) => mapOptions(definition, (options) => {
    if (!isObject(options) || !('widgetOptionArray' in options)) return options;
    const index = options.widgetOptionArray;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0
      || widgetOptionArrays[index] === undefined) {
      invalidIndices.push(index);
      return options;
    }
    return widgetOptionArrays[index];
  }));
  return invalidIndices.length > 0 ? undefined : restored;
}
