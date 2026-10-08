import type { Cookie, HttpRequestInit } from './types.js';
import { MarqueeError } from './errors.js';
import { upstreamUnauthorizedClassification } from './unauthorized-response.js';
import {
  hasValidAuth,
  header as buildCookieHeader,
  save as saveJar,
  setFromResponse,
  type CookieJar,
} from './cookies.js';
import { requiredGroup } from '../lib/regex-group.js';
import { noProxyDnsDiagnostic } from './diagnostics.js';
import {
  appendQuery,
  armRequestDeadline,
  assertExpectedContentType,
  manualRedirect,
  readResponseBody,
  type RedirectResult,
} from './http-plumbing.js';

export interface HttpTransportConfig {
  jar: CookieJar;
  jarPath: string;
  fetchFn?: typeof fetch | undefined;
  saveFn?: ((path: string, jar: CookieJar) => void) | undefined;
  baseUrl?: string | undefined;
}

const DEFAULT_BASE = 'https://marquee.gs.com';
const MARQUEE_HOST = new URL(DEFAULT_BASE).hostname;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSER_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
type AuthSource = 'accessToken' | 'MarqueeIdToken' | 'none';
type ExpectedResponseKind = 'json' | 'text' | 'arrayBuffer' | 'html';
type ResponseClassification =
  | { outcome: 'success'; provenance: 'ordinary' | 'accepted_html' }
  | { outcome: 'retry'; provenance: 'generic_html' | 'gateway_html' }
  | { outcome: 'auth_expired'; provenance: 'http_401' | 'login_html' }
  | {
    outcome: 'upstream_http';
    provenance:
      | 'entity_401'
      | 'entitlement_401'
      | 'http_status'
      | 'generic_html'
      | 'gateway_html';
  }
  | { outcome: 'malformed'; provenance: 'non_json' };
// One in-flight request: its resolved URL, the caller's path and init, and the deadline's signal.
interface DirectRequest {
  url: URL;
  path: string;
  init: HttpRequestInit;
  signal: AbortSignal;
}
interface ResponseClassificationInput {
  status: number;
  contentType: string;
  body?: string | undefined;
  expected: ExpectedResponseKind;
  retryEligible: boolean;
  retryAttempted: boolean;
  parseFailed?: boolean;
}
const RESEARCH_REALM_COOKIE_NAMES = new Set(['JSESSIONID', 'session', 'panama_scope_id', 'panama_scope_started']);

export class HttpTransport {
  private readonly jar: CookieJar;
  private readonly jarPath: string;
  private readonly fetchFn: typeof fetch;
  private readonly saveFn: (path: string, jar: CookieJar) => void;
  private readonly baseUrl: string;
  private accessToken?: { value: string; expiresAt: number } | undefined;

  constructor(cfg: HttpTransportConfig) {
    this.jar = cfg.jar;
    this.jarPath = cfg.jarPath;
    this.fetchFn = cfg.fetchFn ?? fetch;
    this.saveFn = cfg.saveFn ?? saveJar;
    this.baseUrl = cfg.baseUrl ?? DEFAULT_BASE;
  }

  requireAuthentication(): void {
    if (!hasValidAuth(this.jar, new URL(this.baseUrl).hostname)) {
      throw new MarqueeError('auth_expired', 'Not authenticated. Run: marquee auth login');
    }
  }

  async request(path: string, init: HttpRequestInit = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    appendQuery(url, init.query);
    const deadline = armRequestDeadline(init);
    try {
      return await this.send({ url, path, init, signal: deadline.signal });
    } catch (e) {
      throw e instanceof MarqueeError
        ? e
        : deadline.abortError(e, path, 'Request') ?? this.networkError(e, url, path);
    } finally {
      deadline.dispose();
    }
  }

