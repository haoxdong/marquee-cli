import { createArtifactRegistry } from '../index.js';

const [dir, sessionId, countText, sessionKind] = process.argv.slice(2);
if (!dir || !sessionId || !countText) {
  throw new Error('usage: claim-worker <dir> <session-id> <count> [codex-thread]');
}
const count = Number.parseInt(countText, 10);
const registry = createArtifactRegistry(
  dir,
  sessionKind === 'codex-thread'
    ? { CODEX_THREAD_ID: sessionId }
    : sessionId,
);
const claims = Array.from({ length: count }, (_, index) => {
  const namespace = registry.claimDashboard();
  registry.storeArtifact({
    namespace,
    root: {
      type: 'dashboard',
      dashboardId: `MD_WORKER_${process.pid}_${index}`,
    },
    payload: { worker: process.pid, index },
  });
  return namespace;
});
process.stdout.write(JSON.stringify(claims));
