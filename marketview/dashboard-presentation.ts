import type { ConfigId, WidgetId } from '../widget/index.js';
import type { DashboardError } from '../dashboard/index.js';
import type { EntityFeedError } from '../entity-feed/index.js';
import type { EntityError } from '../entity/index.js';
import type {
  WidgetDefinition,
  WidgetDates,
  WidgetError,
  WidgetParameterOverride,
} from '../widget/index.js';

export type ContextDashboardKind = 'asset' | 'country' | 'portfolio';

type DashboardWidgetSnippet = Readonly<{
  title: string;
  isTitleResolved: boolean;
  parameterLines: readonly string[];
}>;

export interface DashboardPresentationWidget {
  widgetId: WidgetId;
  title: string;
  childId?: string;
  configurationId?: ConfigId | null;
  selectedContext?: string | null;
  snippet?: DashboardWidgetSnippet;
  failure?: Extract<DashboardReadError, { kind: 'widget' }>;
  widgetDefinition?: WidgetDefinition;
  widgetParameterOverrides?: readonly WidgetParameterOverride[];
  widgetDates?: WidgetDates;
}

export interface DashboardPresentationSection {
  title: string;
  widgetCount: number;
  startIndex: number;
  sectionId?: string;
}

export interface DashboardPresentation {
  title: string;
  identity?: string | null;
  entityId?: string | null;
  tags: string[];
  link: string;
  total: number;
  widgets: DashboardPresentationWidget[];
  sections?: DashboardPresentationSection[];
}

export type DashboardReadError =
  | { kind: 'dashboard'; error: DashboardError }
  | { kind: 'entity'; error: EntityError }
  | { kind: 'entity-not-found'; entityKind: ContextDashboardKind; identifier: string }
  | { kind: 'entity-feed'; error: EntityFeedError }
  | { kind: 'unresolved'; identifier: string }
  | {
      kind: 'widget';
      action: 'widget-snippet';
      error: WidgetError;
      presentation?: { message: string };
    };
