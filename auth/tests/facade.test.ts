import { describe, expect, it, vi } from 'vitest';

import type { AgentBrowserRuntime } from '../../agent-browser-runtime/index.js';
import type { Endpoint, Transport } from '../../transport/index.js';
import { createAuth } from '../index.js';

function transport(): Transport {
  return {
    request: vi.fn(),
    requireAuthentication: vi.fn(),
    provider: vi.fn(),
    browserAuthenticationCookies: () => undefined,
    isRedirect: () => false,
  };
}

function runtime(): AgentBrowserRuntime {
  return {
    execute: vi.fn(async () => ({ stdout: 'true', stderr: '' })),
  };
}

describe('Auth facade', () => {
  it('exposes exactly the status, login and logout operations', () => {
    const subject = createAuth({
      cookieJarPath: '/unused',
      transport: transport(),
      runtime: runtime(),
    });

    expect(Object.keys(subject).sort()).toEqual(['login', 'logout', 'status']);
  });

  it('returns result and evidence without presentation', async () => {
    const subject = createAuth({
      cookieJarPath: '/unused',
      transport: {
        ...transport(),
        request: vi.fn(async ({ path }: Endpoint) => (
          path === '/research/search/reports/advanced-search' ? { documents: [] } : { login: 'doejane' }
        )),
      },
      runtime: runtime(),
    });

    const status = await subject.status();

    expect(status.result).toMatchObject({
      ok: true,
      value: { state: 'signed-in', identity: { username: 'doejane' } },
    });
    expect(status.evidence.map(({ path }) => path)).toEqual([
      '/v1/users/self',
      '/research/search/reports/advanced-search',
    ]);
  });
});
