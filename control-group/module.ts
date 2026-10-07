import type { ControlGroupModule } from './types.js';
import type { ControlGroupCache } from './cache.js';
import type { ControlGroupAdapter } from './port.js';

export function createControlGroupModuleFromAdapter(
  adapter: ControlGroupAdapter,
  cache?: ControlGroupCache,
): ControlGroupModule {
  return {
    async expand(controlGroupIds, signal) {
      if (controlGroupIds.length === 0) return { ok: true, value: [] };
      const cached = cache?.read(controlGroupIds) ?? [];
      const missing = controlGroupIds.filter((_controlGroupId, index) => !cached[index]);
      if (missing.length === 0) {
        return { ok: true, value: cached as NonNullable<typeof cached[number]>[] };
      }
      const expanded = await adapter.expand(missing, signal);
      if (!expanded.ok) return expanded;
      cache?.merge(expanded.value);
      const byId = new Map(
        [...cached, ...expanded.value]
          .filter((value): value is NonNullable<typeof value> => value !== undefined)
          .map((value) => [value.controlGroupId.trim().toUpperCase(), value]),
      );
      return {
        ok: true,
        value: controlGroupIds.flatMap((controlGroupId) => {
          const value = byId.get(controlGroupId.trim().toUpperCase());
          return value ? [value] : [];
        }),
      };
    },
    match(controlGroupIds, query, limit = 30) {
      return adapter.match(controlGroupIds, query, limit);
    },
  };
}
