import type {
  Entity,
  EntityError,
  EntityIdentifier,
  EntityMatch,
  EntityModule,
  EntityNotFound,
  EntityResolveValue,
  EntityResolveInput,
  EntityResult,
  ResolvedEntityValue,
} from './types.js';
import type { EntityAdapter } from './port.js';
import type { EntityCache } from './cache.js';
import { normalizeEntityResolutionValue } from './normalization.js';

export function isEntityNotFound(
  value: EntityResolveValue,
): value is EntityNotFound {
  return 'status' in value;
}

function canonicalMarqueeIdentity(value: string): string {
  const trimmed = value.trim();
  return /^(?:mw|md|ma|mp)[a-z0-9]+$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

const OPAQUE_ASSET_IDENTIFIER_PATTERN = /^[A-Z0-9]{15,}$/;

function isUnresolvedIdentifier(
  value: unknown,
  knownLabels: Readonly<Record<string, string>>,
): boolean {
  if (typeof value !== 'string') return false;
  const label = knownLabels[value];
  const resolved = typeof label === 'string' && label.length > 0 && label !== value;
  if (value.startsWith('MA')) return !resolved;
  return OPAQUE_ASSET_IDENTIFIER_PATTERN.test(value) && !resolved;
}

function normalizedSourceLabel(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(normalizedSourceLabel).filter(
      (part): part is string => part !== undefined,
    );
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  for (const key of ['id', 'source', 'name', 'label', 'displayName']) {
    const candidate = normalizedSourceLabel(source[key]);
    if (candidate) return candidate;
  }
  const details = ['service', 'queryType', 'dataset', 'type', 'field', 'measure', 'vendor']
    .map((key) => normalizedSourceLabel(source[key]))
    .filter((part): part is string => part !== undefined);
  return details.length > 0 ? details.join(' ') : undefined;
}

export function resolveEntitySourceLabels(values: readonly unknown[]): string[] {
  return [...new Set(values.map(normalizedSourceLabel).filter(
    (label): label is string => label !== undefined,
  ))];
}

const MARKET_CODE_PATTERN = /^[A-Z0-9_*./-]{1,16} [A-Z*]{2,4}$/;
const ASSET_CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{1,14}$/;
const NON_ASSET_ID_PATTERN = /^(?:CH|DV|MD|MW|WC)[A-Z0-9_.-]*\d[A-Z0-9_.-]*$/;

function isEntityMarketCode(value: unknown): boolean {
  return typeof value === 'string' && MARKET_CODE_PATTERN.test(value.trim());
}

function isEntityAssetCode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const label = value.trim();
  return isEntityMarketCode(label)
    || (ASSET_CODE_PATTERN.test(label) && !NON_ASSET_ID_PATTERN.test(label));
}

function entityDisplayValue(
  value: unknown,
  entityMap: Readonly<Record<string, string>>,
): unknown {
  if (Array.isArray(value)) return value.map((entry) => entityDisplayValue(entry, entityMap));
  if (typeof value === 'string') return entityMap[value] ?? value;
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const relativeDate = record.rdate;
  if (relativeDate && typeof relativeDate === 'object') {
    return (relativeDate as Record<string, unknown>).rule;
  }
  for (const field of ['label', 'display', 'displayName', 'name', 'title', 'value']) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      return entityDisplayValue(record[field], entityMap);
    }
  }
  return value;
}

function entityDisplayKey(
  value: unknown,
  entityMap: Readonly<Record<string, string>>,
): string {
  const display = entityDisplayValue(value, entityMap);
  if (display === null || display === undefined) return '';
  if (typeof display === 'object') return JSON.stringify(display);
  // Display values come from JSON, so the rest are its primitives.
  const primitive = display as string | number | boolean;
  return String(primitive);
}

function deduplicateEntityValues(
  values: readonly unknown[],
  entityMap: Readonly<Record<string, string>>,
): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = entityDisplayKey(value, entityMap);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectResolvedEntityValues(
  values: readonly unknown[],
  entityMap: Readonly<Record<string, string>>,
  limit?: number,
): unknown[] {
  const selected: unknown[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (isUnresolvedIdentifier(value, entityMap)) continue;
    const key = entityDisplayKey(value, entityMap);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(value);
    if (limit !== undefined && selected.length >= limit) break;
  }
  return selected;
}

