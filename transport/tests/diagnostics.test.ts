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
    ['marquee.gs.com.', 'marquee.gs.com.'],
    ['marquee.gs.com', 'marquee.gs.com'],
    ['localhost, .gs.com, 127.0.0.1', '.gs.com'],
  ])('matches %s against the Marquee host', (noProxy, expected) => {
    expect(findMatchingNoProxyEntry(HOST, { NO_PROXY: noProxy })).toBe(expected);
  });

  // A port and letter case on an entry match as on any host; the mirror gate keeps a gs.com host with a port out of fixtures.
  it.each([
    ['*.EXAMPLE.TEST.:443', '*.EXAMPLE.TEST.:443'],
    ['API.EXAMPLE.TEST:443', 'API.EXAMPLE.TEST:443'],
  ])('matches %s, with its port and case, against its host', (noProxy, expected) => {
    expect(findMatchingNoProxyEntry('api.example.test', { NO_PROXY: noProxy })).toBe(expected);
  });

  it.each([
    '*',
    'example.com',
    '',
  ])('does not match unrelated NO_PROXY entry %j', (noProxy) => {
    expect(findMatchingNoProxyEntry(HOST, { NO_PROXY: noProxy })).toBeUndefined();
  });

  it('does not match an entry that the host only shares a suffix with', () => {
    expect(findMatchingNoProxyEntry('notexample.test', { NO_PROXY: 'example.test' })).toBeUndefined();
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

  it('preserves environment entry order and exact remediation', () => {
    expect(noProxyDnsDiagnostic(HOST, new Error('fetch failed', {
      cause: Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND', hostname: HOST }),
    }), {
      https_proxy: 'http://proxy.example:8080',
      no_proxy: 'localhost, *.GS.COM.',
      NO_PROXY: 'marquee.gs.com',
    })).toBe('marquee.gs.com failed to resolve directly, and NO_PROXY (*.GS.COM.) is routing it around your proxy. Either remove the matching entry from NO_PROXY, or run with: NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1"');
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
