import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentBrowserRuntime } from '../../../agent-browser-runtime/index.js';
import type { Endpoint, HttpRequestInit, Transport } from '../../../transport/index.js';
import { createAuth } from '../../module.js';
import { createProductionAuthPort } from '../production.js';

const temporaryDirectories: string[] = [];

function transport(
  request: Transport['request'] = vi.fn(),
  requireAuthentication: Transport['requireAuthentication'] = vi.fn(),
): Transport {
  return {
    request,
    requireAuthentication,
    provider: vi.fn(),
    browserAuthenticationCookies: () => undefined,
    isRedirect: () => false,
  };
}

function runtime(
  execute: AgentBrowserRuntime['execute'],
): AgentBrowserRuntime {
  return { execute };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function cookieJar(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mq-auth-port-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'cookies.json');
  writeFileSync(path, JSON.stringify({
    cookies: [{
      name: 'MarqueeLogin', value: '1', domain: '.gs.com', path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }],
    updatedAt: 0,
  }));
  return path;
}

describe('production Auth port', () => {
  it('checks MarketView and one research read and takes identity from the MarketView check', async () => {
    const request = vi.fn(async ({ path }: Endpoint, _init?: HttpRequestInit) => (
      path === '/research/search/reports/advanced-search'
        ? { documents: [], totalRecords: 0 }
        : { login: 'doejane', firstName: 'Jane', lastName: 'Doe' }
    ));
    const subject = createAuth(createProductionAuthPort({
      cookieJarPath: cookieJar(),
      transport: transport(request),
    }));

    const status = await subject.status();

    expect(status.result).toMatchObject({
      ok: true,
      value: { state: 'signed-in', identity: { username: 'doejane', name: 'Jane Doe' } },
    });
    expect(request.mock.calls).toEqual([
      [{ method: 'GET', path: '/v1/users/self' }, undefined],
      [
        { method: 'POST', path: '/research/search/reports/advanced-search' },
        {
          body: {
            filter: '(all EQ ${(zqxjvkwpfhq)}$)',
            sort: 'time',
            page: 1,
            size: 1,
            language: '["en"]',
            limitTo: '[""]',
            applyHighlighting: true,
          },
          headers: {
            Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
            'Content-Type': 'application/json;charset=UTF-8',
          },
        },
      ],
    ]);
    expect(status.evidence.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /v1/users/self',
      'POST /research/search/reports/advanced-search',
    ]);
  });

  it('leaves a missing name empty instead of inventing one', async () => {
    const subject = createAuth(createProductionAuthPort({
      cookieJarPath: '/unused',
      transport: transport(vi.fn(async () => ({ title: 'Vice President' }))),
    }));

    await expect(subject.status()).resolves.toMatchObject({
      result: { ok: true, value: { state: 'signed-in', identity: { name: null, title: 'Vice President' } } },
    });
  });

  it('saves the SSO profile with argv ordering and password stdin', async () => {
    const execute = vi.fn(async () => ({ stdout: '✓ Done', stderr: '' }));
    const port = createProductionAuthPort({
      cookieJarPath: '/unused',
      transport: transport(),
      runtime: runtime(execute),
    });

    await expect(port.saveProfile({
      url: 'https://marquee.gs.com/s/',
      username: 'jane',
      passwordStdin: 'secret\n',
    })).resolves.toEqual({ ok: true, value: undefined });
    expect(execute).toHaveBeenCalledWith({
      argv: ['auth', 'save',
        'marquee', '--url', 'https://marquee.gs.com/s/',
        '--username', 'jane', '--password-stdin',
      ],
      stdin: 'secret\n',
    });
  });

  it('normalizes only the public identity fields', async () => {
    const subject = createAuth(createProductionAuthPort({
      cookieJarPath: '/unused',
      transport: transport(vi.fn(async () => ({
        login: 'doejane', firstName: 'Jane', lastName: 'Doe', title: 'Vice President', pmd: false,
        divisionName: 'GBM', departmentName: 'Marquee', company: 'GS',
        city: 'New York', country: 'US', region: 'Americas', email: 'private@example.com',
      }))),
    }));

    await expect(subject.status()).resolves.toMatchObject({
      result: {
        ok: true,
        value: {
          state: 'signed-in',
          identity: {
            username: 'doejane', name: 'Jane Doe', title: 'Vice President',
            division: 'GBM', department: 'Marquee',
            city: 'New York', country: 'US', region: 'Americas',
          },
        },
      },
    });
  });

  it('maps a failed profile save to a closed error without exposing the password', async () => {
    const port = createProductionAuthPort({
      cookieJarPath: '/unused',
      transport: transport(),
      runtime: runtime(vi.fn(async () => {
        throw new Error('spawn args --username jane --password secret');
      })),
    });

    const result = await port.saveProfile({ url: 'https://marquee.gs.com/s/', username: 'jane' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'saved-profile-failure', failure: { kind: 'unavailable' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('does not claim provider evidence when request setup fails before dispatch', async () => {
    const subject = createAuth(createProductionAuthPort({
      cookieJarPath: '/unused',
      transport: transport(
        vi.fn(),
        () => { throw Object.assign(new Error('no auth'), { code: 'auth_expired' }); },
      ),
    }));

    await expect(subject.status()).resolves.toEqual({
      result: { ok: true, value: { state: 'expired', isRelinkRequired: false } },
      evidence: [],
    });
  });
});
