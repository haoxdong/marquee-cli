import { describe, expect, it } from 'vitest';

import type { MarketViewProviderEvidence } from '../../index.js';
import { presentDashboardReadError } from '../dashboard-error.js';

function providerFailure(
  order: number,
  owner: string,
  operation: string,
  message: string,
): MarketViewProviderEvidence {
  return { order, owner, operation, outcome: 'failed', value: { kind: 'provider-failure', message } };
}

describe('Dashboard error presenter', () => {
  it('keeps the Entity re-link prompt when another owner has a later request failure', () => {
    expect(presentDashboardReadError(
      {
        kind: 'entity',
        error: {
          kind: 'dependency',
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      },
      undefined,
      [
        providerFailure(
          1,
          'entity.request',
          'GET /v1/plots/entities',
          'Goldman link is not connected. Re-link Goldman to continue.',
        ),
        providerFailure(
          2,
          'dashboard-preferences.request',
          'GET /v1/marketview/preferences',
          'Credential Service returned 503 for /v1/marketview/preferences',
        ),
      ],
    )).toStrictEqual({
      message: 'Goldman link is not connected. Re-link Goldman to continue.',
      exitCode: 4,
    });
  });

  it('restores login guidance for Entity resolution authentication failures', () => {
    const presented = presentDashboardReadError({
      kind: 'entity',
      error: {
        kind: 'dependency',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });

    expect(presented.message).toBe('Not authenticated. Run: marquee auth login');
  });

  it('preserves provider diagnostics from ordered evidence outside the domain error', () => {
    const result = presentDashboardReadError(
      {
        kind: 'dashboard',
        error: {
          kind: 'dependency',
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      },
      undefined,
      [
        {
          order: 1,
          owner: 'dashboard',
          operation: 'GET /v1/marketview/dashboards/MD_ONE',
          outcome: 'failed',
          value: {
            kind: 'provider-failure',
            message: 'Not authenticated. Run: marquee auth login',
          },
        },
      ],
    );

    expect(result).toEqual({
      message: 'Not authenticated. Run: marquee auth login',
      exitCode: 4,
    });
  });

  it.each([
    [{ kind: 'not-found', dashboardId: 'MD_GONE' }, 'dashboard MD_GONE not found', 1],
    [{ kind: 'access-denied', dashboardId: 'MD_PRIVATE' }, 'Access denied: dashboard MD_PRIVATE', 1],
    [{ kind: 'access-denied' }, 'Access denied: dashboard', 1],
    [{ kind: 'dependency', failure: { kind: 'cancelled' } }, 'Dashboard read failed', 2],
  ] as const)('words a Dashboard read error %j without provider evidence', (error, message, exitCode) => {
    expect(presentDashboardReadError({ kind: 'dashboard', error })).toStrictEqual({ message, exitCode });
  });

  it('words a Dashboard read error with the latest provider failure', () => {
    expect(presentDashboardReadError(
      { kind: 'dashboard', error: { kind: 'access-denied', dashboardId: 'MD_PRIVATE' } },
      undefined,
      [
        providerFailure(1, 'dashboard', 'GET /v1/marketview/dashboards/MD_PRIVATE', 'older failure'),
        providerFailure(2, 'dashboard', 'GET /v1/marketview/dashboards/MD_PRIVATE', 'Marquee returned 403'),
        { order: 3, owner: 'widget', operation: 'get', outcome: 'failed', value: { intent: 'read', calls: [] } },
        { order: 4, owner: 'dashboard', operation: 'GET /v1/marketview/widgets', outcome: 'failed', value: null },
      ],
    )).toStrictEqual({ message: 'Marquee returned 403', exitCode: 1 });
  });

  it('words an unsupported Dashboard as an adapter failure whatever the provider evidence', () => {
    expect(presentDashboardReadError(
      {
        kind: 'dashboard',
        error: { kind: 'invalid-dashboard', reason: 'Unsupported Dashboard response shape: missing children' },
      },
      undefined,
      [providerFailure(1, 'dashboard', 'GET /v1/marketview/dashboards/MD_ONE', 'Marquee returned 500')],
    )).toStrictEqual({
      message: 'Adapter "marketview.dashboard" failed: Unsupported dashboard response shape: missing children; '
        + 'record a Scenario before accepting this fallback.',
      exitCode: 1,
    });
  });

  it.each([
    [{ kind: 'dependency', failure: { kind: 'timeout' } }, 'Entity resolution failed: dependency', 1],
    [{ kind: 'access-denied' }, 'Entity resolution failed: access-denied', 1],
  ] as const)('words an Entity resolution error %j by its kind', (error, message, exitCode) => {
    expect(presentDashboardReadError({ kind: 'entity', error })).toStrictEqual({ message, exitCode });
  });

  it.each([
    [{ kind: 'invalid-feed', problem: 'response' }, 'Malformed Entity Feed response', 1],
    [{ kind: 'invalid-feed', problem: 'widget-entry' }, 'Malformed Entity Feed Widget entry', 1],
    [
      { kind: 'dependency', source: 'feed', failure: { kind: 'authentication-required', realm: 'marquee' } },
      'Not authenticated. Run: marquee auth login at upstream path /v1/marketview/widgets',
      4,
    ],
    [{ kind: 'dependency', source: 'preferences', failure: { kind: 'timeout' } }, 'Entity Feed read failed', 1],
  ] as const)('words an Entity Feed error %j without provider evidence', (error, message, exitCode) => {
    expect(presentDashboardReadError({ kind: 'entity-feed', error })).toStrictEqual({ message, exitCode });
  });

  it.each([
    [{ kind: 'dependency', source: 'preferences', failure: { kind: 'timeout' } }, 'Preferences timed out'],
    [{ kind: 'dependency', source: 'feed', failure: { kind: 'timeout' } }, 'Widget feed timed out'],
    [{ kind: 'invalid-feed', problem: 'response' }, 'Widget feed timed out'],
  ] as const)('words an Entity Feed error %j with its own request\'s provider failure', (error, message) => {
    expect(presentDashboardReadError({ kind: 'entity-feed', error }, undefined, [
      providerFailure(1, 'entity-feed.request', 'GET /v1/marketview/preferences', 'Preferences timed out'),
      providerFailure(2, 'entity-feed.request', 'GET /v1/marketview/widgets', 'Widget feed timed out'),
      providerFailure(3, 'dashboard-preferences.request', 'GET /v1/marketview/preferences', 'Other owner'),
      providerFailure(4, 'entity-feed.request', 'GET /v1/marketview/widgets/MW_ONE', 'Other request'),
    ]).message).toBe(message);
  });

  it.each([
    [{ kind: 'invalid-response', problem: 'response' }, 'Malformed Dashboard preferences response', 1],
    [{ kind: 'invalid-response', problem: 'pin-entry' }, 'Malformed Dashboard preference pin', 1],
    [
      { kind: 'dependency', failure: { kind: 'authentication-required', realm: 'marquee' } },
      'Not authenticated. Run: marquee auth login at upstream path /v1/marketview/preferences',
      4,
    ],
    [{ kind: 'dependency', failure: { kind: 'unavailable' } }, 'Dashboard preferences read failed', 1],
  ] as const)('words a Dashboard preferences error %j without provider evidence', (error, message, exitCode) => {
    expect(presentDashboardReadError({ kind: 'dashboard-preferences', error })).toStrictEqual({ message, exitCode });
  });

  it('words a Dashboard preferences error with its own request\'s provider failure', () => {
    expect(presentDashboardReadError(
      { kind: 'dashboard-preferences', error: { kind: 'dependency', failure: { kind: 'unavailable' } } },
      undefined,
      [
        providerFailure(1, 'dashboard-preferences.request', 'GET /v1/marketview/preferences', 'Preferences unavailable'),
        providerFailure(2, 'entity-feed.request', 'GET /v1/marketview/preferences', 'Other owner'),
        providerFailure(3, 'dashboard-preferences.request', 'GET /v1/marketview/widgets', 'Other request'),
      ],
    ).message).toBe('Preferences unavailable');
  });
});
