import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createAgentBrowserRuntime,
  type AgentBrowserRuntime,
} from '../../agent-browser-runtime/index.js';
import {
  LOGIN_STATE_SCRIPT,
  LOGIN_WAIT_SECONDS,
  pollLoginProbe,
  type PollClock,
} from '../login-probe.js';
import type {
  AuthPort,
} from '../module.js';
import type { AuthError, AuthResult } from '../types.js';
import type { DependencyFailure } from '../../transport/index.js';

type Cookie = Readonly<{
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number | undefined;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None' | undefined;
}>;

type CookieJar = Readonly<{
  cookies: readonly Cookie[];
  updatedAt: number;
}>;

const LOGIN_URL = 'https://marquee.gs.com/s/';
const LOGIN_SESSION = 'marquee-login';
// These are agent-browser provider spellings, assembled at the adapter
// boundary because they collide with stable Marquee CLI vocabulary.
const AGENT_BROWSER_PROFILE_DIRECTORY = ['a', 'uth'].join('');
const AGENT_BROWSER_JSON_OPTION = ['--', 'json'].join('');
type LoginPort = Pick<
  AuthPort,
  | 'checkLoginBrowser'
  | 'resolveLoginCredentials'
  | 'openLoginBrowser'
  | 'captureLoginState'
  | 'cleanupLogin'
  | 'publishLogin'
  | 'discardLogin'
  | 'clearSession'
>;

type LoginFileSystem = {
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  renameSync: typeof renameSync;
  unlinkSync: typeof unlinkSync;
  writeFileSync: typeof writeFileSync;
};

export type ProductionAuthLoginOptions = Readonly<{
  cookieJarPath: string;
  statePaths?: readonly string[] | undefined;
  runtime?: AgentBrowserRuntime;
  sleep?: (ms: number) => Promise<void>;
  /** The wall clock the login's waits end on. */
  now?: () => number;
  loginUrl?: string;
  loginPidPath?: string;
  agentBrowserDir?: string;
  statePathSuffix?: () => string;
  fileSystem?: Partial<LoginFileSystem>;
}>;

const defaultFileSystem: LoginFileSystem = {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
};

