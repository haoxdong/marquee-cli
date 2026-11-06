import type { EntityFeedEntry } from './types.js';
import type { EntityFeedAdapter } from './module.js';
import type { WidgetPin } from '../lib/widget-pin.js';

export type EntityFeedInMemoryState = {
  feeds?: readonly {
    entityId: string;
    entries: readonly EntityFeedEntry[];
    pins?: readonly WidgetPin[];
    total?: number;
  }[];
};

export function createEntityFeedInMemoryAdapter(
  state: EntityFeedInMemoryState = {},
): EntityFeedAdapter {
  const feeds = new Map((state.feeds ?? []).map((feed) => [feed.entityId, feed]));
  return {
    async read(entityId) {
      const feed = feeds.get(entityId);
      const entries = feed?.entries ?? [];
      return {
        ok: true,
        value: {
          entries,
          pins: feed?.pins ?? [],
          total: feed?.total ?? entries.length,
        },
      };
    },
    async page(entityId, input) {
      if (input.query !== undefined) return { ok: false, error: { kind: 'invalid-feed', problem: 'response' } };
      const feed = feeds.get(entityId);
      const entries = feed?.entries ?? [];
      const offset = input.offset ?? 0;
      return {
        ok: true,
        value: {
          entries: entries.slice(offset, offset + (input.limit ?? 100)),
          total: feed?.total ?? entries.length,
        },
      };
    },
  };
}