function matchingText(entity: Entity): string {
  return [entity.label, entity.entityId, ...entity.aliases].join(' ').toLowerCase();
}

function entityMatches(
  entities: readonly Entity[],
  query: string | undefined,
  limit: number,
): EntityMatch[] {
  const folded = query?.trim().toLowerCase() ?? '';
  const filtered = entities
    .filter((entity) => !folded || matchingText(entity).includes(folded))
    .slice(0, Math.max(0, limit));
  const displayValue = (entity: Entity) => entity.label;
  const displayCounts = new Map<string, number>();
  for (const entity of filtered) {
    const display = displayValue(entity);
    displayCounts.set(display, (displayCounts.get(display) ?? 0) + 1);
  }
  return filtered.map((entity) => {
    const rawDisplay = displayValue(entity);
    const qualifier = entity.aliases[0] ?? entity.entityId;
    const display = (displayCounts.get(rawDisplay) ?? 0) > 1 && qualifier !== rawDisplay
      ? `${rawDisplay} (${qualifier})`
      : rawDisplay;
    return {
      entityId: entity.entityId,
      display,
      aliases: entity.aliases,
    };
  });
}

function resolutionKey(input: EntityResolveInput): string {
  return `${input.kind}:${normalizeEntityResolutionValue(input.value)}`;
}

function restoreResolutionOrder(
  input: readonly EntityResolveInput[],
  uniqueInput: readonly EntityResolveInput[],
  resolutions: readonly EntityResolveValue[],
): EntityResult<readonly EntityResolveValue[]> {
  if (uniqueInput.length !== resolutions.length) {
    return { ok: false, error: { kind: 'malformed-entity' } };
  }
  const mismatchedIndex = uniqueInput.findIndex((identifier, index) => (
    resolutions[index]?.kind !== identifier.kind
  ));
  if (mismatchedIndex >= 0) {
    return {
      ok: false,
      error: { kind: 'malformed-entity', identifier: uniqueInput[mismatchedIndex] },
    };
  }
  const byKey = new Map(
    uniqueInput.map((identifier, index) => [resolutionKey(identifier), resolutions[index]]),
  );
  const ordered = input.map((identifier) => byKey.get(resolutionKey(identifier)));
  if (ordered.some((resolution) => resolution === undefined)) {
    return { ok: false, error: { kind: 'malformed-entity' } };
  }
  return { ok: true, value: ordered as EntityResolveValue[] };
}

type ResolutionPurpose = 'batch' | 'identity';

type ResolutionEvidence = Readonly<{
  resolution: EntityResolveValue;
  discoveredEntities: readonly Entity[];
}>;

type PendingResolution = Readonly<{
  input: EntityResolveInput;
  purpose: ResolutionPurpose;
  promise: Promise<EntityResult<ResolutionEvidence>>;
  settle(result: EntityResult<ResolutionEvidence>): void;
}>;

function pendingResolution(
  input: EntityResolveInput,
  purpose: ResolutionPurpose,
): PendingResolution {
  let settle!: (result: EntityResult<ResolutionEvidence>) => void;
  const promise = new Promise<EntityResult<ResolutionEvidence>>((resolve) => {
    settle = resolve;
  });
  return { input, purpose, promise, settle };
}

function partitionByAdapterBatch(
  adapter: EntityAdapter,
  batch: readonly [string, PendingResolution][],
): Array<Array<[string, PendingResolution]>> {
  const partitions = new Map<string, [[string, PendingResolution], ...Array<[string, PendingResolution]>]>();
  const pendingInputs = batch
    .filter(([, request]) => request.purpose === 'batch')
    .map(([, request]) => request.input);
  for (const entry of batch) {
    const request = entry[1];
    const key = request.purpose === 'identity'
      ? `identity:${resolutionKey(request.input)}`
      : `batch:${adapter.batchKey(request.input, pendingInputs)}`;
    const partition = partitions.get(key);
    if (partition) partition.push(entry);
    else partitions.set(key, [entry]);
  }
  return [...partitions.values()].flatMap((partition) => {
    const size = adapter.maxBatchSize(partition[0][1].input);
    const chunks: Array<Array<[string, PendingResolution]>> = [];
    for (let index = 0; index < partition.length; index += size) {
      chunks.push(partition.slice(index, index + size));
    }
    return chunks;
  });
}

