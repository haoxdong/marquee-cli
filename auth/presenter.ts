import { formatJsonFields, type JsonOutputOptions } from '../presentation/index.js';
import { renderText, type TextBlock } from '../presentation/text.js';
import type {
  AuthError,
  AuthIdentity,
  AuthOutcome,
  AuthStatus,
} from './types.js';

export type AuthPresentation = Readonly<{
  output: string;
  exitCode?: 1 | 4;
}>;

export type AuthStatusPresentation = Readonly<{
  blocks: readonly TextBlock[];
  exitCode?: 1 | 4;
}>;

const MARQUEE_HOST = 'marquee.gs.com';

/** `marquee auth status --json` fields. */
export const AUTH_STATUS_JSON_FIELDS = [
  'department',
  'division',
  'host',
  'location',
  'name',
  'status',
  'title',
  'username',
] as const;

function identityLocation(identity: AuthIdentity): string[] {
  return [identity.city, identity.country, identity.region]
    .filter((part): part is string => part !== null);
}

/** The signed-in status as its text prints it. */
async function presentAuthStatusJson(
  identity: AuthIdentity,
  options: JsonOutputOptions,
): Promise<AuthPresentation> {
  const formatted = await formatJsonFields({
    department: identity.department,
    division: identity.division,
    host: MARQUEE_HOST,
    location: identityLocation(identity),
    name: identity.name,
    status: 'signed in',
    title: identity.title,
    username: identity.username,
  }, options);
  return formatted.ok
    ? { output: formatted.output }
    : { output: `Error: ${formatted.error}`, exitCode: 1 };
}

/** Identity prints only when signed in, so an expired machine shows no one. */
export function presentAuthStatus(outcome: AuthOutcome<AuthStatus>): AuthStatusPresentation {
  if (!outcome.result.ok) {
    const { output, exitCode } = presentAuthError(outcome.result.error);
    return { blocks: [{ type: 'sentence', text: output }], exitCode };
  }
  const status = outcome.result.value;
  if (status.state === 'expired') {
    return {
      blocks: [
        { type: 'field', key: 'status', value: 'expired' },
        { type: 'field', key: 'host', value: MARQUEE_HOST },
        status.isRelinkRequired
          ? { type: 'sentence', text: 'Goldman link expired. Re-link Goldman to continue.' }
          : { type: 'hints', hints: [{ action: 'sign in again', command: 'marquee auth login' }] },
      ],
      exitCode: 1,
    };
  }
  const { identity } = status;
  const location = identityLocation(identity);
  return {
    blocks: [
      { type: 'field', key: 'status', value: 'signed in' },
      { type: 'field', key: 'host', value: MARQUEE_HOST },
      { type: 'field', key: 'username', value: identity.username },
      { type: 'field', key: 'name', value: identity.name },
      { type: 'field', key: 'title', value: identity.title },
      { type: 'field', key: 'division', value: identity.division },
      { type: 'field', key: 'department', value: identity.department },
      { type: 'field', key: 'location', value: location },
    ],
  };
}

/** `auth status` output: `--json` fields when signed in, otherwise text. */
export async function presentAuthStatusOutput(
  outcome: AuthOutcome<AuthStatus>,
  options: JsonOutputOptions,
): Promise<AuthPresentation> {
  if (options.json !== undefined && outcome.result.ok && outcome.result.value.state === 'signed-in') {
    return presentAuthStatusJson(outcome.result.value.identity, options);
  }
  const presentation = presentAuthStatus(outcome);
  return {
    output: renderText(presentation.blocks),
    ...(presentation.exitCode === undefined ? {} : { exitCode: presentation.exitCode }),
  };
}

export function presentAuthLogin(outcome: AuthOutcome<void>): AuthPresentation {
  if (outcome.result.ok) return { output: 'Login successful. Session saved.' };
  return presentAuthError(outcome.result.error);
}

export function presentAuthLoginProgress(mode: 'saved' | 'manual'): AuthPresentation {
  return {
    output: mode === 'saved'
      ? 'Opening browser for SSO login...'
      : 'No saved credentials. Opening browser for manual login...',
  };
}

export function presentAuthLogout(outcome: AuthOutcome<void>): AuthPresentation {
  if (outcome.result.ok) return { output: `Logged out of ${MARQUEE_HOST}.` };
  return presentAuthError(outcome.result.error);
}

function presentAuthError(error: AuthError): Required<AuthPresentation> {
  switch (error.kind) {
    case 'status-realm-failure':
      return error.realm === 'research'
        ? { output: 'Research session unavailable. Check network and retry.', exitCode: 1 }
        : { output: 'Auth status unavailable. Check cookie jar and network, then retry.', exitCode: 1 };
    case 'browser-dependency-missing':
      return {
        output: 'agent-browser is not installed or not on PATH. Install agent-browser or add it to PATH, then rerun `marquee auth login`.',
        exitCode: 1,
      };
    case 'login-input-failure':
      return {
        output: error.problem === 'password-empty'
          ? 'Login failed: no password given on stdin'
          : 'Login failed: --password-stdin requires piped input',
        exitCode: 1,
      };
    case 'profile-decryption-failure':
      return { output: 'Error: saved auth profile could not be decrypted.', exitCode: 1 };
    case 'saved-profile-unreadable':
      return { output: 'Error: saved auth profile could not be read.', exitCode: 1 };
    case 'saved-profile-failure':
      return { output: 'Login failed: SSO credentials could not be saved. Try again.', exitCode: 1 };
    case 'login-browser-failure':
      return { output: 'Login failed: browser session error. Try again.', exitCode: 1 };
    case 'login-capture-failure':
      return {
        output: error.problem === 'empty'
          ? 'Login captured no cookies from the browser. Rerun: marquee auth login'
          : 'Login failed: browser session state could not be captured. Try again.',
        exitCode: 1,
      };
    case 'login-cancelled':
      return {
        output: 'Login cancelled: the browser window was closed before sign-in completed',
        exitCode: 1,
      };
    case 'login-realm-failure':
      return error.failure.kind === 'timeout'
        ? { output: 'Login did not complete within 120 seconds', exitCode: 1 }
        : { output: 'Login could not verify the Marquee session. Try again.', exitCode: 1 };
    case 'login-persistence-failure':
      return { output: 'Login failed: session state could not be saved. Try again.', exitCode: 1 };
    case 'login-cleanup-failure':
      return { output: 'Login failed: browser cleanup failed. Try again.', exitCode: 1 };
    case 'logout-failure':
      return { output: 'Logout failed: session state could not be removed. Try again.', exitCode: 1 };
    case 'identity-shape-failure':
      return { output: 'Error: Marquee identity response was invalid.', exitCode: 1 };
  }
}
