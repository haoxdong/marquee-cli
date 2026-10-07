import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { lockSync, unlockSync } from 'proper-lockfile';
import type {
  ArtifactIdentity,
  ArtifactMembership,
  ArtifactRef,
  ArtifactRegistry,
  InteractionSessionNamespace,
  InteractionSessionNamespaceOptions,
  Ref,
  RegistryArtifact,
  RegistryArtifactHandle,
  RegistryArtifactInput,
  StoredArtifact,
} from './types.js';
import { isArtifactRef } from './ref-resolution.js';
import { RegistryLockError } from './errors.js';
import { cleanupInactiveRegistries } from './cleanup.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RegistryState {
  schemaVersion: 6;
  lastUsedAt: number;
  counters: Record<string, number>;
  refs: Record<string, ArtifactRef>;
  artifacts: Record<string, StoredArtifact>;
  payloads: Record<string, unknown>;
  /** Insertion-order list of payload keys for LRU eviction. */
  payloadOrder?: string[] | undefined;
  interactionNamespaces: Record<string, StoredInteractionNamespace>;
  interactionNamespaceNames: string[];
}

type StoredInteractionNamespace = Readonly<{
  lastUsedAt: number;
  value: unknown;
}>;

/**
 * Maximum number of payloads retained in the registry. Older payloads (and
 * their child refs) are evicted when this limit is exceeded. This prevents
 * the registry file from growing unboundedly across long sessions.
 */
const MAX_PAYLOADS = 50;

type RegistrySessionId = number | string;

interface ArtifactRegistryOptions {
  inactivityMs?: number;
  now?: () => number;
}

const DEFAULT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1_000;

function registryFile(dir: string, sessionId: RegistrySessionId): string {
  const digest = createHash('sha256')
    .update(String(sessionId))
    .digest('hex')
    .slice(0, 16);
  return join(dir, `v6-${digest}.artifact-registry.json`);
}

function defaultState(now: number): RegistryState {
  return {
    schemaVersion: 6,
    lastUsedAt: now,
    counters: {},
    refs: {},
    artifacts: {},
    payloads: {},
    interactionNamespaces: {},
    interactionNamespaceNames: [],
  };
}

function isArtifactIdentity(value: unknown): value is ArtifactIdentity {
  if (!isRecord(value) || typeof value.family !== 'string') return false;
  switch (value.family) {
    case 'search':
      return (value.searchKind === 'market-data' || value.searchKind === 'research')
        && Object.keys(value).every((field) => field === 'family' || field === 'searchKind');
    case 'widget':
      return typeof value.widgetId === 'string'
        && value.widgetId.startsWith('MW')
        && Object.keys(value).every((field) => (
          field === 'family'
          || field === 'widgetId'
          || field === 'configurationId'
          || field === 'selectedContext'
        ))
        && (value.configurationId === undefined || (
          typeof value.configurationId === 'string'
          && value.configurationId.startsWith('WC')
        ))
        && (value.selectedContext === undefined || (
          typeof value.selectedContext === 'string'
          && value.selectedContext.length > 0
        ));
    case 'dashboard':
      return typeof value.dashboardId === 'string'
        && Object.keys(value).every((field) => field === 'family' || field === 'dashboardId');
    case 'entity-feed':
      return typeof value.entityId === 'string'
        && (value.entityKind === 'asset'
          || value.entityKind === 'country'
          || value.entityKind === 'portfolio')
        && Object.keys(value).every((field) => (
          field === 'family' || field === 'entityId' || field === 'entityKind'
        ));
    case 'section':
      return typeof value.dashboardId === 'string'
        && typeof value.sectionId === 'string'
        && Object.keys(value).every((field) => (
          field === 'family' || field === 'dashboardId' || field === 'sectionId'
        ));
    case 'document':
      return typeof value.documentId === 'string'
        && (value.realm === 'markets' || value.realm === 'research')
        && Object.keys(value).every((field) => (
          field === 'family' || field === 'documentId' || field === 'realm'
        ));
    default:
      return false;
  }
}

