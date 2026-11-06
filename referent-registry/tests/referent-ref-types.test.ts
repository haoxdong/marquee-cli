import type { Tagged } from 'type-fest';
type WidgetId = Tagged<string, 'WidgetId'>;
import { describe, expect, it } from 'vitest';
import type { ReferentRef } from '../index.js';

describe('ReferentRef types', () => {
  it('keep resumable state out of exact Referent identity records', () => {
    const search: ReferentRef = { type: 'search', searchKind: 'market-data' };
    const dashboardWidget: ReferentRef = {
      type: 'widget',
      widgetId: 'MW1' as WidgetId,
      dashboardId: 'MD1',
      childId: 'CHILD1',
      configurationId: null,
      selectedContext: null,
    };

    // @ts-expect-error Search query belongs to its surface-owned payload.
    const searchWithQuery: ReferentRef = { type: 'search', searchKind: 'market-data', query: 'rates' };
    // @ts-expect-error Dashboard pagination belongs to its surface-owned payload.
    const dashboardWithCursor: ReferentRef = { type: 'dashboard', dashboardId: 'MD1', cursor: {} };
    // @ts-expect-error Dashboard Widget membership requires both owner fields.
    const incompleteMembership: ReferentRef = {
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
