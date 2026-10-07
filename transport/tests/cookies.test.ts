import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarqueeError } from '../index.js';
import { load, save, header, hasValidAuth, setFromResponse, type CookieJar } from '../cookies.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mq-cookie-'));
  path = join(dir, 'cookies.json');
});

describe('cookie-jar', () => {
  it('returns empty jar when file is missing', () => {
    const jar = load(path);
    expect(jar).toEqual({ cookies: [], updatedAt: 0 });
  });

  it('throws MarqueeError(config) when file is corrupt', () => {
    writeFileSync(path, 'not valid json');
    expect(() => load(path)).toThrow(MarqueeError);
    try {
      load(path);
    } catch (e) {
      expect((e as MarqueeError).code).toBe('config');
    }
  });

  it('throws MarqueeError(config) when the cookie path is unreadable', () => {
    mkdirSync(path);

    expect(() => load(path)).toThrowError(expect.objectContaining({
      code: 'config',
      message: expect.stringContaining(`Cookie file unreadable at ${path}`),
    }));
  });

  it('round-trips save/load atomically', () => {
    const jar: CookieJar = {
      cookies: [{ name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' }],
      updatedAt: 1_700_000_000_000,
    };
    save(path, jar);
    expect(existsSync(path)).toBe(true);
    expect(load(path)).toEqual(jar);
  });

  it('builds Cookie header for a target URL, filtering by domain and path', () => {
    const jar: CookieJar = {
      cookies: [
        { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
        { name: 'gs', value: 'xyz', domain: '.gs.com', path: '/' },
        { name: 'other', value: 'no', domain: 'example.com', path: '/' },
      ],
      updatedAt: 0,
    };
    const h = header(jar, new URL('https://marquee.gs.com/v1/users/self'));
    expect(h).toContain('sid=abc');
    expect(h).toContain('gs=xyz');
    expect(h).not.toContain('other=no');
  });

  it('allows callers to filter otherwise-matching cookies', () => {
    const jar: CookieJar = {
      cookies: [
        { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
        { name: 'session', value: 'research', domain: 'marquee.gs.com', path: '/' },
      ],
      updatedAt: 0,
    };
    const h = header(jar, new URL('https://marquee.gs.com/v1/users/self'), {
      include: (cookie) => cookie.name !== 'session',
    });
    expect(h).toContain('sid=abc');
    expect(h).not.toContain('session=research');
  });

  it('treats browser-state expires=-1 cookies as unexpired session cookies', () => {
    const jar: CookieJar = {
      cookies: [
        { name: 'session', value: 'research', domain: 'marquee.gs.com', path: '/', expires: -1 },
        { name: 'panama_scope_id', value: 'scope', domain: 'marquee.gs.com', path: '/', expires: -1 },
      ],
      updatedAt: 0,
    };
    const h = header(jar, new URL('https://marquee.gs.com/research/session-exchange'));
    expect(h).toContain('session=research');
    expect(h).toContain('panama_scope_id=scope');
  });

  it('updates jar from Set-Cookie response headers', () => {
    const jar: CookieJar = { cookies: [], updatedAt: 0 };
    const res = new Response('', {
      headers: { 'set-cookie': 'newSid=v1; Domain=marquee.gs.com; Path=/; Secure; HttpOnly' },
    });
    setFromResponse(jar, new URL('https://marquee.gs.com/x'), res);
    expect(jar.cookies).toHaveLength(1);
    expect(jar.cookies[0]).toMatchObject({ name: 'newSid', value: 'v1' });
  });

  it('parses Expires and Max-Age attributes from Set-Cookie headers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    try {
      const jar: CookieJar = { cookies: [], updatedAt: 0 };
      const expiresResponse = new Response('', {
        headers: { 'set-cookie': 'expires=v1; Expires=Wed, 21 Oct 2037 07:28:00 GMT' },
      });
      const maxAgeResponse = new Response('', {
        headers: { 'set-cookie': 'max-age=v2; Max-Age=60' },
      });

      setFromResponse(jar, new URL('https://marquee.gs.com/x'), expiresResponse);
      setFromResponse(jar, new URL('https://marquee.gs.com/x'), maxAgeResponse);

      expect(jar.cookies).toEqual([
        { name: 'expires', value: 'v1', domain: 'marquee.gs.com', path: '/', expires: 2_139_722_880 },
        { name: 'max-age', value: 'v2', domain: 'marquee.gs.com', path: '/', expires: 1_893_456_060 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces dotted-domain browser cookies when Set-Cookie rotates the same domain', () => {
    const jar: CookieJar = {
      cookies: [
        { name: 'MARQUEE-CSRF-TOKEN', value: 'OLD', domain: '.marquee.gs.com', path: '/' },
      ],
      updatedAt: 0,
    };
    const res = new Response('', {
      headers: { 'set-cookie': 'MARQUEE-CSRF-TOKEN=NEW; Domain=.marquee.gs.com; Path=/' },
    });

    setFromResponse(jar, new URL('https://marquee.gs.com/v1/x'), res);

    expect(jar.cookies).toEqual([
      { name: 'MARQUEE-CSRF-TOKEN', value: 'NEW', domain: 'marquee.gs.com', path: '/' },
    ]);
    expect(header(jar, new URL('https://marquee.gs.com/v1/x'))).toBe('MARQUEE-CSRF-TOKEN=NEW');
  });

  it('preserves the existing jar when an atomic replacement cannot be created', () => {
    const original: CookieJar = {
      cookies: [{ name: 'a', value: '1', domain: 'x', path: '/' }],
      updatedAt: 1,
    };
    const replacement: CookieJar = {
      cookies: [{ name: 'b', value: '2', domain: 'x', path: '/' }],
      updatedAt: 2,
    };
    save(path, original);

    mkdirSync(`${path}.${process.pid}.tmp`);
    expect(() => save(path, replacement)).toThrow();

    expect(load(path)).toEqual(original);
  });

  it('uses separate temp paths for simulated process writers', () => {
    mkdirSync(`${path}.tmp`);
    const firstJar: CookieJar = {
      cookies: [{ name: 'a', value: '1', domain: 'x', path: '/' }],
      updatedAt: 1,
    };
    const secondJar: CookieJar = {
      cookies: [{ name: 'b', value: '2', domain: 'x', path: '/' }],
      updatedAt: 2,
    };
    const originalPid = Object.getOwnPropertyDescriptor(process, 'pid');

    try {
      Object.defineProperty(process, 'pid', { value: 111_111, configurable: true });
      save(path, firstJar);
      Object.defineProperty(process, 'pid', { value: 222_222, configurable: true });
      save(path, secondJar);
    } finally {
      if (originalPid) Object.defineProperty(process, 'pid', originalPid);
    }

    expect(load(path)).toEqual(secondJar);
    expect(existsSync(`${path}.tmp`)).toBe(true);
    expect(existsSync(`${path}.111111.tmp`)).toBe(false);
    expect(existsSync(`${path}.222222.tmp`)).toBe(false);
  });

  it('hasValidAuth returns false for empty jar', () => {
    expect(hasValidAuth({ cookies: [], updatedAt: 0 }, 'marquee.gs.com')).toBe(false);
  });

  it('hasValidAuth returns true when MarqueeLogin is not expired', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const jar: CookieJar = {
      cookies: [
        { name: 'MarqueeLogin', value: 'x', domain: '.gs.com', path: '/', expires: future },
      ],
      updatedAt: Date.now(),
    };
    expect(hasValidAuth(jar, 'marquee.gs.com')).toBe(true);
  });

  it('hasValidAuth accepts a valid MarqueeIdToken after an expired MarqueeLogin', () => {
    const now = Math.floor(Date.now() / 1000);
    const jar: CookieJar = {
      cookies: [
        { name: 'MarqueeLogin', value: 'expired', domain: '.gs.com', path: '/', expires: now - 1 },
        { name: 'MarqueeIdToken', value: 'valid', domain: '.gs.com', path: '/', expires: now + 3600 },
      ],
      updatedAt: Date.now(),
    };
    expect(hasValidAuth(jar, 'marquee.gs.com')).toBe(true);
  });

  it('hasValidAuth returns false when MarqueeLogin is expired', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const jar: CookieJar = {
      cookies: [
        { name: 'MarqueeLogin', value: 'x', domain: '.gs.com', path: '/', expires: past },
      ],
      updatedAt: Date.now(),
    };
    expect(hasValidAuth(jar, 'marquee.gs.com')).toBe(false);
  });

  it('hasValidAuth returns false when cookies exist but no MarqueeLogin', () => {
    const jar: CookieJar = {
      cookies: [
        { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
      ],
      updatedAt: Date.now(),
    };
    expect(hasValidAuth(jar, 'marquee.gs.com')).toBe(false);
  });
});
