import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockSync } from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../index.js';

vi.mock('proper-lockfile', () => ({ lockSync: vi.fn(), unlockSync: vi.fn() }));
const lock = vi.mocked(lockSync);
let dir: string;
let elapsedMs: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'registry-lock-errors-'));
  lock.mockReset();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  elapsedMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsedMs);
  vi.spyOn(Atomics, 'wait').mockImplementation((_array, _index, _value, timeout) => {
    elapsedMs += timeout ?? 0;
    return 'timed-out';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function captureFailure(): unknown {
  try {
    createArtifactRegistry(dir, 'lock-errors').claimDashboard();
  } catch (error) {
    return error;
  }
  throw new Error('expected registry operation to fail');
}

describe('Artifact Registry lock failures', () => {
  it('acquires a released lock promptly after sustained contention', () => {
    lock.mockImplementation(() => {
      if (elapsedMs < 1200) {
        throw Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' });
      }
      return () => {};
    });
    const registry = createArtifactRegistry(dir, 'released-lock');
    expect(registry.claimDashboard()).toBe('d1');
    expect(elapsedMs).toBeGreaterThanOrEqual(1200);
    expect(elapsedMs).toBeLessThanOrEqual(1250);
    expect(registry.claimDashboard()).toBe('d2');
  });

  it('classifies exhausted contention and retains the final lock failure', () => {
    const cause = Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' });
    lock.mockImplementation(() => { throw cause; });
    expect(captureFailure()).toMatchObject({ name: 'RegistryLockError', kind: 'lock-busy', cause });
    expect(elapsedMs).toBe(15_000);
    expect(Atomics.wait).toHaveBeenCalled();
  });

  it.each(['EACCES', 'ENOENT'])('propagates %s without retrying it as contention', (code) => {
    const cause = Object.assign(new Error(`filesystem failure ${code}`), { code });
    lock.mockImplementation(() => { throw cause; });
    expect(captureFailure()).toMatchObject({ name: 'RegistryLockError', kind: 'lock-failed', cause });
    expect(lock).toHaveBeenCalledTimes(1);
    expect(Atomics.wait).not.toHaveBeenCalled();
  });

  it('allows allocation after transient contention without losing its counter', () => {
    lock.mockImplementationOnce(() => {
      throw Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' });
    });
    const registry = createArtifactRegistry(dir, 'lock-errors');
    expect(registry.claimDashboard()).toBe('d1');
    expect(registry.claimDashboard()).toBe('d2');
    expect(lock).toHaveBeenCalledTimes(3);
    expect(Atomics.wait).toHaveBeenCalledTimes(1);
  });
});