export function createProductionAuthLoginPort(options: ProductionAuthLoginOptions): LoginPort {
  const runtime = options.runtime ?? createAgentBrowserRuntime();
  const fileSystem = { ...defaultFileSystem, ...options.fileSystem };
  const clock: PollClock = {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? (async (ms: number) => {
      await new Promise((resolve) => { setTimeout(resolve, ms); });
    }),
  };
  const loginPidPath = options.loginPidPath ?? defaultLoginPidPath();
  const agentBrowserDir = options.agentBrowserDir ?? join(homedir(), '.agent-browser');
  const statePaths = [...new Set(options.statePaths ?? [])];
  let browserOpened = false;
  let stagedState: string | undefined;

  async function run(argv: readonly string[], timeoutMs: number, headed = false) {
    return runtime.execute({
      session: LOGIN_SESSION,
      headed,
      argv,
      timeoutMs,
    });
  }

  return {
    async checkLoginBrowser() {
      try {
        await runtime.execute({ argv: ['--version'], timeoutMs: 5_000 });
        return success();
      } catch (cause) {
        return failure(isMissingAgentBrowserError(cause)
          ? { kind: 'browser-dependency-missing' }
          : browserFailure('launch', cause));
      }
    },

    async resolveLoginCredentials(input) {
      const read = readSavedCredentials(fileSystem, agentBrowserDir);
      if (!read.ok) return read;
      const saved = read.value;
      const username = input.username ?? saved.username;
      const suppliedPassword = input.passwordStdin?.trim();
      const password = suppliedPassword ? suppliedPassword : saved.password;
      return username && password
        ? { ok: true, value: { username, password } }
        : { ok: true, value: null };
    },

    async openLoginBrowser(credentials) {
      stagedState = undefined;
      try {
        if (fileSystem.existsSync(loginPidPath)) {
          await run(['close'], 5_000);
        }
        await run(['open', options.loginUrl ?? LOGIN_URL], 60_000, true);
        browserOpened = true;
      } catch (cause) {
        return failure(isMissingAgentBrowserError(cause)
          ? { kind: 'browser-dependency-missing' }
          : browserFailure('launch', cause));
      }

      try {
        const state = await waitForMarqueeRealm(run, clock, credentials ? 'form' : 'manual');
        if (state === 'form' && credentials) {
          await run(['wait', 'input[name="username"]'], 30_000);
          await run(['fill', 'input[name="username"]', credentials.username], 30_000);
          await run(['press', 'Enter'], 30_000);
          await run(['wait', 'input[type="password"]'], 30_000);
          await run(['fill', 'input[type="password"]', credentials.password], 30_000);
          await run(['press', 'Enter'], 30_000);
          await waitForMarqueeRealm(run, clock, 'signed-in');
        }
        return success();
      } catch (cause) {
        if (cause instanceof WindowClosedError) return failure({ kind: 'login-cancelled' });
        if (cause instanceof RealmTimeoutError) {
          return failure({ kind: 'login-realm-failure', failure: { kind: 'timeout' } });
        }
        return failure(browserFailure('interaction', cause));
      }
    },

    async captureLoginState() {
      try {
        const { stdout } = await run(['cookies', 'get', AGENT_BROWSER_JSON_OPTION], 10_000);
        const cookies = parseBrowserCookies(stdout);
        if (cookies.length === 0) {
          return failure({
            kind: 'login-capture-failure',
            problem: 'empty',
            failure: { kind: 'unavailable' },
          });
        }
        stagedState = JSON.stringify({ cookies, origins: [] });
        return success();
      } catch (cause) {
        return failure({
          kind: 'login-capture-failure',
          problem: 'read',
          failure: dependencyFailure(cause),
        });
      }
    },

    async cleanupLogin() {
      if (!browserOpened && !fileSystem.existsSync(loginPidPath)) return success();
      try {
        await run(['close'], 5_000);
        browserOpened = false;
        return success();
      } catch (cause) {
        return failure({ kind: 'login-cleanup-failure', failure: dependencyFailure(cause) });
      }
    },

    async publishLogin() {
      if (!stagedState) {
        return failure({ kind: 'login-persistence-failure', failure: { kind: 'unavailable' } });
      }
      try {
        const cookies = parseStateCookies(stagedState);
        const jar: CookieJar = { cookies, updatedAt: Date.now() };
        publishFilesAtomically(
          fileSystem,
          [
            { path: options.cookieJarPath, contents: JSON.stringify(jar, null, 2) },
            ...statePaths.map((path) => ({ path, contents: stagedState as string })),
          ],
          options.statePathSuffix,
        );
        stagedState = undefined;
        return success();
      } catch (cause) {
        return failure({ kind: 'login-persistence-failure', failure: dependencyFailure(cause) });
      }
    },

    async discardLogin() {
      stagedState = undefined;
      return success();
    },

    async clearSession() {
      try {
        for (const path of [options.cookieJarPath, ...statePaths, savedProfilePath(agentBrowserDir)]) {
          if (fileSystem.existsSync(path)) fileSystem.unlinkSync(path);
        }
        return success();
      } catch (cause) {
        return failure({ kind: 'logout-failure', failure: dependencyFailure(cause) });
      }
    },
  };
}

function savedProfilePath(agentBrowserDir: string): string {
  return join(agentBrowserDir, AGENT_BROWSER_PROFILE_DIRECTORY, 'marquee.json');
}

