import type {
  EntityFeedEntry,
  EntityFeedError,
  EntityFeedModule,
} from './types.js';
import type { Transport } from '../transport/index.js';
import { createEntityFeedProductionAdapter } from './adapters/production.js';
import { createEntityFeedModuleFromAdapter } from './module.js';

export type EntityFeedPageReader = (input: Readonly<{
  entityId: string;
  limit: number;
  offset?: number;
}>) => Promise<
  | { ok: true; value: { entries: readonly EntityFeedEntry[]; total: number } }
  | { ok: false; error: EntityFeedError }
>;

export type EntityFeedComposition = Readonly<{
  entityFeed: EntityFeedModule;
  readPage: EntityFeedPageReader;
}>;

export function createEntityFeedComposition(
  transport: Pick<Transport, 'request'>,
): EntityFeedComposition {
  const adapter = createEntityFeedProductionAdapter(transport);
  return Object.freeze({
    entityFeed: createEntityFeedModuleFromAdapter({ adapter }),
    readPage: ({ entityId, limit, offset }) => adapter.page(entityId, {
      limit,
      ...(offset !== undefined ? { offset } : {}),
    }),
  });
}
