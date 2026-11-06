import { EntityApi } from '../api/entity/index.js';
import { MarqueeError } from '../transport/index.js';
import type { Endpoint, HttpRequestInit } from '../transport/index.js';
import type {
  Asset,
  Country,
  Entity,
  EntityError,
  EntityIdentifier,
  EntityResolveInput,
  EntityResult,
  Portfolio,
} from './types.js';
import type { EntityAdapter } from './port.js';
import { soleElement } from '../lib/sole-element.js';
import { normalizeEntityResolutionValue } from './normalization.js';
import { assetFromAttributes } from './asset-attributes.js';
import { allOk } from '../lib/result.js';
import { record, text } from '../lib/json-value.js';

const ENTITY_GET_LIMIT = 40;
const TYPED_ENTITY_CHUNK_SIZE = 50;
const API_FORBIDDEN_QUERY_CHARS_RE = /[&?]/g;
const DOTTED_SHARE_CLASS_RE = /^([A-Za-z]{1,8})\.([A-Za-z])(\s+.*)?$/;

type EntityTransport = {
  request(endpoint: Endpoint, init?: HttpRequestInit): Promise<unknown>;
};

function asset(entity: Record<string, unknown>): Asset | undefined {
  return assetFromAttributes(entity, text(entity.id));
}

function country(entity: Record<string, unknown>): Country | undefined {
  const id = text(entity.id);
  const entityLabel = text(entity.name) ?? text(entity.title);
  const region = text(entity.region);
  const subRegion = text(entity.subRegion);
  if (!id || !entityLabel || text(entity.ticker) || text(entity.assetClass)) {
    return undefined;
  }
  return {
    kind: 'country',
    entityId: id,
    label: entityLabel,
    aliases: [],
    ...(region ? { region } : {}),
    ...(subRegion ? { subRegion } : {}),
  };
}

function portfolio(entity: Record<string, unknown>): Portfolio | undefined {
  const id = text(entity.id);
  const entityLabel = text(entity.name) ?? text(entity.title);
  const currency = text(entity.currency);
  if (!id || !entityLabel) return undefined;
  return {
    kind: 'portfolio',
    entityId: id,
    label: entityLabel,
    aliases: [],
    ...(currency ? { currency } : {}),
  };
}

