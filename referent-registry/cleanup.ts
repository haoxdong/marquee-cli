import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
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

/** Runs a sweep step under the session's lock, unless an active writer holds it. */
function withSweepLock(base: string, step: () => void): void {
  try {
    // An observed active writer makes this file ineligible for cleanup.
    if (checkSync(base, { realpath: false })) return;
    lockSync(base, { realpath: false });
  } catch (error) {
    throw new RegistryLockError(hasCode(error, 'ELOCKED') ? 'lock-busy' : 'lock-failed', error);
  }
  try {
    step();
  } finally {
    unlockSync(base, { realpath: false });
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function isLiveSession(base: string, now: number, inactivityMs: number): boolean {
  return existsSync(base) && !isExpired(base, now, inactivityMs);
}

/**
 * A session's payload files go once its state file has expired or is gone.
 * Files younger than the window stay: a writer stores its payload file before
 * it takes the lock to commit it.
 */
function sweepPayloads(payloadDir: string, base: string, now: number, inactivityMs: number): void {
  // Another sweep may have removed the directory since it was listed.
  const isSweepable = () => isDirectory(payloadDir) && !isLiveSession(base, now, inactivityMs);
  if (!isSweepable()) return;
  withSweepLock(base, () => {
    if (!isSweepable()) return;
    // A directory changed within the window may be a new session's, created just before its first file.
    const dirIsStale = now - lstatSync(payloadDir).mtimeMs > inactivityMs;
    for (const name of readdirSync(payloadDir)) removeExpired(join(payloadDir, name), now, inactivityMs);
    if (!dirIsStale) return;
    try {
      rmdirSync(payloadDir);
    } catch (error) {
      if (!hasCode(error, 'ENOTEMPTY')) throw error;
    }
  });
}

/** Sweep only registry formats observed in the sessions directory. */
export function cleanupInactiveRegistries(dir: string, now: number, inactivityMs: number): void {
  for (const name of readdirSync(dir)) {
    const payloadSession = /^(v7-[a-f0-9]{16})\.artifact-payloads$/.exec(name)?.[1];
    if (payloadSession !== undefined) {
      sweepPayloads(join(dir, name), join(dir, `${payloadSession}.artifact-registry.json`), now, inactivityMs);
      continue;
    }
    const match = /^(v[3-8]-[a-f0-9]{16}\.artifact-registry\.json|.+\.(?:registry|refs)\.json)(?:\.\d+\.tmp)?$/.exec(name);
    const baseName = match?.[1];
    if (baseName === undefined) continue;
    const file = join(dir, name);
    if (!isExpired(file, now, inactivityMs)) continue;
    // Temporary writes share their destination's lock, rather than a separate tmp lock.
    withSweepLock(join(dir, baseName), () => {
      removeExpired(file, now, inactivityMs);
    });
  }
}
