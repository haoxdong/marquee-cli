import {
  createAgentBrowserRuntime,
  type AgentBrowserRuntime,
} from '../../agent-browser-runtime/index.js';
import { AuthApi } from '../../api/auth/index.js';
import type { DependencyFailure, Endpoint, Transport } from '../../transport/index.js';
import {
  type AuthOperationOutcome,
  type AuthPort,
  type AuthProfile,
  type MarqueeRealmStatus,
} from '../module.js';
import type {
  AuthError,
  AuthEvidence,
  AuthIdentity,
  AuthResult,
} from '../types.js';
import { createProductionAuthLoginPort } from './login.js';

function outcome<T>(
  result: AuthResult<T>,
  evidence: readonly AuthEvidence[] = [],
): AuthOperationOutcome<T> {
  return Object.freeze({ result, evidence: Object.freeze([...evidence]) });
}

// A search in Content search's shape and the v2 media type Web asks for. Its filter matches
// nothing, so the reply carries no facets (an unfiltered one is about 1 MB).
const RESEARCH_SEARCH = {
  filter: '(all EQ ${(zqxjvkwpfhq)}$)',
  sort: 'time',
  page: 1,
  size: 1,
  language: '["en"]',
  limitTo: '[""]',
  applyHighlighting: true,
} as const;
const RESEARCH_SEARCH_HEADERS = {
  Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
  'Content-Type': 'application/json;charset=UTF-8',
} as const;

interface ProductionAuthPortOptions {
  cookieJarPath: string;
  transport: Transport;
  runtime?: AgentBrowserRuntime | undefined;
  statePaths?: readonly string[] | undefined;
}

export function createProductionAuthPort(options: ProductionAuthPortOptions): AuthPort {
  const runtime = options.runtime ?? createAgentBrowserRuntime();
  return {
    ...createProductionAuthLoginPort({
      cookieJarPath: options.cookieJarPath,
      runtime,
      statePaths: options.statePaths,
    }),
    inspectMarqueeRealm: () => inspectMarqueeRealm(options),
    inspectResearchRealm: () => inspectResearchRealm(options),
    saveProfile: (profile) => saveProfile(runtime, profile),
  };
}

async function inspectMarqueeRealm(
  options: ProductionAuthPortOptions,
): Promise<AuthOperationOutcome<MarqueeRealmStatus>> {
  const loaded = await request(options, AuthApi.currentUser, (api) => api.getCurrentUser());
  if (loaded.result.ok) {
    const identity = normalizeIdentity(loaded.result.value);
    return identity.ok
      ? outcome({ ok: true, value: { state: 'authenticated', identity: identity.value } }, loaded.evidence)
      : outcome(identity, loaded.evidence);
  }
  if (!('cause' in loaded)) return statusFailure('marquee', loaded.evidence);
  if (isRelinkRequired(loaded.cause)) {
    return outcome({ ok: true, value: { state: 'link-expired' } }, loaded.evidence);
  }
  if (isAuthenticationFailure(loaded.cause)) {
    return outcome({ ok: true, value: { state: 'unauthenticated' } }, loaded.evidence);
  }
  return statusFailure('marquee', loaded.evidence, dependencyFailure(loaded.cause));
}

async function inspectResearchRealm(
  options: ProductionAuthPortOptions,
): Promise<AuthOperationOutcome<'authenticated' | 'session-expired'>> {
  const loaded = await request(
    options,
    AuthApi.researchSearch,
    (api) => api.searchResearch(RESEARCH_SEARCH),
    RESEARCH_SEARCH_HEADERS,
  );
  if (loaded.result.ok) {
    return isRecord(loaded.result.value)
      ? outcome({ ok: true, value: 'authenticated' }, loaded.evidence)
      : statusFailure('research', loaded.evidence);
  }
  if (!('cause' in loaded)) return statusFailure('research', loaded.evidence);
  if (isAuthenticationFailure(loaded.cause)) {
    return outcome({ ok: true, value: 'session-expired' }, loaded.evidence);
  }
  return statusFailure('research', loaded.evidence, dependencyFailure(loaded.cause));
}

async function saveProfile(
  runtime: AgentBrowserRuntime,
  profile: AuthProfile,
): Promise<AuthResult<void>> {
  const args = ['auth', 'save', 'marquee', '--url', profile.url];
  if (profile.username) args.push('--username', profile.username);
  if (profile.passwordStdin !== undefined) args.push('--password-stdin');
  try {
    await runtime.execute({
      argv: args,
      ...(profile.passwordStdin !== undefined ? { stdin: profile.passwordStdin } : {}),
    });
    return { ok: true, value: undefined };
  } catch (cause) {
    return { ok: false, error: saveProfileError(cause) };
  }
}

