import type { Ref } from '../index.js';
import type { Tagged } from 'type-fest';
type WidgetId = Tagged<string, 'WidgetId'>;
type ConfigId = Tagged<string, 'ConfigId'>;
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createReferentRegistry,
  type ReferentRef,
} from '../index.js';
import { isReferentRef } from '../ref-resolution.js';

function registryStateFile(dir: string): string {
  const name = readdirSync(dir).find((entry) => (
    entry.startsWith('v7-') && entry.endsWith('.artifact-registry.json')
  ));
  if (!name) throw new Error(`missing Referent Registry state in ${dir}`);
  return join(dir, name);
}

function v7RegistryStateFile(dir: string, sessionId: number | string): string {
  const digest = createHash('sha256')
    .update(String(sessionId))
    .digest('hex')
    .slice(0, 16);
  return join(dir, `v7-${digest}.artifact-registry.json`);
}

function searchRef(_query = ''): ReferentRef {
  return { type: 'search', searchKind: 'market-data' };
}

function widgetRef(id: string, configurationId = id.replace(/^MW/, 'WC')): ReferentRef {
  return { type: 'widget', widgetId: id as WidgetId, configurationId: configurationId as ConfigId, selectedContext: null };
}

function dashboardRef(id: string): ReferentRef {
  return { type: 'dashboard', dashboardId: id };
}

