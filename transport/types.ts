import type { Tagged } from 'type-fest';

export type MarqueeErrorCode =
  | 'auth_expired'
  | 'auth_login_failed'
  | 'http'
  | 'network'
  | 'persistence'
  | 'timeout'
  | 'adapter'
  | 'config';

// One Marquee endpoint request, defined by its client in the API Client layer (ADR 0072).
export type Endpoint = Tagged<Readonly<{ method: string; path: string }>, 'Endpoint'>;

export interface HttpRequestInit {
  headers?: Record<string, string>;
  method?: string;
  query?: Record<string, unknown>;
  responseType?: 'json' | 'text' | 'arrayBuffer';
  // Raw API output preserves ordinary HTTP-status bodies; classification probes keep their previews.
  isErrorBodyPreserved?: boolean;
  expectedContentType?: string;
  body?: unknown;
  rawBody?: string;
  /** Zero waits for the server without a client deadline; omitted uses the transport default. */
  timeoutMs?: number;
  retry?: false;
  signal?: AbortSignal | undefined;
  isHtmlAccepted?: boolean;
  redirect?: 'manual';
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

export interface CookieJar {
  cookies: Cookie[];
  updatedAt: number;
}

type RecordingNaming = 'hash' | 'readable';

type AuthRealm = 'marquee' | 'research';

interface ProviderEvidenceReservation {
  succeed(value?: unknown): void;
  fail(value?: unknown): void;
  cancel(value?: unknown): void;
}

interface ProviderRequestEvidence {
  reserve(
    call: Readonly<{ owner: string; operation: string }>,
    signal?: AbortSignal,
  ): ProviderEvidenceReservation | undefined;
}

interface ProviderRequester {
  request(target: Endpoint, init?: HttpRequestInit): Promise<unknown>;
}

interface RedirectResult {
  redirected: 'manual';
  status: number;
  location: string;
}

export type DependencyFailure =
  | { kind: 'authentication-required'; realm: AuthRealm }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'timeout' }
  /** `status` and `message` when Marquee answered: its status and its message as it sent it (ADR 0030). */
  | { kind: 'unavailable'; status?: number; message?: string }
  | { kind: 'cancelled' };

export interface Transport {
  request(target: Endpoint, init?: HttpRequestInit): Promise<unknown>;
  requireAuthentication(): void;
  provider(options: Readonly<{
    owner: string;
    evidence?: ProviderRequestEvidence;
  }>): ProviderRequester;
  browserAuthenticationCookies(): readonly Cookie[] | undefined;
  isRedirect(value: unknown): value is RedirectResult;
}

type ManagedDirectTransportConfig = Readonly<{
  execution: 'direct';
  authentication: Readonly<{
    cookieJarPath: string;
    jar?: CookieJar;
    required?: boolean;
    persistCookies?: boolean;
  }>;
  recording?: Readonly<{
    environment?: NodeJS.ProcessEnv;
    processId?: number;
    naming?: RecordingNaming;
    manifestPath?: string | undefined;
    replayFetch?: typeof fetch | undefined;
  }>;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}>;

export type TransportConfig =
  | ManagedDirectTransportConfig
  | Readonly<{
      execution: 'session';
      baseUrl: string;
      sessionToken: string;
      fetchFn?: typeof fetch;
    }>
  | Readonly<{
      execution: 'proxy';
      baseUrl: string;
      accountId: string;
      sessionId: string;
      invocationToken: string;
      fetchFn?: typeof fetch;
    }>;
