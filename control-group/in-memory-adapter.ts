import type { Asset } from '../entity/index.js';
import type { ControlGroupModule } from './types.js';
import { createControlGroupModuleFromAdapter } from './module.js';
import type { ControlGroupAdapter } from './port.js';

export type ControlGroupInMemoryState = Readonly<{
  groups?: readonly Readonly<{
    controlGroupId: string;
    members: readonly Asset[];
  }>[];
}>;

function searchable(asset: Asset): string {
  return [asset.label, asset.entityId, ...asset.aliases].join(' ').toLowerCase();
}

function createControlGroupInMemoryAdapter(
  state: ControlGroupInMemoryState,
): ControlGroupAdapter {
  return {
    async expand(controlGroupIds) {
      return {
        ok: true,
        value: controlGroupIds.map((controlGroupId) => ({
          controlGroupId,
          members: state.groups?.find((group) => (
            group.controlGroupId === controlGroupId
          ))?.members ?? [],
        })),
      };
    },
    async match(controlGroupIds, query, limit) {
      const requested = new Set(controlGroupIds);
      const folded = query?.trim().toLowerCase() ?? '';
      const seen = new Set<string>();
      const members = (state.groups ?? []).flatMap((group) => (
        requested.has(group.controlGroupId) ? group.members : []
      )).filter((member) => {
        if (seen.has(member.entityId)) return false;
        if (folded && !searchable(member).includes(folded)) return false;
        seen.add(member.entityId);
        return true;
      });
      return { ok: true, value: members.slice(0, Math.max(0, limit)) };
    },
  };
}

export function createControlGroupInMemoryModule(
  state: ControlGroupInMemoryState = {},
): ControlGroupModule {
  return createControlGroupModuleFromAdapter(
    createControlGroupInMemoryAdapter(state),
  );
}
