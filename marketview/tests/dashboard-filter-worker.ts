import { createArtifactRegistry } from '../../artifact-registry/index.js';
import type { EntityFeedEntry } from '../../entity-feed/index.js';
import { filterStoredDashboard } from '../dashboard-filter.js';

const [refStoreDir, sessionId] = process.argv.slice(2);
if (!refStoreDir || !sessionId) {
  throw new Error('usage: dashboard-filter-worker <ref-store-dir> <session-id>');
}

const registry = createArtifactRegistry(refStoreDir, sessionId);
const payload = registry.getPayload('d1') as { entityFeed: { entries: EntityFeedEntry[] } };
const result = await filterStoredDashboard('d1', 'analysis', {
  registry,
  readEntityFeedPage: async ({ query }) => {
    if (query !== 'analysis') throw new Error('unexpected unfiltered Entity Feed read');
    return { ok: true, value: { entries: payload.entityFeed.entries, total: 30 } };
  },
  widgets: {
    renderDashboardWidget: async () => {
      throw new Error('Widgets with snippets must not render again');
    },
  },
});
if (!result.ok) throw new Error(`filter failed: ${result.error.kind}`);
process.stdout.write(String(result.value.matches.length));
