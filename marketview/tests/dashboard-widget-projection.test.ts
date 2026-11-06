import type { ConfigId, WidgetId } from '../../widget/index.js';
import { describe, expect, it } from 'vitest';

import type { Dashboard } from '../../dashboard/index.js';
import type { EntityFeedEntry } from '../../entity-feed/index.js';
import {
  createEntityFeedDashboardWidgets,
  createSavedDashboardWidgets,
} from '../dashboard-widget-projection.js';

describe('Entity Feed Widget projection', () => {
  it('preserves the feed Selected Context as Widget Referent identity', () => {
    const entry = {
      widgetId: 'MW_FEED' as WidgetId,
      title: 'Feed Widget',
      configurationId: 'WC_FEED' as ConfigId,
      widgetDefinition: { id: 'MW_FEED', title: 'Feed Widget' },
      widgetParameterOverrides: [],
      selectedContext: 'MA_FEED',
    } satisfies EntityFeedEntry;

    expect(createEntityFeedDashboardWidgets([entry])).toMatchObject([{
      widgetId: 'MW_FEED',
      configurationId: 'WC_FEED',
      selectedContext: 'MA_FEED',
    }]);
  });

  it('carries Widget Dates and omits an absent Config ID', () => {
    const widgetDates = { startDate: '2025-01-01', endDate: '2025-02-01', interval: '1d' };

    expect(createEntityFeedDashboardWidgets([{
      widgetId: 'MW_DATED' as WidgetId,
      title: 'Dated',
      widgetDefinition: { id: 'MW_DATED' },
      widgetParameterOverrides: [{ field: 'asset', value: 'MA_FEED' }],
      selectedContext: null,
      widgetDates,
    }])).toStrictEqual([{
      widgetId: 'MW_DATED',
      title: 'Dated',
      widgetDefinition: { id: 'MW_DATED' },
      widgetParameterOverrides: [{ field: 'asset', value: 'MA_FEED' }],
      selectedContext: null,
      widgetDates,
    }]);
  });
});

describe('saved Dashboard Widget projection', () => {
  it('preserves Selected Context as Widget Referent identity without expanding the Widget', () => {
    const dashboard = {
      dashboardId: 'MD_CONTEXT',
      name: 'Context dashboard',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: [], administrators: [] },
      sections: [],
      link: 'https://example.test/MD_CONTEXT',
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
        widgetDefinition: { id: 'MW_ONE' },
        widgetParameterOverrides: [{ field: 'tenor', value: '2y' }],
        selectedContext: 'MA_CONTEXT',
      }],
    } satisfies Dashboard;

    expect(createSavedDashboardWidgets(dashboard)).toMatchObject([{
      widgetId: 'MW_ONE',
      configurationId: 'WC_ONE',
      selectedContext: 'MA_CONTEXT',
      widgetParameterOverrides: [{ field: 'tenor', value: '2y' }],
    }]);
  });

  function savedDashboard(children: Dashboard['children']): Dashboard {
    return {
      dashboardId: 'MD_SAVED',
      name: 'Saved',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: [], administrators: [] },
      sections: [],
      link: 'https://example.test/MD_SAVED',
      children,
    };
  }

  it('projects placement and Widget state and skips text Children', () => {
    const widgetDates = { startDate: '2025-01-01', endDate: '2025-02-01', interval: '1d' };

    expect(createSavedDashboardWidgets(savedDashboard([
      { kind: 'text', childId: 'CHILD_TEXT', rank: 1, text: 'Notes' },
      {
        kind: 'widget',
        childId: 'CHILD_FULL',
        rank: 2,
        name: 'Full Widget',
        widget: { widgetId: 'MW_FULL' as WidgetId, configurationId: 'WC_FULL' as ConfigId },
        selectedContext: 'MA_FULL',
        parameters: [{ field: 'tenor', value: '2y' }],
        widgetDefinition: { id: 'MW_FULL' },
        widgetParameterOverrides: [{ field: 'tenor', value: '2y' }],
        widgetDates,
      },
    ]))).toStrictEqual([{
      widgetId: 'MW_FULL',
      title: 'Full Widget',
      childId: 'CHILD_FULL',
      configurationId: 'WC_FULL',
      selectedContext: 'MA_FULL',
      widgetDefinition: { id: 'MW_FULL' },
      widgetParameterOverrides: [{ field: 'tenor', value: '2y' }],
      widgetDates,
    }]);
  });

  it('defaults a bare Widget Child title from its Widget ID', () => {
    expect(createSavedDashboardWidgets(savedDashboard([{
      kind: 'widget',
      childId: 'CHILD_BARE',
      rank: 1,
      widget: { widgetId: 'MW_BARE' as WidgetId },
      parameters: [{ field: 'tenor', value: '2y' }],
    }]))).toStrictEqual([{
      widgetId: 'MW_BARE',
      title: 'MW_BARE',
      childId: 'CHILD_BARE',
      configurationId: null,
    }]);
  });
});
