import type {
  ArtifactRef,
  ArtifactRegistry,
} from '../../artifact-registry/index.js';
import type { EntityModule } from '../../entity/index.js';

export function resolveMarqueeUrl(
  entity: Pick<EntityModule, 'resolveCanonicalIdentity'>,
  idOrUrl: string,
): string {
  if (idOrUrl.startsWith('http://') || idOrUrl.startsWith('https://')) return idOrUrl;
  const normalized = entity.resolveCanonicalIdentity(idOrUrl);
  if (normalized.startsWith('MW')) return `https://marquee.gs.com/s/marketview/widget/${normalized}`;
  if (normalized.startsWith('MD')) return `https://marquee.gs.com/s/marketview/dashboards/${normalized}`;
  if (normalized.startsWith('MA')) return `https://marquee.gs.com/s/marketview/asset/${normalized}`;
  if (normalized.startsWith('MP')) return `https://marquee.gs.com/s/marketview/portfolio/${normalized}`;
  return idOrUrl;
}

function payloadBrowserTarget(payload: unknown, refName?: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as Record<string, unknown>;
  if (refName && value.browserTargets && typeof value.browserTargets === 'object') {
    const target = (value.browserTargets as Record<string, unknown>)[refName];
    if (typeof target === 'string' && target.length > 0) return target;
  }
  if (refName?.includes('.')) return undefined;
  return typeof value.browserTarget === 'string' && value.browserTarget.length > 0
    ? value.browserTarget
    : undefined;
}

export function resolveStoredRefUrl(
  ref: ArtifactRef,
  payload?: unknown,
  refName?: string,
): string | undefined {
  if (ref.type === 'widget') {
    const query = new URLSearchParams();
    if (ref.configurationId) query.set('config', ref.configurationId);
    if (ref.selectedContext) query.set('selectedContext', ref.selectedContext);
    const encoded = query.toString();
    return `https://marquee.gs.com/s/marketview/widget/${ref.widgetId}${encoded ? `?${encoded}` : ''}`;
  }
  if (ref.type === 'entity-feed' && ref.entityKind === 'asset') return `https://marquee.gs.com/s/marketview/asset/${ref.entityId}`;
  if (ref.type === 'entity-feed' && ref.entityKind === 'portfolio') return `https://marquee.gs.com/s/marketview/portfolio/${ref.entityId}`;
  if (ref.type === 'dashboard') return `https://marquee.gs.com/s/marketview/dashboards/${ref.dashboardId}`;
  if (ref.type === 'search' || ref.type === 'document' || ref.type === 'entity-feed') {
    return payloadBrowserTarget(payload, refName);
  }
  return undefined;
}

export function resolveBrowserOpenTarget(
  registry: ArtifactRegistry,
  entity: Pick<EntityModule, 'resolveCanonicalIdentity'>,
  target: string,
): { url?: string; error?: string } {
  if (!target.startsWith('@')) return { url: resolveMarqueeUrl(entity, target) };
  const resolved = registry.resolve(target);
  if (!resolved.ok) return { error: resolved.message };
  const namespace = resolved.cleanRef.split('.')[0] ?? resolved.cleanRef;
  const url = resolveStoredRefUrl(
    resolved.ref,
    registry.getPayload(namespace),
    resolved.cleanRef,
  );
  return url ? { url } : { error: `Error: ref @${resolved.cleanRef} cannot be opened in browser` };
}