function identityMatchesRef(identity: ArtifactIdentity, ref: ArtifactRef): boolean {
  switch (identity.family) {
    case 'search':
      return ref.type === 'search' && identity.searchKind === ref.searchKind;
    case 'widget':
      return ref.type === 'widget'
        && identity.widgetId === ref.widgetId
        && identity.configurationId === ref.configurationId
        && identity.selectedContext === ref.selectedContext;
    case 'dashboard':
      return ref.type === 'dashboard' && identity.dashboardId === ref.dashboardId;
    case 'entity-feed':
      return ref.type === 'entity-feed'
        && identity.entityId === ref.entityId
        && identity.entityKind === ref.entityKind;
    case 'section':
      return ref.type === 'section'
        && identity.dashboardId === ref.dashboardId
        && identity.sectionId === ref.sectionId;
    case 'document':
      return ref.type === 'document'
        && identity.documentId === ref.documentId
        && identity.realm === ref.realm;
  }
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (
    !isRecord(value)
    || !isArtifactRef(value.ref)
    || !isArtifactIdentity(value.identity)
    || !identityMatchesRef(value.identity, value.ref)
    || !Object.keys(value).every((field) => (
      field === 'ref' || field === 'identity' || field === 'membership'
    ))
    || !isRecord(value.membership)
    || !Object.keys(value.membership).every((field) => (
      field === 'ancestors' || field === 'dashboardId' || field === 'dashboardChildId'
    ))
    || !Array.isArray(value.membership.ancestors)
    || value.membership.ancestors.some((ancestor) => typeof ancestor !== 'string')
  ) {
    return false;
  }
  const fieldsAreValid = (value.membership.dashboardId === undefined
      || typeof value.membership.dashboardId === 'string')
    && (value.membership.dashboardChildId === undefined
      || typeof value.membership.dashboardChildId === 'string');
  if (!fieldsAreValid) return false;
  const ref = value.ref;
  const hasDashboardMembership = ref.type === 'widget' && 'dashboardId' in ref;
  return hasDashboardMembership
    ? value.membership.dashboardId === ref.dashboardId
      && value.membership.dashboardChildId === ref.childId
    : value.membership.dashboardId === undefined
      && value.membership.dashboardChildId === undefined;
}

function hasInvalidInteractionNamespaces(state: Record<string, unknown>): boolean {
  return (state.interactionNamespaces !== undefined && !isRecord(state.interactionNamespaces))
    || (isRecord(state.interactionNamespaces) && Object.values(state.interactionNamespaces)
      .some((value) => (
        !isRecord(value)
        || typeof value.lastUsedAt !== 'number'
        || !Number.isFinite(value.lastUsedAt)
        || !Object.prototype.hasOwnProperty.call(value, 'value')
      )))
    || (state.interactionNamespaceNames !== undefined && (
      !Array.isArray(state.interactionNamespaceNames)
      || state.interactionNamespaceNames.some((entry) => typeof entry !== 'string')
    ));
}

function hasInvalidCounters(state: Record<string, unknown>): boolean {
  return (state.counters !== undefined && !isRecord(state.counters))
    || (isRecord(state.counters) && Object.values(state.counters).some((value) => (
      typeof value !== 'number' || !Number.isInteger(value) || value < 0
    )));
}

function storedArtifactsMatchRefs(
  refs: Record<string, ArtifactRef>,
  artifacts: Record<string, StoredArtifact>,
): boolean {
  const refNames = Object.keys(refs).sort();
  const artifactNames = Object.keys(artifacts).sort();
  return isDeepStrictEqual(refNames, artifactNames)
    && refNames.every((name) => isDeepStrictEqual(refs[name], artifacts[name]?.ref));
}

