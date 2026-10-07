import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentBrowserInvocation,
  type AgentBrowserRuntime,
} from '../../../agent-browser-runtime/index.js';
import { virtualClock } from '../../tests/virtual-clock.js';
import {
  createAuth,
  type AuthPort,
} from '../../module.js';
import {
  createProductionAuthLoginPort,
  type ProductionAuthLoginOptions,
} from '../login.js';

const temporaryDirectories: string[] = [];

function createInMemoryAgentBrowserRuntime(
  execute: AgentBrowserRuntime['execute'],
): AgentBrowserRuntime {
  return { execute };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mq-login-'));
  temporaryDirectories.push(directory);
  return directory;
}

function subject(options: ProductionAuthLoginOptions) {
  const login = createProductionAuthLoginPort(options);
  const port: AuthPort = {
    ...login,
    inspectMarqueeRealm: vi.fn(),
    inspectResearchRealm: vi.fn(),
    saveProfile: vi.fn(async () => ({ ok: true as const, value: undefined })),
  };
  return createAuth(port);
}

const CREDENTIALS = { username: 'jane', passwordStdin: 'secret' } as const;

function cookiesPayload() {
  return JSON.stringify({
    success: true,
    data: {
      cookies: [
        {
          name: 'MarqueeLogin', value: 'login', domain: '.gs.com', path: '/',
          expires: 1_900_000_000, httpOnly: true, secure: true, sameSite: 'Lax',
        },
        {
          name: 'MarqueeIdToken', value: 'id-token', domain: '.gs.com', path: '/',
          expires: -1, httpOnly: false, secure: true, sameSite: 'Lax',
        },
      ],
    },
  });
}

function successfulRuntime(calls: AgentBrowserInvocation[]) {
  return createInMemoryAgentBrowserRuntime(async (invocation) => {
    calls.push(invocation);
    if (invocation.argv[0] === '--version') return { stdout: 'agent-browser 0.31.2', stderr: '' };
    if (invocation.argv[0] === 'eval') {
      const script = invocation.argv[1] ?? '';
      return { stdout: script.includes('/v1/users/self') ? '"authed"' : '"pending"', stderr: '' };
    }
    if (invocation.argv[0] === 'cookies') return { stdout: cookiesPayload(), stderr: '' };
    return { stdout: '', stderr: '' };
  });
}

