import type { Entity, EntityModule } from '../entity/index.js';
import type {
  ContextDashboardKind,
  DashboardReadError,
} from './dashboard-presentation.js';

type DashboardReadTarget =
  | { kind: 'saved'; dashboardId: string }
  | {
      kind: 'context';
      entityKind: ContextDashboardKind;
      identifier: string;
      entity?: Entity;
    };

type ResolutionProbe<T> =
  | { status: 'match'; value: T }
  | { status: 'miss' }
  | { status: 'error'; error: DashboardReadError };

function canonicalIdentity(trimmed: string): string {
  if (/^(?:mw|md|ma|mp)[a-z0-9]+$/i.test(trimmed) || /^[a-z]{2}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const aggregate = /^([a-z0-9]+)agg$/i.exec(trimmed);
  return aggregate ? `${aggregate[1]?.toUpperCase()}agg` : trimmed;
}

function hasQualifiedEntityIdShape(id: string, prefix: 'MD' | 'MA' | 'MP'): boolean {
  return new RegExp(`^${prefix}[A-Z0-9_]+$`, 'i').test(id);
}

export function isDashboardIdCandidate(identifier: string): boolean {
  return hasQualifiedEntityIdShape(identifier, 'MD');
}

export function canonicalDashboardIdentity(value: string): string {
  const trimmed = value.trim();
  return isDashboardIdCandidate(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function dashboardIdentifierType(
  id: string,
): 'thematic' | 'asset' | 'country' | 'portfolio' | 'unknown' {
  if (isDashboardIdCandidate(id)) return 'thematic';
  if (hasQualifiedEntityIdShape(id, 'MA')) return 'asset';
  if (/^[A-Z]{2}$/.test(id)) return 'country';
  if (hasQualifiedEntityIdShape(id, 'MP')) return 'portfolio';
  return 'unknown';
}

function isContextDashboardKind(value: unknown): value is ContextDashboardKind {
  return value === 'asset' || value === 'country' || value === 'portfolio';
}

export function isDashboardAliasCandidate(identifier: string): boolean {
  return /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(identifier);
}

async function resolveCountryEntity(
  identifier: string,
  entity: Pick<EntityModule, 'resolveIdentity'>,
): Promise<ResolutionProbe<Extract<Entity, { kind: 'country' }>>> {
  const result = await entity.resolveIdentity({ kind: 'country', value: identifier });
  if (!result.ok) {
    return { status: 'error', error: { kind: 'entity', error: result.error } };
  }
  return result.value?.kind === 'country'
    && result.value.region !== undefined
    && result.value.entityId.toLowerCase() === identifier.toLowerCase()
    ? { status: 'match', value: result.value }
    : { status: 'miss' };
}

async function resolveAssetIdentifier(
  identifier: string,
  entity: Pick<EntityModule, 'resolveIdentity'>,
): Promise<ResolutionProbe<Extract<Entity, { kind: 'asset' }>>> {
  const result = await entity.resolveIdentity({ kind: 'asset', value: identifier });
  if (!result.ok) {
    return { status: 'error', error: { kind: 'entity', error: result.error } };
  }
  return result.value?.kind === 'asset'
    ? { status: 'match', value: result.value }
    : { status: 'miss' };
}

async function resolveUnknownDashboard(
  identifier: string,
  entity: Pick<EntityModule, 'resolveIdentity'>,
  savedAliasFallback?: string,
): Promise<{ ok: true; target: DashboardReadTarget } | { ok: false; error: DashboardReadError }> {
  if (/\s/.test(identifier)) {
    return { ok: false, error: { kind: 'unresolved', identifier } };
  }
  const [countryEntity, asset] = await Promise.all([
    resolveCountryEntity(identifier, entity),
    resolveAssetIdentifier(identifier, entity),
  ]);
  if (countryEntity.status === 'error') return { ok: false, error: countryEntity.error };
  if (asset.status === 'error') return { ok: false, error: asset.error };
  if (countryEntity.status === 'match') {
    return {
      ok: true,
      target: {
        kind: 'context',
        entityKind: 'country',
        identifier,
        entity: countryEntity.value,
      },
    };
  }
  if (asset.status === 'match') {
    return {
      ok: true,
      target: {
        kind: 'context',
        entityKind: 'asset',
        identifier,
        entity: asset.value,
      },
    };
  }
  if (savedAliasFallback !== undefined) {
    return { ok: true, target: { kind: 'saved', dashboardId: savedAliasFallback } };
  }
  return { ok: false, error: { kind: 'unresolved', identifier } };
}

export async function resolveDashboardReadTarget(
  input: {
    identifier: string;
    entityKind?: ContextDashboardKind;
  },
  dependencies: {
    entity: Pick<EntityModule, 'resolveIdentity'>;
  },
): Promise<{ ok: true; target: DashboardReadTarget } | { ok: false; error: DashboardReadError }> {
  const rawIdentifier = input.identifier.trim();
  const identifier = canonicalIdentity(rawIdentifier);
  if (isContextDashboardKind(input.entityKind)) {
    return {
      ok: true,
      target: {
        kind: 'context',
        entityKind: input.entityKind,
        identifier,
      },
    };
  }

  const identifierType = dashboardIdentifierType(identifier);
  if (identifierType === 'asset' || identifierType === 'country' || identifierType === 'portfolio') {
    return {
      ok: true,
      target: {
        kind: 'context',
        entityKind: identifierType,
        identifier,
      },
    };
  }
  const aliasCandidate = isDashboardAliasCandidate(rawIdentifier);
  const ambiguousAliasCandidate = aliasCandidate && !rawIdentifier.includes('-');
  if (identifierType === 'thematic') {
    return { ok: true, target: { kind: 'saved', dashboardId: identifier } };
  }
  if (aliasCandidate && !ambiguousAliasCandidate) {
    return { ok: true, target: { kind: 'saved', dashboardId: rawIdentifier } };
  }
  return resolveUnknownDashboard(
    identifier,
    dependencies.entity,
    ambiguousAliasCandidate ? rawIdentifier : undefined,
  );
}
