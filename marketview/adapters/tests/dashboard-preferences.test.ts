import { describe, expect, it } from 'vitest';
import { MarqueeError } from '../../../transport/index.js';
import { createDashboardPreferencesReader } from '../dashboard-preferences.js';

describe('Dashboard preferences adapter', () => {
  it('preserves saved pin order and normalizes Widget identities', async () => {
    const read = createDashboardPreferencesReader({
      async request() {
        return {
          value: {
            pins: [
              { widgetId: 'mw_second', configurationId: 'wc_second' },
              'mw_first',
            ],
          },
        };
      },
    });

    await expect(read()).resolves.toEqual({
      ok: true,
      value: [
        { widgetId: 'MW_SECOND', configurationId: 'WC_SECOND' },
        { widgetId: 'MW_FIRST' },
      ],
    });
  });

  it('treats the recorded empty preference document as no saved pins', async () => {
    const read = createDashboardPreferencesReader({
      async request() {
        return {};
      },
    });

    await expect(read()).resolves.toEqual({ ok: true, value: [] });
  });

  it('returns a closed semantic preference failure without provider diagnostics', async () => {
    const read = createDashboardPreferencesReader({
      async request() {
        throw new MarqueeError('timeout', 'Request timed out after 30s');
      },
    });

    await expect(read()).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dependency',
        failure: { kind: 'timeout' },
      },
    });
  });

  it('fails loud when the preference response has no pins array', async () => {
    const read = createDashboardPreferencesReader({
      async request() {
        return { value: {} };
      },
    });

    await expect(read()).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-response', problem: 'response' },
    });
  });

  it('fails loud when any saved pin is malformed', async () => {
    const read = createDashboardPreferencesReader({
      async request() {
        return { value: { pins: ['MW_VALID', {}] } };
      },
    });

    await expect(read()).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-response', problem: 'pin-entry' },
    });
  });
});