describe('production login adapter', () => {
  it('captures the Marquee sign-in once and publishes it after the browser closes, without visiting Research', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const browserStatePath = join(directory, 'browser-state.json');
    const secondStatePath = join(directory, 'second-state.json');
    const calls: AgentBrowserInvocation[] = [];
    const loginSubject = subject({
      cookieJarPath,
      statePaths: [browserStatePath, secondStatePath],
      runtime: successfulRuntime(calls),
      ...virtualClock(),
      loginPidPath: join(directory, 'missing.pid'),
    });

    await expect(loginSubject.login(CREDENTIALS)).resolves.toEqual({
      result: { ok: true, value: undefined },
      evidence: [],
    });

    expect(JSON.parse(readFileSync(cookieJarPath, 'utf8')).cookies.map(
      (cookie: { name: string }) => cookie.name,
    )).toEqual(['MarqueeLogin', 'MarqueeIdToken']);
    expect(readFileSync(browserStatePath, 'utf8')).toBe(readFileSync(secondStatePath, 'utf8'));
    expect(calls.filter(({ argv }) => argv[0] === 'cookies')).toHaveLength(1);
    expect(calls.filter(({ argv }) => argv[0] === 'tab')).toEqual([]);
    expect(calls.filter(({ argv }) => argv.some((arg) => arg.includes('/research')))).toEqual([]);
    const closeIndex = calls.findIndex(({ argv }) => argv[0] === 'close');
    const finalCaptureIndex = calls.findLastIndex(({ argv }) => argv[0] === 'cookies');
    expect(closeIndex).toBeGreaterThan(finalCaptureIndex);
    expect(calls.filter(({ session }) => session && session !== 'marquee-login')).toEqual([]);
    expect(calls.find(({ argv }) => argv[0] === 'open')).toMatchObject({ headed: true });
  });

  it('waits for the person to sign in on the headed SSO page when no credentials are saved or given', async () => {
    const directory = temporaryDirectory();
    const calls: AgentBrowserInvocation[] = [];
    let marqueeChecks = 0;
    const loginSubject = subject({
      cookieJarPath: join(directory, 'cookies.json'),
      agentBrowserDir: join(directory, '.agent-browser'),
      runtime: createInMemoryAgentBrowserRuntime(async (invocation) => {
        calls.push(invocation);
        const script = invocation.argv[0] === 'eval' ? invocation.argv[1] ?? '' : '';
        if (script.includes('/v1/users/self')) {
          marqueeChecks += 1;
          return { stdout: marqueeChecks < 3 ? '"form"' : '"authed"', stderr: '' };
        }
        if (invocation.argv[0] === 'cookies') return { stdout: cookiesPayload(), stderr: '' };
        return { stdout: '', stderr: '' };
      }),
      ...virtualClock(),
      loginPidPath: join(directory, 'missing.pid'),
    });

    await expect(loginSubject.login()).resolves.toEqual({
      result: { ok: true, value: undefined },
      evidence: [],
    });
    expect(calls.find(({ argv }) => argv[0] === 'open')).toMatchObject({
      headed: true,
      argv: ['open', 'https://marquee.gs.com/s/'],
    });
    expect(calls.filter(({ argv }) => argv[0] === 'fill' || argv[0] === 'press')).toEqual([]);
    expect(marqueeChecks).toBe(3);
  });

  it('ends the manual login at once when the person closes the window before signing in', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const calls: AgentBrowserInvocation[] = [];
    const loginSubject = subject({
      cookieJarPath,
      agentBrowserDir: join(directory, '.agent-browser'),
      runtime: createInMemoryAgentBrowserRuntime(async (invocation) => {
        calls.push(invocation);
        if (invocation.argv[0] === 'eval') {
          const checks = calls.filter(({ argv }) => argv[0] === 'eval').length;
          return { stdout: checks < 2 ? '"form"' : '"closed"', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }),
      sleep: async () => {},
      loginPidPath: join(directory, 'missing.pid'),
    });

    await expect(loginSubject.login()).resolves.toEqual({
      result: { ok: false, error: { kind: 'login-cancelled' } },
      evidence: [],
    });
    expect(calls.filter(({ argv }) => argv[0] === 'eval')).toHaveLength(2);
    expect(calls.at(-1)?.argv).toEqual(['close']);
    expect(existsSync(cookieJarPath)).toBe(false);
  });

  it('rolls back an earlier destination when a later publication rename fails', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const browserStatePath = join(directory, 'browser-state.json');
    writeFileSync(cookieJarPath, 'old-jar');
    writeFileSync(browserStatePath, 'old-browser-state');
    let commitRenames = 0;
    const loginSubject = subject({
      cookieJarPath,
      statePaths: [browserStatePath],
      runtime: successfulRuntime([]),
      sleep: async () => {},
      loginPidPath: join(directory, 'missing.pid'),
      statePathSuffix: () => 'test',
      fileSystem: {
        renameSync: (from, to) => {
          if (String(from).includes('.tmp-test-')) {
            commitRenames += 1;
            if (commitRenames === 2) throw new Error('blocked second rename');
          }
          renameSync(from, to);
        },
      },
    });

    await expect(loginSubject.login(CREDENTIALS)).resolves.toMatchObject({
      result: { ok: false, error: { kind: 'login-persistence-failure' } },
    });

    expect(readFileSync(cookieJarPath, 'utf8')).toBe('old-jar');
    expect(readFileSync(browserStatePath, 'utf8')).toBe('old-browser-state');
    expect(existsSync(`${browserStatePath}.tmp-test-1`)).toBe(false);
  });

  it('does not publish when ephemeral browser cleanup fails', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    writeFileSync(cookieJarPath, 'old-jar');
    const runtime = successfulRuntime([]);
    const execute = vi.spyOn(runtime, 'execute').mockImplementation(async (invocation) => {
      if (invocation.argv[0] === 'close') throw new Error('close failed with private detail');
      if (invocation.argv[0] === '--version') return { stdout: 'agent-browser', stderr: '' };
      if (invocation.argv[0] === 'eval') return { stdout: '"authed"', stderr: '' };
      if (invocation.argv[0] === 'cookies') return { stdout: cookiesPayload(), stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const loginSubject = subject({
      cookieJarPath,
      runtime,
      sleep: async () => {},
      loginPidPath: join(directory, 'missing.pid'),
    });

    const result = await loginSubject.login(CREDENTIALS);

    expect(result.result).toMatchObject({
      ok: false,
      error: { kind: 'login-cleanup-failure', failure: { kind: 'unavailable' } },
    });
    expect(JSON.stringify(result)).not.toContain('private detail');
    expect(readFileSync(cookieJarPath, 'utf8')).toBe('old-jar');
    expect(execute).toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error('spawn agent-browser ENOENT'), { code: 'ENOENT' }),
    new Error('agent-browser not found. Install it: npm install -D agent-browser'),
  ])('classifies a missing agent-browser before opening a login session', async (missingError) => {
    const execute = vi.fn(async () => {
      throw missingError;
    });
    const loginSubject = subject({
      cookieJarPath: join(temporaryDirectory(), 'cookies.json'),
      runtime: createInMemoryAgentBrowserRuntime(execute),
    });

    await expect(loginSubject.login(CREDENTIALS)).resolves.toEqual({
      result: { ok: false, error: { kind: 'browser-dependency-missing' } },
      evidence: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('classifies an empty browser capture without publishing an empty jar', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const runtime = createInMemoryAgentBrowserRuntime(async (invocation) => {
      if (invocation.argv[0] === '--version') return { stdout: 'agent-browser', stderr: '' };
      if (invocation.argv[0] === 'eval') return { stdout: '"authed"', stderr: '' };
      if (invocation.argv[0] === 'cookies') {
        return { stdout: JSON.stringify({ success: true, data: { cookies: [] } }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const loginSubject = subject({
      cookieJarPath,
      runtime,
      sleep: async () => {},
      loginPidPath: join(directory, 'missing.pid'),
    });

    await expect(loginSubject.login(CREDENTIALS)).resolves.toMatchObject({
      result: {
        ok: false,
        error: { kind: 'login-capture-failure', problem: 'empty' },
      },
    });
    expect(existsSync(cookieJarPath)).toBe(false);
  });

  it('uses an injected password only with a saved username', async () => {
    const directory = temporaryDirectory();
    const agentBrowserDir = join(directory, '.agent-browser');
    const profileDirectory = join(agentBrowserDir, ['a', 'uth'].join(''));
    const { mkdirSync } = await import('node:fs');
    const { createCipheriv, randomBytes } = await import('node:crypto');
    mkdirSync(profileDirectory, { recursive: true });
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({ username: 'jane', password: 'saved' }), 'utf8'),
      cipher.final(),
    ]);
    writeFileSync(join(agentBrowserDir, '.encryption-key'), key.toString('hex'));
    writeFileSync(join(profileDirectory, 'marquee.json'), JSON.stringify({
      encrypted: true,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    }));
    const login = createProductionAuthLoginPort({
      cookieJarPath: join(directory, 'cookies.json'),
      agentBrowserDir,
    });

    await expect(login.resolveLoginCredentials({ passwordStdin: 'stdin-password\n' })).resolves.toEqual({
      ok: true,
      value: { username: 'jane', password: 'stdin-password' },
    });
  });

  it('fails loud when the saved SSO profile cannot be read', async () => {
    const directory = temporaryDirectory();
    const agentBrowserDir = join(directory, '.agent-browser');
    const profileDirectory = join(agentBrowserDir, ['a', 'uth'].join(''));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(profileDirectory, { recursive: true });
    writeFileSync(join(profileDirectory, 'marquee.json'), 'not json');
    const login = createProductionAuthLoginPort({
      cookieJarPath: join(directory, 'cookies.json'),
      agentBrowserDir,
    });

    await expect(login.resolveLoginCredentials({})).resolves.toEqual({
      ok: false,
      error: { kind: 'saved-profile-unreadable', cause: expect.any(SyntaxError) },
    });
  });

  it('fails loud when the saved SSO profile is not an encrypted profile', async () => {
    const directory = temporaryDirectory();
    const agentBrowserDir = join(directory, '.agent-browser');
    const profileDirectory = join(agentBrowserDir, ['a', 'uth'].join(''));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(profileDirectory, { recursive: true });
    writeFileSync(join(profileDirectory, 'marquee.json'), JSON.stringify({ username: 'jane' }));
    const login = createProductionAuthLoginPort({
      cookieJarPath: join(directory, 'cookies.json'),
      agentBrowserDir,
    });

    await expect(login.resolveLoginCredentials({ passwordStdin: 'pw' })).resolves.toEqual({
      ok: false,
      error: { kind: 'saved-profile-unreadable', cause: expect.any(Error) },
    });
  });

  it('keeps the cause when the saved SSO profile cannot be decrypted', async () => {
    const directory = temporaryDirectory();
    const agentBrowserDir = join(directory, '.agent-browser');
    const profileDirectory = join(agentBrowserDir, ['a', 'uth'].join(''));
    const { mkdirSync } = await import('node:fs');
    const { randomBytes } = await import('node:crypto');
    mkdirSync(profileDirectory, { recursive: true });
    writeFileSync(join(agentBrowserDir, '.encryption-key'), randomBytes(32).toString('hex'));
    writeFileSync(join(profileDirectory, 'marquee.json'), JSON.stringify({
      encrypted: true,
      iv: randomBytes(12).toString('base64'),
      authTag: randomBytes(16).toString('base64'),
      data: randomBytes(16).toString('base64'),
    }));
    const login = createProductionAuthLoginPort({
      cookieJarPath: join(directory, 'cookies.json'),
      agentBrowserDir,
    });

    await expect(login.resolveLoginCredentials({})).resolves.toEqual({
      ok: false,
      error: { kind: 'profile-decryption-failure', cause: expect.any(Error) },
    });
  });

  it('signs in with a username flag and piped password when no profile is saved', async () => {
    const directory = temporaryDirectory();
    const login = createProductionAuthLoginPort({
      cookieJarPath: join(directory, 'cookies.json'),
      agentBrowserDir: join(directory, '.agent-browser'),
    });

    await expect(login.resolveLoginCredentials({
      username: 'jane',
      passwordStdin: 'stdin-password',
    })).resolves.toEqual({
      ok: true,
      value: { username: 'jane', password: 'stdin-password' },
    });
    await expect(login.resolveLoginCredentials({ passwordStdin: 'stdin-password' })).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it('logs out by removing the cookie jar, every browser state file and the saved SSO profile', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    const statePath = join(directory, 'state.json');
    const missingStatePath = join(directory, 'missing-state.json');
    const agentBrowserDir = join(directory, '.agent-browser');
    const profilePath = join(agentBrowserDir, ['a', 'uth'].join(''), 'marquee.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(agentBrowserDir, ['a', 'uth'].join('')), { recursive: true });
    writeFileSync(cookieJarPath, '{}');
    writeFileSync(statePath, '{}');
    writeFileSync(profilePath, '{}');

    await expect(subject({
      cookieJarPath,
      statePaths: [statePath, missingStatePath],
      agentBrowserDir,
      runtime: createInMemoryAgentBrowserRuntime(vi.fn()),
    }).logout()).resolves.toEqual({ result: { ok: true, value: undefined }, evidence: [] });
    expect([cookieJarPath, statePath, missingStatePath, profilePath].map((path) => existsSync(path)))
      .toEqual([false, false, false, false]);
  });

  it('reports a session file that cannot be removed', async () => {
    const directory = temporaryDirectory();
    const cookieJarPath = join(directory, 'cookies.json');
    writeFileSync(cookieJarPath, '{}');

    await expect(subject({
      cookieJarPath,
      agentBrowserDir: join(directory, '.agent-browser'),
      runtime: createInMemoryAgentBrowserRuntime(vi.fn()),
      fileSystem: { unlinkSync: () => { throw new Error('EACCES'); } },
    }).logout()).resolves.toEqual({
      result: { ok: false, error: { kind: 'logout-failure', failure: { kind: 'unavailable' } } },
      evidence: [],
    });
  });
});
