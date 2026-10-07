import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { filterStoredDashboard } from '../dashboard-filter.js';

const [refStoreDir, sessionId] = process.argv.slice(2);
if (!refStoreDir || !sessionId) {
  throw new Error('usage: dashboard-filter-worker <ref-store-dir> <session-id>');
}

const result = await filterStoredDashboard('d1', 'analysis', {
  registry: createArtifactRegistry(refStoreDir, sessionId),
  readEntityFeedPage: async () => {
    throw new Error('fully loaded Entity Feed must not fetch another page');
  },
  widgets: {
    renderDashboardWidget: async () => {
      throw new Error('Widgets with snippets must not render again');
    },
  },
});
if (!result.ok) throw new Error(`filter failed: ${result.error.kind}`);
process.stdout.write(String(result.value.matches.length));
