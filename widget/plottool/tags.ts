type TaggedLabelSurface =
  | 'default'
  | 'legend'
  | 'statistics'
  | 'batch';

export type TaggedLabelOptions = Readonly<{
  surface?: TaggedLabelSurface;
}>;

export type TaggedEntities = Readonly<Record<string, readonly unknown[]>>;

const TAG_PATTERN = /<[^:]+:[^>]+>/g;

const ENTITY_KEYS: Readonly<Record<string, string>> = {
  Asset: 'assets',
  Country: 'countries',
  Portfolio: 'portfolios',
  Control_Group: 'control_groups',
};

export function resolveTaggedLabel(
  label: string,
  controls: readonly unknown[],
  entities: TaggedEntities,
  options: TaggedLabelOptions = {},
): string {
  return label.replace(TAG_PATTERN, (tag) => (
    resolveTag(tag, controls, entities, options)
    ?? failedTag(tag, options.surface)
  ));
}

function resolveTag(
  tag: string,
  controls: readonly unknown[],
  entities: TaggedEntities,
  options: TaggedLabelOptions,
): string | undefined {
  const tagId = tag.split(':')[1]?.slice(0, -1);
  const control = controls
    .filter(isRecord)
    .find((candidate) => candidate.internalID === tagId);
  if (!control || control.value === undefined) return undefined;

  const type = control.controlType ?? control.type;
  if (type === 'Enum') {
    return typeof control.value === 'string' ? control.value : JSON.stringify(control.value);
  }

  if (typeof type !== 'string') return undefined;
  const key = ENTITY_KEYS[type];
  if (!key) return undefined;
  const entity = (entities[key] ?? [])
    .filter(isRecord)
    .find((candidate) => candidate.id === control.value);
  if (!entity) return undefined;
  const value = usesBbid(options.surface)
    ? entity.bbid ?? entity.name
    : entity.name;
  return String(value);
}

function usesBbid(surface: TaggedLabelSurface | undefined): boolean {
  return surface === 'legend' || surface === 'statistics';
}

function failedTag(tag: string, surface: TaggedLabelSurface | undefined): string {
  return surface === 'batch' ? tag : 'Unknown Value';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