async function settleFailedResolutionBatch(
  adapter: EntityAdapter,
  batch: readonly [string, PendingResolution][],
  error: EntityError,
): Promise<void> {
  const failedKey = 'identifier' in error && error.identifier
    ? resolutionKey(error.identifier)
    : undefined;
  const failed = failedKey
    ? batch.find(([, request]) => resolutionKey(request.input) === failedKey)
    : undefined;
  if (failed && batch.length > 1) {
    failed[1].settle({ ok: false, error });
    await settleResolutionBatch(
      adapter,
      batch.filter(([, request]) => resolutionKey(request.input) !== failedKey),
    );
    return;
  }
  for (const [, request] of batch) request.settle({ ok: false, error });
}

async function settleResolutionBatch(
  adapter: EntityAdapter,
  batch: readonly [string, PendingResolution][],
): Promise<void> {
  const input = batch.map(([, request]) => request.input);
  const result = await adapter.resolve(
    input,
    batch[0]?.[1].purpose === 'identity' ? { purpose: 'identity' } : undefined,
  );
  if (!result.ok) {
    await settleFailedResolutionBatch(adapter, batch, result.error);
    return;
  }
  const ordered = restoreResolutionOrder(input, input, result.value.resolutions);
  if (!ordered.ok) {
    for (const [, request] of batch) request.settle(ordered);
    return;
  }
  ordered.value.forEach((resolution, index) => {
    batch[index]?.[1].settle({
      ok: true,
      value: {
        resolution,
        discoveredEntities: result.value.discoveredEntities,
      },
    });
  });
}

function awaitResolutionsFailFast(
  pending: readonly Promise<EntityResult<ResolutionEvidence>>[],
): Promise<EntityResult<readonly ResolutionEvidence[]>> {
  if (pending.length === 0) return Promise.resolve({ ok: true, value: [] });
  return new Promise((resolve, reject) => {
    const values: Array<ResolutionEvidence | undefined> = Array.from({ length: pending.length });
    let remaining = pending.length;
    let settled = false;
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
          resolve({ ok: true, value: values as ResolutionEvidence[] });
        }
      }, reject);
    });
  });
}

type EntityResolver = Pick<
  EntityModule,
  'resolveIdentity' | 'resolve' | 'resolveMatches'
>;

