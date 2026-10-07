import { describe, expect, it } from 'vitest';

import {
  presentAuthLogin,
  presentAuthLoginProgress,
  presentAuthLogout,
  presentAuthStatus,
} from '../presenter.js';

describe('Auth presenter', () => {
  it('keeps mechanical status failure distinct from unauthenticated state', () => {
    expect(presentAuthStatus({
      result: {
        ok: false,
        error: {
          kind: 'status-realm-failure',
          realm: 'marquee',
          failure: { kind: 'unavailable' },
        },
      },
      evidence: [],
    })).toEqual({
      blocks: [{
        type: 'sentence',
        text: 'Auth status unavailable. Check cookie jar and network, then retry.',
      }],
      exitCode: 1,
    });
  });

  it('shows identity fields only when signed in', () => {
    const identity = {
      username: 'doejane', name: 'Jane Doe', title: 'Vice President',
      division: 'Global Banking & Markets', department: null,
      city: 'New York', country: 'US', region: null,
    };
    expect(presentAuthStatus({
      result: { ok: true, value: { state: 'signed-in', identity } },
      evidence: [],
    })).toEqual({
      blocks: [
        { type: 'field', key: 'status', value: 'signed in' },
        { type: 'field', key: 'host', value: 'marquee.gs.com' },
        { type: 'field', key: 'username', value: 'doejane' },
        { type: 'field', key: 'name', value: 'Jane Doe' },
        { type: 'field', key: 'title', value: 'Vice President' },
        { type: 'field', key: 'division', value: 'Global Banking & Markets' },
        { type: 'field', key: 'department', value: null },
        { type: 'field', key: 'location', value: ['New York', 'US'] },
      ],
    });
    expect(presentAuthStatus({
      result: { ok: true, value: { state: 'expired', isRelinkRequired: false } },
      evidence: [],
    })).toEqual({
      blocks: [
        { type: 'field', key: 'status', value: 'expired' },
        { type: 'field', key: 'host', value: 'marquee.gs.com' },
        { type: 'hints', hints: [{ action: 'sign in again', command: 'marquee auth login' }] },
      ],
      exitCode: 1,
    });
  });

  it('confirms logout and reports a session that could not be removed', () => {
    expect(presentAuthLogout({ result: { ok: true, value: undefined }, evidence: [] })).toEqual({
      output: 'Logged out of marquee.gs.com.',
    });
    expect(presentAuthLogout({
      result: { ok: false, error: { kind: 'logout-failure', failure: { kind: 'unavailable' } } },
      evidence: [],
    })).toEqual({
      output: 'Logout failed: session state could not be removed. Try again.',
      exitCode: 1,
    });
  });

  it('preserves the established missing dependency guidance', () => {
    expect(presentAuthLogin({
      result: { ok: false, error: { kind: 'browser-dependency-missing' } },
      evidence: [],
    })).toEqual({
      output: 'agent-browser is not installed or not on PATH. Install agent-browser or add it to PATH, then rerun `marquee auth login`.',
      exitCode: 1,
    });
  });

  it('preserves the established empty-capture guidance', () => {
    expect(presentAuthLogin({
      result: {
        ok: false,
        error: {
          kind: 'login-capture-failure',
          realm: 'marquee',
          problem: 'empty',
          failure: { kind: 'unavailable' },
        },
      },
      evidence: [],
    })).toEqual({
      output: 'Login captured no cookies from the browser. Rerun: marquee auth login',
      exitCode: 1,
    });
  });

  it('reports a login cancelled by closing the window', () => {
    expect(presentAuthLogin({ result: { ok: false, error: { kind: 'login-cancelled' } }, evidence: [] })).toEqual({
      output: 'Login cancelled: the browser window was closed before sign-in completed',
      exitCode: 1,
    });
  });

  it('owns the exact login progress text', () => {
    expect(presentAuthLoginProgress('saved')).toEqual({
      output: 'Opening browser for SSO login...',
    });
    expect(presentAuthLoginProgress('manual')).toEqual({
      output: 'No saved credentials. Opening browser for manual login...',
    });
  });
});
