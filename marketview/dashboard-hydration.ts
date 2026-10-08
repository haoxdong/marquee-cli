export type { EntityFeedPageReader } from '../entity-feed/index.js';
import type { Entity } from '../entity/index.js';
import type {
  DashboardPresentationWidget,
  DashboardReadError,
} from './dashboard-presentation.js';
import type { MarketViewWidgetOperations } from './dashboard-widget-operations.js';
import { enrichDashboardWidgets } from './dashboard-widget-enrichment.js';

type PreparedContextDashboardWidgets = {
  widgets: DashboardPresentationWidget[];
  title: string;
  identityLine: string;
};

function contextIdentityLine(entity: Entity, identifier: string): string {
  if (entity.kind === 'country') return '';
  const parts = entity.kind === 'asset'
    ? [
        entity.ticker ?? identifier.toUpperCase(),
        entity.assetClass,
        entity.assetType,
        entity.exchange,
        entity.currency,
      ]
    : ['Portfolio', entity.currency];
  return parts.filter((part): part is string => part !== undefined).join(' · ');
}

function supplyContextDisplayValue(
  widgets: DashboardPresentationWidget[],
  display: string,
): void {
  for (const widget of widgets) {
    if (widget.widgetDefinition) {
      widget.widgetParameterOverrides = (widget.widgetParameterOverrides ?? []).map(
        (assignment) => assignment.value === widget.selectedContext
          && assignment.displayValue === undefined
          ? { ...assignment, displayValue: display }
          : assignment,
      );
    }
  }
}

export async function enrichContextDashboardWidgets(
  widgets: DashboardPresentationWidget[],
  operations: MarketViewWidgetOperations,
  display: string | undefined,
): Promise<DashboardReadError | undefined> {
  if (display === undefined) return undefined;
  supplyContextDisplayValue(widgets, display);
  return enrichDashboardWidgets(widgets, operations);
}

export async function prepareContextDashboardWidgets(
  widgets: DashboardPresentationWidget[],
  input: {
    identifier: string;
    entity: Entity;
    operations: MarketViewWidgetOperations;
    enrich: boolean;
  },
): Promise<
  | { ok: true; prepared: PreparedContextDashboardWidgets }
  | { ok: false; error: DashboardReadError }
> {
  const { identifier, entity, operations, enrich } = input;
  const enrichError = await enrichContextDashboardWidgets(
    widgets,
    operations,
    enrich ? entity.label : undefined,
  );
  if (enrichError) return { ok: false, error: enrichError };
  return {
    ok: true,
    prepared: {
      widgets,
      title: entity.label,
      identityLine: contextIdentityLine(entity, identifier),
    },
  };
}
