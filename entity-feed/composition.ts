import type {
  EntityFeedPageReader,
  EntityFeedModule,
} from './types.js';
import type { Transport } from '../transport/index.js';
import { createEntityFeedProductionAdapter } from './adapters/production.js';
import { createEntityFeedModuleFromAdapter } from './module.js';

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
    readPage: ({ entityId, limit, offset, query }) => adapter.page(entityId, {
      ...(limit !== undefined ? { limit } : {}),
      ...(query !== undefined ? { query } : {}),
      ...(offset !== undefined ? { offset } : {}),
    }),
  });
}
