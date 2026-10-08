import type { Ref } from '../index.js';
import type { Tagged } from 'type-fest';
type WidgetId = Tagged<string, 'WidgetId'>;
type ConfigId = Tagged<string, 'ConfigId'>;
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { createArtifactRegistry, type ArtifactRef } from '../index.js';

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRegistryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-registry-'));
  tempDirs.push(dir);
  return dir;
}

describe('Artifact Registry hard cutover', () => {
  it('ignores pre-cutover files and stores typed identity with recursive membership', () => {
    const dir = tempRegistryDir();
    writeFileSync(join(dir, 'owner-legacy.registry.json'), JSON.stringify({
      counters: { s: 9 },
      refs: { s9: { type: 'search' } },
      payloads: {},
    }));

    const registry = createArtifactRegistry(dir, 'interaction-a');
    expect(registry.claimSearch()).toBe('s1');
    registry.storeArtifact({
      namespace: 's1',
      root: { type: 'search', searchKind: 'market-data' },
      refs: {
        's1.d1': { type: 'dashboard', dashboardId: 'MD1' },
        's1.d1.s1': {
          type: 'section',
          dashboardId: 'MD1',
          sectionId: 'section-1',
        },
      },
      payload: [],
    });

    expect(registry.resolveArtifact('s1' as Ref)).toMatchObject({
      identity: { family: 'search', searchKind: 'market-data' },
      membership: { ancestors: [] },
    });
    expect(registry.resolveArtifact('s1.d1.s1' as Ref)).toMatchObject({
      identity: {
        family: 'section',
        dashboardId: 'MD1',
        sectionId: 'section-1',
      },
      membership: { ancestors: ['s1', 's1.d1'] },
    });
    expect(readdirSync(dir)).toContain('owner-legacy.registry.json');
    expect(readdirSync(dir).some((name) => name.startsWith('v7-'))).toBe(true);
  });

  it('expires the complete inactive session atomically', () => {
    const dir = tempRegistryDir();
    let now = 1_000;
    const registry = createArtifactRegistry(dir, 'interaction-a', {
      inactivityMs: 500,
      now: () => now,
    });
    expect(registry.claimSearch()).toBe('s1');
    registry.storeArtifact({
      namespace: 's1',
      root: { type: 'search', searchKind: 'research' },
      refs: { 's1.c1': { type: 'document', documentId: 'document-1', realm: 'research' } },
      payload: [{ id: 'document-1' }],
    });

    now = 1_501;

    expect(registry.resolveRef('s1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.c1' as Ref)).toBeUndefined();
    expect(registry.getPayload('s1')).toBeUndefined();
    expect(registry.claimSearch()).toBe('s1');
  });

  it('rejects invalid Widget identity and Dashboard membership atomically', () => {
    const registry = createArtifactRegistry(tempRegistryDir(), 'interaction-a');
    registry.storeArtifact({
      namespace: 'd1',
      root: { type: 'dashboard', dashboardId: 'MD1' },
      payload: {},
    });

    expect(() => registry.setRefs('d1', {
      'd1.w1': { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: '' as ConfigId, selectedContext: null },
    })).toThrow('invalid canonical identity');
    expect(() => registry.setRefs('d1', {
      'd1.w1': { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: 'WC1' as ConfigId, selectedContext: null },
    })).toThrow('requires Dashboard and Dashboard Child identity');
    expect(registry.resolveRef('d1.w1' as Ref)).toBeUndefined();

    registry.setRefs('d1', {
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW1' as WidgetId,
        configurationId: 'WC1' as ConfigId,
        dashboardId: 'MD1',
        childId: 'CHILD1',
        selectedContext: null,
      },
    });
    expect(registry.resolveArtifact('d1.w1' as Ref)).toMatchObject({
      identity: { family: 'widget', widgetId: 'MW1', configurationId: 'WC1', selectedContext: null },
      membership: { dashboardId: 'MD1', dashboardChildId: 'CHILD1' },
    });

    expect(() => registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD2' },
    })).toThrow('requires Dashboard and Dashboard Child identity');
    expect(registry.resolveRef('d1' as Ref)).toEqual({ type: 'dashboard', dashboardId: 'MD1' });

    registry.storeArtifact({
      namespace: 'd1',
      root: { type: 'dashboard', dashboardId: 'MD2' },
      refs: {
        w2: {
          type: 'widget',
          widgetId: 'MW2' as WidgetId,
          configurationId: 'WC2' as ConfigId,
          dashboardId: 'MD2',
          childId: 'CHILD2',
          selectedContext: null,
        },
      },
      payload: {},
    });
    expect(registry.resolveRef('d1.w1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('d1.w2' as Ref)).toMatchObject({ dashboardId: 'MD2' });
  });

  it('stores Widget identity with nullable Config and Selected Context', () => {
    const registry = createArtifactRegistry(tempRegistryDir(), 'interaction-a');

    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: null, selectedContext: null },
      w2: {
        type: 'widget',
        widgetId: 'MW2' as WidgetId,
        configurationId: 'WC2' as ConfigId,
        selectedContext: 'MA_CONTEXT',
      },
    });

    expect(registry.resolveArtifact('w1' as Ref)).toMatchObject({
      identity: { family: 'widget', widgetId: 'MW1', configurationId: null, selectedContext: null },
    });
    expect(registry.resolveArtifact('w2' as Ref)).toMatchObject({
      identity: {
        family: 'widget',
        widgetId: 'MW2',
        configurationId: 'WC2',
        selectedContext: 'MA_CONTEXT',
      },
    });

    expect(() => registry.setRefs('w3', {
      w3: {
        type: 'widget',
        widgetId: 'MW3',
        data: { title: 'cached surface value' },
        configurationId: null,
        selectedContext: null,
      } as unknown as ArtifactRef,
    })).toThrow('invalid canonical identity');

    expect(() => registry.storeArtifact({
      namespace: 'w3',
      root: { type: 'widget', widgetId: 'MW3' as WidgetId, configurationId: null, selectedContext: null },
      payload: { title: 'cached surface value' },
    })).toThrow('Widget Artifacts cannot store payloads');
    expect(() => registry.setPayload('w1', { title: 'cached surface value' }))
      .toThrow('Widget Artifacts cannot store payloads');
  });

  it('evicts the oldest complete namespace graph without reusing counters', () => {
    const registry = createArtifactRegistry(tempRegistryDir(), 'interaction-a');
    for (let index = 1; index <= 51; index += 1) {
      const namespace = registry.claimSearch();
      registry.storeArtifact({
        namespace,
        root: { type: 'search', searchKind: 'research' },
        refs: {
          [`${namespace}.c1`]: {
            type: 'document',
            documentId: `document-${index}`,
            realm: 'research',
          },
        },
        payload: [{ id: `document-${index}` }],
      });
      if (index === 1) {
        registry.setPayload(`${namespace}.c1`, { body: 'nested payload' });
      }
    }

    expect(registry.resolveRef('s1' as Ref)).toBeUndefined();
    expect(registry.resolveRef('s1.c1' as Ref)).toBeUndefined();
    expect(registry.getPayload('s1')).toBeUndefined();
    expect(registry.getPayload('s1.c1')).toBeUndefined();
    expect(registry.resolveRef('s51' as Ref)).toBeDefined();
    expect(registry.claimSearch()).toBe('s52');
  });

  it('serializes allocation across concurrent CLI processes without lost updates', async () => {
    const dir = tempRegistryDir();
    const workers = await Promise.all(Array.from({ length: 4 }, () => execFileAsync(
      'node_modules/.bin/vite-node',
      [
        'marquee-cli/artifact-registry/tests/claim-worker.ts',
        dir,
        'interaction-a',
        '10',
      ],
      { cwd: process.cwd() },
    )));
    const claims = workers.flatMap(({ stdout }) => JSON.parse(stdout) as string[]);

    expect(new Set(claims).size).toBe(40);
    expect(claims.map((claim) => Number(claim.slice(1))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    const registry = createArtifactRegistry(dir, 'interaction-a');
    expect(Object.keys(registry.getAllRefs())).toHaveLength(40);
    for (const claim of claims) {
      expect(registry.resolveRef(claim as Ref)).toBeDefined();
      expect(registry.getPayload(claim)).toBeDefined();
    }
  }, 20_000);
});
