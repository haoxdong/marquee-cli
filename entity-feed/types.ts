import type { Entity } from '../entity/index.js';
import type { DependencyFailure } from '../transport/index.js';
import type {
  ConfigId,
  WidgetDefinition,
  WidgetDates,
  WidgetId,
  WidgetParameterOverride,
} from '../widget/index.js';

export type EntityFeedEntry = {
  widgetId: WidgetId;
  title: string;
  configurationId?: ConfigId;
  widgetDefinition: WidgetDefinition;
  widgetParameterOverrides: readonly WidgetParameterOverride[];
  selectedContext: string | null;
  widgetDates?: WidgetDates;
  rank?: number;
};

export type EntityFeed = {
  entity: Entity;
  entries: readonly EntityFeedEntry[];
  total: number;
};

type EntityFeedGetInput = Readonly<{
  entity: Entity;
  limit?: number;
}>;

export type EntityFeedError =
  | Readonly<{
      kind: 'dependency';
      source: 'feed' | 'preferences';
      failure: DependencyFailure;
    }>
  | Readonly<{
      kind: 'invalid-feed';
      problem: 'response' | 'widget-entry';
    }>;

export type EntityFeedResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EntityFeedError };

export interface EntityFeedModule {
  get(input: EntityFeedGetInput): Promise<EntityFeedResult<EntityFeed>>;
}

export type EntityFeedPageReader = (input: Readonly<{
  entityId: string;
  limit?: number;
  query?: string;
  offset?: number;
}>) => Promise<
  | { ok: true; value: { entries: readonly EntityFeedEntry[]; total: number } }
  | { ok: false; error: EntityFeedError }
>;