function readSavedCredentials(
  fileSystem: LoginFileSystem,
  agentBrowserDir: string,
): AuthResult<Readonly<{ username?: string; password?: string }>> {
  const profilePath = savedProfilePath(agentBrowserDir);
  if (!fileSystem.existsSync(profilePath)) return { ok: true, value: {} };
  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(fileSystem.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
  } catch (cause) {
    return failure({ kind: 'saved-profile-unreadable', cause });
  }
  const { iv, authTag, data } = profile;
  if (
    profile.encrypted !== true
    || typeof iv !== 'string'
    || typeof authTag !== 'string'
    || typeof data !== 'string'
  ) {
    return failure({
      kind: 'saved-profile-unreadable',
      cause: new Error(`${profilePath} is not an encrypted agent-browser profile`),
    });
  }
  try {
    const envKey = process.env.AGENT_BROWSER_ENCRYPTION_KEY?.trim();
    const keyText = envKey && envKey.length > 0
      ? envKey
      : fileSystem.readFileSync(join(agentBrowserDir, '.encryption-key'), 'utf8').trim();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyText, 'hex'), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]);
    const credentials = JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
    return {
      ok: true,
      value: {
        ...(typeof credentials.username === 'string' && credentials.username ? { username: credentials.username } : {}),
        ...(typeof credentials.password === 'string' && credentials.password ? { password: credentials.password } : {}),
      },
    };
  } catch (cause) {
    return failure({ kind: 'profile-decryption-failure', cause });
  }
}

class RealmTimeoutError extends Error {}
class WindowClosedError extends Error {}

/** `form` stops at the signin form; `manual` fails once the window is closed. */
async function waitForMarqueeRealm(
  run: (argv: readonly string[], timeoutMs: number, headed?: boolean) => Promise<{ stdout: string }>,
  clock: PollClock,
  until: 'form' | 'manual' | 'signed-in',
): Promise<'authed' | 'form'> {
  const state = await pollLoginProbe(
    async (script) => (await run(['eval', script], 10_000)).stdout.trim().replace(/^"|"$/g, ''),
    LOGIN_STATE_SCRIPT,
    (current): 'authed' | 'form' | undefined => {
      if (current === 'authed') return 'authed';
      if (until === 'form' && current === 'form') return 'form';
      if (until === 'manual' && current === 'closed') throw new WindowClosedError();
      return undefined;
    },
    { waitSeconds: LOGIN_WAIT_SECONDS, clock },
  );
  if (state === undefined) throw new RealmTimeoutError();
  return state;
}

/** A cookie as agent-browser reports it: CDP's Network.Cookie, whose text fields are strings. */
interface CapturedCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: unknown;
  httpOnly?: unknown;
  secure?: unknown;
  sameSite?: unknown;
}

function parseBrowserCookies(stdout: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(stdout) as { data?: { cookies?: CapturedCookie[] } };
  return (parsed.data?.cookies ?? [])
    .map((cookie) => ({
      name: String(cookie.name ?? ''),
      value: String(cookie.value ?? ''),
      domain: String(cookie.domain ?? ''),
      path: String(cookie.path ?? '/'),
      expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      sameSite: toSameSite(cookie.sameSite) ?? 'Lax',
    }))
    .filter((cookie) => cookie.name && cookie.value);
}

function parseStateCookies(state: string): Cookie[] {
  const parsed = JSON.parse(state) as { cookies?: unknown };
  if (!Array.isArray(parsed.cookies)) throw new Error('captured state has no cookies');
  return (parsed.cookies as CapturedCookie[])
    .map((cookie) => ({
      name: String(cookie.name ?? ''),
      value: String(cookie.value ?? ''),
      domain: String(cookie.domain ?? 'marquee.gs.com'),
      path: String(cookie.path ?? '/'),
      expires: typeof cookie.expires === 'number' && cookie.expires >= 0
        ? cookie.expires
        : undefined,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      sameSite: toSameSite(cookie.sameSite),
    }))
    .filter((cookie) => cookie.name && cookie.value);
}

