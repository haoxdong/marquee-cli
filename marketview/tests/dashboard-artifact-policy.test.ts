import type { ConfigId, WidgetId } from '../../widget/index.js';
import { describe, expect, it } from 'vitest';
import { dashboardArtifactRefs } from '../dashboard-artifact-policy.js';
import type { DashboardPresentation } from '../dashboard-presentation.js';

function dashboardWindow(): DashboardPresentation {
  return {
    title: 'Regime',
    author: null,
    description: null,
    tags: [],
    link: 'https://example.test/dashboard',
    total: 3,
    widgets: [
      { widgetId: 'MW_A' as WidgetId, title: 'A', configurationId: 'WC_A' as ConfigId, childId: 'child-a' },
      { widgetId: 'MW_B' as WidgetId, title: 'B', configurationId: 'WC_B' as ConfigId, childId: 'child-b' },
      { widgetId: 'MW_C' as WidgetId, title: 'C', configurationId: 'WC_C' as ConfigId, childId: 'child-c' },
    ],
    sections: [
      { title: 'First', widgetCount: 2, startIndex: 0, sectionId: 'sec-1' },
      { title: 'Second', widgetCount: 1, startIndex: 2, sectionId: 'sec-2' },
    ],
  };
}

describe('MarketView Dashboard Artifact policy', () => {
  it('creates visible Widget and Section refs before presentation', () => {
    const refs = dashboardArtifactRefs(
      dashboardWindow(),
      'd1',
      'MD_REG',
      { page: 1, pageSize: 20, total: 3 },
    );

    expect(refs['d1.w1']).toEqual({
      type: 'widget',
      widgetId: 'MW_A',
      configurationId: 'WC_A',
      childId: 'child-a',
      dashboardId: 'MD_REG',
      selectedContext: null,
    });
    expect(refs['d1.w3']).toMatchObject({
      type: 'widget',
      widgetId: 'MW_C',
      childId: 'child-c',
      dashboardId: 'MD_REG',
      configurationId: 'WC_C',
      selectedContext: null,
    });
    expect(refs['d1.s1']).toEqual({
      type: 'section',
      sectionId: 'sec-1',
      dashboardId: 'MD_REG',
    });
    expect(refs['d1.s2']).toEqual({
      type: 'section',
      sectionId: 'sec-2',
      dashboardId: 'MD_REG',
    });
  });

  it('limits Widget refs to the default visible section budget', () => {
    const window = dashboardWindow();
    window.sections = [
      { title: 'First', widgetCount: 2, startIndex: 0 },
      { title: 'Collapsed', widgetCount: 1, startIndex: 2 },
    ];

    const refs = dashboardArtifactRefs(
      window,
      'd1',
      undefined,
      { page: 1, pageSize: 2, total: 3 },
    );

    expect(refs).toHaveProperty('d1.w1');
    expect(refs).toHaveProperty('d1.w2');
    expect(refs).not.toHaveProperty('d1.w3');
    expect(refs).not.toHaveProperty('d1.s1');
  });

  it('creates the Widget refs of a later page, numbered by Dashboard position', () => {
    const refs = dashboardArtifactRefs(
      dashboardWindow(),
      'd1',
      'MD_REG',
      { page: 2, pageSize: 2, total: 3 },
    );

    expect(Object.keys(refs)).toEqual(['d1.s1', 'd1.s2', 'd1.w3']);
  });

  it('numbers the Sections that carry no Section ID by position', () => {
    const window = dashboardWindow();
    window.sections = [
      { title: 'First', widgetCount: 2, startIndex: 0 },
      { title: 'Second', widgetCount: 1, startIndex: 2 },
    ];

    const refs = dashboardArtifactRefs(window, 'd1', 'MD_REG', { page: 1, pageSize: 20, total: 3 });

    expect(refs['d1.s1']).toEqual({ type: 'section', dashboardId: 'MD_REG', sectionId: '1' });
    expect(refs['d1.s2']).toEqual({ type: 'section', dashboardId: 'MD_REG', sectionId: '2' });
  });

  it('creates only Widget refs for a saved Dashboard without Sections', () => {
    const window = dashboardWindow();
    delete window.sections;

    const refs = dashboardArtifactRefs(window, 'd1', 'MD_REG', { page: 1, pageSize: 20, total: 3 });

    expect(Object.keys(refs)).toEqual(['d1.w1', 'd1.w2', 'd1.w3']);
  });

  it('keeps an Entity Feed Widget ref to its Widget identity and Selected Context', () => {
    const refs = dashboardArtifactRefs({
      title: 'EURUSD',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/asset/MA_EURUSD',
      total: 2,
      widgets: [
        { widgetId: 'MW_SKEW' as WidgetId, title: 'Skew', configurationId: null, selectedContext: 'MA_EURUSD' },
        { widgetId: 'MW_CARRY' as WidgetId, title: 'Carry', childId: 'child-carry', selectedContext: null },
      ],
    }, 'd1', undefined, { page: 1, pageSize: 10, total: 2 });

    expect(refs).toEqual({
      'd1.w1': { type: 'widget', widgetId: 'MW_SKEW', selectedContext: 'MA_EURUSD', configurationId: null },
      'd1.w2': { type: 'widget', widgetId: 'MW_CARRY', configurationId: null, selectedContext: null },
    });
  });

  it('gives a saved Dashboard Widget without a Child ID no Dashboard placement', () => {
    const window = dashboardWindow();
    window.widgets = [{ widgetId: 'MW_A' as WidgetId, title: 'A' }];
    delete window.sections;

    expect(dashboardArtifactRefs(window, 'd1', 'MD_REG', { page: 1, pageSize: 20, total: 1 }))
      .toEqual({ 'd1.w1': { type: 'widget', widgetId: 'MW_A', configurationId: null, selectedContext: null } });
  });
});