  private async send(request: DirectRequest): Promise<unknown> {
    const { url, init, signal } = request;
    if (isDvRenderPost(url, init) && !this.currentAccessToken()) {
      await this.exchangeAccessToken(signal);
    }

    const headers = this.buildHeaders(url, init);
    const fetchInit: RequestInit = {
      method: init.method ?? 'GET',
      headers,
      signal,
    };
    if (init.redirect === 'manual') {
      fetchInit.redirect = 'manual';
    }
    if (init.body !== undefined) {
      fetchInit.body = JSON.stringify(init.body);
    }

    let response = await this.fetchAndPersist(url, fetchInit);
    const redirect = manualRedirect(init, response);
    if (redirect) return absoluteRedirect(redirect, url);
    if (response.status === 401 && init.retry !== false && !isResearchRealmRequest(url)) {
      const exchanged = await this.exchangeAccessToken(signal);
      if (exchanged) {
        headers.Authorization = `Bearer ${exchanged}`;
        response = await this.fetchAndPersist(url, fetchInit);
      }
    }
    let htmlBody = response.ok
      ? await htmlBodyIfPresent(bodySource(response, init), signal)
      : undefined;
    const retryAttempted = classifyResponse({
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: htmlBody,
      expected: expectedResponseKind(init),
      retryEligible: init.retry !== false && responseIsRetryableApiHtml(url, init.method ?? 'GET'),
      retryAttempted: false,
    }).outcome === 'retry';
    if (retryAttempted) {
      response = await this.fetchAndPersist(url, fetchInit);
      htmlBody = undefined;
    }
    if (response.status === 401) {
      await throwUnauthorized(response, request, retryAttempted);
    }
    if (!response.ok) {
      await throwHttpStatus(response, request);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      await assertHtmlAccepted(response, request, { htmlBody, retryAttempted });
    }
    assertExpectedContentType(init.expectedContentType, contentType, response.status, request.path);
    return readResponseBody(response, init, (text) => nonJsonError(response, request, { contentType, text, retryAttempted }));
  }

  private async fetchAndPersist(url: URL, fetchInit: RequestInit): Promise<Response> {
    const response = await this.fetchFn(url.toString(), fetchInit);
    this.persistCookies(url, response);
    return response;
  }

  private networkError(e: unknown, url: URL, path: string): MarqueeError {
    const dnsDiagnostic = url.hostname === MARQUEE_HOST
      ? noProxyDnsDiagnostic(MARQUEE_HOST, e)
      : undefined;
    if (dnsDiagnostic) {
      return new MarqueeError('network', dnsDiagnostic, { path });
    }
    return new MarqueeError('network', `Cannot reach ${this.baseUrl}: ${(e as Error).message}`, { path });
  }

