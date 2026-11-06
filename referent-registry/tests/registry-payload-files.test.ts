import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReferentRegistry, type ReferentRef } from '../index.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), rmSync: vi.fn(actual.rmSync) };
});

const dashboard = (dashboardId: string): ReferentRef => ({ type: 'dashboard', dashboardId });
let dir: string;

function sessionEntry(suffix: string): string {
  const name = readdirSync(dir).find((entry) => entry.startsWith('v7-') && entry.endsWith(suffix));
  if (name === undefined) throw new Error(`missing ${suffix} in ${dir}`);
  return join(dir, name);
}
const stateFile = () => sessionEntry('.artifact-registry.json');
const payloadDir = () => sessionEntry('.artifact-payloads');
const payloadFiles = () => readdirSync(payloadDir()).map((name) => join(payloadDir(), name));

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'registry-payload-files-')); });
afterEach(() => {
  vi.mocked(readFileSync).mockRestore();
  vi.mocked(rmSync).mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe('Referent Registry payload files', () => {
  it('keeps payloads out of the state file, so its size does not grow with them', () => {
    const registry = createReferentRegistry(dir, 'session');
    const payload = { body: 'x'.repeat(1024 * 1024) };
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload });

    expect(statSync(stateFile()).size).toBeLessThan(1024);
    expect(payloadFiles()).toHaveLength(1);
    expect(createReferentRegistry(dir, 'session').getPayload('d1')).toEqual(payload);
  });

  it('removes the payload files of replaced and evicted namespaces', () => {
    const registry = createReferentRegistry(dir, 'session');
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { version: 1 } });
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { version: 2 } });
    expect(payloadFiles()).toHaveLength(1);

    for (let i = 2; i <= 52; i += 1) {
      registry.storeReferent({ namespace: `d${i}`, root: dashboard(`MD${i}`), payload: { i } });
    }
    expect(payloadFiles()).toHaveLength(50);
    expect(registry.getPayload('d1')).toBeUndefined();
    expect(registry.getPayload('d2')).toBeUndefined();
    expect(registry.getPayload('d3')).toEqual({ i: 3 });
  });

  it('removes the payload file of a rejected write', () => {
    const registry = createReferentRegistry(dir, 'session');
    registry.setRefs('w1', { w1: { type: 'widget', widgetId: 'MW1' as never, configurationId: null, selectedContext: null } });

    expect(() => registry.setPayload('w1', { rows: [] })).toThrow('Widget Referents cannot store payloads');
    expect(payloadFiles()).toEqual([]);
  });

  it('keeps a committed payload when retired-file cleanup fails', () => {
    const registry = createReferentRegistry(dir, 'session');
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { version: 1 } });
    vi.mocked(rmSync).mockImplementationOnce(() => { throw new Error('cleanup denied'); });
    expect(() => registry.storeReferent({
      namespace: 'd1', root: dashboard('MD2'), payload: { version: 2 },
    })).toThrow('cleanup denied');
    expect(createReferentRegistry(dir, 'session').getReferent('d1')).toEqual({
      namespace: 'd1', root: dashboard('MD2'), refs: { d1: dashboard('MD2') }, payload: { version: 2 },
    });
  });

  it('fails loudly on a corrupt payload file', () => {
    const registry = createReferentRegistry(dir, 'session');
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { ok: true } });
    const [file] = payloadFiles();
    if (file === undefined) throw new Error('missing payload file');
    writeFileSync(file, '{corrupt');

    expect(() => registry.getReferent('d1')).toThrow(`Registry state is corrupt: ${file}`);
  });

  it('fails loudly when a payload file the state references is gone', () => {
    const registry = createReferentRegistry(dir, 'session');
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { ok: true } });
    for (const file of payloadFiles()) rmSync(file);

    expect(() => registry.getPayload('d1'))
      .toThrow(`Registry state is corrupt: ${stateFile()} — payload file for d1 is missing`);
  });

  it('reads a payload outside the lock and retries one replaced before it was read', async () => {
    const reader = createReferentRegistry(dir, 'session');
    const writer = createReferentRegistry(dir, 'session');
    writer.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { version: 1 } });
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    let replaced = false;
    vi.mocked(readFileSync).mockImplementation((...args: Parameters<typeof actual.readFileSync>) => {
      if (!replaced && String(args[0]).includes('.artifact-payloads')) {
        replaced = true;
        // The writer's transaction succeeds only because the reader no longer holds the lock.
        writer.storeReferent({ namespace: 'd1', root: dashboard('MD2'), payload: { version: 2 } });
      }
      return actual.readFileSync(...args);
    });

    expect(reader.getReferent('d1')).toEqual({
      namespace: 'd1', root: dashboard('MD2'), refs: { d1: dashboard('MD2') }, payload: { version: 2 },
    });
    expect(replaced).toBe(true);
  });

  it('removes an expired session\'s payload files when the session restarts', () => {
    const start = Date.now();
    createReferentRegistry(dir, 'session', { inactivityMs: 1_000, now: () => start })
      .storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { old: true } });

    const oldPayloads = payloadFiles();
    const later = createReferentRegistry(dir, 'session', { inactivityMs: 1_000, now: () => start + 1_001 });
    expect(later.getPayload('d1')).toBeUndefined();
    expect(oldPayloads).toHaveLength(1);
    expect(oldPayloads.map((file) => existsSync(file))).toEqual([false]);
  });
});

describe('ended session payload cleanup', () => {
  const inactivityMs = 1_000;
  const now = Date.now();
  const options = { inactivityMs, now: () => now };
  const age = (file: string) => {
    const old = new Date(now - inactivityMs - 1);
    utimesSync(file, old, old);
  };

  it('removes an ended session\'s payload directory', () => {
    createReferentRegistry(dir, 'ended')
      .storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { ok: true } });
    const ended = payloadDir();
    for (const file of [stateFile(), ...payloadFiles(), ended]) age(file);

    createReferentRegistry(dir, 'new', options);
    expect(existsSync(ended)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps a new session\'s empty payload directory created before its first file', () => {
    const fresh = join(dir, 'v7-0123456789abcdef.artifact-payloads');
    mkdirSync(fresh);

    createReferentRegistry(dir, 'new', options);
    expect(existsSync(fresh)).toBe(true);
  });

  it('keeps old payload files while their session is live', () => {
    const registry = createReferentRegistry(dir, 'live');
    registry.storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { ok: true } });
    for (const file of payloadFiles()) age(file);

    createReferentRegistry(dir, 'new', options);
    expect(registry.getPayload('d1')).toEqual({ ok: true });
  });

  it('keeps a fresh payload file an ended session\'s writer has yet to commit', () => {
    createReferentRegistry(dir, 'ended')
      .storeReferent({ namespace: 'd1', root: dashboard('MD1'), payload: { ok: true } });
    const [stored] = payloadFiles();
    if (stored === undefined) throw new Error('missing payload file');
    age(stateFile());
    age(stored);
    const pending = join(payloadDir(), '00000000-0000-4000-8000-000000000000.json');
    writeFileSync(pending, '{}');

    createReferentRegistry(dir, 'new', options);
    expect(existsSync(stored)).toBe(false);
    expect(existsSync(pending)).toBe(true);
  });
});
