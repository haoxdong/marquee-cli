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
import type { DashboardPreferencesError } from './adapters/dashboard-preferences.js';

export type ContextDashboardKind = 'asset' | 'country' | 'portfolio';

type DashboardWidgetSnippet = Readonly<{
  title: string;
  isTitleResolved: boolean;
  parameterLines: readonly string[];
}>;

export interface DashboardPresentationWidget {
  widgetId: WidgetId;
  title: string;
  type?: 'Widget';
  childId?: string;
  configurationId?: ConfigId | null;
  selectedContext?: string | null;
  underlyingChartId?: string | null;
  configurationParameters?: Array<{ field: string; value: unknown }>;
  contextParameter?: Record<string, unknown> | null;
  renderParams?: Record<string, unknown> | null;
  parameters?: Array<{
    field?: string | null;
    options?: unknown[];
    offset?: number;
    type?: string;
    values?: unknown;
    defaultValue?: unknown;
    [key: string]: unknown;
  }>;
  parameterLines?: string[];
  snippet?: DashboardWidgetSnippet;
  visualizationType?: string | null;
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
  entityKind?: 'asset' | 'country' | 'portfolio' | 'thematic';
  entityIdentity?: Record<string, unknown>;
  author: string | null;
  description: string | null;
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
  | { kind: 'dashboard-preferences'; error: DashboardPreferencesError }
  | { kind: 'unresolved'; identifier: string }
  | {
      kind: 'widget';
      action: 'widget-snippet';
      error: WidgetError;
      presentation?: { message: string };
    };
