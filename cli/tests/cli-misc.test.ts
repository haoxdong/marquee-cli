import { vi } from 'vitest';
import {
  afterEach,
  describe,
  expect,
  it,
  createProgram,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  createMockTransport,
  mockStdin,
} from './cli-test-harness.js';
import type { TransportOpts } from '../browser-transport.js';

afterEach(() => {
  process.exitCode = undefined;
});

// os.homedir() reads the real process environment, which a worker thread cannot
// change, so tests point the home directory here instead of writing HOME.
const homeDirectory = vi.hoisted(() => ({ path: undefined as string | undefined }));
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, homedir: () => homeDirectory.path ?? os.homedir() };
});

async function withIsolatedHome(fn: (home: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mq-cli-home-'));
  homeDirectory.path = dir;
  try {
    await fn(dir);
  } finally {
    homeDirectory.path = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('root command registration', () => {
  it('registers the folded content grammar without subsurfaces', () => {
    const program = createProgram();
    const content = program.program.commands.find((command) => command.name() === 'content');
    const names = content?.commands.map((command) => command.name()) ?? [];

    expect(names).toEqual(['search', 'view']);
    expect(names).not.toContain('open');
    expect(names).not.toContain('markets');
    expect(names).not.toContain('research');
  });
  it('omits deferred placeholder command groups from help', () => {
    const { program } = createProgram(() => {});

    expect(program.helpInformation()).not.toContain('ptp');
    expect(program.helpInformation()).not.toContain('visual-structuring');
    expect(program.commands.find((command) => command.name() === 'ptp')).toBeUndefined();
    expect(program.commands.find((command) => command.name() === 'visual-structuring')).toBeUndefined();
  });

});

describe('auth commands', () => {
  async function loginWithIsolatedState(
    args: string[],
    configure: (transport: ReturnType<typeof createMockTransport>) => void = () => {},
  ) {
    let output = '';
    let error = '';
    const transport = createMockTransport({ '*': '' });
    configure(transport);
    await withIsolatedHome(async () => {
      const authDir = mkdtempSync(join(tmpdir(), 'mq-cli-auth-'));
      try {
        const { program } = createProgram(
          (chunk) => { output += chunk; }, transport,
          undefined,
          {
            cookieJarPath: join(authDir, 'cookies.json'),
            browserStatePath: join(authDir, 'browser-state.json'),
            writeError: (chunk) => { error += chunk; },
          },
        );
        await runOutLoginPolling(() => program.parseAsync(args, { from: 'user' }));
      } finally {
        rmSync(authDir, { recursive: true, force: true });
      }
    });
    return { output, error, transport };
  }

  // Login polls the browser between real waits; a fake clock runs them out, so a
  // browser answer login does not accept fails the test at once instead of timing out.
  async function runOutLoginPolling(parse: () => Promise<unknown>) {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const command = { settled: false };
    const done = parse().finally(() => { command.settled = true; });
    done.catch(() => {});
    try {
      while (!command.settled) {
        // eslint-disable-next-line no-await-in-loop -- advances the fake clock until the command settles
        await vi.advanceTimersByTimeAsync(250);
        // eslint-disable-next-line no-await-in-loop -- lets real file I/O finish between clock steps
        await new Promise((resolve) => { setImmediate(resolve); });
      }
    } finally {
      vi.useRealTimers();
      await done;
    }
  }

  it('auth login saves the SSO profile flags before opening the browser', async () => {
    const restoreStdin = mockStdin('contract-password\n');
    try {
      const { output, transport } = await loginWithIsolatedState([
        'auth', 'login',
        '--url', 'https://marquee.gs.com/s/',
        '--username', 'testuser',
        '--password-stdin',
      ]);

      expect(transport.run).toHaveBeenCalledWith(
        'auth',
        ['save', 'marquee', '--url', 'https://marquee.gs.com/s/', '--username', 'testuser', '--password-stdin'],
        { stdin: 'contract-password' },
      );
      const commands = transport.run.mock.calls.map(([command]) => command);
      expect(commands.indexOf('auth')).toBeLessThan(commands.indexOf('open'));
      expect(output).toContain('Opening browser for SSO login...');
      expect(output).toContain('Login successful. Session saved.');
    } finally {
      restoreStdin();
    }
  });

  it('auth login defaults the saved --url to marquee SSO', async () => {
    const { transport } = await loginWithIsolatedState(['auth', 'login', '--username', 'testuser']);

    expect(transport.run).toHaveBeenCalledWith(
      'auth',
      ['save', 'marquee', '--url', 'https://marquee.gs.com/s/', '--username', 'testuser'],
    );
  });

  it('auth login --password-stdin rejects interactive input instead of waiting', async () => {
    const originalIsTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const on = vi.spyOn(process.stdin, 'on').mockImplementation(() => {
      throw new Error('stdin read attempted');
    });
    let error = '';
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(
      () => {}, transport, undefined,
      { writeError: (chunk) => { error += chunk; } },
    );

    try {
      await program.parseAsync(
        ['auth', 'login', '--username', 'testuser', '--password-stdin'],
        { from: 'user' },
      );
    } finally {
      on.mockRestore();
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTty, configurable: true });
    }

    expect(error.trim()).toBe('Login failed: --password-stdin requires piped input');
    expect(process.exitCode).toBe(1);
    expect(transport.run).not.toHaveBeenCalled();
  });

  it('auth login without --password-stdin does not read stdin', async () => {
    const on = vi.spyOn(process.stdin, 'on').mockImplementation(() => {
      throw new Error('stdin read attempted');
    });
    try {
      const { transport } = await loginWithIsolatedState(['auth', 'login', '--username', 'testuser']);
      expect(transport.run).toHaveBeenCalledWith('auth', [
        'save', 'marquee', '--url', 'https://marquee.gs.com/s/', '--username', 'testuser',
      ]);
    } finally {
      on.mockRestore();
    }
  });

  it('auth login stops with a nonzero exit code when the profile cannot be saved', async () => {
    const { error, transport } = await loginWithIsolatedState(
      ['auth', 'login', '--username', 'testuser'],
      (mock) => {
        mock.run.mockImplementation(async (command: string) => {
          if (command === 'auth') throw new Error('auth save transport failed');
          return '';
        });
      },
    );

    expect(error.trim()).toBe('Login failed: SSO credentials could not be saved. Try again.');
    expect(error).not.toContain('transport failed');
    expect(transport.run).not.toHaveBeenCalledWith('open', expect.anything(), expect.anything());
    expect(process.exitCode).toBe(1);
  });

  it('auth logout removes the stored session files and the saved SSO profile', async () => {
    await withIsolatedHome(async (home) => {
      const authDir = mkdtempSync(join(tmpdir(), 'mq-cli-auth-'));
      const cookieJarPath = join(authDir, 'cookies.json');
      const browserStatePath = join(authDir, 'browser-state.json');
      const profileDir = join(home, '.agent-browser', 'auth');
      const profilePath = join(profileDir, 'marquee.json');
      mkdirSync(profileDir, { recursive: true });
      for (const path of [cookieJarPath, browserStatePath, profilePath]) {
        writeFileSync(path, JSON.stringify({ cookies: [], updatedAt: 0 }));
      }
      try {
        let output = '';
        const { program } = createProgram(
          (chunk) => { output += chunk; }, createMockTransport({ '*': '' }),
          undefined,
          { cookieJarPath, browserStatePath },
        );

        await program.parseAsync(['auth', 'logout'], { from: 'user' });

        expect(output.trim()).toBe('Logged out of marquee.gs.com.');
        expect([cookieJarPath, browserStatePath, profilePath].map((path) => existsSync(path)))
          .toEqual([false, false, false]);
        expect(process.exitCode).toBeUndefined();
      } finally {
        rmSync(authDir, { recursive: true, force: true });
      }
    });
  });

  it('auth login honors AGENT_BROWSER_ENCRYPTION_KEY for saved credentials', async () => {
    await withIsolatedHome(async (home) => {
      const authDir = mkdtempSync(join(tmpdir(), 'mq-cli-auth-'));
      const cookieJarPath = join(authDir, 'cookies.json');
      const browserStatePath = join(authDir, 'browser-state.json');
      const { randomBytes, createCipheriv } = await import('node:crypto');
      const { mkdirSync } = await import('node:fs');
      const key = randomBytes(32);
      vi.stubEnv('AGENT_BROWSER_ENCRYPTION_KEY', key.toString('hex'));
      try {
        // Profile encrypted with the env key; no ~/.agent-browser/.encryption-key
        // file exists (agent-browser only auto-generates it when the env var is
        // not set).
        const abAuthDir = join(home, '.agent-browser', 'auth');
        mkdirSync(abAuthDir, { recursive: true });
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const data = Buffer.concat([
          cipher.update(JSON.stringify({ username: 'user@example.com', password: 'pw' }), 'utf8'),
          cipher.final(),
        ]);
        writeFileSync(join(abAuthDir, 'marquee.json'), JSON.stringify({
          encrypted: true,
          iv: iv.toString('base64'),
          authTag: cipher.getAuthTag().toString('base64'),
          data: data.toString('base64'),
        }), 'utf-8');

        let output = '';
        const transport = createMockTransport({ '*': '' });
        const { program } = createProgram(
          (chunk) => { output += chunk; }, transport,
          undefined,
          { cookieJarPath, browserStatePath },
        );

        await runOutLoginPolling(() => program.parseAsync(['auth', 'login'], { from: 'user' }));

        expect(output).toContain('Opening browser for SSO login...');
        expect(output).toContain('Login successful');
        expect(output).not.toContain('No saved credentials');
      } finally {
        vi.unstubAllEnvs();
        rmSync(authDir, { recursive: true, force: true });
      }
    });
  });

  it('auth login reports missing agent-browser before opening the browser', async () => {
    let output = '';
    const transport = createMockTransport({ '*': '' });
    transport.run.mockImplementation(async (command: string, _args: string[] = [], _opts: TransportOpts = {}) => {
      if (command === '--version') {
        throw Object.assign(new Error('spawn agent-browser ENOENT'), { code: 'ENOENT' });
      }
      return '';
    });
    let error = '';
    const { program } = createProgram(
      (chunk) => { output += chunk; }, transport, undefined,
      { writeError: (chunk) => { error += chunk; } },
    );

    await program.parseAsync(['auth', 'login'], { from: 'user' });

    expect(error).toContain('agent-browser is not installed or not on PATH');
    expect(error).not.toContain('--headed');
    expect(output).toBe('');
    expect(process.exitCode).toBe(1);
  });

  it('auth login publishes the cookie jar and the browser state', async () => {
    await withIsolatedHome(async () => {
      const authDir = mkdtempSync(join(tmpdir(), 'mq-cli-auth-'));
      const cookieJarPath = join(authDir, 'cookies.json');
      const browserStatePath = join(authDir, 'browser-state.json');
      const restoreStdin = mockStdin('unused-password\n');
      try {
        let output = '';
        const transport = createMockTransport({ '*': '' });
        const { program } = createProgram(
          (chunk) => { output += chunk; }, transport,
          undefined,
          { cookieJarPath, browserStatePath },
        );

        await runOutLoginPolling(() => program.parseAsync(['auth', 'login', '--username', 'testuser', '--password-stdin'], { from: 'user' }));

        expect(transport.run).toHaveBeenCalledWith('--version');
        expect(output).toContain('Login successful. Session saved.');
        expect(process.exitCode).toBeUndefined();
        expect(existsSync(cookieJarPath)).toBe(true);
        expect(existsSync(browserStatePath)).toBe(true);
      } finally {
        restoreStdin();
        rmSync(authDir, { recursive: true, force: true });
      }
    });
  });
});

describe('unknown commands', () => {
  it('guides reserved widget verbs to the nearest implemented path', async () => {
    const transport = createMockTransport({});
    const { program } = createProgram(
      () => {}, transport,
    );

    await expect(
      program.parseAsync(['marketview', 'widget', 'describe', '@w1'], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'marquee.reservedVerb',
      message: "reserved verb 'describe' is not implemented here; use 'marquee marketview widget view'",
    });

    expect(transport.run).not.toHaveBeenCalled();
  });

  it.each([
    ['explain', 'marquee marketview widget view'],
    ['list', 'marquee marketview widget view'],
    ['delete', 'marquee marketview widget view'],
    ['describe', 'marquee marketview widget view'],
    ['apply', 'marquee marketview widget view'],
    ['delete', 'marquee marketview dashboard edit'],
    ['describe', 'marquee marketview dashboard view'],
    ['list', 'marquee content view'],
  ])('types reserved %s errors and names %s', async (verb, nearestPath) => {
    const { program } = createProgram(() => {});
    const path = nearestPath.split(' ').slice(1, -1);

    await expect(
      program.parseAsync([...path, verb], { from: 'user' }),
    ).rejects.toMatchObject({
      name: 'ReservedVerbError',
      code: 'marquee.reservedVerb',
      message: `reserved verb '${verb}' is not implemented here; use '${nearestPath}'`,
    });
  });

  it('rejects unrecognized commands', async () => {
    const transport = createMockTransport({});
    const { program } = createProgram(
      () => {}, transport,
    );

    await expect(
      program.parseAsync(['nonsense'], { from: 'user' }),
    ).rejects.toThrow();

    expect(transport.run).not.toHaveBeenCalled();
  });

  it('rejects unrecognized commands even when help is requested', async () => {
    const transport = createMockTransport({});
    const { program } = createProgram(
      () => {}, transport,
    );

    await expect(
      program.parseAsync(['nonsense', '--help'], { from: 'user' }),
    ).rejects.toThrow(/unknown command 'nonsense'/);

    expect(transport.run).not.toHaveBeenCalled();
  });
});