describe('ReferentRegistry', () => {
  let dir: string;
  let registry: ReturnType<typeof createReferentRegistry>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'registry-'));
    registry = createReferentRegistry(dir, 12345);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reloads Widget refs with explicit null identity values', () => {
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: null, selectedContext: null },
    });

    const reloaded = createReferentRegistry(dir, 12345);
    expect(reloaded.resolveReferent('w1' as Ref)).toEqual({
      ref: { type: 'widget', widgetId: 'MW1', configurationId: null, selectedContext: null },
      identity: { family: 'widget', widgetId: 'MW1', configurationId: null, selectedContext: null },
      membership: { ancestors: [] },
    });
  });

  it.each(['configurationId', 'selectedContext'])('rejects stored Widget identity without %s', (field) => {
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: null, selectedContext: null },
    });
    const file = registryStateFile(dir);
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      artifacts: Record<string, { identity: Record<string, unknown> }>;
    };
    const referent = state.artifacts.w1;
    if (!referent) throw new Error('missing stored Widget');
    delete referent.identity[field];
    writeFileSync(file, JSON.stringify(state));

    expect(() => createReferentRegistry(dir, 12345).resolveRef('w1' as Ref))
      .toThrow('invalid registry state shape');
  });

  it('claimSearch returns s1 on first call, s2 on second', () => {
    const s1 = registry.claimSearch();
    const s2 = registry.claimSearch();
    expect(s1).toBe('s1');
    expect(s2).toBe('s2');
  });

  it('claimWidget returns w1 on first call, w2 on second', () => {
    const w1 = registry.claimWidget();
    const w2 = registry.claimWidget();
    expect(w1).toBe('w1');
    expect(w2).toBe('w2');
  });

  it('claimDashboard returns d1, d2', () => {
    expect(registry.claimDashboard()).toBe('d1');
    expect(registry.claimDashboard()).toBe('d2');
  });

  it('claims one Content namespace sequence', () => {
    expect(registry.claimContent()).toBe('c1');
    expect(registry.claimContent()).toBe('c2');
  });

  it('setRefs stores canonical Referent refs', () => {
    registry.setRefs('w1', {
      w1: widgetRef('MW1', 'WC1'),
    });

    expect(registry.resolveRef('w1' as Ref)).toEqual(widgetRef('MW1', 'WC1'));
  });

  it('resolveRef returns undefined for unknown ref', () => {
    expect(registry.resolveRef('w99' as Ref)).toBeUndefined();
  });

  it('refs accumulate across multiple setRefs calls', () => {
    registry.setRefs('w1', { w1: widgetRef('MW1', 'WC1') });
    registry.setRefs('w2', { w2: widgetRef('MW2', 'WC2') });
    expect(registry.resolveRef('w1' as Ref)).toEqual(widgetRef('MW1'));
    expect(registry.resolveRef('w2' as Ref)).toEqual(widgetRef('MW2'));
  });

  it('setPayload and getPayload work for a namespace', () => {
    registry.setPayload('w1', { rows: [{ x: 1 }], widget: {} });
    expect(registry.getPayload('w1')).toEqual({ rows: [{ x: 1 }], widget: {} });
  });

  it('storeReferent stores root ref, child refs, and payload behind one referent handle', () => {
    const referent = registry.storeReferent({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
      },
      payload: [{ id: 'MW1' }],
    });

    expect(referent.namespace).toBe('s1');
    expect(referent.root).toEqual(searchRef('rates'));
    expect(referent.childRef('w1')).toBe('s1.w1');
    expect(registry.resolveRef('s1' as Ref)).toEqual(searchRef('rates'));
    expect(registry.resolveRef('s1.w1' as Ref)).toEqual(widgetRef('MW1'));
    expect(registry.getPayload('s1')).toEqual([{ id: 'MW1' }]);
  });

  it('stores canonical namespace-member Referents', () => {
    registry.storeReferent({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
        's1.d1': dashboardRef('MD1'),
        's1.d1.s1': {
          type: 'section',
          dashboardId: 'MD1',
          sectionId: 'section-1',
        },
      },
      payload: [],
    });

    expect(registry.getAllRefs()).toEqual({
      s1: searchRef('rates'),
      's1.w1': widgetRef('MW1'),
      's1.d1': dashboardRef('MD1'),
      's1.d1.s1': {
        type: 'section',
        dashboardId: 'MD1',
        sectionId: 'section-1',
      },
    });
  });

  it('rejects Dashboard membership outside a Dashboard ancestor', () => {
    expect(() => registry.storeReferent({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': {
          type: 'widget',
          widgetId: 'MW1' as WidgetId,
          dashboardId: 'MD1',
          childId: 'CHILD1',
          configurationId: null,
          selectedContext: null,
        },
      },
      payload: [],
    })).toThrow('Dashboard Widget @s1.w1 requires Dashboard and Dashboard Child identity');
  });

  it('storeReferent normalizes child refs into the referent namespace', () => {
    const referent = registry.storeReferent({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        w1: widgetRef('MW1', 'WC1'),
      },
      payload: [{ id: 'MW1' }],
    });

    expect(referent.refs).toEqual({
      s1: searchRef('rates'),
      's1.w1': widgetRef('MW1'),
    });
    expect(registry.resolveRef('w1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.w1' as Ref)).toEqual(widgetRef('MW1'));
    expect(registry.resolveRef('s1.w1.link' as Ref)).toBeUndefined();
  });

  it('getReferent returns only refs owned by the referent namespace', () => {
    registry.storeReferent({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
      },
      payload: [{ id: 'MW1' }],
    });
    registry.storeReferent({
      namespace: 's2',
      root: searchRef('credit'),
      refs: {
        's2.w1': widgetRef('MW2', 'WC2'),
      },
      payload: [{ id: 'MW2' }],
    });

    expect(registry.getReferent('s1')).toEqual({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        s1: searchRef('rates'),
        's1.w1': widgetRef('MW1'),
      },
      payload: [{ id: 'MW1' }],
    });
  });

  it('storeReferent replaces stale child refs in its namespace', () => {
    registry.storeReferent({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
        's1.w2': widgetRef('MW2', 'WC2'),
      },
      payload: [{ id: 'MW1' }, { id: 'MW2' }],
    });

    registry.storeReferent({
      namespace: 's1',
      root: searchRef('credit'),
      refs: {
        's1.w3': widgetRef('MW3', 'WC3'),
      },
      payload: [{ id: 'MW3' }],
    });

    expect(registry.resolveRef('s1.w1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.w2' as Ref)).toBeUndefined();
    expect(registry.getReferent('s1')).toEqual({
      namespace: 's1',
      root: searchRef('credit'),
      refs: {
        s1: searchRef('credit'),
        's1.w3': widgetRef('MW3'),
      },
      payload: [{ id: 'MW3' }],
    });
  });

  it('storeReferent clears cached child payloads when replacing an referent namespace', () => {
    registry.storeReferent({
      namespace: 's1',
      root: { type: 'search', searchKind: 'research' },
      refs: {
        's1.c1': { type: 'document', documentId: 'old-doc', realm: 'research' },
      },
      payload: { results: [{ id: 'old-doc' }] },
    });
    registry.setPayload('s1.c1', { id: 'old-doc', body: 'stale body' });

    registry.storeReferent({
      namespace: 's1',
      root: { type: 'search', searchKind: 'research' },
      refs: {
        's1.c1': { type: 'document', documentId: 'new-doc', realm: 'research' },
      },
      payload: { results: [{ id: 'new-doc' }] },
    });

    expect(registry.resolveRef('s1.c1' as Ref)).toEqual({
      type: 'document',
      documentId: 'new-doc',
      realm: 'research',
    });
    expect(registry.getPayload('s1.c1')).toBeUndefined();
    expect(registry.getPayload('s1')).toEqual({ results: [{ id: 'new-doc' }] });
  });

  it('storeReferent rejects empty namespace', () => {
    expect(() =>
      registry.storeReferent({
        namespace: '',
        root: searchRef(),
        payload: [],
      }),
    ).toThrow('storeReferent requires a non-empty namespace');
  });

  it('getPayload returns undefined for unknown namespace', () => {
    expect(registry.getPayload('w99')).toBeUndefined();
  });

  it('persists to a versioned Referent Registry file', () => {
    registry.claimSearch();
    registry.setRefs('s1', { s1: searchRef() });
    const file = registryStateFile(dir);
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      counters: Record<string, number>;
      refs: Record<string, unknown>;
    };
    expect(data.counters.s).toBe(1);
    expect(data.refs.s1).toEqual(searchRef());
  });

  it('fails loudly without overwriting a corrupt registry file', () => {
    registry.claimSearch();
    const file = registryStateFile(dir);
    writeFileSync(file, '{corrupt', 'utf8');

    expect(() => registry.getAllRefs()).toThrow(`Registry state is corrupt: ${file}`);
    expect(() => registry.claimSearch()).toThrow(`Registry state is corrupt: ${file}`);
    expect(readFileSync(file, 'utf8')).toBe('{corrupt');
  });

  it('rejects structurally corrupt registry JSON without normalizing it', () => {
    registry.claimSearch();
    const file = registryStateFile(dir);
    const corrupt = JSON.stringify({ counters: 'bad', refs: [], payloads: [] });
    writeFileSync(file, corrupt, 'utf8');

    expect(() => registry.claimSearch()).toThrow(`Registry state is corrupt: ${file}`);
    expect(readFileSync(file, 'utf8')).toBe(corrupt);
  });

  it.each([
    ['non-numeric counter', { counters: { w: 'bad' }, refs: {}, payloads: {} }],
    ['non-object ref', { counters: {}, refs: { w1: 'bad' }, payloads: {} }],
  ])('rejects a registry with a %s', (_name, state) => {
    registry.claimSearch();
    const file = registryStateFile(dir);
    const corrupt = JSON.stringify(state);
    writeFileSync(file, corrupt, 'utf8');

    expect(() => registry.claimWidget()).toThrow(`Registry state is corrupt: ${file}`);
    expect(readFileSync(file, 'utf8')).toBe(corrupt);
  });

  it('rejects persisted entries without typed Referent identity and membership', () => {
    registry.setRefs('s1', {
      s1: { type: 'search', searchKind: 'market-data' },
    });
    const file = registryStateFile(dir);
    const state = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    state.artifacts = {
      s1: {
        ref: { type: 'search', searchKind: 'market-data' },
        identity: { family: 'anything' },
        membership: { ancestors: [] },
      },
    };
    writeFileSync(file, JSON.stringify(state), 'utf8');

    expect(() => registry.resolveReferent('s1' as Ref)).toThrow(/Registry state is corrupt/);
  });

  it('rejects persisted refs that disagree with their stored Referents', () => {
    registry.setRefs('d1', { d1: dashboardRef('MD1') });
    const file = registryStateFile(dir);
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      refs: Record<string, ReferentRef>;
    };
    state.refs.d1 = dashboardRef('MD2');
    writeFileSync(file, JSON.stringify(state), 'utf8');

    expect(() => registry.resolveRef('d1' as Ref)).toThrow(/Registry state is corrupt/);
  });

  it('initializes missing registry state on first use', () => {
    const fresh = createReferentRegistry(dir, 'fresh');

    expect(readdirSync(dir).filter((entry) => entry.startsWith('v7-'))).toEqual([]);
    expect(fresh.getAllRefs()).toEqual({});
    expect(registryStateFile(dir)).toMatch(/\.artifact-registry\.json$/);
    expect(fresh.claimWidget()).toBe('w1');
  });

  it('does not carry counters from an expired v7 session', () => {
    writeFileSync(v7RegistryStateFile(dir, 12345), JSON.stringify({
      schemaVersion: 7, lastUsedAt: 0, counters: { d: 9 },
    }));
    expect(registry.claimDashboard()).toBe('d1');
  });

  it('fails loudly rather than reuse counters from corrupt v7 state', () => {
    writeFileSync(v7RegistryStateFile(dir, 12345), JSON.stringify({
      schemaVersion: 7, lastUsedAt: Date.now(), counters: { d: -1 },
    }));
    expect(() => registry.claimDashboard()).toThrow('Registry state is corrupt:');
  });

  it('hard-cuts v7 state that held its payloads inline', () => {
    const file = v7RegistryStateFile(dir, 12345);
    const contents = JSON.stringify({
      schemaVersion: 7,
      lastUsedAt: Date.now(),
      counters: { d: 1 },
      refs: { d1: dashboardRef('MD1') },
      artifacts: {
        d1: {
          ref: dashboardRef('MD1'),
          identity: { family: 'dashboard', dashboardId: 'MD1' },
          membership: { ancestors: [] },
        },
      },
      payloads: { d1: { cursor: { page: 1, pageSize: 50, total: 180 } } },
      payloadOrder: ['d1'],
      interactionNamespaces: {},
      interactionNamespaceNames: [],
    });
    writeFileSync(file, contents, 'utf8');

    expect(registry.resolveRef('d1' as Ref)).toBeUndefined();
    expect(registry.getPayload('d1')).toBeUndefined();
    expect(registry.claimDashboard()).toBe('d2');
    registry.setRefs('d2', { d2: dashboardRef('MD2') });
    expect(registry.resolveRef('d1' as Ref)).toBeUndefined();
    expect(createReferentRegistry(dir, 12345).claimDashboard()).toBe('d3');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ schemaVersion: 8, counters: { d: 3 } });
  });

  it('a delayed first-use instance cannot clobber another instance claim', () => {
    const delayed = createReferentRegistry(dir, 'interleaved');

    const winner = createReferentRegistry(dir, 'interleaved');
    expect(winner.claimWidget()).toBe('w1');
    winner.setRefs('w1', { w1: widgetRef('MW1', 'WC1') });

    expect(delayed.claimWidget()).toBe('w2');
    expect(delayed.resolveRef('w1' as Ref)).toEqual(widgetRef('MW1'));
  });

  it('evicts oldest payloads and their child refs when over MAX_PAYLOADS (50)', () => {
    // Store 52 payloads — the first 2 should be evicted
    for (let i = 1; i <= 52; i++) {
      const ns = `s${i}`;
      registry.setRefs(ns, {
        [ns]: searchRef(),
        [`${ns}.w1`]: widgetRef(`MW${i}`, `WC${i}`),
      });
      registry.setPayload(ns, { result: i });
    }

    // s1 and s2 should be evicted
    expect(registry.getPayload('s1')).toBeUndefined();
    expect(registry.getPayload('s2')).toBeUndefined();
    expect(registry.resolveRef('s1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.w1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s2' as Ref)).toBeUndefined();

    // s3 through s52 should remain
    expect(registry.getPayload('s3')).toEqual({ result: 3 });
    expect(registry.resolveRef('s3' as Ref)).toEqual(searchRef());
    expect(registry.resolveRef('s3.w1' as Ref)).toEqual(widgetRef('MW3'));
    expect(registry.getPayload('s52')).toEqual({ result: 52 });
  });

  it('frees the slot of an evicted payload\'s child payload, wherever it sits in the eviction order', () => {
    const store = (ns: string) => {
      registry.setRefs(ns, { [ns]: searchRef() });
      registry.setPayload(ns, { result: ns });
    };
    store('s1');
    store('s2');
    store('s1.w1');
    for (let i = 3; i <= 51; i++) store(`s${i}`);

    expect(registry.getPayload('s1')).toBeUndefined();
    expect(registry.getPayload('s1.w1')).toBeUndefined();
    expect(registry.getPayload('s2')).toEqual({ result: 's2' });
  });

  it('clean removes the registry file', () => {
    registry.setRefs('w1', { w1: widgetRef('MW1', 'WC1') });
    registry.clean();
    expect(registry.resolveRef('w1' as Ref)).toBeUndefined();
  });

  it('clean fails loudly when the registry path cannot be removed', () => {
    registry.claimSearch();
    const file = registryStateFile(dir);
    rmSync(file, { force: true });
    mkdirSync(file);

    expect(() => registry.clean()).toThrow(/EISDIR|EPERM|operation not permitted/i);
  });

  it('rejects retired asset refs after dashboard unification', () => {
    expect(
      isReferentRef({
        type: 'asset',
        id: 'MAAPL',
        cursor: { page: 1, pageSize: 50, total: 214 },
      }),
    ).toBe(false);
  });

  it('replaces resumable cursor state without changing Dashboard identity', () => {
    registry.storeReferent({
      namespace: 'd1',
      root: dashboardRef('MD1234'),
      payload: { cursor: { page: 1, pageSize: 50, total: 180 } },
    });
    registry.setPayload('d1', { cursor: { page: 2, pageSize: 50, total: 180 } });

    expect(registry.resolveRef('d1' as Ref)).toEqual(dashboardRef('MD1234'));
    expect(createReferentRegistry(dir, 12345).getReferent('d1')).toEqual({
      namespace: 'd1',
      root: dashboardRef('MD1234'),
      refs: { d1: dashboardRef('MD1234') },
      payload: { cursor: { page: 2, pageSize: 50, total: 180 } },
    });
  });
});
