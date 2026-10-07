import { createInteractionSessionNamespace } from '../artifact-registry/index.js';
import type { Asset } from '../entity/index.js';
import type { ControlGroupExpansion, ControlGroupModuleOptions } from './types.js';

const CONTROL_GROUP_CACHE_NAMESPACE = 'control-group-expansion-v1';

type ControlGroupCacheOptions = Exclude<
  ControlGroupModuleOptions['cache'],
  false | undefined
>;

type ControlGroupCacheState = Readonly<{
  records: Readonly<Record<string, ControlGroupExpansion>>;
}>;

export interface ControlGroupCache {
  read(controlGroupIds: readonly string[]): Array<ControlGroupExpansion | undefined>;
  merge(expansions: readonly ControlGroupExpansion[]): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAsset(value: unknown): value is Asset {
  return isRecord(value)
    && value.kind === 'asset'
    && typeof value.entityId === 'string'
    && typeof value.label === 'string'
    && Array.isArray(value.aliases)
    && value.aliases.every((alias) => typeof alias === 'string');
}

function isExpansion(value: unknown): value is ControlGroupExpansion {
  return isRecord(value)
    && typeof value.controlGroupId === 'string'
    && Array.isArray(value.members)
    && value.members.every(isAsset);
}

function isControlGroupCacheState(value: unknown): value is ControlGroupCacheState {
  return isRecord(value)
    && isRecord(value.records)
    && Object.values(value.records).every(isExpansion);
}

function cacheKey(controlGroupId: string): string {
  return controlGroupId.trim().toUpperCase();
}

export function createControlGroupCache(
  options: ControlGroupCacheOptions = {},
): ControlGroupCache {
  const namespace = createInteractionSessionNamespace(
    CONTROL_GROUP_CACHE_NAMESPACE,
    isControlGroupCacheState,
    options,
  );
  return {
    read(controlGroupIds) {
      const records = namespace.read()?.records ?? {};
      return controlGroupIds.map((controlGroupId) => records[cacheKey(controlGroupId)]);
    },
    merge(expansions) {
      namespace.update((current) => {
        const records = { ...(current?.records ?? {}) };
        for (const expansion of expansions) {
          records[cacheKey(expansion.controlGroupId)] = expansion;
        }
        return { records };
      });
    },
  };
}