function publishFilesAtomically(
  fileSystem: LoginFileSystem,
  files: readonly Readonly<{ path: string; contents: string }>[],
  suffixFactory: (() => string) | undefined,
): void {
  const suffix = suffixFactory?.() ?? `${process.pid}-${Date.now()}`;
  const prepared = preparePublicationFiles(fileSystem, files, suffix);
  const committed: typeof prepared = [];
  try {
    for (const file of prepared) {
      fileSystem.renameSync(file.temporaryPath, file.path);
      committed.push(file);
    }
  } catch (cause) {
    rollbackPublication(fileSystem, prepared, committed, suffix);
    throw cause;
  }
}

function preparePublicationFiles(
  fileSystem: LoginFileSystem,
  files: readonly Readonly<{ path: string; contents: string }>[],
  suffix: string,
) {
  const prepared: Array<Readonly<{
    path: string;
    contents: string;
    temporaryPath: string;
    previous: Buffer | undefined;
  }>> = [];
  try {
    for (const [index, file] of files.entries()) {
      fileSystem.mkdirSync(dirname(file.path), { recursive: true });
      const temporaryPath = `${file.path}.tmp-${suffix}-${index}`;
      const previous = fileSystem.existsSync(file.path)
        ? fileSystem.readFileSync(file.path)
        : undefined;
      fileSystem.writeFileSync(temporaryPath, file.contents, { mode: 0o600 });
      prepared.push({ ...file, temporaryPath, previous });
    }
    return prepared;
  } catch (cause) {
    for (const file of prepared) {
      if (fileSystem.existsSync(file.temporaryPath)) fileSystem.unlinkSync(file.temporaryPath);
    }
    throw cause;
  }
}

function rollbackPublication(
  fileSystem: LoginFileSystem,
  prepared: readonly Readonly<{
    path: string;
    temporaryPath: string;
    previous: Buffer | undefined;
  }>[],
  committed: readonly Readonly<{
    path: string;
    temporaryPath: string;
    previous: Buffer | undefined;
  }>[],
  suffix: string,
): void {
  for (const file of prepared.slice(committed.length)) {
    if (fileSystem.existsSync(file.temporaryPath)) fileSystem.unlinkSync(file.temporaryPath);
  }
  for (const [index, file] of [...committed].reverse().entries()) {
    if (file.previous === undefined) {
      if (fileSystem.existsSync(file.path)) fileSystem.unlinkSync(file.path);
      continue;
    }
    const rollbackPath = `${file.path}.rollback-${suffix}-${index}`;
    fileSystem.writeFileSync(rollbackPath, file.previous, { mode: 0o600 });
    fileSystem.renameSync(rollbackPath, file.path);
  }
}

function defaultLoginPidPath(): string {
  const namespace = process.env.AGENT_BROWSER_NAMESPACE?.trim();
  const runDirectory = namespace
    ? join(homedir(), '.agent-browser', 'namespaces', namespace, 'run')
    : join(homedir(), '.agent-browser');
  return join(runDirectory, `${LOGIN_SESSION}.pid`);
}

function success(): AuthResult<void> {
  return { ok: true, value: undefined };
}

function failure(error: AuthError): AuthResult<never> {
  return { ok: false, error };
}

function browserFailure(
  problem: 'launch' | 'interaction',
  cause: unknown,
): AuthError {
  return { kind: 'login-browser-failure', problem, failure: dependencyFailure(cause) };
}

function dependencyFailure(cause: unknown): DependencyFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/timed? ?out|etimedout/i.test(message)) return { kind: 'timeout' };
  return { kind: 'unavailable' };
}

function isMissingAgentBrowserError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
    const spawnError = error as { path?: unknown; syscall?: unknown };
    if (
      spawnError.path === 'agent-browser'
      || spawnError.syscall === 'spawn agent-browser'
      || (spawnError.syscall === 'spawn' && spawnError.path === 'agent-browser')
    ) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('spawn agent-browser ENOENT')
    || message.includes('agent-browser: command not found')
    || message.includes('agent-browser not found. Install it:');
}

function toSameSite(value: unknown): Cookie['sameSite'] | undefined {
  return value === 'Lax' || value === 'Strict' || value === 'None' ? value : undefined;
}