  private buildHeaders(url: URL, init: HttpRequestInit): Record<string, string> {
    const isResearchRealm = isResearchRealmRequest(url);
    const headers: Record<string, string> = {
      Origin: this.baseUrl,
      Referer: isResearchRealm
        ? `${this.baseUrl}/content/research/site/search.html`
        : `${this.baseUrl}/s/marketview/`,
      Accept: 'application/json',
      'Accept-Language': BROWSER_ACCEPT_LANGUAGE,
      'User-Agent': BROWSER_USER_AGENT,
      'X-Dash-AppId': dashAppId(url, init),
      'X-Application': 'mqda-mv',
      'X-Flatten-Status': 'true',
    };
    const cookieHeader = cookieHeaderForRequest(this.jar, url);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    // The research realm (advanced-search, GIR downloads) is authorized by
    // the Marquee session cookies alone. The MarketView
    // id-token/access-token bearer is rejected there (401), so never attach it.
    const authentication = isResearchRealm
      ? { source: 'none' as const, value: undefined }
      : this.authTokenForRequest(url);
    if (authentication.value) {
      headers.Authorization = `Bearer ${authentication.value}`;
    }

    if (url.pathname.startsWith('/v1/')) {
      const csrfToken = csrfHeader(this.jar, url);
      if (csrfToken) {
        headers['X-MARQUEE-CSRF-TOKEN'] = csrfToken;
      }
    }
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json;charset=utf-8';
    }
    return init.headers ? { ...headers, ...init.headers } : headers;
  }

  private authTokenForRequest(url: URL): { source: AuthSource; value?: string } {
    const accessToken = this.currentAccessToken();
    if (accessToken) return { source: 'accessToken', value: accessToken };
    const idToken = cookieValue(this.jar, url, 'MarqueeIdToken');
    if (idToken) return { source: 'MarqueeIdToken', value: idToken };
    return { source: 'none' };
  }

  private currentAccessToken(): string | undefined {
    if (!this.accessToken) return undefined;
    if (this.accessToken.expiresAt <= Date.now()) {
      this.accessToken = undefined;
      return undefined;
    }
    return this.accessToken.value;
  }

  private async exchangeAccessToken(signal: AbortSignal): Promise<string | undefined> {
    const url = new URL('/tokenExchange', this.baseUrl);
    const idToken = cookieValue(this.jar, url, 'MarqueeIdToken');
    if (!idToken) {
      return undefined;
    }
    const headers: Record<string, string> = {
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/s/`,
      Accept: 'application/json',
      'Accept-Language': BROWSER_ACCEPT_LANGUAGE,
      'User-Agent': BROWSER_USER_AGENT,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
    const cookieHeader = cookieHeaderForRequest(this.jar, url);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    const csrfToken = csrfHeader(this.jar, url);
    if (csrfToken) {
      headers['X-MARQUEE-CSRF-TOKEN'] = csrfToken;
    }
    const response = await this.fetchFn(url.toString(), { method: 'POST', headers, signal });
    this.persistCookies(url, response);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      await safeReadBody(response);
      return undefined;
    }

    if (contentType.includes('text/html')) {
      // A successful HTTP response can still contain a login shell.
      return undefined;
    }
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(text) as { accessToken?: unknown; expiryInMillis?: unknown };
      if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) {
        return undefined;
      }
      const ttl = typeof parsed.expiryInMillis === 'number' && Number.isFinite(parsed.expiryInMillis)
        ? Math.max(0, parsed.expiryInMillis - 30_000)
        : 240_000;
      this.accessToken = {
        value: parsed.accessToken,
        expiresAt: Date.now() + ttl,
      };
      return parsed.accessToken;
    } catch {
      return undefined;
    }
  }

  private persistCookies(url: URL, response: Response): void {
    const cookiesBefore = JSON.stringify(this.jar.cookies);
    setFromResponse(this.jar, url, response);
    if (JSON.stringify(this.jar.cookies) !== cookiesBefore || response.headers.has('set-cookie')) {
      try {
        this.saveFn(this.jarPath, this.jar);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new MarqueeError('persistence', `Failed to persist cookie jar ${this.jarPath}: ${message}`, {
          path: url.pathname,
          jarPath: this.jarPath,
        });
      }
    }
  }
}

function bodySource(response: Response, init: HttpRequestInit): Response {
  return init.isHtmlAccepted ? response.clone() : response;
}

function absoluteRedirect(redirect: RedirectResult, url: URL): RedirectResult {
  return { ...redirect, location: new URL(redirect.location, url).toString() };
}

async function throwUnauthorized(
  response: Response,
  { url, path, init }: DirectRequest,
  retryAttempted: boolean,
): Promise<never> {
  // Read the 401 body while the request timer is still armed, so a stalled
  // body stream is bounded by the request deadline. The body is
  // the only signal that separates a genuine auth failure from an app-level
  // entity-resolution error that Marquee mis-statuses as 401. Surface
  // the real error instead of sending the user to re-login for a problem that
  // is not theirs.
  const body = await safeReadBody(response);
  const isDvRender = isDvRenderPost(url, init);
  const classification = classifyResponse({
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body,
    expected: expectedResponseKind(init),
    retryEligible: false,
    retryAttempted,
  });
  if (classification.outcome === 'upstream_http') {
    throw new MarqueeError('http', `Marquee returned 401 for ${path}`, {
      status: 401,
      path,
      body,
      responseClassification: classification.provenance,
    });
  }
  const details = {
    status: 401,
    path,
    responseClassification: classification.provenance,
    ...(isDvRender && body ? { body } : {}),
  };
  const suffix = isDvRender ? dvRender401Suffix(body) : '';
  throw new MarqueeError('auth_expired', `Not authenticated. Run: marquee auth login${suffix}`, details);
}

function dvRender401Suffix(body: string): string {
  return body.length > 0 ? ` — ${body.slice(0, 300)}` : ' — (empty 401 body)';
}

async function throwHttpStatus(
  response: Response,
  { path, signal, init }: DirectRequest,
): Promise<never> {
  const body = await readFailureBody(response, signal, init.isErrorBodyPreserved);
  const retryAfter = response.status === 429 ? retryAfterMs(response.headers.get('retry-after')) : undefined;
  throw new MarqueeError('http', `Marquee returned ${response.status} for ${path}`, {
    status: response.status,
    ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
    path,
    body,
    responseClassification: 'http_status',
  });
}

async function assertHtmlAccepted(
  response: Response,
  { url, path, init, signal }: DirectRequest,
  prior: { htmlBody: string | undefined; retryAttempted: boolean },
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? '';
  const htmlBody = prior.htmlBody ?? await readFailureBody(bodySource(response, init), signal);
  const classification = classifyResponse({
    status: response.status,
    contentType,
    body: htmlBody,
    expected: expectedResponseKind(init),
    retryEligible: init.retry !== false && responseIsRetryableApiHtml(url, init.method ?? 'GET'),
    retryAttempted: prior.retryAttempted,
  });
  const details = {
    status: response.status,
    path,
    contentType,
    body: htmlBody.slice(0, 256),
    responseClassification: classification.provenance,
  };
  if (classification.outcome === 'upstream_http') {
    throw new MarqueeError('http', `Unexpected HTML response for ${path}`, details);
  }
  if (classification.outcome === 'auth_expired') {
    throw new MarqueeError('auth_expired', `Access denied or session expired for ${path}. Run: marquee auth login`, details);
  }
}

function nonJsonError(
  response: Response,
  { path, init }: DirectRequest,
  body: { contentType: string; text: string; retryAttempted: boolean },
): Error {
  const classification = classifyResponse({
    status: response.status,
    contentType: body.contentType,
    body: body.text,
    expected: expectedResponseKind(init),
    retryEligible: false,
    retryAttempted: body.retryAttempted,
    parseFailed: true,
  });
  if (classification.outcome !== 'malformed') {
    return new Error(`Unexpected response classification: ${classification.outcome}`);
  }
  return new MarqueeError('http', `Unexpected non-JSON response for ${path}`, {
    status: response.status,
    path,
    body: body.text.slice(0, 256),
    responseClassification: classification.provenance,
  });
}

async function safeReadBody(res: Response): Promise<string> {
  return readBody(res, 'preserve-classification');
}

async function readFailureBody(res: Response, signal: AbortSignal, isErrorBodyPreserved = false): Promise<string> {
  return readBody(res, 'propagate-abort', signal, isErrorBodyPreserved);
}

async function readBody(
  res: Response,
  abortPolicy: 'preserve-classification' | 'propagate-abort',
  signal?: AbortSignal,
  isErrorBodyPreserved = false,
): Promise<string> {
  try {
    const text = await res.text();
    return isErrorBodyPreserved ? text : text.slice(0, 1024);
  } catch (error) {
    if (abortPolicy === 'propagate-abort') {
      if ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError') {
        throw error;
      }
      if (signal?.aborted) {
        const abortError = new Error(error instanceof Error ? error.message : String(error));
        abortError.name = 'AbortError';
        throw abortError;
      }
    }
    return '';
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

async function htmlBodyIfPresent(response: Response, signal: AbortSignal): Promise<string | undefined> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return undefined;
  return readFailureBody(response, signal);
}

function responseIsRetryableApiHtml(url: URL, method: string): boolean {
  return method === 'GET' && url.pathname.startsWith('/v1/');
}

function expectedResponseKind(init: HttpRequestInit): ExpectedResponseKind {
  if (init.isHtmlAccepted) return 'html';
  return init.responseType ?? 'json';
}

function classifyResponse(input: ResponseClassificationInput): ResponseClassification {
  if (input.parseFailed) {
    return { outcome: 'malformed', provenance: 'non_json' };
  }
  if (input.status === 401) {
    return classifyUnauthorizedResponse(input);
  }
  if (input.status < 200 || input.status >= 300) {
    return { outcome: 'upstream_http', provenance: 'http_status' };
  }
  if (!input.contentType.includes('text/html')) {
    return { outcome: 'success', provenance: 'ordinary' };
  }

  return classifyHtmlResponse(input);
}

function classifyUnauthorizedResponse(input: ResponseClassificationInput): ResponseClassification {
  const body = input.body ?? '';
  const upstream = upstreamUnauthorizedClassification(body);
  if (upstream) return { outcome: 'upstream_http', provenance: upstream };
  if (!input.contentType.includes('text/html')) {
    return { outcome: 'auth_expired', provenance: 'http_401' };
  }

  const loginHtml = input.expected === 'html'
    ? looksLikeLoginHtml(body)
    : looksLikeApiLoginHtml(body);
  if (loginHtml) {
    return { outcome: 'auth_expired', provenance: 'login_html' };
  }
  const gatewayHtml = looksLikeGatewayHtml(
    input.expected === 'html' ? acceptedHtmlShell(body) : body,
  );
  if (gatewayHtml) {
    return { outcome: 'upstream_http', provenance: 'gateway_html' };
  }
  return { outcome: 'auth_expired', provenance: 'http_401' };
}

function classifyHtmlResponse(input: {
  body?: string | undefined;
  expected: ExpectedResponseKind;
  retryEligible: boolean;
  retryAttempted: boolean;
}): ResponseClassification {
  const body = input.body ?? '';
  const loginHtml = input.expected === 'html'
    ? looksLikeLoginHtml(body)
    : looksLikeApiLoginHtml(body);
  if (loginHtml) {
    return { outcome: 'auth_expired', provenance: 'login_html' };
  }

  const gatewayHtml = looksLikeGatewayHtml(
    input.expected === 'html' ? acceptedHtmlShell(body) : body,
  );
  if (gatewayHtml) {
    return input.retryEligible && !input.retryAttempted
      ? { outcome: 'retry', provenance: 'gateway_html' }
      : { outcome: 'upstream_http', provenance: 'gateway_html' };
  }
  if (input.expected === 'html') {
    return { outcome: 'success', provenance: 'accepted_html' };
  }
  if (input.retryEligible && !input.retryAttempted) {
    return { outcome: 'retry', provenance: 'generic_html' };
  }
  return { outcome: 'upstream_http', provenance: 'generic_html' };
}

function looksLikeGatewayHtml(body: string): boolean {
  const text = htmlText(body);
  return /\b(?:access denied|akamai|bad gateway|gateway timeout|proxy error)\b|\bupstream\b[^.]{0,100}\bunavailable\b|\breference\s+#\S+/i.test(text);
}

function acceptedHtmlShell(body: string): string {
  const ranges = semanticArticleRanges(body);
  if (ranges.length === 0) return body;
  const semanticSegments = ranges.map((range) => body.slice(range.innerStart, range.innerEnd));
  if (looksLikeSparseSemanticArticleShell(semanticSegments)) return body;
  // Gateway markers in research prose (or the document title) describe the
  // article; only the surrounding page shell is transport evidence.
  return stripSemanticArticleRanges(body, ranges)
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, ' ');
}

function looksLikeApiLoginHtml(body: string): boolean {
  return (
    /<input\b[^>]*type\s*=\s*['"]?password\b/i.test(body) ||
    /<form\b[^>]*(?:login|sign[- ]?in|sso|saml|oauth|idfs)/i.test(body) ||
    /<(?:form|input)\b[\s\S]{0,500}\b(?:username|password|pf\.username|pf\.pass)\b/i.test(body) ||
    looksLikeShortAuthShell(body)
  );
}

function looksLikeLoginHtml(body: string): boolean {
  const text = htmlText(body);
  if (/<input\b[^>]*type\s*=\s*['"]?password\b/i.test(body)) {
    return true;
  }
  if (/<form\b[^>]*(?:login|sign[- ]?in|sso|saml|oauth|idfs)/i.test(body)) {
    return true;
  }
  if (/<(?:form|input)\b[\s\S]{0,500}\b(?:username|password|pf\.username|pf\.pass)\b/i.test(body)) {
    return true;
  }

  if (
    !/\b(login|sign[- ]?in|sso|saml|oauth|idfs|session (?:has )?expired|access denied)\b/i.test(body) &&
    !/\b(login|sign[- ]?in|sso|saml|oauth|idfs|session (?:has )?expired|access denied)\b/i.test(text)
  ) {
    return false;
  }

  let shellHtml = body;
  const semanticRanges = semanticArticleRanges(body);
  const semanticSegments = semanticRanges.map((range) => body.slice(range.innerStart, range.innerEnd));
  if (semanticSegments.length > 0) {
    if (looksLikeSemanticArticleAuthShell(semanticSegments)) {
      return true;
    }
    if (!looksLikeSparseSemanticArticleShell(semanticSegments)) {
      shellHtml = stripSemanticArticleRanges(body, semanticRanges);
    }
  }
  return looksLikeShortAuthShell(shellHtml);
}

function htmlText(body: string): string {
  return body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|\x23160|\x23x0*a0);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface SemanticArticleRange {
  outerStart: number;
  outerEnd: number;
  innerStart: number;
  innerEnd: number;
}

function semanticArticleRanges(body: string): SemanticArticleRange[] {
  const ranges: SemanticArticleRange[] = [];
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(body)) !== null) {
    if (!isSemanticArticleOpenTag(match[0])) {
      continue;
    }

    const outerStart = match.index;
    const innerStart = tagPattern.lastIndex;
    const close = matchingCloseTag(body, tagPattern, requiredGroup(match, 1).toLowerCase());
    ranges.push({
      outerStart,
      outerEnd: close?.outerEnd ?? body.length,
      innerStart,
      innerEnd: close?.innerEnd ?? body.length,
    });
    if (!close) {
      break;
    }
  }
  return ranges;
}

function isSemanticArticleOpenTag(tag: string): boolean {
  return !tag.startsWith('</') && !isSelfClosingTag(tag) && (/^<article\b/i.test(tag) || hasChapterTestId(tag));
}

// Advances tagPattern past the close tag balancing an already-consumed open tag.
function matchingCloseTag(
  body: string,
  tagPattern: RegExp,
  tagName: string,
): { innerEnd: number; outerEnd: number } | undefined {
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(body)) !== null) {
    const tag = match[0];
    if (requiredGroup(match, 1).toLowerCase() !== tagName) continue;
    if (!tag.startsWith('</')) {
      if (!isSelfClosingTag(tag)) depth += 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return { innerEnd: match.index, outerEnd: tagPattern.lastIndex };
    }
  }
  return undefined;
}

function stripSemanticArticleRanges(body: string, ranges: SemanticArticleRange[]): string {
  let stripped = body;
  for (const range of [...ranges].reverse()) {
    stripped = `${stripped.slice(0, range.outerStart)} ${stripped.slice(range.outerEnd)}`;
  }
  return stripped;
}

function isSelfClosingTag(tag: string): boolean {
  return /\/\s*>$/.test(tag) || /^<\s*(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(tag);
}

function hasChapterTestId(tag: string): boolean {
  return /\sdata-testid\s*=\s*(?:"Chapter"|'Chapter'|Chapter)(?:\s|>|\/)/i.test(tag);
}

function looksLikeSemanticArticleAuthShell(segments: string[]): boolean {
  for (const segment of segments) {
    if (hasAuthHeading(segment)) {
      return true;
    }
    if (hasAuthPromptElement(segment)) {
      return true;
    }
    if (htmlText(segment).length <= 120 && looksLikeShortAuthShell(segment)) {
      return true;
    }
  }
  return false;
}

function looksLikeSparseSemanticArticleShell(segments: string[]): boolean {
  for (const segment of segments) {
    if (htmlText(segment).length > 80) {
      return false;
    }
  }
  return true;
}

function hasAuthHeading(html: string): boolean {
  for (const match of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    if (looksLikeAuthPrompt(htmlText(match[1] ?? ''))) {
      return true;
    }
  }
  return false;
}

function hasAuthPromptElement(html: string): boolean {
  const unquotedHtml = html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, ' ');
  for (const match of unquotedHtml.matchAll(/<(p|li|button|a|span|label)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (looksLikeAuthPrompt(htmlText(match[2] ?? ''))) {
      return true;
    }
  }
  for (const match of unquotedHtml.matchAll(/<(div|section)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const segment = htmlText(match[2] ?? '');
    if (segment.length <= 240 && looksLikeAuthPrompt(segment)) {
      return true;
    }
  }
  return false;
}

function looksLikeShortAuthShell(html: string): boolean {
  const text = htmlText(html);
  if (!/\b(login|sign[- ]?in|sso|saml|oauth|idfs|session (?:has )?expired|access denied)\b/i.test(text)) {
    return false;
  }
  for (const match of html.matchAll(/<(title|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tagName = match[1]?.toLowerCase();
    const segment = htmlText(match[2] ?? '');
    if (looksLikeAuthPrompt(segment) || (tagName === 'title' && looksLikeBrandedAuthTitle(segment))) {
      return true;
    }
  }
  for (const match of html.matchAll(/<(p|li|button|a|span|label)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (looksLikeAuthPrompt(htmlText(match[2] ?? ''))) {
      return true;
    }
  }
  for (const match of html.matchAll(/<(div|section)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const segment = htmlText(match[2] ?? '');
    if (segment.length <= 240 && looksLikeAuthPrompt(segment)) {
      return true;
    }
  }
  if (text.length > 240) {
    return false;
  }
  if (looksLikeAuthPrompt(text)) {
    return true;
  }
  return false;
}

function looksLikeAuthPrompt(text: string): boolean {
  const prompt = text.replace(/[.!?]+$/g, '').trim();
  if (/^(?:your\s+)?session\s+(?:has\s+)?expired(?:[.!?]*\s*(?:(?:please\s+)?(?:login|sign[- ]?in)(?:\s+again)?|contact\s+your\s+administrator))?$/i.test(prompt)) {
    return true;
  }
  if (/^(?:your\s+)?access\s+denied[.!?]*\s*(?:please\s+)?(?:login|sign[- ]?in)(?:\s+again)?$/i.test(prompt)) {
    return true;
  }
  return /^(?:please\s+)?(?:login(?:\s+(?:to\s+(?:continue|proceed)|again))?|sign[- ]?in(?:\s+(?:with|using)\s+(?:sso|saml|oauth|idfs|single sign[- ]?on))?(?:\s+(?:to\s+(?:continue|proceed)|again))?|(?:sso|saml|oauth|idfs)\s+login|idfs)$/i.test(prompt);
}

function looksLikeBrandedAuthTitle(text: string): boolean {
  const title = text.replace(/[.!?]+$/g, '').trim();
  return /^(?:goldman\s+sachs|goldmansachs|gs|marquee)(?:\s*[-:]\s*|\s+)(?:idfs|sso|login|sign[- ]?in)(?:\s+login)?$/i.test(title);
}

function csrfHeader(jar: CookieJar, url: URL): string | undefined {
  const raw = cookieValue(jar, url, 'MARQUEE-CSRF-TOKEN');
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function isCookieOnlyResearchDownload(url: URL): boolean {
  return url.pathname.startsWith('/content/research/');
}

function cookieHeaderForRequest(jar: CookieJar, url: URL): string {
  return buildCookieHeader(jar, url, {
    include: (cookie) => isResearchRealmRequest(url) || !isResearchRealmCookie(cookie),
  });
}

function isResearchRealmRequest(url: URL): boolean {
  return url.pathname.startsWith('/research/') || isCookieOnlyResearchDownload(url);
}

function isResearchRealmCookie(cookie: Cookie): boolean {
  return RESEARCH_REALM_COOKIE_NAMES.has(cookie.name);
}

function dashAppId(url: URL, init: HttpRequestInit): string {
  const method = init.method ?? 'GET';
  const isDashboardMutation = (
    url.pathname.startsWith('/v1/marketview/dashboards') &&
    !url.pathname.endsWith('/children') &&
    (method === 'POST' || method === 'PUT' || method === 'DELETE')
  );
  return isDashboardMutation ? 'MQSITE' : 'MarketView';
}

function isDvRenderPost(url: URL, init: HttpRequestInit): boolean {
  return (
    (init.method ?? 'GET') === 'POST' &&
    url.pathname.startsWith('/v1/data/visualizations/') &&
    url.pathname.endsWith('/render')
  );
}

function cookieValue(jar: CookieJar, url: URL, name: string): string | undefined {
  const matches = jar.cookies.filter((cookie) => (
    cookie.name === name &&
    domainMatches(cookie.domain, url.hostname) &&
    pathMatches(cookie.path || '/', url.pathname)
  ));
  return (
    matches.find((cookie) => cookie.domain === url.hostname)?.value ||
    matches[0]?.value
  );
}

function domainMatches(cookieDomain: string, host: string): boolean {
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return host === normalized || host.endsWith(`.${normalized}`);
}

function pathMatches(cookiePath: string, urlPath: string): boolean {
  return urlPath === cookiePath || urlPath.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
}
