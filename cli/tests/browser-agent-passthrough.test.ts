import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBrowserInvocation } from '../../agent-browser-runtime/index.js';
import { createProgram } from '../../cli-composition/index.js';
import type { TransportOpts } from '../browser-transport.js';

function createMockTransport(output = '') {
  return {
    run: vi.fn(async (_command: string, _args: string[] = [], _opts: TransportOpts = {}) => output),
    saveState: vi.fn(async () => {}),
    close: vi.fn(async () => output),
  };
}

async function runBrowser(argv: string[], transport = createMockTransport()) {
  let output = '';
  const { program } = createProgram((chunk) => { output += chunk; }, { authTransport: transport });
  await program.parseAsync(['browser', ...argv], { from: 'user' });
  return { output, transport };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllEnvs();
});

describe('browser forwards agent-browser commands', () => {
  it.each([
    [['click', '@e1', '--new-tab', '--human']],
    [['select', '@e1', 'opt1', 'opt2']],
    [['keyboard', 'inserttext', 'paste me']],
    [['scroll', 'down', '500', '-s', 'div.content']],
    [['wait', '--download', '/tmp/report.pdf', '--timeout', '30000']],
    [['find', 'role', 'button', 'click', '--name', 'Submit', '--exact']],
    [['get', 'title', '--json']],
    [['network', 'request', '22948.2', '--json']],
    [['network', 'har', 'start', '--content', 'all']],
    [['diff', 'screenshot', '-b', 'before.png', '--threshold', '0.2']],
    [['webmcp', 'invoke', 'search', '--params', '{}', '--detach']],
    [['screenshot', '#chart', '/tmp/shot.jpg', '-f', '--screenshot-format', 'jpeg']],
    [['click', '--help']],
  ])('forwards %j verbatim', async (argv) => {
    const { transport } = await runBrowser(argv);

    expect(transport.run.mock.calls).toEqual([[argv[0], argv.slice(1)]]);
    expect(process.exitCode).toBeUndefined();
  });

  it('emits agent-browser stdout byte-for-byte', async () => {
    const stdout = '  {"Authorization":"Bearer synthetic-token","ok":true}';

    const { output } = await runBrowser(['network', 'requests', '--json'], createMockTransport(stdout));

    expect(output).toBe(stdout);
  });

  it('labels a forwarded failure with its command', async () => {
    const transport = createMockTransport();
    transport.run.mockRejectedValue(new Error('Request not found'));

    const { output } = await runBrowser(['network', 'request', '99999.9'], transport);

    expect(output).toBe('network failed: Request not found\n');
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ...[
      'auth', 'batch', 'chat', 'clipboard', 'confirm', 'connect', 'console', 'cookies',
      'dashboard', 'deny', 'doctor', 'download', 'errors', 'highlight', 'inspect', 'install',
      'mcp', 'mouse', 'pdf', 'plugin', 'profiles', 'profiler', 'pushstate', 'react', 'read',
      'record', 'removeinitscript', 'set', 'skills', 'state', 'storage', 'stream', 'trace',
      'upgrade', 'upload', 'vitals',
    ].map((command): [string[], string] => [[command, '--json'], command]),
    ...[
      '--namespace', '--cdp', '--auto-connect', '--profile', '--state', '--headers',
      '--restore', '--restore-save', '--restore-check-url', '--restore-check-text',
      '--restore-check-fn', '--session-name', '--config',
    ].map((option): [string[], string] => [['get', 'url', option, 'value'], option]),
    [['get', 'url', '--profile=Default'], '--profile=Default'],
    [['open', 'https://example.com', '--state', 'auth.json'], '--state'],
    ...([
      ['--executable-path', 'AGENT_BROWSER_EXECUTABLE_PATH'],
      ['--extension', 'AGENT_BROWSER_EXTENSIONS'],
      ['--init-script', 'AGENT_BROWSER_INIT_SCRIPTS'],
      ['--enable', 'AGENT_BROWSER_ENABLE'],
      ['--args', 'AGENT_BROWSER_ARGS'],
      ['--user-agent', 'AGENT_BROWSER_USER_AGENT'],
      ['--proxy', 'AGENT_BROWSER_PROXY'],
      ['--proxy-bypass', 'AGENT_BROWSER_PROXY_BYPASS'],
      ['--ignore-https-errors', 'AGENT_BROWSER_IGNORE_HTTPS_ERRORS'],
      ['--ca-cert', 'AGENT_BROWSER_CA_CERT'],
      ['--no-ca-cert', 'AGENT_BROWSER_CLEAR_CA_CERT'],
      ['--allow-file-access', 'AGENT_BROWSER_ALLOW_FILE_ACCESS'],
      ['--hide-scrollbars', 'AGENT_BROWSER_HIDE_SCROLLBARS'],
      ['-p', 'AGENT_BROWSER_PROVIDER'],
      ['--provider', 'AGENT_BROWSER_PROVIDER'],
      ['--device', 'AGENT_BROWSER_IOS_DEVICE'],
      ['--webgpu', 'AGENT_BROWSER_WEBGPU'],
      ['--no-webmcp', 'AGENT_BROWSER_NO_WEBMCP'],
      ['--color-scheme', 'AGENT_BROWSER_COLOR_SCHEME'],
      ['--download-path', 'AGENT_BROWSER_DOWNLOAD_PATH'],
      ['--engine', 'AGENT_BROWSER_ENGINE'],
      ['--allowed-domains', 'AGENT_BROWSER_ALLOWED_DOMAINS'],
    ] as const).map(([option, env]): [string[], string] => [
      ['open', option, 'value', 'MW123'], `${option}; set ${env} instead`,
    ]),
    [['get', 'url', '--proxy=http://user:pass@proxy'], '--proxy; set AGENT_BROWSER_PROXY instead'],
    [['snapshot', '--headed'], '--headed; set AGENT_BROWSER_HEADED=1 instead'],
    [['fill', '@e1', '-p'], '-p; set AGENT_BROWSER_PROVIDER instead'],
    [['fill', '@e1', '--', '-p'], '-p; set AGENT_BROWSER_PROVIDER instead'],
    [['open', '--headed', 'MW123'], '--headed; set AGENT_BROWSER_HEADED=1 instead'],
    [['--session', 's1', 'cookies'], 'cookies'],
    [['tab', 'new', '--headed', 'MW123'], '--headed; set AGENT_BROWSER_HEADED=1 instead'],
    [['get', 'title', '--headed=true'], '--headed; set AGENT_BROWSER_HEADED=1 instead'],
  ])('rejects denied agent-browser surface in %j', async (argv, denied) => {
    const { output, transport } = await runBrowser(argv);

    expect(output).toBe(`Error: marquee browser does not forward agent-browser ${denied}\n`);
    expect(process.exitCode).toBe(1);
    expect(transport.run).not.toHaveBeenCalled();
  });

  it('rejects a flag before the command, where it would hide the command from the denylist', async () => {
    const { output, transport } = await runBrowser(['--json', 'cookies']);

    expect(output).toBe('Error: put --json after the command: marquee browser <command> [flags]\n');
    expect(process.exitCode).toBe(1);
    expect(transport.run).not.toHaveBeenCalled();
  });

  it('shows help when no command is given', async () => {
    await expect(runBrowser([])).rejects.toMatchObject({ message: '(outputHelp)', exitCode: 1 });
  });
});

