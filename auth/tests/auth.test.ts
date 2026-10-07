import { describe, expect, it, vi } from 'vitest';

import {
  createAuth,
  type AuthOperationOutcome,
  type AuthPort,
  type AuthResult,
} from '../module.js';

function outcome<T>(result: AuthResult<T>): AuthOperationOutcome<T> {
  return { result, evidence: [] };
}

const IDENTITY = {
  username: 'doejane', name: 'Jane Doe', title: null, division: null,
  department: null, city: null, country: null, region: null,
} as const;

function port(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    checkLoginBrowser: vi.fn(async () => ({ ok: true, value: undefined })),
    resolveLoginCredentials: vi.fn(async () => ({ ok: true, value: null })),
    openLoginBrowser: vi.fn(async () => ({ ok: true, value: undefined })),
    captureLoginState: vi.fn(async () => ({ ok: true, value: undefined })),
    cleanupLogin: vi.fn(async () => ({ ok: true, value: undefined })),
    publishLogin: vi.fn(async () => ({ ok: true, value: undefined })),
    discardLogin: vi.fn(async () => ({ ok: true, value: undefined })),
    inspectMarqueeRealm: vi.fn(async () => outcome({
      ok: true,
      value: { state: 'authenticated', identity: IDENTITY },
    })),
    inspectResearchRealm: vi.fn(async () => outcome({ ok: true, value: 'authenticated' })),
    saveProfile: vi.fn(async () => ({ ok: true, value: undefined })),
    clearSession: vi.fn(async () => ({ ok: true, value: undefined })),
    ...overrides,
  };
}

