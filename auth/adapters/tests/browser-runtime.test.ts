import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentBrowserInvocation } from '../../../agent-browser-runtime/index.js';
import type { Cookie } from '../../../transport/index.js';
import {
  createAuthBrowserRuntime,
} from '../browser-runtime.js';

type Run = (command: string, args: string[]) => Promise<string>;

function createMockTransport(run: Run) {
  return { run: vi.fn(run) };
}

function createBrowserAuthState(options: { cookieJarPath: string }) {
  const sessions: (string | undefined)[] = [];
  let commands: ReturnType<typeof createMockTransport> | undefined;
  const state = createAuthBrowserRuntime({
    getCookies() {
      let parsed: { cookies?: Cookie[] };
      try {
        parsed = JSON.parse(readFileSync(options.cookieJarPath, 'utf8')) as {
          cookies?: Cookie[];
        };
      } catch {
        throw new Error(`Cookie file corrupted at ${options.cookieJarPath}`);
      }
      const cookies = parsed.cookies ?? [];
      const now = Math.floor(Date.now() / 1000);
      const isAuthenticated = cookies.some((cookie) => (
        cookie.name === 'MarqueeLogin'
        && (cookie.expires === undefined || cookie.expires < 0 || cookie.expires > now)
      ));
      return isAuthenticated ? cookies : undefined;
    },
    runtime: {
      async execute(invocation: AgentBrowserInvocation) {
        sessions.push(invocation.session);
        const command = invocation.argv[0] ?? '';
        const stdout = await commands?.run(command, Array.from(invocation.argv.slice(1))) ?? '';
        return { stdout, stderr: '' };
      },
    },
  });
  return {
    sessions,
    syncBrowserSession(browserCommands: ReturnType<typeof createMockTransport>, session = 's1') {
      commands = browserCommands;
      return state.syncBrowserSession(session);
    },
  };
}

function writeValidJar(path: string): void {
  writeFileSync(path, JSON.stringify({
    cookies: [
      { name: 'MarqueeLogin', value: '1', domain: '.gs.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 },
      { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
    ],
    updatedAt: 0,
  }), 'utf8');
}

const noOutput: Run = async () => '';

describe('Auth browser runtime', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function jarPath(cookies?: Cookie[]): string {
    dir = mkdtempSync(join(tmpdir(), 'mq-browser-auth-'));
    const cookieJarPath = join(dir, 'cookies.json');
    if (cookies) {
      writeFileSync(cookieJarPath, JSON.stringify({ cookies, updatedAt: 0 }), 'utf8');
    } else {
      writeValidJar(cookieJarPath);
    }
    return cookieJarPath;
  }

  it('only sets each Marquee cookie, in the named Browser Session', async () => {
    const authState = createBrowserAuthState({ cookieJarPath: jarPath() });
    const transport = createMockTransport(noOutput);

    await authState.syncBrowserSession(transport, 's1');

    expect(transport.run.mock.calls.map(([command, args]) => [command, args[0], args[1]])).toEqual([
      ['cookies', 'set', 'MarqueeLogin'],
      ['cookies', 'set', 'sid'],
    ]);
    expect(authState.sessions).toEqual(['s1', 's1']);
  });

  it('is a no-op when the cookie jar lacks valid auth', async () => {
    const authState = createBrowserAuthState({
      cookieJarPath: jarPath([{ name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' }]),
    });
    const transport = createMockTransport(noOutput);

    await authState.syncBrowserSession(transport);

    expect(transport.run).not.toHaveBeenCalled();
  });

  it('fails when the cookie jar is corrupted', async () => {
    const cookieJarPath = jarPath();
    writeFileSync(cookieJarPath, 'not json', 'utf8');
    const authState = createBrowserAuthState({ cookieJarPath });
    const transport = createMockTransport(noOutput);

    await expect(authState.syncBrowserSession(transport)).rejects.toThrow('Cookie file corrupted');
    expect(transport.run).not.toHaveBeenCalled();
  });

  it('truncates decimal expires to integer', async () => {
    const decimalExpires = Math.floor(Date.now() / 1000) + 3600.28714;
    const authState = createBrowserAuthState({
      cookieJarPath: jarPath([
        { name: 'MarqueeLogin', value: '1', domain: '.gs.com', path: '/', expires: decimalExpires },
      ]),
    });
    const transport = createMockTransport(noOutput);

    await authState.syncBrowserSession(transport);

    const cookieArgs = transport.run.mock.calls[0]?.[1] ?? [];
    expect(cookieArgs.slice(cookieArgs.indexOf('--expires'))).toEqual([
      '--expires', String(Math.floor(decimalExpires)),
    ]);
  });

  it('passes every cookie attribute to agent-browser', async () => {
    const authState = createBrowserAuthState({
      cookieJarPath: jarPath([{
        name: 'MarqueeLogin',
        value: '1',
        domain: '.gs.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        expires: -1,
      }]),
    });
    const transport = createMockTransport(noOutput);

    await authState.syncBrowserSession(transport);

    expect(transport.run.mock.calls[0]).toEqual(['cookies', [
      'set', 'MarqueeLogin', '1', '--url', 'https://marquee.gs.com', '--domain', '.gs.com', '--path', '/',
      '--httpOnly', '--secure', '--sameSite', 'Lax', '--expires', '-1',
    ]]);
  });

  // Regression: `state load` navigates the browser to /s/home, clobbering
  // the subsequent `open` navigation. Cookie sync must ONLY use `cookies set`
  // (which injects cookies without navigating) and never `state load` or `open`.
  it('never issues navigation commands (state load, open)', async () => {
    const authState = createBrowserAuthState({ cookieJarPath: jarPath() });
    const transport = createMockTransport(noOutput);

    await authState.syncBrowserSession(transport);

    const navigationCommands = transport.run.mock.calls.filter(([command]) => (
      command === 'state' || command === 'open'
    ));
    expect(navigationCommands).toHaveLength(0);
  });

  it('sets only unexpired cookies that match marquee.gs.com', async () => {
    const expired = Math.floor(Date.now() / 1000) - 3600;
    const valid = Math.floor(Date.now() / 1000) + 3600;
    const authState = createBrowserAuthState({
      cookieJarPath: jarPath([
        { name: 'MarqueeLogin', value: '1', domain: '.gs.com', path: '/', expires: valid },
        { name: 'old_session', value: 'x', domain: 'marquee.gs.com', path: '/', expires: expired },
        { name: 'no_expiry', value: 'y', domain: 'marquee.gs.com', path: '/' },
        { name: 'session_cookie', value: 'z', domain: 'marquee.gs.com', path: '/', expires: -1 },
        { name: 'idfs_token', value: 'xyz', domain: 'idfs.gs.com', path: '/' },
        { name: 'other', value: '1', domain: 'example.com', path: '/' },
      ]),
    });
    const transport = createMockTransport(noOutput);

    await authState.syncBrowserSession(transport);

    const cookieNames = transport.run.mock.calls
      .filter(([command]) => command === 'cookies')
      .map(([, args]) => args[1]);
    expect(cookieNames).toEqual(['MarqueeLogin', 'no_expiry', 'session_cookie']);
  });
});