describe('browser Marquee-owned commands forward their other flags', () => {
  it('open keeps flags around the resolved target', async () => {
    const { transport } = await runBrowser(['open', '--json', 'MW123', '--max-output', '100']);

    expect(transport.run.mock.calls).toEqual([
      ['open', ['--json', 'https://marquee.gs.com/s/marketview/widget/MW123', '--max-output', '100']],
      ['wait', ['--fn', expect.stringContaining('input[name="username"]')]],
      ['get', ['url']],
    ]);
  });

  it('open forwards flags without a target', async () => {
    const { transport } = await runBrowser(['open', '--json']);

    expect(transport.run.mock.calls).toEqual([['open', ['--json']]]);
  });

  it('close forwards its flags instead of closing the default session', async () => {
    const { transport } = await runBrowser(['close', '--all', '--json']);

    expect(transport.run.mock.calls).toEqual([['close', ['--all', '--json']]]);
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('snapshot adds its Marquee flags ahead of the forwarded ones', async () => {
    const { transport } = await runBrowser(['snapshot', '--cursor', '-u', '--scope', '#main', '--json']);

    expect(transport.run.mock.calls).toEqual([['snapshot', ['-i', '-C', '-s', '#main', '-u', '--json']]]);
  });

  it('is forwards flags after its state and ref', async () => {
    const { transport } = await runBrowser(['is', 'visible', '@e1', '--json']);

    expect(transport.run.mock.calls).toEqual([['is', ['visible', '@e1', '--json']]]);
  });
});

describe('browser runs in the named Browser Session', () => {
  beforeEach(() => {
    // Any call that bypassed the fake runtime reaches this stub rather than a real browser.
    vi.stubEnv('MARQUEE_HTTP_REPLAY', 'fixture');
    vi.stubEnv('MARQUEE_AGENT_BROWSER_REPLAY_BIN', fileURLToPath(
      new URL('../../../contract/_stubs/browser-session/agent-browser.js', import.meta.url),
    ));
    // No agent host identity, so an unnamed command runs in the `marquee` Browser Session.
    for (const name of [
      'MARQUEE_INTERACTION_SESSION_ID',
      'MARQUEE_OWNER_SESSION_ID',
      'CODEX_THREAD_ID',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_SESSION_ID',
    ]) vi.stubEnv(name, undefined);
  });

  it('routes to marquee-<hash> of the agent host identity without a name', async () => {
    vi.stubEnv('AGENT_BROWSER_SESSION', undefined);
    vi.stubEnv('CODEX_THREAD_ID', 'conversation-a');

    expect(await runInSession(['get', 'url'])).toEqual(['marquee-6a46a0e170d8bf41 get url']);
  });

  async function runInSession(argv: string[], cookieJarPath?: string) {
    const invocations: AgentBrowserInvocation[] = [];
    const browserRuntime = {
      async execute(invocation: AgentBrowserInvocation) {
        invocations.push(invocation);
        const stdout = invocation.argv[0] === 'tab' ? '{"data":{"tabs":[]}}' : '';
        return { stdout, stderr: '' };
      },
    };
    const { program } = createProgram(() => {}, { browserRuntime, ...(cookieJarPath ? { cookieJarPath } : {}) });
    await program.parseAsync(['browser', ...argv], { from: 'user' });
    // A launch option would show as `headed=<value>`.
    return invocations.map(({ session, headed, argv: args }) => (
      [session, ...(headed === undefined ? [] : [`headed=${headed}`]), ...args].join(' ')
    ));
  }

  it.each([
    [['--session', 's1', 'get', 'url'], 's1 get url'],
    [['--session=s1', 'get', 'url'], 's1 get url'],
    [['get', 'url', '--session', 's1'], 's1 get url'],
    [['get', 'url', '--session=s1'], 's1 get url'],
    [['--session', 's1', 'snapshot'], 's1 snapshot -i'],
    [['--session', 's1', 'close'], 's1 close'],
    [['close', '--all', '--session', 's1'], 's1 close --all'],
    [['--session', 's1', 'session', 'list'], 's1 session list'],
    [['get', 'url', '--session'], 's2 get url --session'],
  ])('routes %j to its Browser Session', async (argv, invocation) => {
    vi.stubEnv('AGENT_BROWSER_SESSION', 's2');

    expect(await runInSession(argv)).toEqual([invocation]);
  });

  it('checks the opened tab for sign-in in the same Browser Session', async () => {
    vi.stubEnv('AGENT_BROWSER_SESSION', 's2');

    expect(await runInSession(['--session', 's1', 'open', 'MW123'])).toEqual([
      's1 open https://marquee.gs.com/s/marketview/widget/MW123',
      expect.stringMatching(/^s1 wait --fn /),
      's1 get url',
    ]);
  });

  it('routes to AGENT_BROWSER_SESSION without a flag', async () => {
    vi.stubEnv('AGENT_BROWSER_SESSION', 's2');

    expect(await runInSession(['get', 'url'])).toEqual(['s2 get url']);
  });

  it.each([
    [['--session=', 'get', 'url']],
    [['--session', '', 'get', 'url']],
    [['get', 'url', '--session=']],
    [['get', 'url', '--session', '']],
  ])('rejects the empty Browser Session name in %j', async (argv) => {
    let output = '';
    const { program } = createProgram((chunk) => { output += chunk; }, { browserRuntime: {
      async execute() { throw new Error('agent-browser ran'); },
    } });

    await program.parseAsync(['browser', ...argv], { from: 'user' });

    expect(output).toBe('Error: --session needs a Browser Session name\n');
    expect(process.exitCode).toBe(1);
  });

  it('treats an empty AGENT_BROWSER_SESSION as unset', async () => {
    vi.stubEnv('AGENT_BROWSER_SESSION', '');

    expect(await runInSession(['get', 'url'])).toEqual(['marquee get url']);
  });

  it('routes to the marquee Browser Session without a flag or AGENT_BROWSER_SESSION', async () => {
    vi.stubEnv('AGENT_BROWSER_SESSION', undefined);

    expect(await runInSession(['get', 'url'])).toEqual(['marquee get url']);
  });

  describe('with a Marquee login', () => {
    let dir: string;

    function cookieJar(): string {
      dir = mkdtempSync(join(tmpdir(), 'mq-browser-session-'));
      const path = join(dir, 'cookies.json');
      writeFileSync(path, JSON.stringify({
        cookies: [{ name: 'MarqueeLogin', value: 'login', domain: 'marquee.gs.com', path: '/' }],
        updatedAt: 0,
      }));
      return path;
    }

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('signs the named Browser Session in before the command, with no launch option', async () => {
      const invocations = await runInSession(['--session', 's1', 'get', 'url'], cookieJar());

      expect(invocations.map((invocation) => invocation.split(' ').slice(0, 3).join(' '))).toEqual([
        's1 cookies set',
        's1 get url',
      ]);
    });

    it.each([
      [['session'], 's1 session'],
      [['session', 'list'], 's1 session list'],
    ])('leaves %j unsynced, so it launches no browser', async (argv, invocation) => {
      expect(await runInSession(['--session', 's1', ...argv], cookieJar())).toEqual([invocation]);
    });

    it('leaves close --all unsynced', async () => {
      vi.stubEnv('AGENT_BROWSER_SESSION', undefined);

      expect(await runInSession(['close', '--all'], cookieJar())).toEqual(['marquee close --all']);
    });
  });
});
