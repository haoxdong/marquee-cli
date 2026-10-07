import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MarqueeError } from './errors.js';
import type { Cookie } from './types.js';

export interface CookieJar {
  cookies: Cookie[];
  updatedAt: number;
}

export function load(path: string): CookieJar {
  if (!existsSync(path)) {
    return { cookies: [], updatedAt: 0 };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new MarqueeError('config', `Cookie file unreadable at ${path}: ${(e as Error).message}. Run: marquee auth login`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MarqueeError('config', `Cookie file corrupted at ${path}. Run: marquee auth login`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as CookieJar).cookies)) {
    throw new MarqueeError('config', `Cookie file corrupted at ${path}. Run: marquee auth login`);
  }

  return parsed as CookieJar;
}

export function save(path: string, jar: CookieJar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(jar, null, 2), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
}

const AUTH_COOKIE_NAMES = ['MarqueeLogin', 'MarqueeIdToken'];

export function hasValidAuth(jar: CookieJar, hostname: string): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return jar.cookies.some(
    (c) => (
      AUTH_COOKIE_NAMES.includes(c.name)
      && domainMatches(c.domain, hostname)
      && isUnexpired(c, nowSeconds)
    ),
  );
}

export function header(
  jar: CookieJar,
  url: URL,
  opts: { include?: (cookie: Cookie) => boolean } = {},
): string {
  return cookiesForUrl(jar, url, opts)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function cookiesForUrl(
  jar: CookieJar,
  url: URL,
  opts: { include?: (cookie: Cookie) => boolean } = {},
): Cookie[] {
  const host = url.hostname;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return jar.cookies.filter((c) => (
    isUnexpired(c, nowSeconds) &&
    domainMatches(c.domain, host) &&
    pathMatches(c.path, url.pathname) &&
    (opts.include?.(c) ?? true)
  ));
}

export function cookiesForDomain(jar: CookieJar, hostname: string): Cookie[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return jar.cookies.filter((cookie) => (
    isUnexpired(cookie, nowSeconds)
    && domainMatches(cookie.domain, hostname)
  ));
}

export function setFromResponse(jar: CookieJar, url: URL, response: Response): void {
  const setCookies = typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean) as string[];

  for (const raw of setCookies) {
    const cookie = parseSetCookie(raw, url);
    if (cookie) {
      upsert(jar, cookie);
    }
  }
  jar.updatedAt = Date.now();
}

function upsert(jar: CookieJar, cookie: Cookie): void {
  const idx = jar.cookies.findIndex((x) => sameCookieIdentity(x, cookie));
  if (idx >= 0) {
    jar.cookies = jar.cookies.filter((x) => !sameCookieIdentity(x, cookie));
    jar.cookies.splice(idx, 0, cookie);
  } else {
    jar.cookies.push(cookie);
  }
}

function sameCookieIdentity(a: Cookie, b: Cookie): boolean {
  return a.name === b.name && normalizedDomain(a.domain) === normalizedDomain(b.domain) && a.path === b.path;
}

function parseSetCookie(raw: string, url: URL): Cookie | null {
  const [first, ...attrs] = raw.split(';');
  // Stryker disable next-line StringLiteral: split always yields at least one part, so this never throws
  if (first === undefined) throw new Error('Set-Cookie header split yielded no parts');
  const eq = first.indexOf('=');
  if (eq < 0) {
    return null;
  }

  const cookie: Cookie = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
    domain: url.hostname,
    path: '/',
  };

  for (const attr of attrs) {
    const eqIndex = attr.indexOf('=');
    const rawKey = eqIndex >= 0 ? attr.slice(0, eqIndex) : attr;
    const rawValue = eqIndex >= 0 ? attr.slice(eqIndex + 1) : undefined;
    applyCookieAttribute(cookie, rawKey.trim().toLowerCase(), rawValue?.trim());
  }

  return cookie;
}

function applyCookieAttribute(cookie: Cookie, key: string, value: string | undefined): void {
  switch (key) {
    case 'domain':
      if (value) cookie.domain = normalizedDomain(value);
      break;
    case 'path':
      if (value) cookie.path = value;
      break;
    case 'expires':
      if (value) cookie.expires = Math.floor(new Date(value).getTime() / 1000);
      break;
    case 'max-age':
      if (value) cookie.expires = Math.floor(Date.now() / 1000) + Number(value);
      break;
    case 'httponly':
      cookie.httpOnly = true;
      break;
    case 'secure':
      cookie.secure = true;
      break;
    case 'samesite':
      if (isSameSite(value)) cookie.sameSite = value;
      break;
  }
}

function isSameSite(value: string | undefined): value is NonNullable<Cookie['sameSite']> {
  return value === 'Lax' || value === 'Strict' || value === 'None';
}

function isUnexpired(cookie: Cookie, nowSeconds: number): boolean {
  return cookie.expires === undefined || cookie.expires < 0 || cookie.expires > nowSeconds;
}

function domainMatches(cookieDomain: string, host: string): boolean {
  const normalized = normalizedDomain(cookieDomain);
  return host === normalized || host.endsWith(`.${normalized}`);
}

function normalizedDomain(domain: string): string {
  return domain.startsWith('.') ? domain.slice(1) : domain;
}

function pathMatches(cookiePath: string, urlPath: string): boolean {
  return urlPath === cookiePath || urlPath.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
}