describe('Auth interface', () => {
  it('publishes login state only after the Marquee realm verifies and browser cleanup succeeds', async () => {
    const steps: string[] = [];
    const authPort = Object.assign(port(), {
      resolveLoginCredentials: vi.fn(async () => ({
        ok: true as const,
        value: { username: 'jane', password: 'secret' },
      })),
      checkLoginBrowser: vi.fn(async () => {
        steps.push('check-browser');
        return { ok: true as const, value: undefined };
      }),
      openLoginBrowser: vi.fn(async () => {
        steps.push('verify-marquee');
        return { ok: true as const, value: undefined };
      }),
      captureLoginState: vi.fn(async () => {
        steps.push('capture');
        return { ok: true as const, value: undefined };
      }),
      cleanupLogin: vi.fn(async () => {
        steps.push('cleanup');
        return { ok: true as const, value: undefined };
      }),
      publishLogin: vi.fn(async () => {
        steps.push('publish');
        return { ok: true as const, value: undefined };
      }),
      discardLogin: vi.fn(async () => {
        steps.push('discard');
        return { ok: true as const, value: undefined };
      }),
    });
    const subject = createAuth(authPort);
    const progress: string[] = [];

    await expect(subject.login(
      { passwordStdin: 'secret\n' },
      () => { progress.push('opening'); },
    )).resolves.toEqual({ result: { ok: true, value: undefined }, evidence: [] });

    expect(progress).toEqual(['opening']);
    expect(steps).toEqual([
      'check-browser',
      'verify-marquee',
      'capture',
      'cleanup',
      'publish',
    ]);
  });

  it('reports cleanup failure instead of silently discarding it during abort', async () => {
    const discardLogin = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const subject = createAuth(port({
      resolveLoginCredentials: vi.fn(async () => ({
        ok: true as const,
        value: { username: 'jane', password: 'secret' },
      })),
      captureLoginState: vi.fn(async () => ({
        ok: false as const,
        error: {
          kind: 'login-capture-failure' as const,
          problem: 'read' as const,
          failure: { kind: 'unavailable' as const },
        },
      })),
      cleanupLogin: vi.fn(async () => ({
        ok: false as const,
        error: {
          kind: 'login-cleanup-failure' as const,
          failure: { kind: 'unavailable' as const },
        },
      })),
      discardLogin,
    }));

    await expect(subject.login()).resolves.toEqual({
      result: {
        ok: false,
        error: {
          kind: 'login-cleanup-failure',
          failure: { kind: 'unavailable' },
        },
      },
      evidence: [],
    });
    expect(discardLogin).not.toHaveBeenCalled();
  });

  it('is signed in with the MarketView identity only when both sessions are valid', async () => {
    const subject = createAuth(port({
      inspectMarqueeRealm: vi.fn(async () => outcome({
        ok: true,
        value: { state: 'authenticated', identity: IDENTITY },
      })),
    }));

    await expect(subject.status()).resolves.toEqual({
      result: { ok: true, value: { state: 'signed-in', identity: IDENTITY } },
      evidence: [],
    });
  });

  it('still checks Research when MarketView is unauthenticated and reports expired', async () => {
    const authPort = port({
      inspectMarqueeRealm: vi.fn(async () => outcome({ ok: true, value: { state: 'unauthenticated' } })),
    });
    const subject = createAuth(authPort);

    await expect(subject.status()).resolves.toEqual({
      result: { ok: true, value: { state: 'expired', isRelinkRequired: false } },
      evidence: [],
    });
    expect(authPort.inspectResearchRealm).toHaveBeenCalledOnce();
  });

  it('reports expired without identity when only the research read is unauthorized', async () => {
    const subject = createAuth(port({
      inspectMarqueeRealm: vi.fn(async () => outcome({
        ok: true,
        value: { state: 'authenticated', identity: IDENTITY },
      })),
      inspectResearchRealm: vi.fn(async () => outcome({ ok: true, value: 'session-expired' })),
    }));

    await expect(subject.status()).resolves.toEqual({
      result: { ok: true, value: { state: 'expired', isRelinkRequired: false } },
      evidence: [],
    });
  });

  it('saves the SSO profile with the Marquee URL default before resolving credentials', async () => {
    const steps: string[] = [];
    const authPort = port({
      saveProfile: vi.fn(async () => {
        steps.push('save');
        return { ok: true as const, value: undefined };
      }),
      resolveLoginCredentials: vi.fn(async () => {
        steps.push('resolve');
        return { ok: true as const, value: null };
      }),
    });
    const subject = createAuth(authPort);

    await subject.login({ username: 'jane', passwordStdin: 'secret' });

    expect(authPort.saveProfile).toHaveBeenCalledWith({
      url: 'https://marquee.gs.com/s/',
      username: 'jane',
      passwordStdin: 'secret',
    });
    expect(authPort.resolveLoginCredentials).toHaveBeenCalledWith({
      username: 'jane',
      passwordStdin: 'secret',
    });
    expect(steps).toEqual(['save', 'resolve']);
  });

  it('does not save a profile when login has no SSO profile flags', async () => {
    const authPort = port();

    await createAuth(authPort).login({ passwordStdin: 'secret' });

    expect(authPort.saveProfile).not.toHaveBeenCalled();
  });

  it('stops login before opening the browser when the profile cannot be saved', async () => {
    const authPort = port({
      saveProfile: vi.fn(async () => ({
        ok: false as const,
        error: { kind: 'saved-profile-failure' as const, failure: { kind: 'unavailable' as const } },
      })),
    });

    await expect(createAuth(authPort).login({ url: 'https://marquee.gs.com/s/' })).resolves.toEqual({
      result: {
        ok: false,
        error: { kind: 'saved-profile-failure', failure: { kind: 'unavailable' } },
      },
      evidence: [],
    });
    expect(authPort.openLoginBrowser).not.toHaveBeenCalled();
  });

  it('opens the browser for manual sign-in when no SSO credentials are saved or given', async () => {
    const authPort = port({
      resolveLoginCredentials: vi.fn(async () => ({ ok: true as const, value: null })),
    });
    const onProgress = vi.fn();

    await expect(createAuth(authPort).login({}, onProgress)).resolves.toEqual({
      result: { ok: true, value: undefined },
      evidence: [],
    });
    expect(onProgress).toHaveBeenCalledWith('manual');
    expect(authPort.openLoginBrowser).toHaveBeenCalledWith(null);
  });

  it('logs out by clearing the stored session', async () => {
    const authPort = port();

    await expect(createAuth(authPort).logout()).resolves.toEqual({
      result: { ok: true, value: undefined },
      evidence: [],
    });
    expect(authPort.clearSession).toHaveBeenCalledOnce();
  });
});
