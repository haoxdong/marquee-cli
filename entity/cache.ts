import { createInteractionSessionNamespace } from '../referent-registry/index.js';
import type {
  Entity,
  EntityResolveInput,
  EntityModuleOptions,
  ResolvedEntityValue,
} from './types.js';
import { normalizeEntityResolutionValue } from './normalization.js';
import { isRecord } from '../lib/json-value.js';

const ENTITY_CACHE_NAMESPACE = 'entity-resolution-v1';

type EntityCacheOptions = Exclude<EntityModuleOptions['cache'], false | undefined>;

type EntityCacheState = Readonly<{
  records: Readonly<Record<string, ResolvedEntityValue>>;
}>;

export interface EntityCache {
  read(input: readonly EntityResolveInput[]): Array<ResolvedEntityValue | undefined>;
  merge(
    input: readonly EntityResolveInput[],
    resolutions: readonly ResolvedEntityValue[],
  ): void;
}

function isEntity(value: unknown): value is Entity {
  return isRecord(value)
    && (value.kind === 'asset' || value.kind === 'country' || value.kind === 'portfolio')
    && typeof value.entityId === 'string'
    && typeof value.label === 'string'
    && Array.isArray(value.aliases)
    && value.aliases.every((alias) => typeof alias === 'string');
}

function isEntityCacheState(value: unknown): value is EntityCacheState {
  return isRecord(value)
    && isRecord(value.records)
    && Object.values(value.records).every(isEntity);
}

function cacheKey(kind: EntityResolveInput['kind'], value: string): string {
  return `${kind}:${normalizeEntityResolutionValue(value)}`;
}

function storeResolution(
  records: Record<string, ResolvedEntityValue>,
  resolution: ResolvedEntityValue,
): void {
  for (const identity of [resolution.entityId, ...resolution.aliases]) {
    const key = cacheKey(resolution.kind, identity);
    if (records[key] === undefined) records[key] = resolution;
  }
}

export function createEntityCache(options: EntityCacheOptions): EntityCache {
  const namespace = createInteractionSessionNamespace(
    ENTITY_CACHE_NAMESPACE,
    isEntityCacheState,
    options,
  );
  return {
    read(input) {
      const records = namespace.read()?.records ?? {};
      return input.map(({ kind, value }) => records[cacheKey(kind, value)]);
    },
    merge(input, resolutions) {
      namespace.update((current) => {
        const records = { ...(current?.records ?? {}) };
        for (const resolution of resolutions) storeResolution(records, resolution);
        resolutions.forEach((resolution, index) => {
          const requested = input[index];
          if (requested) records[cacheKey(requested.kind, requested.value)] = resolution;
        });
        return { records };
      });
    },
  };
}
