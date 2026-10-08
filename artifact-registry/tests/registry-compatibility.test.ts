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
  createArtifactRegistry,
  type ArtifactRef,
} from '../index.js';
import { isArtifactRef } from '../ref-resolution.js';

function registryStateFile(dir: string): string {
  const name = readdirSync(dir).find((entry) => (
    entry.startsWith('v7-') && entry.endsWith('.artifact-registry.json')
  ));
  if (!name) throw new Error(`missing Artifact Registry state in ${dir}`);
  return join(dir, name);
}

function legacyRegistryStateFile(
  dir: string,
  sessionId: number | string,
  version = 2,
): string {
  const digest = createHash('sha256')
    .update(String(sessionId))
    .digest('hex')
    .slice(0, 16);
  return join(dir, `v${version}-${digest}.artifact-registry.json`);
}

function searchRef(_query = ''): ArtifactRef {
  return { type: 'search', searchKind: 'market-data' };
}

function widgetRef(id: string, configurationId = id.replace(/^MW/, 'WC')): ArtifactRef {
  return { type: 'widget', widgetId: id as WidgetId, configurationId: configurationId as ConfigId, selectedContext: null };
}

function dashboardRef(id: string): ArtifactRef {
  return { type: 'dashboard', dashboardId: id };
}

describe('ArtifactRegistry', () => {
  let dir: string;
  let registry: ReturnType<typeof createArtifactRegistry>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'registry-'));
    registry = createArtifactRegistry(dir, 12345);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reloads Widget refs with explicit null identity values', () => {
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: null, selectedContext: null },
    });

    const reloaded = createArtifactRegistry(dir, 12345);
    expect(reloaded.resolveArtifact('w1' as Ref)).toEqual({
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
    const artifact = state.artifacts.w1;
    if (!artifact) throw new Error('missing stored Widget');
    delete artifact.identity[field];
    writeFileSync(file, JSON.stringify(state));

    expect(() => createArtifactRegistry(dir, 12345).resolveRef('w1' as Ref))
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

  it('setRefs stores canonical Artifact refs', () => {
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

  it('storeArtifact stores root ref, child refs, and payload behind one artifact handle', () => {
    const artifact = registry.storeArtifact({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
      },
      payload: [{ id: 'MW1' }],
    });

    expect(artifact.namespace).toBe('s1');
    expect(artifact.root).toEqual(searchRef('rates'));
    expect(artifact.childRef('w1')).toBe('s1.w1');
    expect(registry.resolveRef('s1' as Ref)).toEqual(searchRef('rates'));
    expect(registry.resolveRef('s1.w1' as Ref)).toEqual(widgetRef('MW1'));
    expect(registry.getPayload('s1')).toEqual([{ id: 'MW1' }]);
  });

  it('stores canonical namespace-member artifacts', () => {
    registry.storeArtifact({
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
    expect(() => registry.storeArtifact({
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

  it('storeArtifact normalizes child refs into the artifact namespace', () => {
    const artifact = registry.storeArtifact({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        w1: widgetRef('MW1', 'WC1'),
      },
      payload: [{ id: 'MW1' }],
    });

    expect(artifact.refs).toEqual({
      s1: searchRef('rates'),
      's1.w1': widgetRef('MW1'),
    });
    expect(registry.resolveRef('w1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.w1' as Ref)).toEqual(widgetRef('MW1'));
    expect(registry.resolveRef('s1.w1.link' as Ref)).toBeUndefined();
  });

  it('getArtifact returns only refs owned by the artifact namespace', () => {
    registry.storeArtifact({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
      },
      payload: [{ id: 'MW1' }],
    });
    registry.storeArtifact({
      namespace: 's2',
      root: searchRef('credit'),
      refs: {
        's2.w1': widgetRef('MW2', 'WC2'),
      },
      payload: [{ id: 'MW2' }],
    });

    expect(registry.getArtifact('s1')).toEqual({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        s1: searchRef('rates'),
        's1.w1': widgetRef('MW1'),
      },
      payload: [{ id: 'MW1' }],
    });
  });

  it('storeArtifact replaces stale child refs in its namespace', () => {
    registry.storeArtifact({
      namespace: 's1',
      root: searchRef('rates'),
      refs: {
        's1.w1': widgetRef('MW1', 'WC1'),
        's1.w2': widgetRef('MW2', 'WC2'),
      },
      payload: [{ id: 'MW1' }, { id: 'MW2' }],
    });

    registry.storeArtifact({
      namespace: 's1',
      root: searchRef('credit'),
      refs: {
        's1.w3': widgetRef('MW3', 'WC3'),
      },
      payload: [{ id: 'MW3' }],
    });

    expect(registry.resolveRef('s1.w1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.w2' as Ref)).toBeUndefined();
    expect(registry.getArtifact('s1')).toEqual({
      namespace: 's1',
      root: searchRef('credit'),
      refs: {
        s1: searchRef('credit'),
        's1.w3': widgetRef('MW3'),
      },
      payload: [{ id: 'MW3' }],
    });
  });

  it('storeArtifact clears cached child payloads when replacing an artifact namespace', () => {
    registry.storeArtifact({
      namespace: 's1',
      root: { type: 'search', searchKind: 'research' },
      refs: {
        's1.c1': { type: 'document', documentId: 'old-doc', realm: 'research' },
      },
      payload: { results: [{ id: 'old-doc' }] },
    });
    registry.setPayload('s1.c1', { id: 'old-doc', body: 'stale body' });

    registry.storeArtifact({
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

  it('storeArtifact rejects empty namespace', () => {
    expect(() =>
      registry.storeArtifact({
        namespace: '',
        root: searchRef(),
        payload: [],
      }),
    ).toThrow('storeArtifact requires a non-empty namespace');
  });

  it('getPayload returns undefined for unknown namespace', () => {
    expect(registry.getPayload('w99')).toBeUndefined();
  });

  it('persists to a versioned Artifact Registry file', () => {
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

  it('rejects persisted entries without typed Artifact identity and membership', () => {
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

    expect(() => registry.resolveArtifact('s1' as Ref)).toThrow(/Registry state is corrupt/);
  });

  it('rejects persisted refs that disagree with their stored Artifacts', () => {
    registry.setRefs('d1', { d1: dashboardRef('MD1') });
    const file = registryStateFile(dir);
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      refs: Record<string, ArtifactRef>;
    };
    state.refs.d1 = dashboardRef('MD2');
    writeFileSync(file, JSON.stringify(state), 'utf8');

    expect(() => registry.resolveRef('d1' as Ref)).toThrow(/Registry state is corrupt/);
  });

  it('initializes missing registry state on first use', () => {
    const fresh = createArtifactRegistry(dir, 'fresh');

    expect(readdirSync(dir).filter((entry) => entry.startsWith('v7-'))).toEqual([]);
    expect(fresh.getAllRefs()).toEqual({});
    expect(registryStateFile(dir)).toMatch(/\.artifact-registry\.json$/);
    expect(fresh.claimWidget()).toBe('w1');
  });

  it('hard-cuts a valid pre-Widget v2 registry instead of treating it as corrupt', () => {
    writeFileSync(legacyRegistryStateFile(dir, 12345), JSON.stringify({
      schemaVersion: 2,
      lastUsedAt: Date.now(),
      counters: { w: 1 },
      refs: {
        w1: { type: 'configured-widget', widgetId: 'MW1', configurationId: 'WC1' },
      },
      artifacts: {
        w1: {
          ref: { type: 'configured-widget', widgetId: 'MW1', configurationId: 'WC1' },
          identity: { family: 'configured-widget', widgetId: 'MW1', configurationId: 'WC1' },
          membership: { ancestors: [] },
        },
      },
      payloads: {},
    }), 'utf8');

    expect(registry.getAllRefs()).toEqual({});
    expect(registry.claimWidget()).toBe('w1');
  });

  it('hard-cuts pre-single-Content v4 refs without aliases', () => {
    writeFileSync(legacyRegistryStateFile(dir, 12345, 4), JSON.stringify({
      schemaVersion: 4,
      lastUsedAt: Date.now(),
      counters: { cm: 1 },
      refs: {
        cm1: { type: 'document', documentId: 'old-doc', realm: 'markets' },
      },
      artifacts: {
        cm1: {
          ref: { type: 'document', documentId: 'old-doc', realm: 'markets' },
          identity: { family: 'document', documentId: 'old-doc', realm: 'markets' },
          membership: { ancestors: [] },
        },
      },
      payloads: { cm1: { id: 'old-doc' } },
      interactionNamespaces: {},
      interactionNamespaceNames: [],
    }), 'utf8');

    expect(registry.getAllRefs()).toEqual({});
    expect(registry.resolveRef('cm1' as Ref)).toBeUndefined();
    expect(registry.claimContent()).toBe('c1');
  });

  it('hard-cuts v5 Dashboard payloads stored before the widgetDefinition rename', () => {
    const entry = { rank: 1, title: 'Short interest', widgetId: 'MW1', widgetData: {}, widgetParameterAssignments: [] };
    writeFileSync(legacyRegistryStateFile(dir, 12345, 5), JSON.stringify({
      schemaVersion: 5,
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
      payloads: { d1: { kind: 'entity-feed', entityFeed: { entries: [entry] } } },
      interactionNamespaces: {},
      interactionNamespaceNames: [],
    }), 'utf8');

    expect(registry.resolveRef('d1' as Ref)).toBeUndefined();
    expect(registry.getPayload('d1')).toBeUndefined();
    expect(registry.claimDashboard()).toBe('d1');
  });

  it.each([
    { type: 'widget', widgetId: 'MW1' },
    { type: 'widget', widgetId: 'MW1', configurationId: 'WC1' },
  ])('hard-cuts unexpired v6 Widget refs with optional identity keys: %o', (ref) => {
    const file = legacyRegistryStateFile(dir, 12345, 6);
    const { type: _type, ...identity } = ref;
    const contents = JSON.stringify({
      schemaVersion: 6,
      lastUsedAt: Date.now(),
      counters: { w: 1 },
      refs: { w1: ref },
      artifacts: {
        w1: { ref, identity: { family: 'widget', ...identity }, membership: { ancestors: [] } },
      },
      payloads: {},
      interactionNamespaces: {},
      interactionNamespaceNames: [],
    });
    writeFileSync(file, contents, 'utf8');

    expect(registry.getAllRefs()).toEqual({});
    expect(registry.claimWidget()).toBe('w1');
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: null, selectedContext: null },
    });
    expect(createArtifactRegistry(dir, 12345).resolveRef('w1' as Ref)).toEqual({
      type: 'widget', widgetId: 'MW1', configurationId: null, selectedContext: null,
    });
    expect(readFileSync(file, 'utf8')).toBe(contents);
  });

  it('a delayed first-use instance cannot clobber another instance claim', () => {
    const delayed = createArtifactRegistry(dir, 'interleaved');

    const winner = createArtifactRegistry(dir, 'interleaved');
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
      isArtifactRef({
        type: 'asset',
        id: 'MAAPL',
        cursor: { page: 1, pageSize: 50, total: 214 },
      }),
    ).toBe(false);
  });

  it('updates resumable cursor state atomically without changing Dashboard identity', async () => {
    registry.storeArtifact({
      namespace: 'd1',
      root: dashboardRef('MD1234'),
      payload: { cursor: { page: 1, pageSize: 50, total: 180 } },
    });
    await Promise.all([
      Promise.resolve().then(() => registry.updatePayload('d1', (value) => {
        const payload = value as { cursor: { page: number; pageSize: number; total: number } };
        return { cursor: { ...payload.cursor, page: payload.cursor.page + 1 } };
      })),
      Promise.resolve().then(() => registry.updatePayload('d1', (value) => {
        const payload = value as { cursor: { page: number; pageSize: number; total: number } };
        return { cursor: { ...payload.cursor, page: payload.cursor.page + 1 } };
      })),
      Promise.resolve().then(() => registry.updatePayload('d1', (value) => {
        const payload = value as { cursor: { page: number; pageSize: number; total: number } };
        return { cursor: { ...payload.cursor, page: payload.cursor.page + 1 } };
      })),
    ]);
    expect(registry.resolveRef('d1' as Ref)).toEqual(dashboardRef('MD1234'));
    expect(registry.getPayload('d1')).toEqual({
      cursor: { page: 4, pageSize: 50, total: 180 },
    });

    const second = createArtifactRegistry(dir, 12345);
    expect(second.getPayload('d1')).toEqual({
      cursor: { page: 4, pageSize: 50, total: 180 },
    });
  });
});
