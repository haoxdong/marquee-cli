import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockSync } from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry, createInteractionSessionNamespace } from '../index.js';

vi.mock('proper-lockfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('proper-lockfile')>();
  return { ...actual, lockSync: vi.fn(actual.lockSync) };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, unlinkSync: vi.fn(actual.unlinkSync) };
});

let dir: string;
const inactivityMs = 1_000;
const now = Date.now();
const options = { inactivityMs, now: () => now };
function age(file: string): void {
  const old = new Date(now - inactivityMs - 1);
  utimesSync(file, old, old);
}
function endedRegistry(): string {
  createArtifactRegistry(dir, 'ended').claimSearch();
  const name = readdirSync(dir).find((entry) => entry.startsWith('v7-'));
  if (name === undefined) throw new Error('ended registry fixture was not created');
  const file = join(dir, name);
  age(file);
  return file;
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'registry-cleanup-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('ended session cleanup', () => {
  it('removes an expired session when a different session opens', () => {
    const ended = endedRegistry();
    const fresh = createArtifactRegistry(dir, 'new', options);
    expect(existsSync(ended)).toBe(false);
    expect(fresh.claimSearch()).toBe('s1');
  });

  it('also sweeps when an Interaction Session namespace opens', () => {
    const ended = endedRegistry();
    const namespace = createInteractionSessionNamespace('work', (value): value is number => typeof value === 'number', {
      ...options, dir, session: 'new',
    });
    expect(existsSync(ended)).toBe(false);
    expect(namespace.update(() => 1)).toBe(1);
  });

  it('removes stale known legacy files and abandoned writes without parsing them', () => {
    const names = ['v5-0123456789abcdef.artifact-registry.json', 'owner.registry.json', 'owner.refs.json', 'owner.registry.json.123.tmp', 'v6-0123456789abcdef.artifact-registry.json.456.tmp', 'v7-0123456789abcdef.artifact-registry.json', 'v7-0123456789abcdef.artifact-registry.json.456.tmp'];
    for (const name of names) {
      const file = join(dir, name);
      writeFileSync(file, 'not JSON');
      age(file);
    }
    createArtifactRegistry(dir, 'new', options);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('preserves recent registries, unknown files and symlinks', () => {
    const names = ['recent.registry.json', 'notes.json', 'unrelated.tmp', 'v8-0123456789abcdef.artifact-registry.json'];
    for (const name of names) {
      const file = join(dir, name);
      writeFileSync(file, 'not JSON');
      if (name !== 'recent.registry.json') age(file);
    }
    symlinkSync(join(dir, 'notes.json'), join(dir, 'linked.registry.json'));
    createArtifactRegistry(dir, 'new', options);
    expect(readdirSync(dir).sort()).toEqual([...names, 'linked.registry.json'].sort());
  });

  it('leaves stale files and tmp writes owned by an active writer alone', () => {
    const ended = endedRegistry();
    const temp = `${ended}.123.tmp`;
    writeFileSync(temp, 'partial');
    age(temp);
    const release = lockSync(ended, { realpath: false });
    try {
      createArtifactRegistry(dir, 'new', options);
      expect(existsSync(ended)).toBe(true);
      expect(existsSync(temp)).toBe(true);
    } finally { release(); }
    createArtifactRegistry(dir, 'next', options);
    expect(existsSync(ended)).toBe(false);
    expect(existsSync(temp)).toBe(false);
  });

  it('rechecks age after acquiring the lock so revived sessions survive', async () => {
    const ended = endedRegistry();
    const actual = await vi.importActual<typeof import('proper-lockfile')>('proper-lockfile');
    vi.mocked(lockSync).mockImplementationOnce((file, lockOptions) => {
      const release = actual.lockSync(file, lockOptions);
      utimesSync(ended, new Date(now), new Date(now));
      return release;
    });
    createArtifactRegistry(dir, 'new', options);
    expect(existsSync(ended)).toBe(true);
  });

  it('removes only abandoned tmp writes while retaining their fresh destination', () => {
    const base = join(dir, 'owner.registry.json');
    writeFileSync(base, 'fresh');
    const temp = `${base}.123.tmp`;
    writeFileSync(temp, 'partial');
    age(temp);
    createArtifactRegistry(dir, 'new', options);
    expect(existsSync(base)).toBe(true);
    expect(existsSync(temp)).toBe(false);
  });

  it('tolerates a candidate disappearing before the locked age check', async () => {
    const ended = endedRegistry();
    const actual = await vi.importActual<typeof import('proper-lockfile')>('proper-lockfile');
    vi.mocked(lockSync).mockImplementationOnce((file, lockOptions) => {
      const release = actual.lockSync(file, lockOptions);
      unlinkSync(ended);
      return release;
    });
    expect(() => createArtifactRegistry(dir, 'new', options)).not.toThrow();
    expect(existsSync(ended)).toBe(false);
  });

  it('classifies sweep lock failures instead of reporting successful cleanup', () => {
    const ended = endedRegistry();
    const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(lockSync).mockImplementationOnce(() => { throw cause; });
    expect(() => createArtifactRegistry(dir, 'new', options)).toThrow(expect.objectContaining({
      name: 'RegistryLockError', kind: 'lock-failed', cause,
    }));
    expect(existsSync(ended)).toBe(true);
  });

  it('reports a writer racing the lock probe instead of discarding its acquisition failure', () => {
    const ended = endedRegistry();
    const cause = Object.assign(new Error('writer acquired the lock'), { code: 'ELOCKED' });
    vi.mocked(lockSync).mockImplementationOnce(() => { throw cause; });
    expect(() => createArtifactRegistry(dir, 'new', options)).toThrow(expect.objectContaining({
      name: 'RegistryLockError', kind: 'lock-busy', cause,
    }));
    expect(existsSync(ended)).toBe(true);
  });

  it('propagates deletion failure and releases the lock', () => {
    const ended = endedRegistry();
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(unlinkSync).mockImplementationOnce(() => { throw failure; });
    expect(() => createArtifactRegistry(dir, 'new', options)).toThrow(failure);
    const release = lockSync(ended, { realpath: false });
    release();
    expect(existsSync(ended)).toBe(true);
  });
});
