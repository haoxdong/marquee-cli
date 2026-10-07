import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { compactDashboardArtifactPayload, restoreDashboardArtifactPayload, type MarketViewDashboardArtifactPayload } from '../dashboard-artifact-payload.js';
import type { WidgetId, ConfigId } from '../../widget/index.js';

it('restores saved Dashboard child definitions without changing other render values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saved-dashboard-payload-'));
  try {
    const definition = {
      id: 'MW_ONE', underlyingChartId: 'CH_ONE',
      contextParameter: { field: 'asset', type: 'Asset', options: ['MA_A', 'MA_B'], values: { default: 'MA_B' } },
      supportedContexts: ['MA_A', 'MA_B'], parameters: [{ field: 'tenor', options: ['1m', '1y'] }],
    };
    const payload: MarketViewDashboardArtifactPayload = {
      kind: 'dashboard', dashboard: { dashboardId: 'MD_ONE', name: 'Dashboard', kind: 'thematic', tags: [],
        permissions: { viewers: [], editors: [], administrators: [] }, sections: [], link: 'https://example.test/dashboard',
        children: [{ kind: 'widget', childId: 'CHILD_ONE', rank: 1,
          widget: { widgetId: 'MW_ONE' as WidgetId }, parameters: [], widgetDefinition: definition }] },
      window: { title: 'Dashboard', author: null, description: null, tags: [], link: 'https://example.test/dashboard', total: 1,
        widgets: [{ widgetId: 'MW_ONE' as WidgetId, title: 'Widget', widgetDefinition: definition, widgetParameterOverrides: [{ field: 'tenor', value: '1y' }],
        selectedContext: 'MA_A', configurationId: 'WC_ONE' as ConfigId, widgetDates: {
          startDate: '2025-10-05', endDate: '2026-10-05', interval: '1d', relativeDate: '1Y',
        } }] },
      cursor: { page: 1, pageSize: 10, total: 1 }, browserTarget: 'https://example.test/dashboard',
    };
    const registry = createArtifactRegistry(dir, 'saved-dashboard');
    registry.storeArtifact({ namespace: 'd1', root: { type: 'dashboard', dashboardId: 'MD_ONE' },
      payload: compactDashboardArtifactPayload(payload) });
    const stored = createArtifactRegistry(dir, 'saved-dashboard').getPayload('d1') as MarketViewDashboardArtifactPayload;
    expect(stored.widgetOptionArrays).toEqual([['MA_A', 'MA_B']]);
    expect(restoreDashboardArtifactPayload(stored)).toEqual(payload);
    expect(restoreDashboardArtifactPayload(payload)).toBe(payload);
    expect(restoreDashboardArtifactPayload({ ...stored, widgetOptionArrays: [[]] })).not.toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
