import type { ConfigId, WidgetId } from '../../widget/index.js';
import { describe, expect, it } from 'vitest';

import type { DashboardError } from '../../dashboard/index.js';
import {
  presentMarketViewDashboardEdit,
  renderMarketViewDashboardEdit,
} from '../presenters/dashboard-edit.js';
import type { MarketViewDashboardEditResult } from '../types.js';

const authenticationEvidence = [{
  order: 1,
  owner: 'dashboard',
  operation: 'POST /v1/marketview/dashboards/MD_MACRO/children',
  outcome: 'failed' as const,
  value: {
    kind: 'provider-failure',
    message: 'Not authenticated. Run: marquee auth login',
  },
}];

describe('MarketView Dashboard edit presenter', () => {
  it('prints the Dashboard fields and an Applied table with a non-zero partial outcome', () => {
    const result: MarketViewDashboardEditResult = {
      ok: true,
      value: {
        ref: 'd1',
        dashboard: {
          dashboardId: 'MD_MACRO',
          name: 'Macro Desk',
          kind: 'custom',
          tags: [],
          permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
          children: [],
          sections: [],
          link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        },
        entries: [
          {
            change: { kind: 'remove-child', childId: 'CHILD_OLD' },
            action: 'remove',
            target: '@d1.w1',
            status: 'applied',
          },
          {
            change: { kind: 'add-widget', widget: { widgetId: 'MW_NEW' as WidgetId, configurationId: 'WC_NEW' as ConfigId } },
            action: 'add',
            target: '@w2',
            status: 'failed',
            error: {
              kind: 'dependency',
              failure: { kind: 'authentication-required', realm: 'marquee' },
            },
          },
          {
            change: { kind: 'add-section', name: 'Later' },
            action: 'add-section',
            target: 'Later',
            status: 'not-attempted',
          },
        ],
      },
    };

    expect(presentMarketViewDashboardEdit(result, authenticationEvidence)).toEqual({
      text: [
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        '',
        'Applied',
        'action\ttarget\tresult',
        'remove\t@d1.w1\tapplied',
        'add\t@w2\tfailed: Not authenticated. Run: marquee auth login',
        'add-section\tLater\tnot-attempted',
      ].join('\n'),
      exitCode: 4,
    });

    expect(presentMarketViewDashboardEdit({
      ok: true,
      value: {
        ...result.value,
        entries: [{
          change: {
            kind: 'add-widget',
            widget: { widgetId: 'MW_NEW' as WidgetId, configurationId: 'WC_NEW' as ConfigId },
          },
          action: 'add',
          target: '@w2',
          status: 'failed',
          error: {
            kind: 'invalid-widget-placement',
            configurationId: 'WC_NEW',
            problem: 'configuration-not-found',
          },
        }],
      },
    })).toEqual({
      text: [
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        '',
        'Applied',
        'action\ttarget\tresult',
        'add\t@w2\tfailed: Widget configuration WC_NEW was not found',
      ].join('\n'),
      exitCode: 1,
    });
  });

  it('prints an applied change by its note and exits cleanly when every change applied', () => {
    const value = {
      ref: 'd1',
      dashboard: {
        dashboardId: 'MD_MACRO',
        name: 'Macro Desk',
        kind: 'custom',
        tags: [],
        permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
        children: [],
        sections: [],
        link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
      },
    } as const;

    expect(presentMarketViewDashboardEdit({
      ok: true,
      value: {
        ...value,
        entries: [{
          change: { kind: 'add-widget', widget: { widgetId: 'MW_NEW' as WidgetId, configurationId: 'WC_NEW' as ConfigId } },
          action: 'add',
          target: '@w2',
          status: 'applied',
          note: 'already-present',
        }],
      },
    })).toStrictEqual({
      text: [
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        '',
        'Applied',
        'action\ttarget\tresult',
        'add\t@w2\talready-present',
      ].join('\n'),
    });
    expect(presentMarketViewDashboardEdit({ ok: true, value: { ...value, entries: [] } }).text)
      .toContain('\nApplied\n  There are no changes');
  });

  it('preserves edit preflight guidance', () => {
    expect(presentMarketViewDashboardEdit({
      ok: false,
      error: { kind: 'invalid-input', reason: 'blank-section' },
    })).toEqual({ text: 'Error: section title must not be empty', exitCode: 1 });

    expect(presentMarketViewDashboardEdit({
      ok: false,
      error: {
        kind: 'invalid-input',
        reason: 'free-text-target',
        targetLabel: 'Gone Desk',
      },
    })).toEqual({
      text: 'Error: dashboard edit does not accept free-text title "Gone Desk"; use a Dashboard ID, alias, or ref',
      exitCode: 1,
    });
  });

  it('preserves authentication guidance through a typed verification failure', () => {
    const result: MarketViewDashboardEditResult = {
      ok: true,
      value: {
        ref: 'd1',
        dashboard: {
          dashboardId: 'MD_MACRO',
          name: 'Macro Desk',
          kind: 'custom',
          tags: [],
          permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
          children: [],
          sections: [],
          link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        },
        entries: [{
          change: { kind: 'remove-child', childId: 'CHILD_ONE' },
          action: 'remove',
          target: '@d1.w1',
          status: 'uncertain',
          error: {
            kind: 'verification-failed',
            cause: {
              kind: 'dependency',
              failure: { kind: 'authentication-required', realm: 'marquee' },
            },
          },
        }],
      },
    };

    expect(presentMarketViewDashboardEdit(result, authenticationEvidence)).toEqual({
      text: [
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        '',
        'Applied',
        'action\ttarget\tresult',
        'remove\t@d1.w1\tuncertain: Not authenticated. Run: marquee auth login',
      ].join('\n'),
      exitCode: 4,
    });
  });
});

