import { describe, expect, it } from 'vitest';
import {
  findMatchingNoProxyEntry,
  noProxyDnsDiagnostic,
  NO_PROXY_REMEDIATION,
} from '../diagnostics.js';

const HOST = 'marquee.gs.com';

describe('NO_PROXY DNS diagnostics', () => {
  it.each([
    ['.gs.com', '.gs.com'],
    ['gs.com', 'gs.com'],
    ['marquee.gs.com', 'marquee.gs.com'],
    ['MARQUEE.GS.COM:443', 'MARQUEE.GS.COM:443'],
    ['localhost, .gs.com, 127.0.0.1', '.gs.com'],
  ])('matches %s against the Marquee host', (noProxy, expected) => {
    expect(findMatchingNoProxyEntry(HOST, { NO_PROXY: noProxy })).toBe(expected);
  });

  it.each([
    'example.com',
    'notgs.com',
    '',
  ])('does not match unrelated NO_PROXY entry %j', (noProxy) => {
    expect(findMatchingNoProxyEntry(HOST, { NO_PROXY: noProxy })).toBeUndefined();
  });

  it.each([
    'HTTPS_PROXY',
    'https_proxy',
    'HtTpS_pRoXy',
    'HTTP_PROXY',
    'all_proxy',
    'AGENT_BROWSER_PROXY',
  ])('accepts configured proxy variable %s in any casing', (proxyName) => {
    const diagnostic = noProxyDnsDiagnostic(HOST, 'getaddrinfo ENOTFOUND', {
      [proxyName]: 'http://proxy.example:8080',
      no_proxy: '.gs.com',
    });

    expect(diagnostic).toContain('NO_PROXY (.gs.com)');
    expect(diagnostic).toContain(NO_PROXY_REMEDIATION);
  });

  it.each([
    [{ NO_PROXY: '.gs.com' }, 'getaddrinfo ENOTFOUND'],
    [{ HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: 'example.com' }, 'getaddrinfo ENOTFOUND'],
    [{ HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: '.gs.com' }, 'connect ECONNREFUSED'],
  ])('does not diagnose when the required conditions are incomplete', (env, failure) => {
    expect(noProxyDnsDiagnostic(HOST, failure, env)).toBeUndefined();
  });

  it('reads DNS details from a nested fetch cause', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND marquee.gs.com'), {
      code: 'ENOTFOUND',
      hostname: HOST,
    });
    const failure = new TypeError('fetch failed', { cause });

    expect(noProxyDnsDiagnostic(HOST, failure, {
      HTTPS_PROXY: 'http://proxy.example:8080',
      NO_PROXY: '.gs.com',
    })).toContain(NO_PROXY_REMEDIATION);
  });
});
