import type { ArtifactRegistry } from '../artifact-registry/index.js';
import type {
  DashboardModule,
} from '../dashboard/index.js';
import type { DashboardWidgetArtifact } from '../dashboard/index.js';

import type { MarketViewDashboardCreateResult } from './types.js';

export interface MarketViewDashboardCreation {
  create(input: {
    name: string;
    widgetRefs: readonly string[];
  }): Promise<MarketViewDashboardCreateResult>;
}

export function createMarketViewDashboardCreation(dependencies: {
  dashboard: Pick<DashboardModule, 'create'>;
  registry: ArtifactRegistry;
}): MarketViewDashboardCreation {
  return {
    async create(input) {
      if (!input.name.trim()) {
        return {
          ok: false,
          error: { kind: 'dashboard', error: { kind: 'invalid-name', name: input.name } },
        };
      }
      const resolvedWidgets: DashboardWidgetArtifact[] = [];
      for (const requestedRef of input.widgetRefs) {
        const refName = dependencies.registry.refName(requestedRef);
        const ref = dependencies.registry.resolveRef(refName);
        if (!ref) return { ok: false, error: { kind: 'unknown-ref', refName } };
        if (ref.type !== 'widget') {
          return {
            ok: false,
            error: { kind: 'wrong-artifact', refName, artifactType: ref.type },
          };
        }
        resolvedWidgets.push({
          widgetId: ref.widgetId,
          ...(ref.configurationId ? { configurationId: ref.configurationId } : {}),
          ...(ref.selectedContext ? { selectedContext: ref.selectedContext } : {}),
        });
      }
      const result = await dependencies.dashboard.create({
        name: input.name,
        widgets: [...resolvedWidgets],
      });
      if (!result.ok) return { ok: false, error: { kind: 'dashboard', error: result.error } };
      const ref = dependencies.registry.claimDashboard();
      dependencies.registry.setRefs(ref, {
        [ref]: { type: 'dashboard', dashboardId: result.value.dashboardId },
      });
      return {
        ok: true,
        value: { dashboard: result.value, ref, seededWidgetCount: resolvedWidgets.length },
      };
    },
  };
}
