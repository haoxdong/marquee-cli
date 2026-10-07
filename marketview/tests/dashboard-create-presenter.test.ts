import { describe, expect, it } from 'vitest';

import type { DashboardError } from '../../dashboard/index.js';
import type { WidgetId } from '../../widget/index.js';
import {
  presentMarketViewDashboardCreate,
  renderMarketViewDashboardCreate,
} from '../presenters/dashboard-create.js';
import type { MarketViewDashboardCreateResult } from '../types.js';

describe('MarketView Dashboard create presenter', () => {
  it('prints the new Dashboard ref, url and seeded widget count as fields', () => {
    const dashboard = {
      dashboardId: 'MD_NEW',
      name: 'Macro Desk',
      kind: 'custom' as const,
      tags: [],
      permissions: { viewers: [], editors: [], administrators: [] },
      children: [],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_NEW',
    };

    expect(presentMarketViewDashboardCreate({
      ok: true,
      value: { ref: 'd1', dashboard, seededWidgetCount: 0 },
    })).toEqual({
      text: [
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_NEW',
        'widgets:\t0',
      ].join('\n'),
    });
    expect(presentMarketViewDashboardCreate({
      ok: true,
      value: { ref: 'd3', dashboard, seededWidgetCount: 2 },
    })).toEqual({
      text: [
        'ref:\t@d3',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_NEW',
        'widgets:\t2',
      ].join('\n'),
    });
  });

  it('preserves duplicate and authentication lookup failures', () => {
    const duplicate: MarketViewDashboardCreateResult = {
      ok: false,
      error: {
        kind: 'dashboard',
        error: {
          kind: 'dashboard-exists',
          name: 'Macro Desk',
          matches: [
            { dashboardId: 'MD_ONE', name: 'Macro Desk' },
            { dashboardId: 'MD_TWO', name: 'macro desk' },
          ],
        },
      },
    };
    const loginFailure: MarketViewDashboardCreateResult = {
      ok: false,
      error: {
        kind: 'dashboard',
        error: {
          kind: 'lookup-failed',
          name: 'Macro Desk',
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      },
    };

    expect(presentMarketViewDashboardCreate(duplicate)).toEqual({
      text: 'Error: dashboard "Macro Desk" already exists: Macro Desk (MD_ONE), macro desk (MD_TWO)',
      exitCode: 1,
    });
    expect(presentMarketViewDashboardCreate(loginFailure, [{
      order: 1,
      owner: 'dashboard',
      operation: 'GET /v1/marketview/dashboards',
      outcome: 'failed',
      value: {
        kind: 'provider-failure',
        message: 'Not authenticated. Run: marquee auth login',
      },
    }])).toEqual({
      text: 'Error: could not verify existing dashboards titled "Macro Desk" (Not authenticated. Run: marquee auth login); refusing to create a possible duplicate',
      exitCode: 4,
    });
  });
});

describe('MarketView Dashboard create presenter failures', () => {
  const failedEvidence = (message: string) => [{
    order: 1,
    owner: 'dashboard',
    operation: 'POST /v1/marketview/dashboards',
    outcome: 'failed' as const,
    value: { kind: 'provider-failure', message },
  }];

  function failed(error: DashboardError, evidence: Parameters<typeof presentMarketViewDashboardCreate>[1] = []) {
    return presentMarketViewDashboardCreate({ ok: false, error: { kind: 'dashboard', error } }, evidence);
  }

  it('prints an unknown ref and each non-Widget ref with the command that shows it', () => {
    const wrong = (artifactType: 'dashboard' | 'entity-feed' | 'section' | 'document' | 'search') =>
      presentMarketViewDashboardCreate({ ok: false, error: { kind: 'wrong-artifact', refName: 'x1', artifactType } });

    expect(presentMarketViewDashboardCreate({ ok: false, error: { kind: 'unknown-ref', refName: 'w9' } })).toStrictEqual({
      text: 'Error: ref @w9 not found\nHint: run the previous command again or use one of the refs printed above.',
      exitCode: 1,
    });
    expect(wrong('dashboard')).toStrictEqual({
      text: 'Error: ref @x1 is a dashboard — use `marquee marketview dashboard view ...`',
      exitCode: 1,
    });
    expect(wrong('entity-feed')).toStrictEqual({
      text: 'Error: ref @x1 is a entity-feed — use `marquee marketview dashboard view ...`',
      exitCode: 1,
    });
    expect(wrong('section')).toStrictEqual({
      text: 'Error: ref @x1 is a section — use `marquee marketview dashboard edit ...`',
      exitCode: 1,
    });
    expect(wrong('document')).toStrictEqual({
      text: 'Error: ref @x1 is a document — use `marquee content view ...`',
      exitCode: 1,
    });
    expect(wrong('search')).toStrictEqual({
      text: "Error: ref @x1 is a search — use the search result's Widget ref",
      exitCode: 1,
    });
  });

  it('prints each Dashboard error by its own text when no provider failure was recorded', () => {
    const unavailable = { kind: 'unavailable' } as const;

    expect(failed({ kind: 'invalid-name', name: ' ' }))
      .toStrictEqual({ text: 'Error: dashboard name must not be empty', exitCode: 1 });
    expect(failed({ kind: 'invalid-widget', widget: { widgetId: 'MW_NEW' as WidgetId } }))
      .toStrictEqual({ text: 'Error: configured widget identity requires MW and WC IDs', exitCode: 1 });
    expect(failed({ kind: 'invalid-widget-placement', configurationId: 'WC_NEW', problem: 'invalid-identity' }))
      .toStrictEqual({ text: 'Error: Configured Widget identity is invalid for Dashboard placement', exitCode: 1 });
    expect(failed({ kind: 'lookup-failed', name: 'Macro Desk', failure: unavailable })).toStrictEqual({
      text: 'Error: could not verify existing dashboards titled "Macro Desk" (lookup failed); refusing to create a possible duplicate',
      exitCode: 1,
    });
    expect(failed({ kind: 'access-denied' }))
      .toStrictEqual({ text: 'Error: permission denied while creating dashboard', exitCode: 1 });
    expect(failed({ kind: 'create-failed', name: 'Macro Desk', failure: { kind: 'cancelled' } }))
      .toStrictEqual({ text: 'Error: failed to create dashboard Macro Desk', exitCode: 2 });
    expect(failed({ kind: 'ambiguous-creation', name: 'Macro Desk' }))
      .toStrictEqual({ text: 'Error: dashboard Macro Desk creation outcome is uncertain', exitCode: 1 });
    expect(failed({ kind: 'missing-created-id', name: 'Macro Desk' }))
      .toStrictEqual({ text: 'Unsupported dashboard create response shape: missing dashboard id', exitCode: 1 });
    expect(failed({ kind: 'invalid-dashboard', reason: 'Dashboard MD_NEW has no name' }))
      .toStrictEqual({ text: 'Dashboard MD_NEW has no name', exitCode: 1 });
    expect(failed({ kind: 'not-found', dashboardId: 'MD_NEW' }))
      .toStrictEqual({ text: 'Error: dashboard MD_NEW not found', exitCode: 1 });
    expect(failed({ kind: 'dependency', failure: { kind: 'authentication-required', realm: 'marquee' } }))
      .toStrictEqual({ text: 'Error: dashboard dependency failed', exitCode: 4 });
    expect(failed({ kind: 'write-failed', failure: unavailable, isAmbiguous: false }))
      .toStrictEqual({ text: 'Error: dashboard write failed', exitCode: 1 });
    expect(failed({ kind: 'permission-denied', dashboardId: 'MD_NEW' }))
      .toStrictEqual({ text: 'Error: permission denied for dashboard MD_NEW', exitCode: 1 });
    expect(failed({ kind: 'invalid-mutation', reason: 'Error: no widgets to seed' }))
      .toStrictEqual({ text: 'Error: no widgets to seed', exitCode: 1 });
    expect(failed({ kind: 'effect-not-observed', reason: 'dashboard MD_NEW is not listed' }))
      .toStrictEqual({ text: 'Error: dashboard MD_NEW is not listed', exitCode: 1 });
    expect(failed({
      kind: 'verification-failed',
      cause: { kind: 'write-failed', failure: { kind: 'cancelled' }, isAmbiguous: true },
    })).toStrictEqual({ text: 'Error: dashboard write failed', exitCode: 2 });
  });

  it('prints the latest recorded provider failure in place of a provider-backed Dashboard error', () => {
    const evidence = failedEvidence('Marquee returned 503');
    const timeout = { kind: 'timeout' } as const;
    const expected = { text: 'Error: Marquee returned 503', exitCode: 1 };

    expect(failed({ kind: 'lookup-failed', name: 'Macro Desk', failure: timeout }, evidence)).toStrictEqual({
      text: 'Error: could not verify existing dashboards titled "Macro Desk" (Marquee returned 503); refusing to create a possible duplicate',
      exitCode: 1,
    });
    expect(failed({ kind: 'access-denied', dashboardId: 'MD_NEW' }, evidence)).toStrictEqual(expected);
    expect(failed({ kind: 'create-failed', name: 'Macro Desk', failure: timeout }, evidence)).toStrictEqual(expected);
    expect(failed({ kind: 'ambiguous-creation', name: 'Macro Desk' }, evidence)).toStrictEqual(expected);
    expect(failed({ kind: 'not-found', dashboardId: 'MD_NEW' }, evidence)).toStrictEqual(expected);
    expect(failed({ kind: 'dependency', failure: timeout }, evidence)).toStrictEqual(expected);
    expect(failed({ kind: 'write-failed', failure: timeout, isAmbiguous: true }, evidence)).toStrictEqual(expected);
  });

  it('adds the Error prefix to a provider failure only when it does not already start with one', () => {
    const accessDenied = { kind: 'access-denied' } as const;

    expect(failed(accessDenied, failedEvidence('Error: Forbidden')))
      .toStrictEqual({ text: 'Error: Forbidden', exitCode: 1 });
    expect(failed(accessDenied, failedEvidence('error: forbidden')))
      .toStrictEqual({ text: 'error: forbidden', exitCode: 1 });
    expect(failed(accessDenied, failedEvidence('Gateway Error: Forbidden')))
      .toStrictEqual({ text: 'Error: Gateway Error: Forbidden', exitCode: 1 });
  });

  it('renders a create outcome with its recorded evidence', () => {
    expect(renderMarketViewDashboardCreate({
      result: { ok: false, error: { kind: 'dashboard', error: { kind: 'ambiguous-creation', name: 'Macro Desk' } } },
      evidence: failedEvidence('Marquee timed out'),
    })).toStrictEqual({ text: 'Error: Marquee timed out', exitCode: 1 });
  });
});