function entityError(error: unknown, identifier?: EntityIdentifier): EntityError {
  if (error instanceof MarqueeError) {
    if (error.details?.status === 403) return { kind: 'access-denied', identifier };
    if (error.code === 'auth_expired') {
      return {
        kind: 'dependency',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      };
    }
    if (error.details?.status === 429) {
      return { kind: 'dependency', failure: { kind: 'rate-limited' } };
    }
    if (error.code === 'timeout') {
      return { kind: 'dependency', failure: { kind: 'timeout' } };
    }
    if (error.details?.isCanceled === true) {
      return { kind: 'dependency', failure: { kind: 'cancelled' } };
    }
  }
  return { kind: 'dependency', failure: { kind: 'unavailable' } };
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

function normalizeAssetQuery(value: string): string {
  const sanitized = value.trim().replace(API_FORBIDDEN_QUERY_CHARS_RE, ' ').replace(/\s+/g, ' ');
  return sanitized.replace(
    DOTTED_SHARE_CLASS_RE,
    (_match, ticker: string, shareClass: string, suffix = '') =>
      `${ticker.toUpperCase()}/${shareClass.toUpperCase()}${suffix}`,
  ).toUpperCase();
}

function isAssetShapedCountry(value: unknown): boolean {
  const entity = record(value);
  return entity !== undefined
    && (text(entity.ticker) !== undefined || text(entity.assetClass) !== undefined)
    && asset(entity) !== undefined;
}

function entityResponseCollection(response: unknown, key: string): unknown {
  const responseRecord = record(response);
  if (responseRecord
    && responseRecord[key] === undefined
    && text(responseRecord.requestId)
    && Object.keys(responseRecord).every((field) => field === 'requestId')) {
    return { [key]: [] };
  }
  const values = responseRecord?.[key];
  if (key === 'countries' && Array.isArray(values)) {
    return {
      ...responseRecord,
      [key]: values.filter((value) => !isAssetShapedCountry(value)),
    };
  }
  return response;
}

// The provider's fan-out can answer 200 with a status entry in place of an entity: 404 is an
// unresolved identity, any other status a provider failure.
function decodeEntityValue(
  value: unknown,
  decode: (value: Record<string, unknown>) => Entity | undefined,
): EntityResult<Entity | undefined> {
  const decodedRecord = record(value);
  const status = decodedRecord?.status_code;
  if (status === 404) return { ok: true, value: undefined };
  if (typeof status === 'number') {
    return { ok: false, error: { kind: 'dependency', failure: { kind: 'unavailable' } } };
  }
  const decoded = decodedRecord ? decode(decodedRecord) : undefined;
  return decoded ? { ok: true, value: decoded } : { ok: false, error: { kind: 'malformed-entity' } };
}

function decodeEntityResponses(
  responses: readonly unknown[],
  key: string,
  decode: (value: Record<string, unknown>) => Entity | undefined,
): EntityResult<readonly Entity[]> {
  const entities: Entity[] = [];
  for (const response of responses) {
    const responseRecord = record(response);
    const values = responseRecord?.[key];
    if (!Array.isArray(values)) return { ok: false, error: { kind: 'malformed-entity' } };
    for (const value of values) {
      const decoded = decodeEntityValue(value, decode);
      if (!decoded.ok) return decoded;
      if (decoded.value) entities.push(decoded.value);
    }
  }
  return { ok: true, value: entities };
}

async function resolveAssets(
  transport: EntityTransport,
  identifiers: readonly EntityIdentifier[],
  lookup: 'id' | 'identity' | 'query',
): Promise<EntityResult<readonly Entity[]>> {
  if (identifiers.length === 0) return { ok: true, value: [] };
  const ids = identifiers.map(({ value }) => (
    lookup === 'query' ? normalizeAssetQuery(value) : value
  ));
  const entities = new EntityApi(transport);
  try {
    const response = await (identifiers.length <= ENTITY_GET_LIMIT
      ? entities.getEntities({ entityIds: ids, ...(lookup === 'id' ? {} : { type: 'Asset' }) })
      : entities.postEntities({ entityIds: ids, types: ['Asset', 'Control_Group'] }));
    return decodeEntityResponses(
      [entityResponseCollection(response, 'assets')],
      'assets',
      asset,
    );
  } catch (error) {
    return { ok: false, error: entityError(error, soleElement(identifiers)) };
  }
}

async function resolveTypedEntities(
  transport: EntityTransport,
  identifiers: readonly EntityIdentifier[],
  type: 'Country' | 'Portfolio',
): Promise<EntityResult<readonly Entity[]>> {
  if (identifiers.length === 0) return { ok: true, value: [] };
  try {
    const responses = await Promise.all(chunks(identifiers, TYPED_ENTITY_CHUNK_SIZE).map((batch) =>
      new EntityApi(transport).getEntities({ entityIds: batch.map(({ value }) => value), type })));
    const key = type === 'Country' ? 'countries' : 'portfolios';
    const decode = type === 'Country' ? country : portfolio;
    return decodeEntityResponses(
      responses.map((response) => entityResponseCollection(response, key)),
      key,
      decode,
    );
  } catch (error) {
    return { ok: false, error: entityError(error, soleElement(identifiers)) };
  }
}

function entityForInput(
  entities: readonly Entity[],
  input: EntityResolveInput,
): Entity | undefined {
  const requested = normalizeEntityResolutionValue(
    input.kind === 'asset' && !isCanonicalAssetIdentifier(input.value)
      ? normalizeAssetQuery(input.value)
      : input.value,
  );
  return entities.find((entity) => (
    entity.kind === input.kind
    && [
      entity.entityId,
      entity.label,
      ...entity.aliases,
      ...(entity.kind === 'asset' ? [entity.ticker, entity.bbid] : []),
    ]
      .filter((identity): identity is string => identity !== undefined)
      .some((identity) => normalizeEntityResolutionValue(identity) === requested)
  ));
}

function resolutionBatchKey(
  input: EntityResolveInput,
  pending: readonly EntityResolveInput[],
): string {
  if (input.kind !== 'asset') return input.kind;
  const assetBatchSize = pending.filter(({ kind }) => kind === 'asset').length;
  if (assetBatchSize > ENTITY_GET_LIMIT) return input.kind;
  return isCanonicalAssetIdentifier(input.value)
    ? 'asset-id'
    : 'asset-query';
}

function isCanonicalAssetIdentifier(value: string): boolean {
  return value.toUpperCase().startsWith('MA');
}

async function resolveAssetBatch(
  transport: EntityTransport,
  identifiers: readonly EntityIdentifier[],
): Promise<EntityResult<readonly Entity[]>> {
  const canonicalIds = identifiers.filter(({ value }) => isCanonicalAssetIdentifier(value));
  const queries = identifiers.filter(({ value }) => !isCanonicalAssetIdentifier(value));
  if (identifiers.length > ENTITY_GET_LIMIT) {
    return resolveAssets(transport, identifiers, queries.length > 0 ? 'query' : 'id');
  }
  const resolved = await allOk([
    resolveAssets(transport, canonicalIds, 'id'),
    resolveAssets(transport, queries, 'query'),
  ]);
  return resolved.ok ? { ok: true, value: resolved.value.flat() } : resolved;
}

async function resolveBatch(
  transport: EntityTransport,
  input: readonly EntityResolveInput[],
): Promise<EntityResult<readonly Entity[]>> {
  const assets = input.filter(({ kind }) => kind === 'asset');
  const countries = input.filter(({ kind }) => kind === 'country');
  const portfolios = input.filter(({ kind }) => kind === 'portfolio');
  const resolved = await allOk([
    resolveAssetBatch(transport, assets),
    resolveTypedEntities(transport, countries, 'Country'),
    resolveTypedEntities(transport, portfolios, 'Portfolio'),
  ]);
  return resolved.ok ? { ok: true, value: resolved.value.flat() } : resolved;
}

function resolveIdentity(
  transport: EntityTransport,
  identifier: EntityIdentifier,
): Promise<EntityResult<readonly Entity[]>> {
  return identifier.kind === 'asset'
    ? resolveAssets(
        transport,
        [identifier],
        isCanonicalAssetIdentifier(identifier.value) ? 'identity' : 'query',
      )
    : resolveTypedEntities(
        transport,
        [identifier],
        identifier.kind === 'country' ? 'Country' : 'Portfolio',
      );
}

export function createEntityProductionAdapter(transport: EntityTransport): EntityAdapter {
  return {
    batchKey: resolutionBatchKey,
    maxBatchSize(input) {
      return input.kind === 'asset' ? Number.MAX_SAFE_INTEGER : TYPED_ENTITY_CHUNK_SIZE;
    },
    async resolve(input, options) {
      const [first] = input;
      if (first === undefined) {
        return { ok: true, value: { resolutions: [], discoveredEntities: [] } };
      }
      const identity = options?.purpose === 'identity';
      const resolved = await (identity ? resolveIdentity(transport, first) : resolveBatch(transport, input));
      if (!resolved.ok) return resolved;
      return {
        ok: true,
        value: {
          resolutions: (identity ? [first] : input).map((identifier) => (
            entityForInput(resolved.value, identifier) ?? { ...identifier, status: 'not-found' }
          )),
          discoveredEntities: resolved.value,
        },
      };
    },
    resolveMatches(identifiers) {
      return resolveAssets(
        transport,
        identifiers.map((value): EntityIdentifier => ({ kind: 'asset', value })),
        'query',
      );
    },
  };
}