function saveProfileError(cause: unknown): AuthError {
  if (isMissingBrowserDependency(cause)) return { kind: 'browser-dependency-missing' };
  const message = errorMessage(cause).toLowerCase();
  if (message.includes('decrypt') || message.includes('encryption')) {
    return { kind: 'profile-decryption-failure', cause };
  }
  return { kind: 'saved-profile-failure', failure: dependencyFailure(cause) };
}

function normalizeIdentity(raw: unknown): AuthResult<AuthIdentity> {
  if (!isRecord(raw)) {
    return { ok: false, error: { kind: 'identity-shape-failure', problem: 'not-an-object' } };
  }
  const fields = [
    'login', 'firstName', 'lastName', 'name', 'title', 'divisionName', 'departmentName',
    'city', 'country', 'region',
  ] as const;
  if (fields.some((field) => raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string')) {
    return { ok: false, error: { kind: 'identity-shape-failure', problem: 'invalid-field' } };
  }
  const firstName = stringField(raw.firstName);
  const lastName = stringField(raw.lastName);
  return {
    ok: true,
    value: {
      username: stringField(raw.login) ?? null,
      name: firstName && lastName
        ? `${firstName} ${lastName}`
        : stringField(raw.name) ?? null,
      title: stringField(raw.title) ?? null,
      division: stringField(raw.divisionName) ?? null,
      department: stringField(raw.departmentName) ?? null,
      city: stringField(raw.city) ?? null,
      country: stringField(raw.country) ?? null,
      region: stringField(raw.region) ?? null,
    },
  };
}

type RequestAttempt =
  | { result: { ok: true; value: unknown }; evidence: readonly AuthEvidence[] }
  | { result: { ok: false }; cause: unknown; evidence: readonly AuthEvidence[] };

async function request(
  options: ProductionAuthPortOptions,
  endpoint: Endpoint,
  send: (api: AuthApi) => Promise<unknown>,
  headers?: Readonly<Record<string, string>>,
): Promise<RequestAttempt> {
  try {
    options.transport.requireAuthentication();
  } catch (cause) {
    return { result: { ok: false }, cause, evidence: [] };
  }
  const startMs = Math.round(performance.now());
  try {
    const value = await send(new AuthApi({
      request: (sent, init) => options.transport.request(sent, headers ? { ...init, headers } : init),
    }));
    return {
      result: { ok: true, value },
      evidence: [requestEvidence(endpoint, startMs, 'ok')],
    };
  } catch (cause) {
    return {
      result: { ok: false },
      cause,
      evidence: [requestEvidence(endpoint, startMs, 'error')],
    };
  }
}

function requestEvidence(
  { method, path }: Endpoint,
  startMs: number,
  status: 'ok' | 'error',
): AuthEvidence {
  return {
    method,
    path,
    queryKeys: [],
    startMs,
    durationMs: Math.round(performance.now()) - startMs,
    status,
  };
}

function statusFailure<T>(
  realm: 'marquee' | 'research',
  evidence: readonly AuthEvidence[] = [],
  failure: DependencyFailure = { kind: 'unavailable' },
): AuthOperationOutcome<T> {
  return outcome({ ok: false, error: { kind: 'status-realm-failure', realm, failure } }, evidence);
}

function dependencyFailure(cause: unknown): DependencyFailure {
  const status = errorStatus(cause);
  const code = errorCode(cause);
  if (code === 'auth_expired' || status === 401 || status === 403) {
    return { kind: 'authentication-required', realm: 'marquee' };
  }
  if (code === 'timeout' || /timed? ?out|etimedout/i.test(errorMessage(cause))) {
    return { kind: 'timeout' };
  }
  if (status === 429) return { kind: 'rate-limited' };
  if (isRecord(cause) && isRecord(cause.details) && cause.details.isCanceled === true) {
    return { kind: 'cancelled' };
  }
  return { kind: 'unavailable' };
}

function isAuthenticationFailure(cause: unknown): boolean {
  const status = errorStatus(cause);
  return errorCode(cause) === 'auth_expired' || status === 401 || status === 403;
}

function isRelinkRequired(cause: unknown): boolean {
  return isRecord(cause) && isRecord(cause.details) && cause.details.credentialServiceCode === 'relink_required';
}

function errorStatus(cause: unknown): number | undefined {
  if (!isRecord(cause) || !isRecord(cause.details)) return undefined;
  return typeof cause.details.status === 'number' ? cause.details.status : undefined;
}

function errorCode(cause: unknown): string | undefined {
  return isRecord(cause) && typeof cause.code === 'string' ? cause.code : undefined;
}

function isMissingBrowserDependency(cause: unknown): boolean {
  if (isRecord(cause) && cause.code === 'ENOENT') return true;
  return /agent-browser.+(?:not found|command not found|enoent)/i.test(errorMessage(cause));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
