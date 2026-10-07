import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createArtifactRegistry, type Ref } from '../index.js';

const { lockSync, unlockSync } = createRequire(import.meta.url)('proper-lockfile') as typeof import('proper-lockfile');
const execFileAsync = promisify(execFile);

describe('Artifact Registry lock contention', () => {
  it('waits for another process without consuming a CPU core', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'registry-lock-wait-'));
    const sessionId = 'lock-wait';
    const registry = createArtifactRegistry(dir, sessionId);
    expect(registry.claimDashboard()).toBe('d1');
    const name = readdirSync(dir).find((name) => name.endsWith('.json'));
    if (!name) throw new Error('expected the seeded registry file');
    const file = join(dir, name);
    lockSync(file, { realpath: false });
    const holder = { locked: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn('node_modules/.bin/vite-node', [
      fileURLToPath(new URL('./lock-wait-worker.ts', import.meta.url)), dir, sessionId,
    ]);
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (!timer && output.startsWith('READY\n')) {
        timer = setTimeout(() => {
          unlockSync(file, { realpath: false });
          holder.locked = false;
        }, 1200);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      expect(code, errors).toBe(0);
      const result = JSON.parse(output.slice('READY\n'.length)) as { claim: string; wallMs: number; cpuMs: number };
      console.log('Registry lock wait:', result);
      expect(result.claim).toBe('d2');
      expect(result.wallMs).toBeGreaterThanOrEqual(1100);
      expect(result.cpuMs / result.wallMs).toBeLessThan(0.25);
      expect(registry.claimDashboard()).toBe('d3');
    } finally {
      if (timer) clearTimeout(timer);
      child.kill();
      if (holder.locked) unlockSync(file, { realpath: false });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it('preserves six concurrent callers allocations and payload updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'registry-six-callers-'));
    try {
      const registry = createArtifactRegistry(dir, 'six-callers');
      registry.storeArtifact({
        namespace: registry.claimDashboard(),
        root: { type: 'dashboard', dashboardId: 'MD_SYNTHETIC_FIXTURE' },
        payload: { body: 'x'.repeat(1024 * 1024) },
      });
      const results = await Promise.all(Array.from({ length: 6 }, () => execFileAsync(
        'node_modules/.bin/vite-node', [
          'marquee-cli/artifact-registry/tests/claim-worker.ts', dir, 'six-callers', '5',
        ],
      )));
      const claims = results.flatMap(({ stdout }) => JSON.parse(stdout) as string[]);
      expect(new Set(claims).size).toBe(30);
      expect(claims.map((claim) => Number(claim.slice(1))).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 30 }, (_, index) => index + 2),
      );
      expect(Object.keys(registry.getAllRefs())).toHaveLength(31);
      expect(registry.getPayload('d1')).toEqual({ body: 'x'.repeat(1024 * 1024) });
      for (const claim of claims) {
        expect(registry.resolveRef(claim as Ref)).toBeDefined();
        expect(registry.getPayload(claim)).toBeDefined();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
