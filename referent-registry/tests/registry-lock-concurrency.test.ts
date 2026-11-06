import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createReferentRegistry, type Ref } from '../index.js';

const { lockSync, unlockSync } = createRequire(import.meta.url)('proper-lockfile') as typeof import('proper-lockfile');
const execFileAsync = promisify(execFile);

describe('Referent Registry lock contention', () => {
  it.each([7, 8])('waits for a schema %i writer without consuming a CPU core', async (schema) => {
    const dir = mkdtempSync(join(tmpdir(), 'registry-lock-wait-'));
    const sessionId = 'lock-wait';
    const registry = createReferentRegistry(dir, sessionId);
    expect(registry.claimDashboard()).toBe('d1');
    const name = readdirSync(dir).find((name) => name.endsWith('.json'));
    if (!name) throw new Error('expected the seeded registry file');
    const file = join(dir, schema === 7 ? name.replace(/^v8-/, 'v7-') : name);
    if (schema === 7) {
      renameSync(join(dir, name), file);
      const state = JSON.parse(readFileSync(file, 'utf8'));
      state.schemaVersion = 7;
      writeFileSync(file, JSON.stringify(state));
    }
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
          if (schema === 7) {
            const state = JSON.parse(readFileSync(file, 'utf8'));
            expect(state.schemaVersion).toBe(7);
            state.counters.d = 2;
            writeFileSync(file, JSON.stringify(state));
          }
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
      expect(result.claim).toBe(schema === 7 ? 'd3' : 'd2');
      expect(result.wallMs).toBeGreaterThanOrEqual(1100);
      expect(result.cpuMs / result.wallMs).toBeLessThan(0.25);
      expect(registry.claimDashboard()).toBe(schema === 7 ? 'd4' : 'd3');
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
      const registry = createReferentRegistry(dir, 'six-callers');
      registry.storeReferent({
        namespace: registry.claimDashboard(),
        root: { type: 'dashboard', dashboardId: 'MD_SYNTHETIC_FIXTURE' },
        payload: { body: 'x'.repeat(1024 * 1024) },
      });
      const results = await Promise.all(Array.from({ length: 6 }, () => execFileAsync(
        'node_modules/.bin/vite-node', [
          fileURLToPath(new URL('./claim-worker.ts', import.meta.url)), dir, 'six-callers', '5',
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
