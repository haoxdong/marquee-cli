import type {
  AuthEvidence,
  AuthIdentity,
  AuthResult,
  AuthStatus,
} from './types.js';

export type MarqueeRealmStatus =
  | Readonly<{ state: 'authenticated'; identity: AuthIdentity }>
  | Readonly<{ state: 'unauthenticated' | 'link-expired' }>;
type ResearchRealmStatus = 'authenticated' | 'session-expired';

export type AuthOperationOutcome<T> = Readonly<{
  result: AuthResult<T>;
  evidence: readonly AuthEvidence[];
}>;

type ResolvedAuthLoginInput = Readonly<{
  url?: string;
  username?: string;
  passwordStdin?: string;
}>;

export type AuthProfile = Readonly<{
  url: string;
  username?: string;
  passwordStdin?: string;
}>;

export interface AuthPort {
  checkLoginBrowser(): Promise<AuthResult<void>>;
  resolveLoginCredentials(input: Readonly<{
    username?: string;
    passwordStdin?: string;
  }>): Promise<AuthResult<Readonly<{
    username: string;
    password: string;
  }> | null>>;
  openLoginBrowser(credentials: Readonly<{
    username: string;
    password: string;
  }> | null): Promise<AuthResult<void>>;
  captureLoginState(): Promise<AuthResult<void>>;
  cleanupLogin(): Promise<AuthResult<void>>;
  publishLogin(): Promise<AuthResult<void>>;
  discardLogin(): Promise<AuthResult<void>>;
  inspectMarqueeRealm(): Promise<AuthOperationOutcome<MarqueeRealmStatus>>;
  inspectResearchRealm(): Promise<AuthOperationOutcome<ResearchRealmStatus>>;
  saveProfile(profile: AuthProfile): Promise<AuthResult<void>>;
  clearSession(): Promise<AuthResult<void>>;
}

export interface AuthOperations {
  login(
    input?: ResolvedAuthLoginInput,
    onProgress?: (mode: 'saved' | 'manual') => void,
  ): Promise<AuthOperationOutcome<void>>;
  status(): Promise<AuthOperationOutcome<AuthStatus>>;
  logout(): Promise<AuthOperationOutcome<void>>;
}

const DEFAULT_PROFILE_URL = 'https://marquee.gs.com/s/';

export function createAuth(port: AuthPort): AuthOperations {
  return Object.freeze({
    async login(
      input: ResolvedAuthLoginInput = {},
      onProgress?: (mode: 'saved' | 'manual') => void,
    ): Promise<AuthOperationOutcome<void>> {
      const browser = await port.checkLoginBrowser();
      if (!browser.ok) return outcome(browser);

      const saved = await saveLoginProfile(port, input);
      if (!saved.ok) return outcome(saved);

      const { url: _url, ...credentialInput } = input;
      const credentials = await port.resolveLoginCredentials(credentialInput);
      if (!credentials.ok) return outcome(credentials);
      onProgress?.(credentials.value ? 'saved' : 'manual');

      const steps = [
        () => port.openLoginBrowser(credentials.value),
        () => port.captureLoginState(),
      ];
      for (const step of steps) {
        // eslint-disable-next-line no-await-in-loop -- each login step needs the previous one to have succeeded
        const result = await step();
        if (!result.ok) return abortLogin(port, result);
      }

      const cleanup = await port.cleanupLogin();
      if (!cleanup.ok) return abortLogin(port, cleanup, false);

      const publication = await port.publishLogin();
      if (!publication.ok) return abortLogin(port, publication, false);
      return outcome({ ok: true, value: undefined });
    },
    async status(): Promise<AuthOperationOutcome<AuthStatus>> {
      const [marquee, research] = await Promise.all([
        port.inspectMarqueeRealm(),
        port.inspectResearchRealm(),
      ]);
      const evidence = [...marquee.evidence, ...research.evidence];
      if (!marquee.result.ok) return outcome(marquee.result, evidence);
      if (!research.result.ok) return outcome(research.result, evidence);
      const realm = marquee.result.value;
      if (realm.state === 'authenticated' && research.result.value === 'authenticated') {
        return outcome({ ok: true, value: { state: 'signed-in', identity: realm.identity } }, evidence);
      }
      return outcome(
        { ok: true, value: { state: 'expired', isRelinkRequired: realm.state === 'link-expired' } },
        evidence,
      );
    },
    logout: async () => outcome(await port.clearSession()),
  });
}

/** `--url` or `--username` on login stores the SSO profile first. */
async function saveLoginProfile(
  port: AuthPort,
  { url, ...profile }: ResolvedAuthLoginInput,
): Promise<AuthResult<void>> {
  if (url === undefined && profile.username === undefined) return { ok: true, value: undefined };
  return port.saveProfile({ url: url ?? DEFAULT_PROFILE_URL, ...profile });
}

async function abortLogin(
  port: AuthPort,
  failure: Extract<AuthResult<void>, { ok: false }>,
  cleanupBrowser = true,
): Promise<AuthOperationOutcome<void>> {
  if (cleanupBrowser) {
    const cleanup = await port.cleanupLogin();
    if (!cleanup.ok) return outcome(cleanup);
  }
  const discard = await port.discardLogin();
  if (!discard.ok) return outcome(discard);
  return outcome(failure);
}

function outcome<T>(
  result: AuthResult<T>,
  evidence: readonly AuthEvidence[] = [],
): AuthOperationOutcome<T> {
  return Object.freeze({ result, evidence: Object.freeze([...evidence]) });
}
