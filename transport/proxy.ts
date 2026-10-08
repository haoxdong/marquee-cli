/** @format */

import type { HttpRequestInit } from './types.js';
import { MarqueeError } from './errors.js';
import { upstreamUnauthorizedClassification } from './unauthorized-response.js';
import {
  appendQuery,
  armRequestDeadline,
  assertExpectedContentType,
  manualRedirect,
  readResponseBody,
} from './http-plumbing.js';

interface InvocationTransportConfig {
  baseUrl: string;
  accountId: string;
  sessionId: string;
  invocationToken: string;
  fetchFn?: typeof fetch | undefined;
}

export type ProxyHttpTransportConfig =
  | InvocationTransportConfig
  | {
      execution: 'session';
      baseUrl: string;
      sessionToken: string;
      fetchFn?: typeof fetch | undefined;
    };

const DEFAULT_TIMEOUT_MS = 110_000;

export class ProxyHttpTransport {
  private readonly baseUrl: string;
  private readonly authentication:
    | { kind: 'session'; token: string }
    | {
        kind: 'invocation';
        accountId: string;
        sessionId: string;
        token: string;
      };
  private readonly fetchFn: typeof fetch;

  constructor(cfg: ProxyHttpTransportConfig) {
    this.baseUrl = required(cfg.baseUrl, 'baseUrl');
    this.authentication =
      'sessionToken' in cfg
        ? { kind: 'session', token: sessionCredential(cfg.sessionToken) }
        : {
            kind: 'invocation',
            accountId: required(cfg.accountId, 'accountId'),
            sessionId: required(cfg.sessionId, 'sessionId'),
            token: required(cfg.invocationToken, 'invocationToken'),
          };
    if (this.authentication.kind === 'session') gatewayBase(this.baseUrl);
    this.fetchFn = cfg.fetchFn ?? fetch;
  }

  async request(path: string, init: HttpRequestInit = {}): Promise<unknown> {
    const url =
      this.authentication.kind === 'session'
        ? sessionUrlForPath(this.baseUrl, path)
        : proxyUrlForPath(this.baseUrl, path);
    appendQuery(url, init.query);
    const deadline = armRequestDeadline({
      signal: init.signal,
      timeoutMs: init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    try {
      return await this.send(url, path, init, deadline.signal);
    } catch (error) {
      throw error instanceof MarqueeError
        ? error
        : (deadline.abortError(error, path, 'Marquee proxy request') ??
            new MarqueeError(
              'network',
              this.authentication.kind === 'session'
                ? 'Cannot reach Marquee gateway'
                : `Cannot reach Marquee proxy: ${(error as Error).message}`,
              { path }
            ));
    } finally {
      deadline.dispose();
    }
  }

  private async send(
    url: URL,
    path: string,
    init: HttpRequestInit,
    signal: AbortSignal
  ): Promise<unknown> {
    const response = await this.fetchFn(url.toString(), {
      method: init.method ?? 'GET',
      headers: this.buildHeaders(init),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal,
      ...(this.authentication.kind === 'session' || init.redirect === 'manual'
        ? { redirect: 'manual' as const }
        : {}),
    });

    if (response.status === 401 || response.status === 403) {
      throw await authFailureError(
        response,
        path,
        this.authentication.kind === 'session'
      );
    }
    const redirect = manualRedirect(init, response);
    if (redirect) return redirect;
    if (!response.ok) {
      const body = await safeReadBody(
        response,
        init.isErrorBodyPreserved,
        this.authentication.kind === 'session'
      );
      throw new MarqueeError(
        'http',
        `Credential Service returned ${response.status} for ${path}`,
        {
          status: response.status,
          path,
          body,
        }
      );
    }

    assertExpectedContentType(
      init.expectedContentType,
      response.headers.get('content-type') ?? '',
      response.status,
      path
    );
    return readResponseBody(
      response,
      init,
      (text) =>
        new MarqueeError(
          'http',
          `Unexpected non-JSON proxy response for ${path}`,
          {
            status: response.status,
            path,
            body: text.slice(0, 256),
          }
        )
    );
  }

  private buildHeaders(init: HttpRequestInit): Record<string, string> {
    const extras = stripCallerCredentialHeaders(
      init.headers ?? {},
      this.authentication.kind === 'session'
    );
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...extras,
      ...(this.authentication.kind === 'session'
        ? { Cookie: `marqueebot_session=${this.authentication.token}` }
        : {
            Authorization: `Bearer ${this.authentication.token}`,
            'X-MarqueeBot-Account-Id': this.authentication.accountId,
            'X-MarqueeBot-Session-Id': this.authentication.sessionId,
          }),
    };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json;charset=utf-8';
    }
    return headers;
  }
}

