import { createArtifactRegistry } from '../index.js';

const [dir, sessionId] = process.argv.slice(2);
if (!dir || !sessionId) throw new Error('usage: lock-wait-worker <dir> <session-id>');
const registry = createArtifactRegistry(dir, sessionId);
process.stdout.write('READY\n');
const start = performance.now();
const cpu = process.cpuUsage();
const claim = registry.claimDashboard();
const used = process.cpuUsage(cpu);
process.stdout.write(JSON.stringify({
  claim,
  wallMs: performance.now() - start,
  cpuMs: (used.user + used.system) / 1000,
}));
