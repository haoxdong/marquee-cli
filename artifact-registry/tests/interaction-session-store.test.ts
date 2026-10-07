import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createArtifactRegistry,
  createInteractionSessionNamespace,
} from '../index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'interaction-session-'));
  tempDirs.push(dir);
  return dir;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

describe('Interaction Session namespace store', () => {
  it('shares whole-session activity and expiry with Artifact Registry state', () => {
    const dir = tempSessionDir();
    let now = 0;
    const session = 'interaction-a';
    const options = { inactivityMs: 10, now: () => now };
    const registry = createArtifactRegistry(dir, session, options);
    const namespace = createInteractionSessionNamespace(
      'entity-resolution-v1',
      isNumber,
      { dir, session, ...options },
    );

    expect(registry.claimSearch()).toBe('s1');
    namespace.update(() => 1);
    now = 8;
    expect(namespace.read()).toBe(1);
    now = 15;
    expect(registry.claimSearch()).toBe('s2');
    now = 22;
    expect(namespace.read()).toBe(1);

    now = 33;
    expect(namespace.read()).toBeUndefined();
    expect(registry.claimSearch()).toBe('s1');
  });

  it('evicts the oldest complete namespace at capacity', () => {
    const dir = tempSessionDir();
    for (let index = 1; index <= 51; index += 1) {
      createInteractionSessionNamespace(
        `namespace-${index}`,
        isNumber,
        { dir, session: 'interaction-a', maxNamespaces: 50 },
      ).update(() => index);
    }

    expect(createInteractionSessionNamespace(
      'namespace-1',
      isNumber,
      { dir, session: 'interaction-a', maxNamespaces: 50 },
    ).read()).toBeUndefined();
    expect(createInteractionSessionNamespace(
      'namespace-51',
      isNumber,
      { dir, session: 'interaction-a', maxNamespaces: 50 },
    ).read()).toBe(51);
  });
});
