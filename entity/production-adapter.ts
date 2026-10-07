import { EntityApi } from '../api/entity/index.js';
import { MarqueeError } from '../transport/index.js';
import type { Endpoint, HttpRequestInit } from '../transport/index.js';
import type {
  Asset,
  Country,
  Entity,
  EntityError,
  EntityIdentifier,
  EntityResolveValue,
  EntityResolveInput,
  EntityResult,
  Portfolio,
} from './types.js';
import type {
  EntityAdapter,
  EntityAdapterResolution,
} from './port.js';
import { soleElement } from '../lib/sole-element.js';
import { normalizeEntityResolutionValue } from './normalization.js';
import { assetFromAttributes } from './asset-attributes.js';
import { record, text } from '../lib/json-value.js';

const ENTITY_GET_LIMIT = 40;
const TYPED_ENTITY_CHUNK_SIZE = 50;
const MATCH_HEDGE_DELAYS_MS = [500, 1250];
const API_FORBIDDEN_QUERY_CHARS_RE = /[&?]/g;
const DOTTED_SHARE_CLASS_RE = /^([A-Za-z]{1,8})\.([A-Za-z])(\s+.*)?$/;

type EntityRequestInit = HttpRequestInit & { hedgeDelaysMs?: number[] };
type EntityTransport = {
  request(endpoint: Endpoint, init?: EntityRequestInit): Promise<unknown>;
};

function isProviderNotFound(value: Record<string, unknown>): boolean {
  return value.status_code === 404;
}

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
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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
      const decodedRecord = record(value);
      if (decodedRecord && isProviderNotFound(decodedRecord)) continue;
      const decoded = decodedRecord ? decode(decodedRecord) : undefined;
      if (!decoded) return { ok: false, error: { kind: 'malformed-entity' } };
      entities.push(decoded);
    }
  }
  return { ok: true, value: entities };
}

async function resolveAssets(
  transport: EntityTransport,
  identifiers: readonly EntityIdentifier[],
  lookup: 'id' | 'identity' | 'query',
): Promise<{ ok: true; value: readonly Entity[] } | { ok: false; error: EntityError }> {
  if (identifiers.length === 0) return { ok: true, value: [] };
  const ids = identifiers.map(({ value }) => (
    lookup === 'query' ? normalizeAssetQuery(value) : value
  ));
  const entities = new EntityApi(lookup === 'query'
    ? { request: (endpoint, init) => transport.request(endpoint, { ...init, hedgeDelaysMs: MATCH_HEDGE_DELAYS_MS }) }
    : transport);
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
): Promise<{ ok: true; value: readonly Entity[] } | { ok: false; error: EntityError }> {
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

async function matchEntities(
  transport: EntityTransport,
  identifiers: readonly string[],
): Promise<EntityResult<readonly Entity[]>> {
  return resolveAssets(
    transport,
    identifiers.map((value): EntityIdentifier => ({ kind: 'asset', value })),
    'query',
  );
}

function resolveAllFailFast(
  pending: readonly Promise<EntityResult<readonly Entity[]>>[],
): Promise<EntityResult<readonly Entity[]>> {
  if (pending.length === 0) return Promise.resolve({ ok: true, value: [] });
  return new Promise((resolve, reject) => {
    const values: Array<readonly Entity[] | undefined> = Array.from({ length: pending.length });
    let remaining = pending.length;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    pending.forEach((promise, index) => {
      promise.then((result) => {
        if (settled) return;
        if (!result.ok) {
          settled = true;
          resolve(result);
          return;
        }
        values[index] = result.value;
        remaining -= 1;
        if (remaining === 0) {
          settled = true;
          resolve({ ok: true, value: values.flatMap((value) => value ?? []) });
        }
      }, fail);
    });
  });
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

function orderedResolutions(
  input: readonly EntityResolveInput[],
  entities: readonly Entity[],
): readonly EntityResolveValue[] {
  const resolutions: EntityResolveValue[] = [];
  for (const identifier of input) {
    const resolved = entityForInput(entities, identifier);
    if (!resolved) {
      resolutions.push({ ...identifier, status: 'not-found' });
      continue;
    }
    resolutions.push(resolved);
  }
  return resolutions;
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

function resolveAssetBatch(
  transport: EntityTransport,
  identifiers: readonly EntityIdentifier[],
): Promise<EntityResult<readonly Entity[]>> {
  const canonicalIds = identifiers.filter(({ value }) => isCanonicalAssetIdentifier(value));
  const queries = identifiers.filter(({ value }) => !isCanonicalAssetIdentifier(value));
  if (identifiers.length <= ENTITY_GET_LIMIT) {
    return resolveAllFailFast([
      resolveAssets(transport, canonicalIds, 'id'),
      resolveAssets(transport, queries, 'query'),
    ]);
  }
  return resolveAssets(transport, identifiers, queries.length > 0 ? 'query' : 'id');
}

async function resolveBatch(
  transport: EntityTransport,
  input: readonly EntityResolveInput[],
): Promise<EntityResult<EntityAdapterResolution>> {
  const assets = input.filter(({ kind }) => kind === 'asset');
  const countries = input.filter(({ kind }) => kind === 'country');
  const portfolios = input.filter(({ kind }) => kind === 'portfolio');
  const resolved = await resolveAllFailFast([
    resolveAssetBatch(transport, assets),
    resolveTypedEntities(transport, countries, 'Country'),
    resolveTypedEntities(transport, portfolios, 'Portfolio'),
  ]);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    value: {
      resolutions: orderedResolutions(input, resolved.value),
      discoveredEntities: resolved.value,
    },
  };
}

async function resolveIdentityBatch(
  transport: EntityTransport,
  identifier: EntityIdentifier,
): Promise<EntityResult<EntityAdapterResolution>> {
  const resolved = identifier.kind === 'asset'
    ? await resolveAssets(
        transport,
        [identifier],
        isCanonicalAssetIdentifier(identifier.value) ? 'identity' : 'query',
      )
    : await resolveTypedEntities(
        transport,
        [identifier],
        identifier.kind === 'country' ? 'Country' : 'Portfolio',
      );
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    value: {
      resolutions: orderedResolutions([identifier], resolved.value),
      discoveredEntities: resolved.value,
    },
  };
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
      if (options?.purpose === 'identity') {
        return resolveIdentityBatch(transport, first);
      }
      return resolveBatch(transport, input);
    },
    resolveMatches(identifiers) {
      return matchEntities(transport, identifiers);
    },
  };
}
