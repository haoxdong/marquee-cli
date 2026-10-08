function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
import type {
  ArtifactRef,
  ArtifactRegistry,
  ArtifactResolution,
  Ref,
} from './types.js';

type RegistryReader = Pick<ArtifactRegistry, 'getAllRefs' | 'resolveRef'>;

const REF_FIELDS = {
  search: new Set(['type', 'searchKind']),
  widget: new Set(['type', 'widgetId', 'configurationId', 'selectedContext']),
  dashboardWidget: new Set([
    'type',
    'widgetId',
    'configurationId',
    'selectedContext',
    'dashboardId',
    'childId',
  ]),
  dashboard: new Set(['type', 'dashboardId']),
  entityFeed: new Set(['type', 'entityId', 'entityKind']),
  section: new Set(['type', 'dashboardId', 'sectionId']),
  document: new Set(['type', 'documentId', 'realm']),
} as const;

function hasOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => fields.has(field));
}

export function isArtifactRef(value: unknown): value is ArtifactRef {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'search':
      return (value.searchKind === 'market-data' || value.searchKind === 'research')
        && hasOnlyFields(value, REF_FIELDS.search);
    case 'widget': {
      const hasDashboardId = value.dashboardId !== undefined;
      const hasChildId = value.childId !== undefined;
      return typeof value.widgetId === 'string'
        && value.widgetId.startsWith('MW')
        && (value.configurationId === null || (
          typeof value.configurationId === 'string'
          && value.configurationId.startsWith('WC')
        ))
        && (value.selectedContext === null || (
          typeof value.selectedContext === 'string'
          && value.selectedContext.length > 0
        ))
        && hasDashboardId === hasChildId
        && (!hasDashboardId || (
          typeof value.dashboardId === 'string'
          && value.dashboardId.length > 0
          && typeof value.childId === 'string'
          && value.childId.length > 0
        ))
        && hasOnlyFields(
          value,
          hasDashboardId ? REF_FIELDS.dashboardWidget : REF_FIELDS.widget,
        );
    }
    case 'dashboard':
      return typeof value.dashboardId === 'string'
        && value.dashboardId.length > 0
        && hasOnlyFields(value, REF_FIELDS.dashboard);
    case 'entity-feed':
      return typeof value.entityId === 'string'
        && value.entityId.length > 0
        && (value.entityKind === 'asset'
          || value.entityKind === 'country'
          || value.entityKind === 'portfolio')
        && hasOnlyFields(value, REF_FIELDS.entityFeed);
    case 'section':
      return typeof value.dashboardId === 'string'
        && value.dashboardId.length > 0
        && typeof value.sectionId === 'string'
        && value.sectionId.length > 0
        && hasOnlyFields(value, REF_FIELDS.section);
    case 'document':
      return typeof value.documentId === 'string'
        && value.documentId.length > 0
        && (value.realm === 'markets' || value.realm === 'research')
        && hasOnlyFields(value, REF_FIELDS.document);
    default:
      return false;
  }
}

export function normalizeRefName(ref: string): Ref {
  return (ref.startsWith('@') ? ref.slice(1) : ref) as Ref;
}

export function refNamespace(ref: string): string {
  const cleanRef = normalizeRefName(ref);
  const [namespace] = cleanRef.split('.');
  return namespace ?? cleanRef;
}

function rankedRefNames(registry: Pick<RegistryReader, 'getAllRefs'>, cleanRef: string): string[] {
  const refs = Object.keys(registry.getAllRefs());
  const namespace = refNamespace(cleanRef);
  const kind = cleanRef[0] ?? '';
  return refs
    .map((name, index) => ({
      name,
      index,
      score: name === namespace ? 0 : name.startsWith(`${namespace}.`) ? 1 : kind && name.startsWith(kind) ? 2 : 3,
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ name }) => name);
}

export function formatUnknownRefError(
  registry: Pick<RegistryReader, 'getAllRefs'>,
  cleanRef: string,
  options: { prefix?: 'Error' | 'error' } = {},
): string {
  const names = rankedRefNames(registry, cleanRef);
  const visible = names.slice(0, 6);
  const hint = visible.length === 0
    ? ['Hint: run the previous command again or use one of the refs printed above.']
    : [
        `Hint: current refs include ${visible.map((name) => `@${name}`).join(', ')}${names.length > visible.length ? ', ...' : ''}.`,
        'Run the previous command again or use one of the refs printed above.',
      ];
  return [
    `${options.prefix ?? 'Error'}: ref @${cleanRef} not found`,
    ...hint,
  ].join('\n');
}

export function resolveRefOrError(registry: RegistryReader, refName: string): ArtifactResolution {
  const { cleanRef, ref } = resolveStoredRef(registry, refName);
  if (!ref) return { ok: false, cleanRef, message: formatUnknownRefError(registry, cleanRef) };
  return { ok: true, cleanRef, ref };
}

export function resolveStoredRef(
  registry: Pick<RegistryReader, 'resolveRef'>,
  refName: string,
): { cleanRef: string; ref?: ArtifactRef | undefined } {
  const cleanRef = normalizeRefName(refName);
  const ref = registry.resolveRef(cleanRef);
  return { cleanRef, ref: isArtifactRef(ref) ? ref : undefined };
}
