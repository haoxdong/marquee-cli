import type { WidgetPin } from '../lib/widget-pin.js';
import type {
  EntityFeedEntry,
  EntityFeedModule,
  EntityFeedResult,
} from './types.js';

type EntityFeedPage = {
  entries: readonly EntityFeedEntry[];
  total: number;
};

export type EntityFeedSource = EntityFeedPage & {
  pins: readonly WidgetPin[];
};

export interface EntityFeedAdapter {
  read(entityId: string): Promise<EntityFeedResult<EntityFeedSource>>;
  page(
    entityId: string,
    input: { limit: number; offset?: number },
  ): Promise<EntityFeedResult<EntityFeedPage>>;
}

function pinMatches(entry: EntityFeedEntry, pin: WidgetPin): boolean {
  return entry.widgetId === pin.widgetId && (
    pin.configurationId === undefined || entry.configurationId === pin.configurationId
  );
}

function orderEntries(
  entries: readonly EntityFeedEntry[],
  pins: readonly WidgetPin[],
): EntityFeedEntry[] {
  const remaining = entries.map((entry, providerIndex) => ({ entry, providerIndex }));
  const pinned: EntityFeedEntry[] = [];
  for (const pin of pins) {
    const index = remaining.findIndex(({ entry }) => pinMatches(entry, pin));
    if (index >= 0) pinned.push(...remaining.splice(index, 1).map(({ entry }) => entry));
  }
  remaining.sort((left, right) => {
    const leftRank = left.entry.rank ?? Number.POSITIVE_INFINITY;
    const rightRank = right.entry.rank ?? Number.POSITIVE_INFINITY;
    return leftRank - rightRank || left.providerIndex - right.providerIndex;
  });
  return [...pinned, ...remaining.map(({ entry }) => entry)];
}

export function createEntityFeedModuleFromAdapter(deps: {
  adapter: EntityFeedAdapter;
}): EntityFeedModule {
  return {
    async get(input) {
      const source = await deps.adapter.read(input.entity.entityId);
      if (!source.ok) return source;
      const entries = orderEntries(source.value.entries, source.value.pins);
      const target = Math.min(input.limit ?? entries.length, source.value.total);
      while (entries.length < target) {
        // eslint-disable-next-line no-await-in-loop -- each offset depends on the number of entries actually returned
        const page = await deps.adapter.page(input.entity.entityId, {
          offset: entries.length,
          limit: target - entries.length,
        });
        if (!page.ok) return page;
        if (page.value.entries.length === 0) {
          return { ok: false, error: { kind: 'invalid-feed', problem: 'response' } };
        }
        entries.push(...page.value.entries);
      }
      return {
        ok: true,
        value: {
          entity: input.entity,
          entries,
          total: source.value.total,
        },
      };
    },
  };
}
