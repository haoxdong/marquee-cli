import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { lockSync, unlockSync } from 'proper-lockfile';
import type {
  ReferentIdentity,
  ReferentMembership,
  ReferentRef,
  ReferentRegistry,
  InteractionSessionNamespace,
  InteractionSessionNamespaceOptions,
  Ref,
  RegistryReferent,
  RegistryReferentHandle,
  RegistryReferentInput,
  StoredReferent,
} from './types.js';
import { hasOnlyFields, isReferentRef } from './ref-resolution.js';
import { RegistryLockError } from './errors.js';
import { cleanupInactiveRegistries } from './cleanup.js';
import { isRecord } from '../lib/json-value.js';

interface RegistryState {
  schemaVersion: 8;
  lastUsedAt: number;
  counters: Record<string, number>;
  refs: Record<string, ReferentRef>;
  artifacts: Record<string, StoredReferent>;
  /**
   * Namespace → id of its payload file. Payload files are immutable and live
   * beside the state file, so a command reads and writes only the payloads it
   * touches, outside the lock.
   */
  payloads: Record<string, string>;
  /** Insertion-order list of payload keys for LRU eviction. */
  payloadOrder: string[];
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

interface ReferentRegistryOptions {
  inactivityMs?: number;
  now?: () => number;
}

const DEFAULT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1_000;

interface RegistryPaths {
  file: string;
  payloadDir: string;
}

function registryPaths(dir: string, sessionId: RegistrySessionId): RegistryPaths {
  const digest = createHash('sha256')
    .update(String(sessionId))
    .digest('hex')
    .slice(0, 16);
  return {
    file: join(dir, `v7-${digest}.artifact-registry.json`),
    payloadDir: join(dir, `v7-${digest}.artifact-payloads`),
  };
}

function defaultState(now: number): RegistryState {
  return {
    schemaVersion: 8,
    lastUsedAt: now,
    counters: {},
    refs: {},
    artifacts: {},
    payloads: {},
    payloadOrder: [],
    interactionNamespaces: {},
    interactionNamespaceNames: [],
  };
}

function isReferentIdentity(value: unknown): value is ReferentIdentity {
  if (!isRecord(value) || typeof value.family !== 'string') return false;
  switch (value.family) {
    case 'search':
      return (value.searchKind === 'market-data' || value.searchKind === 'research')
        && hasOnlyFields(value, new Set(['family', 'searchKind']));
    case 'widget':
      return typeof value.widgetId === 'string'
        && value.widgetId.startsWith('MW')
        && hasOnlyFields(value, new Set(['family', 'widgetId', 'configurationId', 'selectedContext']))
        && (value.configurationId === null || (
          typeof value.configurationId === 'string'
          && value.configurationId.startsWith('WC')
        ))
        && (value.selectedContext === null || (
          typeof value.selectedContext === 'string'
          && value.selectedContext.length > 0
        ));
    case 'dashboard':
      return typeof value.dashboardId === 'string'
        && hasOnlyFields(value, new Set(['family', 'dashboardId']));
    case 'entity-feed':
      return typeof value.entityId === 'string'
        && (value.entityKind === 'asset'
          || value.entityKind === 'country'
          || value.entityKind === 'portfolio')
        && hasOnlyFields(value, new Set(['family', 'entityId', 'entityKind']));
    case 'section':
      return typeof value.dashboardId === 'string'
        && typeof value.sectionId === 'string'
        && hasOnlyFields(value, new Set(['family', 'dashboardId', 'sectionId']));
    case 'document':
      return typeof value.documentId === 'string'
        && (value.realm === 'markets' || value.realm === 'research')
        && hasOnlyFields(value, new Set(['family', 'documentId', 'realm']));
    default:
      return false;
  }
}

function identityMatchesRef(identity: ReferentIdentity, ref: ReferentRef): boolean {
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

function isStoredReferent(value: unknown): value is StoredReferent {
  if (
    !isRecord(value)
    || !isReferentRef(value.ref)
    || !isReferentIdentity(value.identity)
    || !identityMatchesRef(value.identity, value.ref)
    || !hasOnlyFields(value, new Set(['ref', 'identity', 'membership']))
    || !isRecord(value.membership)
    || !hasOnlyFields(value.membership, new Set(['ancestors', 'dashboardId', 'dashboardChildId']))
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

function storedReferentsMatchRefs(
  refs: Record<string, ReferentRef>,
  artifacts: Record<string, StoredReferent>,
): boolean {
  const refNames = Object.keys(refs).sort();
  const referentNames = Object.keys(artifacts).sort();
  return isDeepStrictEqual(refNames, referentNames)
    && refNames.every((name) => isDeepStrictEqual(refs[name], artifacts[name]?.ref));
}

const PAYLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface LoadedState {
  state: RegistryState;
  /** Payload ids of an expired session, whose files the transaction removes. */
  retiredPayloadIds: string[];
}

function cutoverState(parsed: Record<string, unknown>, now: number, inactivityMs: number): RegistryState {
  if (typeof parsed.lastUsedAt !== 'number' || !Number.isFinite(parsed.lastUsedAt)
    || hasInvalidCounters(parsed)) {
    throw new Error('invalid registry state shape');
  }
  const state = defaultState(now);
  if (now - parsed.lastUsedAt <= inactivityMs) {
    state.counters = parsed.counters as Record<string, number> | undefined ?? {};
  }
  return state;
}

function readState(paths: RegistryPaths, now: number, inactivityMs: number): LoadedState {
  const { file } = paths;
  if (!existsSync(file)) {
    return { state: defaultState(now), retiredPayloadIds: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (isRecord(parsed) && parsed.schemaVersion === 7) {
      return { state: cutoverState(parsed, now, inactivityMs), retiredPayloadIds: [] };
    }
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 8 ||
      typeof parsed.lastUsedAt !== 'number' ||
      !Number.isFinite(parsed.lastUsedAt) ||
      hasInvalidCounters(parsed) ||
      (parsed.refs !== undefined && !isRecord(parsed.refs)) ||
      (isRecord(parsed.refs) && Object.values(parsed.refs).some((value) => (
        !isReferentRef(value)
      ))) ||
      (parsed.artifacts !== undefined && !isRecord(parsed.artifacts)) ||
      (isRecord(parsed.artifacts) && Object.values(parsed.artifacts).some((value) => (
        !isStoredReferent(value)
      ))) ||
      (isRecord(parsed.refs) && isRecord(parsed.artifacts) && !storedReferentsMatchRefs(
        parsed.refs as Record<string, ReferentRef>,
        parsed.artifacts as unknown as Record<string, StoredReferent>,
      )) ||
      !isRecord(parsed.payloads) ||
      Object.values(parsed.payloads).some((id) => typeof id !== 'string' || !PAYLOAD_ID.test(id)) ||
      !Array.isArray(parsed.payloadOrder) ||
      parsed.payloadOrder.some((entry) => typeof entry !== 'string') ||
      hasInvalidInteractionNamespaces(parsed)
    ) {
      throw new Error('invalid registry state shape');
    }
    const payloads = parsed.payloads as Record<string, string>;
    if (now - parsed.lastUsedAt > inactivityMs) {
      return { state: defaultState(now), retiredPayloadIds: Object.values(payloads) };
    }
    return {
      state: {
        schemaVersion: 8,
        lastUsedAt: now,
        counters: parsed.counters as Record<string, number> | undefined ?? {},
        refs: parsed.refs as Record<string, ReferentRef> | undefined ?? {},
        artifacts: parsed.artifacts as Record<string, StoredReferent> | undefined ?? {},
        payloads,
        payloadOrder: parsed.payloadOrder as string[],
        interactionNamespaces: parsed.interactionNamespaces as
          Record<string, StoredInteractionNamespace> | undefined ?? {},
        interactionNamespaceNames: Array.isArray(parsed.interactionNamespaceNames)
          ? parsed.interactionNamespaceNames
          : [],
      },
      retiredPayloadIds: [],
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

function payloadFile(payloadDir: string, id: string): string {
  return join(payloadDir, `${id}.json`);
}

/** Writes an immutable payload file that no state references until a transaction commits its id. */
function writePayloadFile(payloadDir: string, payload: unknown): string {
  const id = randomUUID();
  mkdirSync(payloadDir, { recursive: true });
  writeFileSync(payloadFile(payloadDir, id), JSON.stringify(payload), 'utf8');
  return id;
}

const MISSING_PAYLOAD = Symbol('missing payload');

function readPayloadFile(payloadDir: string, id: string): unknown {
  const file = payloadFile(payloadDir, id);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return MISSING_PAYLOAD;
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Registry state is corrupt: ${file} — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * One session transaction on the small state file. Payload files the
 * transaction stops referencing are removed before the lock is released.
 */
function withWriteLock<T>(
  paths: RegistryPaths,
  now: () => number,
  inactivityMs: number,
  operation: (state: RegistryState) => T,
  committed?: () => void,
): T {
  lockSyncRetry(paths.file);
  try {
    const { state, retiredPayloadIds } = readState(paths, now(), inactivityMs);
    const before = [...retiredPayloadIds, ...Object.values(state.payloads)];
    const result = operation(state);
    state.lastUsedAt = now();
    writeState(paths.file, state);
    committed?.();
    const kept = new Set(Object.values(state.payloads));
    for (const id of before) {
      if (!kept.has(id)) rmSync(payloadFile(paths.payloadDir, id), { force: true });
    }
    return result;
  } finally {
    unlockSync(paths.file, { realpath: false });
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
  const paths = registryPaths(dir, sessionId);
  const now = options.now ?? Date.now;
  const inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  const maxNamespaces = options.maxNamespaces ?? MAX_PAYLOADS;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cleanupInactiveRegistries(dir, now(), inactivityMs);

  return {
    read() {
      return withWriteLock(paths, now, inactivityMs, (state) => {
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
      return withWriteLock(paths, now, inactivityMs, (state) => {
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

function isReferentRefName(namespace: string, refName: string): boolean {
  return refName === namespace || refName.startsWith(`${namespace}.`);
}

function referentRefs(refs: Record<string, ReferentRef>, namespace: string): Record<string, ReferentRef> {
  return Object.fromEntries(
    Object.entries(refs).filter(([name]) => isReferentRefName(namespace, name)),
  );
}

function dashboardAncestor(
  refs: Record<string, ReferentRef>,
  name: string,
): Extract<ReferentRef, { type: 'dashboard' }> | undefined {
  const parts = name.split('.');
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const ancestor = refs[parts.slice(0, length).join('.')];
    if (ancestor?.type === 'dashboard') return ancestor;
  }
  return undefined;
}

function assertCanonicalReferentRefs(
  existing: Record<string, ReferentRef>,
  refs: Record<string, ReferentRef>,
): void {
  const combined = { ...existing, ...refs };
  for (const [name, ref] of Object.entries(combined)) {
    if (!isReferentRef(ref)) {
      throw new Error(`Referent @${name} has invalid canonical identity`);
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

function assertWidgetReferentsHaveNoPayloads(
  refs: Record<string, ReferentRef>,
  payloads: Record<string, string>,
): void {
  const widgetWithPayload = Object.entries(refs).find(
    ([name, ref]) => ref.type === 'widget' && name in payloads,
  );
  if (widgetWithPayload) throw new Error('Widget Referents cannot store payloads');
}

function membershipFor(name: string, ref: ReferentRef): ReferentMembership {
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

function identityFor(ref: ReferentRef): ReferentIdentity {
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
        configurationId: ref.configurationId,
        selectedContext: ref.selectedContext,
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

function toStoredReferents(refs: Record<string, ReferentRef>): Record<string, StoredReferent> {
  return Object.fromEntries(Object.entries(refs).map(([name, ref]) => [
    name,
    { ref, identity: identityFor(ref), membership: membershipFor(name, ref) },
  ]));
}

function syncRefsFromReferents(state: RegistryState): void {
  state.refs = Object.fromEntries(
    Object.entries(state.artifacts).map(([name, referent]) => [name, referent.ref]),
  );
}

function outsideNamespace<T>(entries: Record<string, T>, namespace: string): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).filter(([name]) => !isReferentRefName(namespace, name)));
}

function removeReferentNamespace(state: RegistryState, namespace: string): void {
  state.artifacts = outsideNamespace(state.artifacts, namespace);
  state.payloads = outsideNamespace(state.payloads, namespace);
  state.payloadOrder = state.payloadOrder.filter(
    (payloadKey) => !isReferentRefName(namespace, payloadKey),
  );
  syncRefsFromReferents(state);
}

/** Over the limit, the order holds at least one payload to evict. */
function isOverPayloadLimit(order: string[]): order is [string, ...string[]] {
  // Stryker disable next-line ConditionalExpression,EqualityOperator: a bound true on an empty order never ends the eviction loop, a hang the gate scores as a timeout, never a kill.
  return order.length > MAX_PAYLOADS;
}

function trackPayload(state: RegistryState, namespace: string, payloadId: string): void {
  state.payloads[namespace] = payloadId;

  let order = state.payloadOrder;
  const idx = order.indexOf(namespace);
  if (idx !== -1) order.splice(idx, 1);
  order.push(namespace);

  while (isOverPayloadLimit(order)) {
    const [evicted, ...newer] = order;
    removeReferentNamespace(state, evicted);
    order = newer.filter((name) => !isReferentRefName(evicted, name));
  }
  state.payloadOrder = order;
}

function toReferentHandle(
  namespace: string,
  root: ReferentRef,
  refs: Record<string, ReferentRef>,
  payload: unknown,
): RegistryReferentHandle {
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

export function createReferentRegistryImplementation(
  dir: string,
  sessionId: RegistrySessionId,
  options: ReferentRegistryOptions = {},
): Omit<
  ReferentRegistry,
  'refName' | 'resolve' | 'formatUnknownRef'
> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const paths = registryPaths(dir, sessionId);
  const now = options.now ?? Date.now;
  const inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  if (!Number.isFinite(inactivityMs) || inactivityMs <= 0) {
    throw new Error('Referent Registry inactivityMs must be a positive finite number');
  }
  cleanupInactiveRegistries(dir, now(), inactivityMs);

  const updateState = <T>(operation: (state: RegistryState) => T): T => (
    withWriteLock(paths, now, inactivityMs, operation)
  );

  /** Writes the payload file outside the lock, then commits its id in one transaction. */
  function commitPayload<T>(payload: unknown, operation: (state: RegistryState, payloadId: string) => T): T {
    const payloadId = writePayloadFile(paths.payloadDir, payload);
    const transaction = { committed: false };
    try {
      return withWriteLock(paths, now, inactivityMs, (state) => operation(state, payloadId), () => { transaction.committed = true; });
    } catch (error) {
      if (!transaction.committed) rmSync(payloadFile(paths.payloadDir, payloadId), { force: true });
      throw error;
    }
  }

  /**
   * Selects from one state snapshot and reads its payload file outside the
   * lock. A payload replaced or evicted between the two reads is retried from
   * a fresh snapshot; ids are never reused, so a still-referenced id whose file
   * is missing is corruption.
   */
  function readWithPayload<T>(namespace: string, select: (state: RegistryState) => T): [T, unknown] {
    let missingId: string | undefined;
    for (;;) {
      const [selected, payloadId] = updateState((state) => [select(state), state.payloads[namespace]] as const);
      if (payloadId === undefined) return [selected, undefined];
      const payload = readPayloadFile(paths.payloadDir, payloadId);
      if (payload !== MISSING_PAYLOAD) return [selected, payload];
      if (payloadId === missingId) {
        throw new Error(
          `Registry state is corrupt: ${paths.file} — payload file for ${namespace} is missing`,
        );
      }
      missingId = payloadId;
    }
  }

  function claim(prefix: string): Ref {
    return updateState((state) => {
      const next = (state.counters[prefix] ?? 0) + 1;
      state.counters[prefix] = next;
      return `${prefix}${next}` as Ref;
    });
  }

  return {
    claimSearch: () => claim('s'),
    claimWidget: () => claim('w'),
    claimDashboard: () => claim('d'),
    claimContent: () => claim('c'),

    setRefs(_namespace: string, refs: Record<string, ReferentRef>): void {
      updateState((state) => {
        assertCanonicalReferentRefs(state.refs, refs);
        assertWidgetReferentsHaveNoPayloads(refs, state.payloads);
        state.artifacts = { ...state.artifacts, ...toStoredReferents(refs) };
        syncRefsFromReferents(state);
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
        assertCanonicalReferentRefs(state.refs, next);
        assertWidgetReferentsHaveNoPayloads(next, state.payloads);
        state.artifacts = { ...state.artifacts, ...toStoredReferents(next) };
        syncRefsFromReferents(state);
      });
    },

    resolveRef(name: Ref): ReferentRef | undefined {
      return updateState((state) => state.refs[name]);
    },

    resolveReferent(name: Ref): StoredReferent | undefined {
      return updateState((state) => state.artifacts[name]);
    },

    getAllRefs(): Record<string, ReferentRef> {
      return updateState((state) => state.refs);
    },

    setPayload(namespace: string, payload: unknown): void {
      commitPayload(payload, (state, payloadId) => {
        if (state.refs[namespace]?.type === 'widget') {
          throw new Error('Widget Referents cannot store payloads');
        }
        trackPayload(state, namespace, payloadId);
      });
    },

    getPayload(namespace: string): unknown {
      return readWithPayload(namespace, () => undefined)[1];
    },

    storeReferent(input: RegistryReferentInput): RegistryReferentHandle {
      if (!input.namespace) throw new Error('storeReferent requires a non-empty namespace');
      if (input.root.type === 'widget') {
        throw new Error('Widget Referents cannot store payloads');
      }
      return commitPayload(input.payload, (state, payloadId) => {
        const childRefs = Object.fromEntries(
          Object.entries(input.refs ?? {}).map(([name, ref]) => [childRefName(input.namespace, name), ref]),
        ) as Record<string, ReferentRef>;
        const refs = {
          ...childRefs,
          [input.namespace]: input.root,
        };
        assertCanonicalReferentRefs(outsideNamespace(state.refs, input.namespace), refs);
        removeReferentNamespace(state, input.namespace);
        state.artifacts = { ...state.artifacts, ...toStoredReferents(refs) };
        syncRefsFromReferents(state);
        trackPayload(state, input.namespace, payloadId);
        const storedRoot = state.refs[input.namespace];
        if (!storedRoot) {
          throw new Error(`storeReferent requires a valid root Referent for ${input.namespace}`);
        }
        return toReferentHandle(
          input.namespace,
          storedRoot,
          referentRefs(state.refs, input.namespace),
          input.payload,
        );
      });
    },

    getReferent(namespace: string): RegistryReferent | undefined {
      const [referent, payload] = readWithPayload(namespace, (state) => {
        const root = state.refs[namespace];
        return root ? { namespace, root, refs: referentRefs(state.refs, namespace) } : undefined;
      });
      return referent ? { ...referent, payload } : undefined;
    },

    clean(): void {
      lockSyncRetry(paths.file);
      try {
        rmSync(paths.file, { force: true });
        rmSync(paths.payloadDir, { recursive: true, force: true });
      } finally {
        unlockSync(paths.file, { realpath: false });
      }
    },
  };
}
