import { describe, expect, it } from 'vitest';
import {
  exitCodeForDashboardError,
  exitCodeForDashboardPreferencesError,
  exitCodeForEntityError,
  exitCodeForEntityFeedError,
  exitCodeForMarketViewSearchError,
  exitCodeForWidgetError,
  writeMarketViewErrorLine,
} from '../failure-semantics.js';
import { presentDashboardReadError } from '../dashboard-error.js';

describe('MarketView failure semantics', () => {
  it('classifies typed owner authentication failures', () => {
    expect(exitCodeForMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'authentication-required', realm: 'marquee' },
    })).toBe(4);
    expect(exitCodeForWidgetError({
      kind: 'widget-load-failure',
      identity: { widgetId: 'MW1' },
      failure: { kind: 'authentication-required', realm: 'marquee' },
    })).toBe(4);
    expect(exitCodeForWidgetError({
      kind: 'control-group-resolution-failure',
      identity: { widgetId: 'MW1' },
      failure: {
        kind: 'dependency',
        controlGroupIds: ['CG1'],
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    })).toBe(4);
    expect(exitCodeForDashboardError({
      kind: 'dependency',
      failure: { kind: 'authentication-required', realm: 'marquee' },
    })).toBe(4);
    expect(exitCodeForEntityFeedError({
      kind: 'dependency',
      source: 'feed',
      failure: { kind: 'authentication-required', realm: 'marquee' },
    })).toBe(4);
  });

  it('classifies typed cancellation and ordinary owner failures', () => {
    expect(exitCodeForMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'cancelled' },
    })).toBe(2);
    expect(exitCodeForMarketViewSearchError({
      kind: 'widget-hydration-failed',
      identity: { widgetId: 'MW1' },
      problem: 'cancelled',
    })).toBe(2);
    expect(exitCodeForWidgetError({
      kind: 'widget-load-failure',
      identity: { widgetId: 'MW1' },
      failure: { kind: 'cancelled' },
    })).toBe(2);
    expect(exitCodeForWidgetError({
      kind: 'control-group-resolution-failure',
      identity: { widgetId: 'MW1' },
      failure: {
        kind: 'dependency',
        controlGroupIds: ['CG1'],
        failure: { kind: 'cancelled' },
      },
    })).toBe(2);
    expect(exitCodeForMarketViewSearchError({
      kind: 'invalid-query',
    })).toBe(1);
  });

  it('preserves provider diagnostics only at the presentation boundary', () => {
    expect(presentDashboardReadError({
      kind: 'entity-feed',
      error: {
        kind: 'dependency',
        source: 'feed',
        failure: { kind: 'timeout' },
      },
    }, undefined, [{
      order: 1,
      owner: 'entity-feed.request',
      operation: 'GET /v1/marketview/widgets',
      outcome: 'failed',
      value: {
        kind: 'provider-failure',
        message: 'Request timed out after 30s',
        code: 'timeout',
      },
    }])).toEqual({ message: 'Request timed out after 30s', exitCode: 1 });

    expect(presentDashboardReadError({
      kind: 'dashboard-preferences',
      error: { kind: 'dependency', failure: { kind: 'unavailable' } },
    }, undefined, [{
      order: 1,
      owner: 'dashboard-preferences.request',
      operation: 'GET /v1/marketview/preferences',
      outcome: 'failed',
      value: {
        kind: 'provider-failure',
        message: 'Preferences unavailable',
        code: 'service_unavailable',
      },
    }])).toEqual({ message: 'Preferences unavailable', exitCode: 1 });
  });

  it('preserves Entity Feed preference authentication guidance', () => {
    expect(presentDashboardReadError({
      kind: 'entity-feed',
      error: {
        kind: 'dependency',
        source: 'preferences',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    })).toEqual({
      message: 'Not authenticated. Run: marquee auth login at upstream path /v1/marketview/preferences',
      exitCode: 4,
    });
  });

  it('selects the diagnostic for the failed Entity Feed source', () => {
    expect(presentDashboardReadError({
      kind: 'entity-feed',
      error: {
        kind: 'dependency',
        source: 'feed',
        failure: { kind: 'timeout' },
      },
    }, undefined, [{
      order: 1,
      owner: 'entity-feed.request',
      operation: 'GET /v1/marketview/widgets',
      outcome: 'failed',
      value: {
        kind: 'provider-failure',
        message: 'Widget feed timed out',
        code: 'timeout',
      },
    }, {
      order: 2,
      owner: 'entity-feed.request',
      operation: 'GET /v1/marketview/preferences',
      outcome: 'failed',
      value: {
        kind: 'provider-failure',
        message: 'Preferences unavailable',
        code: 'service_unavailable',
      },
    }])).toEqual({ message: 'Widget feed timed out', exitCode: 1 });
  });

  it('classifies MarketView Search errors by their typed failure', () => {
    expect([
      exitCodeForMarketViewSearchError({ kind: 'discovery-failed', failure: { kind: 'timeout' } }),
      exitCodeForMarketViewSearchError({ kind: 'discovery-failed', failure: { kind: 'rate-limited' } }),
      exitCodeForMarketViewSearchError({ kind: 'discovery-failed', failure: { kind: 'unavailable' } }),
      exitCodeForMarketViewSearchError({
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW1' },
        problem: 'authentication',
      }),
      exitCodeForMarketViewSearchError({
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW1' },
        problem: 'timeout',
      }),
      exitCodeForMarketViewSearchError({ kind: 'artifact-policy-failed' }),
    ]).toEqual([1, 1, 1, 4, 1, 1]);
  });

  it('classifies Widget errors by the failure nested in PlotTool and DataViz problems', () => {
    const identity = { widgetId: 'MW1', configurationId: 'WC1' };
    expect([
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: {
          kind: 'chart-load-failed',
          chartId: 'CH1',
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      }),
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: { kind: 'chart-load-failed', chartId: 'CH1', failure: { kind: 'cancelled' } },
      }),
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: { kind: 'chart-load-failed', chartId: 'CH1', failure: { kind: 'timeout' } },
      }),
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: {
          kind: 'execution-failed',
          chartId: 'CH1',
          failure: { kind: 'authentication-required', realm: 'research' },
        },
      }),
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: { kind: 'execution-failed', chartId: 'CH1', failure: { kind: 'cancelled' } },
      }),
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: { kind: 'execution-failed', chartId: 'CH1', reason: 'access-denied' },
      }),
      exitCodeForWidgetError({
        kind: 'plottool-failure',
        identity,
        problem: { kind: 'chart-not-found', chartId: 'CH1' },
      }),
      exitCodeForWidgetError({
        kind: 'data-viz-failure',
        identity,
        problem: {
          kind: 'render-failure',
          targetId: 'DV1',
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      }),
      exitCodeForWidgetError({
        kind: 'data-viz-failure',
        identity,
        problem: { kind: 'render-failure', targetId: 'DV1', failure: { kind: 'cancelled' } },
      }),
      exitCodeForWidgetError({
        kind: 'data-viz-failure',
        identity,
        problem: { kind: 'target-not-found', targetId: 'DV1' },
      }),
    ]).toEqual([4, 2, 1, 4, 2, 1, 1, 4, 2, 1]);
  });

  it('classifies Widget load and Control Group failures that are not authentication or cancellation', () => {
    expect([
      exitCodeForWidgetError({
        kind: 'widget-load-failure',
        identity: { widgetId: 'MW1' },
        failure: { kind: 'timeout' },
      }),
      exitCodeForWidgetError({
        kind: 'control-group-resolution-failure',
        identity: { widgetId: 'MW1' },
        failure: { kind: 'access-denied', controlGroupIds: ['CG1'] },
      }),
      exitCodeForWidgetError({ kind: 'widget-not-found', identity: { widgetId: 'MW1' } }),
    ]).toEqual([1, 1, 1]);
  });

  it('classifies Dashboard dependency, write, lookup and create failures', () => {
    const auth = { kind: 'authentication-required', realm: 'marquee' } as const;
    const cancelled = { kind: 'cancelled' } as const;
    expect([
      exitCodeForDashboardError({ kind: 'dependency', failure: cancelled }),
      exitCodeForDashboardError({ kind: 'write-failed', failure: auth, isAmbiguous: false }),
      exitCodeForDashboardError({ kind: 'write-failed', failure: cancelled, isAmbiguous: true }),
      exitCodeForDashboardError({ kind: 'lookup-failed', name: 'Carry', failure: auth }),
      exitCodeForDashboardError({ kind: 'lookup-failed', name: 'Carry', failure: cancelled }),
      exitCodeForDashboardError({ kind: 'create-failed', name: 'Carry', failure: auth }),
      exitCodeForDashboardError({ kind: 'create-failed', name: 'Carry', failure: cancelled }),
      exitCodeForDashboardError({ kind: 'dependency', failure: { kind: 'timeout' } }),
      exitCodeForDashboardError({ kind: 'access-denied', dashboardId: 'MD1' }),
    ]).toEqual([2, 4, 2, 4, 2, 4, 2, 1, 1]);
  });

  it('classifies a failed Dashboard verification by its write error, else by its cause', () => {
    expect([
      exitCodeForDashboardError({
        kind: 'verification-failed',
        cause: { kind: 'dependency', failure: { kind: 'cancelled' } },
        writeError: {
          kind: 'write-failed',
          failure: { kind: 'authentication-required', realm: 'marquee' },
          isAmbiguous: true,
        },
      }),
      exitCodeForDashboardError({
        kind: 'verification-failed',
        cause: { kind: 'dependency', failure: { kind: 'cancelled' } },
      }),
    ]).toEqual([4, 2]);
  });

  it('classifies Entity Feed, Dashboard preferences and Entity errors', () => {
    expect([
      exitCodeForEntityFeedError({ kind: 'dependency', source: 'feed', failure: { kind: 'cancelled' } }),
      exitCodeForEntityFeedError({ kind: 'invalid-feed', problem: 'response' }),
      exitCodeForDashboardPreferencesError({
        kind: 'dependency',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      }),
      exitCodeForDashboardPreferencesError({ kind: 'dependency', failure: { kind: 'cancelled' } }),
      exitCodeForDashboardPreferencesError({ kind: 'invalid-response', problem: 'pin-entry' }),
      exitCodeForEntityError({
        kind: 'dependency',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      }),
      exitCodeForEntityError({ kind: 'dependency', failure: { kind: 'cancelled' } }),
      exitCodeForEntityError({ kind: 'access-denied' }),
    ]).toEqual([2, 1, 4, 2, 1, 4, 2, 1]);
  });

  it('writes a MarketView error line on stderr with the failure exit code unless one is given', () => {
    const written: string[] = [];
    const sink = {
      writeError: (text: string) => written.push(`stderr: ${text}`),
      setExitCode: (code: number) => written.push(`exit: ${code}`),
    };

    writeMarketViewErrorLine(sink, 'Error: one');
    writeMarketViewErrorLine(sink, 'Error: two', 4);

    expect(written).toEqual(['exit: 1', 'stderr: Error: one\n', 'exit: 4', 'stderr: Error: two\n']);
  });
});
