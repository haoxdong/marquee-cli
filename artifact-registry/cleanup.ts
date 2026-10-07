import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { checkSync, lockSync, unlockSync } from 'proper-lockfile';
import { RegistryLockError } from './errors.js';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isExpired(file: string, now: number, inactivityMs: number): boolean {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && now - stat.mtimeMs > inactivityMs;
  } catch (error) {
    // Another sweep or an atomic writer may have removed this candidate.
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function removeExpired(file: string, now: number, inactivityMs: number): void {
  if (!isExpired(file, now, inactivityMs)) return;
  try {
    unlinkSync(file);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
}

/** Sweep only registry formats observed in the sessions directory. */
export function cleanupInactiveRegistries(dir: string, now: number, inactivityMs: number): void {
  for (const name of readdirSync(dir)) {
    const match = /^(v[56]-[a-f0-9]{16}\.artifact-registry\.json|.+\.(?:registry|refs)\.json)(?:\.\d+\.tmp)?$/.exec(name);
    const baseName = match?.[1];
    if (baseName === undefined) continue;
    const file = join(dir, name);
    if (!isExpired(file, now, inactivityMs)) continue;
    // Temporary writes share their destination's lock, rather than a separate tmp lock.
    const base = join(dir, baseName);
    try {
      // An observed active writer makes this file ineligible for cleanup.
      if (checkSync(base, { realpath: false })) continue;
      lockSync(base, { realpath: false });
    } catch (error) {
      throw new RegistryLockError(hasCode(error, 'ELOCKED') ? 'lock-busy' : 'lock-failed', error);
    }
    try {
      removeExpired(file, now, inactivityMs);
    } finally {
      unlockSync(base, { realpath: false });
    }
  }
}
