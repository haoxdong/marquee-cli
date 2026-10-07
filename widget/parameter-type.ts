import { identityKind } from './input-resolution.js';

const PARAM_TYPE_ALIASES: Record<string, string> = {
  asset: 'Asset',
  assetlist: 'AssetList',
  asset_list: 'AssetList',
  'asset-list': 'AssetList',
  boolean: 'Boolean',
  context: 'Context',
  country: 'Country',
  countryid: 'Country',
  countrylist: 'CountryList',
  date: 'Date',
  enum: 'Enum',
  enumlist: 'EnumList',
  enum_list: 'EnumList',
  'enum-list': 'EnumList',
  integer: 'Integer',
  number: 'Integer',
  portfolio: 'Portfolio',
  relativedate: 'RelativeDate',
  relative_date: 'RelativeDate',
  'relative-date': 'RelativeDate',
  string: 'String',
};

function isAssetOrControlGroupId(value: unknown): boolean {
  const kind = identityKind(value);
  return kind === 'asset' || kind === 'control-group';
}

function inferParamType(rawDefault: unknown, rawValues: unknown[]): string {
  if (Array.isArray(rawDefault)) {
    return [...rawDefault, ...rawValues].some((value) => identityKind(value) === 'asset')
      ? 'AssetList'
      : 'EnumList';
  }
  if (typeof rawDefault === 'boolean') return 'Boolean';
  if (typeof rawDefault === 'number') return 'Integer';
  if (rawDefault && typeof rawDefault === 'object' && 'rdate' in rawDefault) return 'Date';
  if ([rawDefault, ...rawValues].some(isAssetOrControlGroupId)) return 'Asset';
  if (rawValues.length > 0) return 'Enum';
  return 'String';
}

function knownParamType(rawType: unknown): string | undefined {
  if (typeof rawType === 'string') {
    const trimmed = rawType.trim();
    const compactKey = trimmed.replace(/\s+/g, '').toLowerCase();
    const known = PARAM_TYPE_ALIASES[compactKey];
    if (known) return known;
  }
  return undefined;
}

export function paramTypeFromRecord(
  record: Record<string, unknown>,
  rawDefault: unknown,
  rawValues: unknown[],
): string {
  return knownParamType(record.type) ??
    knownParamType(record.controlType) ??
    inferParamType(rawDefault, rawValues);
}