async function authFailureError(
  response: Response,
  path: string,
  session = false
): Promise<MarqueeError> {
  const body = await safeReadBody(response, false, session);
  const proxyFailure = parseProxyAuthFailure(body);
  if (response.status === 403 && proxyFailure.kind === 'refused') {
    // The relay refused the call before it reached Marquee, so no Marquee status applies.
    return new MarqueeError('http', proxyFailure.message, { path });
  }
  const upstream = upstreamUnauthorizedClassification(body);
  if (response.status === 401 && proxyFailure.kind !== 'matched' && upstream) {
    return new MarqueeError('http', `Marquee returned 401 for ${path}`, {
      status: response.status,
      path,
      body,
      responseClassification: upstream,
    });
  }
  return new MarqueeError(
    'auth_expired',
    proxyFailure.kind === 'matched'
      ? proxyFailure.message
      : 'Credential Service could not authenticate this Marquee request',
    {
      status: response.status,
      path,
      ...(proxyFailure.kind === 'matched'
        ? { credentialServiceCode: proxyFailure.code }
        : {}),
    }
  );
}

function proxyUrlForPath(base: string, path: string): URL {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const relative = proxyRelativePath(path);
  return new URL(relative, normalizedBase);
}

function proxyRelativePath(path: string): string {
  const value = path.trim();
  if (value.startsWith('//')) {
    return proxyRelativePathFromMarqueeUrl(new URL(`https:${value}`), path);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return proxyRelativePathFromMarqueeUrl(new URL(value), path);
  }
  return value.replace(/^\/+/, '');
}

function proxyRelativePathFromMarqueeUrl(
  parsed: URL,
  originalPath: string
): string {
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'marquee.gs.com') {
    throw new MarqueeError(
      'config',
      'Proxy transport only accepts marquee.gs.com URLs or paths',
      { path: originalPath }
    );
  }
  return `${parsed.pathname.replace(/^\/+/, '')}${parsed.search}`;
}

function required(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MarqueeError('config', `Missing proxy ${name}`);
  }
  return trimmed;
}

function stripCallerCredentialHeaders(
  headers: Record<string, string>,
  session = false
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const normalized = name.toLowerCase();
      return (
        normalized !== 'authorization' &&
        normalized !== 'cookie' &&
        !(session && normalized.startsWith('x-marqueebot-'))
      );
    })
  );
}

async function safeReadBody(
  res: Response,
  isErrorBodyPreserved = false,
  session = false
): Promise<string> {
  try {
    const text = await res.text();
    return isErrorBodyPreserved ? text : text.slice(0, 1024);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    if (session) return 'Unable to read Marquee gateway error response body';
    return `Unable to read proxy error response body: ${error instanceof Error ? error.message : String(error)}`;
  }
}

type ProxyAuthFailure =
  | { kind: 'matched'; code: string; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'missing' }
  | { kind: 'malformed' };

function parseProxyAuthFailure(body: string): ProxyAuthFailure {
  if (!body) return { kind: 'missing' };
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    const detail = parsed.detail;
    // The Credential Service's refusal of an upstream call outside its read scope.
    if (
      typeof detail === 'string' &&
      detail.startsWith('Credential Service only allows ')
    ) {
      return { kind: 'refused', message: detail };
    }
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      return { kind: 'missing' };
    }
    const code = (detail as Record<string, unknown>).code;
    const message = (detail as Record<string, unknown>).message;
    if (code === 'gateway_refused' && typeof message === 'string')
      return { kind: 'refused', message };
    if (
      !['relink_required', 'session_required', 'session_invalid'].includes(
        String(code)
      ) ||
      typeof code !== 'string' ||
      typeof message !== 'string'
    ) {
      return { kind: 'missing' };
    }
    return {
      kind: 'matched',
      code,
      message,
    };
  } catch {
    return { kind: 'malformed' };
  }
}

function sessionCredential(value: string): string {
  if (!/^sess_[A-Za-z0-9_-]+$/.test(value)) {
    throw new MarqueeError(
      'config',
      'Invalid MarqueeBot session configuration'
    );
  }
  return value;
}

function gatewayBase(base: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new MarqueeError('config', 'Invalid Marquee gateway URL');
  }
  if (
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new MarqueeError('config', 'Invalid Marquee gateway URL');
  }
  return url;
}

function sessionUrlForPath(base: string, path: string): URL {
  const raw = path.trim();
  const pathname = raw.split('?', 1)[0] ?? '';
  if (
    raw.includes('#') ||
    /\\|%(?:2e|2f|5c|25)/i.test(pathname) ||
    pathname.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new MarqueeError('config', 'Invalid Marquee gateway request path');
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) {
    let source: URL;
    try {
      source = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    } catch {
      throw new MarqueeError('config', 'Invalid Marquee gateway request path');
    }
    if (source.username || source.password || source.port)
      throw new MarqueeError('config', 'Invalid Marquee gateway request path');
  }
  const relative = proxyRelativePath(raw);
  const root = gatewayBase(base);
  const url = new URL(
    relative,
    root.href.endsWith('/') ? root.href : `${root.href}/`
  );
  if (
    url.origin !== root.origin ||
    !url.pathname.startsWith(`${root.pathname.replace(/\/$/, '')}/`)
  ) {
    throw new MarqueeError('config', 'Invalid Marquee gateway request path');
  }
  return url;
}
