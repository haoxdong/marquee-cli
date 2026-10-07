import type { AgentBrowserRuntime } from '../agent-browser-runtime/index.js';
import type { Endpoint, Transport } from '../transport/index.js';

export type AuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthError };

type AuthRealm = 'marquee' | 'research';

type AuthDependencyFailure =
  | { kind: 'authentication-required'; realm: AuthRealm }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'timeout' }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' };

/** Signed in only when MarketView and research both answer (ADR 0070). */
export type AuthStatus =
  | Readonly<{ state: 'signed-in'; identity: AuthIdentity }>
  | Readonly<{ state: 'expired'; isRelinkRequired: boolean }>;

export type AuthError =
  | {
      kind: 'status-realm-failure';
      realm: AuthRealm;
      failure: AuthDependencyFailure;
    }
  | { kind: 'browser-dependency-missing' }
  | { kind: 'saved-profile-failure'; failure: AuthDependencyFailure }
  | { kind: 'saved-profile-unreadable'; cause: unknown }
  | { kind: 'profile-decryption-failure'; cause: unknown }
  | {
      kind: 'login-browser-failure';
      problem: 'launch' | 'interaction';
      failure: AuthDependencyFailure;
    }
  | {
      kind: 'login-input-failure';
      problem: 'password-stdin-required' | 'password-empty';
    }
  | {
      kind: 'login-capture-failure';
      problem: 'empty' | 'read';
      failure: AuthDependencyFailure;
    }
  | { kind: 'login-cancelled' }
  | {
      kind: 'login-realm-failure';
      failure: AuthDependencyFailure;
    }
  | {
      kind: 'login-persistence-failure';
      failure: AuthDependencyFailure;
    }
  | {
      kind: 'login-cleanup-failure';
      failure: AuthDependencyFailure;
    }
  | { kind: 'logout-failure'; failure: AuthDependencyFailure }
  | {
      kind: 'identity-shape-failure';
      problem: 'not-an-object' | 'invalid-field';
    };

export type AuthEvidence = Readonly<{
  method: Endpoint['method'];
  path: string;
  queryKeys: readonly string[];
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
}>;

export type AuthOutcome<T> = Readonly<{
  result: AuthResult<T>;
  evidence: readonly AuthEvidence[];
}>;

export type AuthIdentity = Readonly<{
  username: string | null;
  name: string | null;
  title: string | null;
  division: string | null;
  department: string | null;
  city: string | null;
  country: string | null;
  region: string | null;
}>;

/** `url` or `username` saves the SSO profile before signing in. */
export type AuthLoginInput = Readonly<{
  url?: string;
  username?: string;
  readPasswordStdin?: () => Promise<string>;
}>;

export interface Auth {
  status(): Promise<AuthOutcome<AuthStatus>>;
  login(
    input?: AuthLoginInput,
    onProgress?: (mode: 'saved' | 'manual') => void,
  ): Promise<AuthOutcome<void>>;
  logout(): Promise<AuthOutcome<void>>;
}

export interface AuthConfig {
  cookieJarPath: string;
  transport: Transport;
  runtime?: AgentBrowserRuntime | undefined;
  statePaths?: readonly string[] | undefined;
}
