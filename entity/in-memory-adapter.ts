import type {
  Entity,
  EntityModule,
  EntityModuleOptions,
  EntityResolveValue,
} from './types.js';
import type { EntityAdapter } from './port.js';
import { createEntityCache } from './cache.js';
import { assembleEntityModule } from './resolver.js';

export type EntityInMemoryState = {
  entities?: readonly Entity[];
};

function searchable(entity: Entity): string {
  return [entity.label, entity.entityId, ...entity.aliases].join(' ').toLowerCase();
}

function createEntityInMemoryAdapter(state: EntityInMemoryState): EntityAdapter {
  const entities = state.entities ?? [];
  const byIdentity = new Map<string, Entity>();
  for (const entity of entities) {
    byIdentity.set(entity.entityId.toUpperCase(), entity);
    for (const alias of entity.aliases) byIdentity.set(alias.toUpperCase(), entity);
  }

  return {
    batchKey() {
      return 'in-memory';
    },
    maxBatchSize() {
      return Number.MAX_SAFE_INTEGER;
    },
    async resolve(input) {
      const resolutions: EntityResolveValue[] = [];
      for (const identifier of input) {
        const resolved = byIdentity.get(identifier.value.trim().toUpperCase());
        if (!resolved || resolved.kind !== identifier.kind) {
          resolutions.push({ ...identifier, status: 'not-found' });
          continue;
        }
        resolutions.push(resolved);
      }
      return {
        ok: true,
        value: {
          resolutions,
          discoveredEntities: [],
        },
      };
    },
    async resolveMatches(identifiers, query, limit) {
      const scoped = identifiers
        .map((identifier) => byIdentity.get(identifier.trim().toUpperCase()))
        .filter((entity): entity is Entity => entity !== undefined);
      const folded = query?.trim().toLowerCase() ?? '';
      return {
        ok: true,
        value: scoped
          .filter((entity) => !folded || searchable(entity).includes(folded))
          .slice(0, Math.max(0, limit)),
      };
    },
  };
}

export function createEntityInMemoryModule(
  state: EntityInMemoryState = {},
  options: Readonly<{
    cache?: Exclude<EntityModuleOptions['cache'], false | undefined>;
  }> = {},
): EntityModule {
  return assembleEntityModule(
    createEntityInMemoryAdapter(state),
    options.cache ? createEntityCache(options.cache) : undefined,
  );
}
