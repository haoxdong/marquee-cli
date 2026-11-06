import type { Transport } from '../transport/index.js';

import { createEntityFeedComposition } from './composition.js';
import type { EntityFeedModule } from './types.js';
export type {
  EntityFeedEntry,
  EntityFeed,
  EntityFeedError,
  EntityFeedModule,
  EntityFeedPageReader,
} from './types.js';

export function createEntityFeedModule(
  transport: Pick<Transport, 'request'>,
): EntityFeedModule {
  return createEntityFeedComposition(transport).entityFeed;
}