describe('MarketView Dashboard edit presenter failures', () => {
  const providerEvidence = [{
    order: 1,
    owner: 'dashboard',
    operation: 'GET /v1/marketview/dashboards/MD_MACRO',
    outcome: 'failed' as const,
    value: { kind: 'provider-failure', message: 'Marquee returned 503' },
  }];
  const dashboard = {
    dashboardId: 'MD_MACRO',
    name: 'Macro Desk',
    kind: 'custom',
    tags: [],
    permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
    children: [],
    sections: [],
    link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
  } as const;
  const addSection = { kind: 'add-section', name: 'Notes' } as const;

  function failed(error: DashboardError, evidence: Parameters<typeof presentMarketViewDashboardEdit>[1] = []) {
    return presentMarketViewDashboardEdit({ ok: false, error: { kind: 'dashboard', error } }, evidence);
  }

  it('prints each local input error with its guidance', () => {
    const invalid = (error: Extract<MarketViewDashboardEditResult, { ok: false }>['error']) =>
      presentMarketViewDashboardEdit({ ok: false, error });

    expect(invalid({ kind: 'invalid-input', reason: 'empty-order' }))
      .toStrictEqual({ text: 'Error: --order requires a comma-separated list of refs', exitCode: 1 });
    expect(invalid({ kind: 'invalid-input', reason: 'free-text-target' })).toStrictEqual({
      text: 'Error: dashboard edit does not accept free-text title ""; use a Dashboard ID, alias, or ref',
      exitCode: 1,
    });
    expect(invalid({ kind: 'invalid-input', reason: 'section-add-section', targetLabel: '@d1.s1' })).toStrictEqual({
      text: 'Error: --add-section cannot target section @d1.s1; target its dashboard instead',
      exitCode: 1,
    });
    expect(invalid({ kind: 'invalid-input', reason: 'section-add-section' })).toStrictEqual({
      text: 'Error: --add-section cannot target section; target its dashboard instead',
      exitCode: 1,
    });
    expect(invalid({ kind: 'invalid-input', reason: 'no-mutations' })).toStrictEqual({
      text: 'Error: dashboard edit requires at least one --add-widget, --remove-widget, --add-section, --remove-section, or --order mutation',
      exitCode: 1,
    });
    expect(invalid({ kind: 'unknown-ref', refName: 'w9' })).toStrictEqual({
      text: 'Error: ref @w9 not found\nHint: run the previous command again or use one of the refs printed above.',
      exitCode: 1,
    });
    expect(invalid({ kind: 'wrong-target', refName: 'w9', artifactType: 'widget' }))
      .toStrictEqual({ text: 'Error: @w9 is not a dashboard or dashboard section ref', exitCode: 1 });
    expect(invalid({ kind: 'wrong-change-ref', refName: 'd1', artifactType: 'dashboard' }))
      .toStrictEqual({ text: 'Error: @d1 is not a dashboard tile or section ref', exitCode: 1 });
    expect(invalid({ kind: 'foreign-ref', refName: 'd2.w1', dashboardId: 'MD_OTHER' }))
      .toStrictEqual({ text: 'Error: @d2.w1 belongs to a different dashboard', exitCode: 1 });
  });

  it('prints each Dashboard error by its own text when no provider failure was recorded', () => {
    const failure = { kind: 'unavailable' } as const;

    expect(failed({ kind: 'permission-denied', dashboardId: 'MD_MACRO' }))
      .toStrictEqual({ text: 'Error: permission denied for dashboard MD_MACRO', exitCode: 1 });
    expect(failed({ kind: 'invalid-mutation', reason: 'section SECTION_ONE is not empty' }))
      .toStrictEqual({ text: 'Error: section SECTION_ONE is not empty', exitCode: 1 });
    expect(failed({ kind: 'effect-not-observed', reason: 'tile CHILD_ONE is still present' }))
      .toStrictEqual({ text: 'Error: tile CHILD_ONE is still present', exitCode: 1 });
    expect(failed({ kind: 'not-found', dashboardId: 'MD_GONE' }))
      .toStrictEqual({ text: 'Error: dashboard MD_GONE not found', exitCode: 1 });
    expect(failed({ kind: 'access-denied', dashboardId: 'MD_MACRO' }))
      .toStrictEqual({ text: 'Error: permission denied for dashboard MD_MACRO', exitCode: 1 });
    expect(failed({ kind: 'access-denied' }))
      .toStrictEqual({ text: 'Error: permission denied for dashboard', exitCode: 1 });
    expect(failed({ kind: 'dependency', failure }))
      .toStrictEqual({ text: 'Error: dashboard dependency failed', exitCode: 1 });
    expect(failed({ kind: 'write-failed', failure: { kind: 'cancelled' }, isAmbiguous: false }))
      .toStrictEqual({ text: 'Error: dashboard write failed', exitCode: 2 });
    expect(failed({ kind: 'invalid-dashboard', reason: 'Dashboard MD_MACRO has no sections' }))
      .toStrictEqual({ text: 'Error: Dashboard MD_MACRO has no sections', exitCode: 1 });
    expect(failed({ kind: 'invalid-name', name: ' ' }))
      .toStrictEqual({ text: 'Error: dashboard name must not be empty', exitCode: 1 });
    expect(failed({ kind: 'invalid-widget', widget: { widgetId: 'MW_NEW' as WidgetId } }))
      .toStrictEqual({ text: 'Error: configured widget identity requires MW and WC IDs', exitCode: 1 });
    expect(failed({ kind: 'invalid-widget-placement', configurationId: 'WC_NEW', problem: 'malformed-binding' }))
      .toStrictEqual({ text: 'Error: Widget configuration contains a malformed parameter binding', exitCode: 1 });
    expect(failed({ kind: 'dashboard-exists', name: 'Macro Desk', matches: [] }))
      .toStrictEqual({ text: 'Error: dashboard "Macro Desk" already exists', exitCode: 1 });
    expect(failed({ kind: 'lookup-failed', name: 'Macro Desk', failure }))
      .toStrictEqual({ text: 'Error: dashboard lookup failed for Macro Desk', exitCode: 1 });
    expect(failed({ kind: 'create-failed', name: 'Macro Desk', failure }))
      .toStrictEqual({ text: 'Error: failed to create dashboard Macro Desk', exitCode: 1 });
    expect(failed({ kind: 'ambiguous-creation', name: 'Macro Desk' }))
      .toStrictEqual({ text: 'Error: dashboard Macro Desk creation outcome is uncertain', exitCode: 1 });
    expect(failed({ kind: 'missing-created-id', name: 'Macro Desk' }))
      .toStrictEqual({ text: 'Error: dashboard creation returned no id', exitCode: 1 });
    expect(failed({ kind: 'verification-failed', cause: { kind: 'not-found', dashboardId: 'MD_GONE' } }))
      .toStrictEqual({ text: 'Error: dashboard MD_GONE not found', exitCode: 1 });
  });

  it('prints the latest recorded provider failure in place of a provider-backed Dashboard error', () => {
    const failure = { kind: 'timeout' } as const;
    const expected = { text: 'Error: Marquee returned 503', exitCode: 1 };

    expect(failed({ kind: 'not-found', dashboardId: 'MD_GONE' }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'access-denied', dashboardId: 'MD_MACRO' }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'dependency', failure }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'write-failed', failure, isAmbiguous: true }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'lookup-failed', name: 'Macro Desk', failure }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'create-failed', name: 'Macro Desk', failure }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'ambiguous-creation', name: 'Macro Desk' }, providerEvidence)).toStrictEqual(expected);
    expect(failed({ kind: 'invalid-name', name: ' ' }, providerEvidence))
      .toStrictEqual({ text: 'Error: dashboard name must not be empty', exitCode: 1 });
  });

  it('exits by the most specific failure among failed or uncertain changes', () => {
    const entry = (
      status: 'applied' | 'failed' | 'uncertain' | 'not-attempted',
      error?: DashboardError,
    ) => ({ change: addSection, action: 'add-section', target: 'Notes', status, ...(error ? { error } : {}) });
    const exitCode = (...entries: ReturnType<typeof entry>[]) =>
      presentMarketViewDashboardEdit({ ok: true, value: { ref: 'd1', dashboard, entries } }).exitCode;
    const cancelled = { kind: 'dependency', failure: { kind: 'cancelled' } } as const;
    const authentication = {
      kind: 'verification-failed',
      cause: { kind: 'write-failed', failure: { kind: 'authentication-required', realm: 'marquee' }, isAmbiguous: true },
    } as const;

    expect(exitCode(entry('not-attempted'), entry('applied'))).toBeUndefined();
    expect(exitCode(entry('failed'))).toBe(1);
    expect(exitCode(entry('uncertain', { kind: 'effect-not-observed', reason: 'gone' }))).toBe(1);
    expect(exitCode(entry('failed', { kind: 'dependency', failure: { kind: 'rate-limited' } }))).toBe(1);
    expect(exitCode(entry('failed'), entry('uncertain', cancelled))).toBe(2);
    expect(exitCode(entry('failed', cancelled), entry('uncertain', authentication), entry('failed'))).toBe(4);
    expect(exitCode(entry('applied', authentication), entry('not-attempted', cancelled))).toBeUndefined();
  });

  it('prints an order change by its refs and a failed change by its error under the given evidence', () => {
    expect(renderMarketViewDashboardEdit({
      result: {
        ok: true,
        value: {
          ref: 'd1',
          dashboard,
          entries: [
            {
              change: { kind: 'order-sections', sectionIds: ['SECTION_TWO', 'SECTION_ONE'] },
              action: 'order',
              target: ['@d1.s2', '@d1.s1'],
              status: 'applied',
            },
            {
              change: addSection,
              action: 'add-section',
              target: 'Notes',
              status: 'failed',
              error: { kind: 'write-failed', failure: { kind: 'unavailable' }, isAmbiguous: false },
            },
          ],
        },
      },
      evidence: providerEvidence,
    })).toStrictEqual({
      text: [
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        '',
        'Applied',
        'action\ttarget\tresult',
        'order\t@d1.s2, @d1.s1\tapplied',
        'add-section\tNotes\tfailed: Marquee returned 503',
      ].join('\n'),
      exitCode: 1,
    });
  });
});