function readState(file: string, now: number, inactivityMs: number): RegistryState {
  if (!existsSync(file)) {
    return defaultState(now);
  }

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 6 ||
      typeof parsed.lastUsedAt !== 'number' ||
      !Number.isFinite(parsed.lastUsedAt) ||
      hasInvalidCounters(parsed) ||
      (parsed.refs !== undefined && !isRecord(parsed.refs)) ||
      (isRecord(parsed.refs) && Object.values(parsed.refs).some((value) => (
        !isArtifactRef(value)
      ))) ||
      (parsed.artifacts !== undefined && !isRecord(parsed.artifacts)) ||
      (isRecord(parsed.artifacts) && Object.values(parsed.artifacts).some((value) => (
        !isStoredArtifact(value)
      ))) ||
      (isRecord(parsed.refs) && isRecord(parsed.artifacts) && !storedArtifactsMatchRefs(
        parsed.refs as Record<string, ArtifactRef>,
        parsed.artifacts as unknown as Record<string, StoredArtifact>,
      )) ||
      (parsed.payloads !== undefined && !isRecord(parsed.payloads)) ||
      (parsed.payloadOrder !== undefined && (
        !Array.isArray(parsed.payloadOrder) ||
        parsed.payloadOrder.some((entry) => typeof entry !== 'string')
      )) ||
      hasInvalidInteractionNamespaces(parsed)
    ) {
      throw new Error('invalid registry state shape');
    }
    if (now - parsed.lastUsedAt > inactivityMs) {
      return defaultState(now);
    }
    return {
      schemaVersion: 6,
      lastUsedAt: now,
      counters: parsed.counters as Record<string, number> | undefined ?? {},
      refs: parsed.refs as Record<string, ArtifactRef> | undefined ?? {},
      artifacts: parsed.artifacts as Record<string, StoredArtifact> | undefined ?? {},
      payloads: parsed.payloads ?? {},
      payloadOrder: Array.isArray(parsed.payloadOrder) ? parsed.payloadOrder : undefined,
      interactionNamespaces: parsed.interactionNamespaces as
        Record<string, StoredInteractionNamespace> | undefined ?? {},
      interactionNamespaceNames: Array.isArray(parsed.interactionNamespaceNames)
        ? parsed.interactionNamespaceNames
        : [],
    };
  } catch (error) {
    throw new Error(
      `Registry state is corrupt: ${file} — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeState(file: string, state: RegistryState): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state), 'utf8');
  renameSync(temp, file);
}

const lockWait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function lockSyncRetry(file: string): void {
  const deadline = performance.now() + 15_000;
  for (;;) {
    try {
      lockSync(file, { realpath: false });
      return;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ELOCKED') {
        throw new RegistryLockError('lock-failed', error);
      }
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) throw new RegistryLockError('lock-busy', error);
      const jitterMs = Math.floor(Math.random() * 10);
      Atomics.wait(lockWait, 0, 0, Math.min(20 + jitterMs, remainingMs));
    }
  }
}

function withWriteLock<T>(
  file: string,
  now: () => number,
  inactivityMs: number,
  operation: (state: RegistryState) => T,
): T {
  lockSyncRetry(file);
  try {
    const state = readState(file, now(), inactivityMs);
    const result = operation(state);
    state.lastUsedAt = now();
    writeState(file, state);
    return result;
  } finally {
    unlockSync(file, { realpath: false });
  }
}

function touchInteractionNamespace(
  state: RegistryState,
  namespace: string,
  now: number,
  value: unknown,
  maxNamespaces: number,
): void {
  state.interactionNamespaces[namespace] = { lastUsedAt: now, value };
  state.interactionNamespaceNames = state.interactionNamespaceNames
    .filter((name) => name !== namespace);
  state.interactionNamespaceNames.push(namespace);
  while (state.interactionNamespaceNames.length > maxNamespaces) {
    const evicted = state.interactionNamespaceNames.shift();
    if (evicted !== undefined) delete state.interactionNamespaces[evicted];
  }
}

export function createInteractionSessionNamespaceStateImplementation<T>(
  dir: string,
  sessionId: RegistrySessionId,
  namespace: string,
  validate: (value: unknown) => value is T,
  options: InteractionSessionNamespaceOptions,
): InteractionSessionNamespace<T> {
  const file = registryFile(dir, sessionId);
  const now = options.now ?? Date.now;
  const inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  const maxNamespaces = options.maxNamespaces ?? MAX_PAYLOADS;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cleanupInactiveRegistries(dir, now(), inactivityMs);

  return {
    read() {
      return withWriteLock(file, now, inactivityMs, (state) => {
        const stored = state.interactionNamespaces[namespace];
        if (!stored) return undefined;
        if (!validate(stored.value)) {
          throw new Error(`Interaction Session namespace is corrupt: ${namespace}`);
        }
        touchInteractionNamespace(state, namespace, now(), stored.value, maxNamespaces);
        return stored.value;
      });
    },
    update(updater) {
      return withWriteLock(file, now, inactivityMs, (state) => {
        const stored = state.interactionNamespaces[namespace];
        if (stored && !validate(stored.value)) {
          throw new Error(`Interaction Session namespace is corrupt: ${namespace}`);
        }
        const value = updater(stored?.value as T | undefined);
        touchInteractionNamespace(state, namespace, now(), value, maxNamespaces);
        return value;
      });
    },
  };
}

function childRefName(namespace: string, child: string): Ref {
  const cleanChild = child.startsWith('@') ? child.slice(1) : child;
  if (cleanChild === namespace || cleanChild.startsWith(`${namespace}.`)) {
    return cleanChild as Ref;
  }
  return `${namespace}.${cleanChild}` as Ref;
}

function isArtifactRefName(namespace: string, refName: string): boolean {
  return refName === namespace || refName.startsWith(`${namespace}.`);
}

function artifactRefs(refs: Record<string, ArtifactRef>, namespace: string): Record<string, ArtifactRef> {
  return Object.fromEntries(
    Object.entries(refs).filter(([name]) => isArtifactRefName(namespace, name)),
  );
}

function dashboardAncestor(
  refs: Record<string, ArtifactRef>,
  name: string,
): Extract<ArtifactRef, { type: 'dashboard' }> | undefined {
  const parts = name.split('.');
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const ancestor = refs[parts.slice(0, length).join('.')];
    if (ancestor?.type === 'dashboard') return ancestor;
  }
  return undefined;
}

function assertCanonicalArtifactRefs(
  existing: Record<string, ArtifactRef>,
  refs: Record<string, ArtifactRef>,
): void {
  const combined = { ...existing, ...refs };
  for (const [name, ref] of Object.entries(combined)) {
    if (!isArtifactRef(ref)) {
      throw new Error(`Artifact @${name} has invalid canonical identity`);
    }
    const owner = ref.type === 'widget'
      ? dashboardAncestor(combined, name)
      : undefined;
    const hasDashboardMembership = ref.type === 'widget' && 'dashboardId' in ref;
    if ((owner && (!hasDashboardMembership || ref.dashboardId !== owner.dashboardId))
      || (hasDashboardMembership && !owner)) {
      throw new Error(`Dashboard Widget @${name} requires Dashboard and Dashboard Child identity`);
    }
  }
}

function assertWidgetArtifactsHaveNoPayloads(
  refs: Record<string, ArtifactRef>,
  payloads: Record<string, unknown>,
): void {
  const widgetWithPayload = Object.entries(refs).find(
    ([name, ref]) => ref.type === 'widget' && name in payloads,
  );
  if (widgetWithPayload) throw new Error('Widget Artifacts cannot store payloads');
}

function membershipFor(name: string, ref: ArtifactRef): ArtifactMembership {
  const parts = name.split('.');
  const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'));
  const dashboardMembership = ref.type === 'widget' && ref.dashboardId !== undefined
    ? { dashboardId: ref.dashboardId, dashboardChildId: ref.childId }
    : {};
  return {
    ancestors,
    ...dashboardMembership,
  };
}

function identityFor(ref: ArtifactRef): ArtifactIdentity {
  switch (ref.type) {
    case 'search':
      return {
        family: 'search',
        searchKind: ref.searchKind,
      };
    case 'widget':
      return {
        family: 'widget',
        widgetId: ref.widgetId,
        ...(ref.configurationId ? { configurationId: ref.configurationId } : {}),
        ...(ref.selectedContext ? { selectedContext: ref.selectedContext } : {}),
      };
    case 'dashboard':
      return { family: 'dashboard', dashboardId: ref.dashboardId };
    case 'entity-feed':
      return {
        family: 'entity-feed',
        entityId: ref.entityId,
        entityKind: ref.entityKind,
      };
    case 'section':
      return {
        family: 'section',
        dashboardId: ref.dashboardId,
        sectionId: ref.sectionId,
      };
    case 'document':
      return {
        family: 'document',
        documentId: ref.documentId,
        realm: ref.realm,
      };
  }
}

function toStoredArtifacts(refs: Record<string, ArtifactRef>): Record<string, StoredArtifact> {
  return Object.fromEntries(Object.entries(refs).map(([name, ref]) => [
    name,
    { ref, identity: identityFor(ref), membership: membershipFor(name, ref) },
  ]));
}

function syncRefsFromArtifacts(state: RegistryState): void {
  state.refs = Object.fromEntries(
    Object.entries(state.artifacts).map(([name, artifact]) => [name, artifact.ref]),
  );
}

function removeArtifactNamespace(state: RegistryState, namespace: string): void {
  for (const refKey of Object.keys(state.artifacts)) {
    if (isArtifactRefName(namespace, refKey)) {
      delete state.artifacts[refKey];
    }
  }
  for (const payloadKey of Object.keys(state.payloads)) {
    if (isArtifactRefName(namespace, payloadKey)) {
      delete state.payloads[payloadKey];
    }
  }
  if (state.payloadOrder) {
    state.payloadOrder = state.payloadOrder.filter(
      (payloadKey) => !isArtifactRefName(namespace, payloadKey),
    );
  }
  syncRefsFromArtifacts(state);
}

/** Over the limit, the order holds at least one payload to evict. */
function isOverPayloadLimit(order: string[]): order is [string, ...string[]] {
  // Stryker disable next-line ConditionalExpression,EqualityOperator: a bound true on an empty order never ends the eviction loop, a hang the gate scores as a timeout, never a kill.
  return order.length > MAX_PAYLOADS;
}

function trackPayload(state: RegistryState, namespace: string, payload: unknown): void {
  state.payloads[namespace] = payload;

  // Track insertion order for eviction
  let order = state.payloadOrder ?? Object.keys(state.payloads);
  const idx = order.indexOf(namespace);
  if (idx !== -1) order.splice(idx, 1);
  order.push(namespace);

  // Evict oldest payloads (and their child refs) when over limit
  while (isOverPayloadLimit(order)) {
    const [evicted, ...newer] = order;
    removeArtifactNamespace(state, evicted);
    order = newer.filter((name) => !isArtifactRefName(evicted, name));
  }
  state.payloadOrder = order;
}

function toArtifactHandle(
  namespace: string,
  root: ArtifactRef,
  refs: Record<string, ArtifactRef>,
  payload: unknown,
): RegistryArtifactHandle {
  return {
    namespace,
    root,
    refs,
    payload,
    childRef(name: string): Ref {
      return childRefName(namespace, name);
    },
  };
}

export function createArtifactRegistryImplementation(
  dir: string,
  sessionId: RegistrySessionId,
  options: ArtifactRegistryOptions = {},
): Omit<
  ArtifactRegistry,
  'refName' | 'resolve' | 'formatUnknownRef'
> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const file = registryFile(dir, sessionId);
  const now = options.now ?? Date.now;
  const inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  if (!Number.isFinite(inactivityMs) || inactivityMs <= 0) {
    throw new Error('Artifact Registry inactivityMs must be a positive finite number');
  }
  cleanupInactiveRegistries(dir, now(), inactivityMs);

  const updateState = <T>(operation: (state: RegistryState) => T): T => (
    withWriteLock(file, now, inactivityMs, operation)
  );

  function claim(prefix: string): Ref {
    return updateState((state) => {
      const next = (state.counters[prefix] ?? 0) + 1;
      state.counters[prefix] = next;
      return `${prefix}${next}` as Ref;
    });
  }

  return {
    claimSearch(): Ref {
      return claim('s');
    },

    claimWidget(): Ref {
      return claim('w');
    },

    claimDashboard(): Ref {
      return claim('d');
    },

    claimContent(): Ref {
      return claim('c');
    },

    setRefs(_namespace: string, refs: Record<string, ArtifactRef>): void {
      updateState((state) => {
        assertCanonicalArtifactRefs(state.refs, refs);
        assertWidgetArtifactsHaveNoPayloads(refs, state.payloads);
        state.artifacts = { ...state.artifacts, ...toStoredArtifacts(refs) };
        syncRefsFromArtifacts(state);
      });
    },

    updateRefs(refNames, updater): void {
      const requested = new Set(refNames);
      updateState((state) => {
        const current = Object.fromEntries(
          [...requested].map((refName) => [refName, state.refs[refName]]),
        );
        const next = updater(current);
        const unexpected = Object.keys(next).find((refName) => !requested.has(refName));
        if (unexpected) {
          throw new Error(`updateRefs cannot update unrequested ref @${unexpected}`);
        }
        assertCanonicalArtifactRefs(state.refs, next);
        assertWidgetArtifactsHaveNoPayloads(next, state.payloads);
        state.artifacts = { ...state.artifacts, ...toStoredArtifacts(next) };
        syncRefsFromArtifacts(state);
      });
    },

    resolveRef(name: Ref): ArtifactRef | undefined {
      return updateState((state) => state.refs[name]);
    },

    resolveArtifact(name: Ref): StoredArtifact | undefined {
      return updateState((state) => state.artifacts[name]);
    },

    getAllRefs(): Record<string, ArtifactRef> {
      return updateState((state) => state.refs);
    },

    setPayload(namespace: string, payload: unknown): void {
      updateState((state) => {
        if (state.refs[namespace]?.type === 'widget') {
          throw new Error('Widget Artifacts cannot store payloads');
        }
        trackPayload(state, namespace, payload);
      });
    },

    updatePayload(namespace: string, updater: (payload: unknown) => unknown): unknown {
      return updateState((state) => {
        if (state.refs[namespace]?.type === 'widget') {
          throw new Error('Widget Artifacts cannot store payloads');
        }
        const payload = updater(state.payloads[namespace]);
        trackPayload(state, namespace, payload);
        return payload;
      });
    },

    getPayload(namespace: string): unknown {
      return updateState((state) => state.payloads[namespace]);
    },

    storeArtifact(input: RegistryArtifactInput): RegistryArtifactHandle {
      if (!input.namespace) throw new Error('storeArtifact requires a non-empty namespace');
      if (input.root.type === 'widget') {
        throw new Error('Widget Artifacts cannot store payloads');
      }
      return updateState((state) => {
        const childRefs = Object.fromEntries(
          Object.entries(input.refs ?? {}).map(([name, ref]) => [childRefName(input.namespace, name), ref]),
        ) as Record<string, ArtifactRef>;
        const refs = {
          ...childRefs,
          [input.namespace]: input.root,
        };
        const retainedRefs = Object.fromEntries(
          Object.entries(state.refs).filter(([name]) => !isArtifactRefName(input.namespace, name)),
        ) as Record<string, ArtifactRef>;
        assertCanonicalArtifactRefs(retainedRefs, refs);
        removeArtifactNamespace(state, input.namespace);
        state.artifacts = { ...state.artifacts, ...toStoredArtifacts(refs) };
        syncRefsFromArtifacts(state);
        trackPayload(state, input.namespace, input.payload);
        const storedRoot = state.refs[input.namespace];
        if (!storedRoot) {
          throw new Error(`storeArtifact requires a valid root Artifact for ${input.namespace}`);
        }
        return toArtifactHandle(
          input.namespace,
          storedRoot,
          artifactRefs(state.refs, input.namespace),
          state.payloads[input.namespace],
        );
      });
    },

    getArtifact(namespace: string): RegistryArtifact | undefined {
      return updateState((state) => {
        const root = state.refs[namespace];
        if (!root) {
          return undefined;
        }
        return {
          namespace,
          root,
          refs: artifactRefs(state.refs, namespace),
          payload: state.payloads[namespace],
        };
      });
    },

    clean(): void {
      lockSyncRetry(file);
      try {
        if (existsSync(file)) {
          unlinkSync(file);
        }
      } finally {
        unlockSync(file, { realpath: false });
      }
    },
  };
}