function createEntityResolver(
  adapter: EntityAdapter,
  cache?: EntityCache,
): EntityResolver {
  const pending = new Map<string, PendingResolution>();
  const inFlight = new Map<string, Promise<EntityResult<ResolutionEvidence>>>();
  const discovered = new Map<string, Entity>();
  let dispatchScheduled = false;

  function pendingKey(input: EntityResolveInput, purpose: ResolutionPurpose): string {
    return `${purpose}:${resolutionKey(input)}`;
  }

  function activeResolution(
    input: EntityResolveInput,
    purpose: ResolutionPurpose,
  ): Promise<EntityResult<ResolutionEvidence>> | undefined {
    const key = pendingKey(input, purpose);
    return inFlight.get(key) ?? pending.get(key)?.promise;
  }

  function rememberDiscoveredEntities(entities: readonly Entity[]): void {
    for (const entity of entities) {
      for (const value of [entity.entityId, ...entity.aliases]) {
        const key = resolutionKey({ kind: entity.kind, value });
        if (!discovered.has(key)) discovered.set(key, entity);
      }
    }
  }

  async function dispatchPending(): Promise<void> {
    dispatchScheduled = false;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [key, request] of batch) inFlight.set(key, request.promise);
    try {
      await Promise.all(partitionByAdapterBatch(adapter, batch).map((adapterBatch) => (
        settleResolutionBatch(adapter, adapterBatch)
      )));
    } catch {
      for (const [, request] of batch) {
        request.settle({
          ok: false,
          error: {
            kind: 'dependency',
            failure: { kind: 'unavailable' },
          },
        });
      }
    } finally {
      for (const [key] of batch) inFlight.delete(key);
    }
  }

  function resolvePending(
    input: EntityResolveInput,
    purpose: ResolutionPurpose = 'batch',
    cached?: ResolvedEntityValue,
    readCache = true,
  ): Promise<EntityResult<ResolutionEvidence>> {
    const key = pendingKey(input, purpose);
    const active = activeResolution(input, purpose);
    if (active) return active;
    const stored = cached ?? (readCache ? cache?.read([input])[0] : undefined);
    if (stored) {
      return Promise.resolve({
        ok: true,
        value: { resolution: stored, discoveredEntities: [] },
      });
    }
    const request = pendingResolution(input, purpose);
    pending.set(key, request);
    if (!dispatchScheduled) {
      dispatchScheduled = true;
      queueMicrotask(() => void dispatchPending());
    }
    return request.promise;
  }

  function resolvePendingBatch(
    input: readonly EntityResolveInput[],
  ): Array<Promise<EntityResult<ResolutionEvidence>>> {
    const active = input.map((identifier) => activeResolution(identifier, 'batch'));
    const inactive = input.filter((_identifier, index) => active[index] === undefined);
    const stored = inactive.length > 0 ? cache?.read(inactive) ?? [] : [];
    const cached = inactive.map((identifier, index) => (
      discovered.get(resolutionKey(identifier)) ?? stored[index]
    ));
    let cacheIndex = 0;
    return input.map((identifier, index) => {
      const shared = active[index];
      if (shared) return shared;
      return resolvePending(identifier, 'batch', cached[cacheIndex++], false);
    });
  }

  function rememberResolutions(
    input: readonly EntityResolveInput[],
    evidence: readonly ResolutionEvidence[],
  ): EntityResolveValue[] {
    const resolutions = evidence.map(({ resolution }) => resolution);
    rememberDiscoveredEntities(evidence.flatMap(({ discoveredEntities }) => discoveredEntities));
    resolutions.forEach((resolution, index) => {
      const requested = input[index];
      if (requested && !isEntityNotFound(resolution)) {
        discovered.set(resolutionKey(requested), resolution);
      }
    });
    const cacheable = resolutions.flatMap((resolution, index) => {
      const requested = input[index];
      return requested && !isEntityNotFound(resolution)
        ? [{ requested, resolution }]
        : [];
    });
    if (cacheable.length > 0) {
      cache?.merge(
        cacheable.map(({ requested }) => requested),
        cacheable.map(({ resolution }) => resolution),
      );
    }
    return resolutions;
  }

  return {
    async resolveIdentity(identifier: EntityIdentifier) {
      if (identifier.value.trim().length === 0) {
        return { ok: false, error: { kind: 'invalid-identifier', identifier } };
      }
      const result = await resolvePending(identifier, 'identity');
      if (!result.ok) {
        return result.error.kind === 'not-found'
          ? { ok: true, value: null }
          : result;
      }
      const value = result.value.resolution;
      if (isEntityNotFound(value)) return { ok: true, value: null };
      if (value.kind !== identifier.kind) {
        return { ok: false, error: { kind: 'malformed-entity', identifier } };
      }
      rememberResolutions([identifier], [result.value]);
      return { ok: true, value };
    },
    async resolve(input) {
      const invalidIdentifier = input.find(({ value }) => value.trim().length === 0);
      if (invalidIdentifier) {
        return {
          ok: false,
          error: { kind: 'invalid-identifier', identifier: invalidIdentifier },
        };
      }
      const result = await awaitResolutionsFailFast(resolvePendingBatch(input));
      if (!result.ok) return result;
      return { ok: true, value: rememberResolutions(input, result.value) };
    },
    async resolveMatches(identifiers, query, limit = 30) {
      const result = await adapter.resolveMatches(identifiers, query, limit);
      if (!result.ok) return result;
      return { ok: true, value: entityMatches(result.value, query, limit) };
    },
  };
}

export function assembleEntityModule(
  adapter: EntityAdapter,
  cache?: EntityCache,
): EntityModule {
  const resolver = createEntityResolver(adapter, cache);
  const entity: EntityModule = {
    resolveCanonicalIdentity: canonicalMarqueeIdentity,
    resolveIsUnresolvedIdentifier: isUnresolvedIdentifier,
    resolveSourceLabels: resolveEntitySourceLabels,
    resolveIsAssetCode: isEntityAssetCode,
    resolveIsMarketCode: isEntityMarketCode,
    resolveDisplayKey: entityDisplayKey,
    resolveDeduplicatedValues: deduplicateEntityValues,
    resolveSelectedValues: selectResolvedEntityValues,
    ...resolver,
  };
  return entity;
}
