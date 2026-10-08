import type { Tagged } from 'type-fest';
type WidgetId = Tagged<string, 'WidgetId'>;
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../index.js';

describe('ArtifactRef types', () => {
  it('keep resumable state out of exact Artifact identity records', () => {
    const search: ArtifactRef = { type: 'search', searchKind: 'market-data' };
    const dashboardWidget: ArtifactRef = {
      type: 'widget',
      widgetId: 'MW1' as WidgetId,
      dashboardId: 'MD1',
      childId: 'CHILD1',
      configurationId: null,
      selectedContext: null,
    };

    // @ts-expect-error Search query belongs to its surface-owned payload.
    const searchWithQuery: ArtifactRef = { type: 'search', searchKind: 'market-data', query: 'rates' };
    // @ts-expect-error Dashboard pagination belongs to its surface-owned payload.
    const dashboardWithCursor: ArtifactRef = { type: 'dashboard', dashboardId: 'MD1', cursor: {} };
    // @ts-expect-error Dashboard Widget membership requires both owner fields.
    const incompleteMembership: ArtifactRef = {
      type: 'widget',
      widgetId: 'MW1' as WidgetId,
      dashboardId: 'MD1',
      configurationId: null,
      selectedContext: null,
    };

    expect([search, dashboardWidget]).toHaveLength(2);
    expect([searchWithQuery, dashboardWithCursor, incompleteMembership]).toHaveLength(3);
  });
});
