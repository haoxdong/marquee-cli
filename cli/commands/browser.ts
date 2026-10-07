import { Command } from 'commander';
import type {
  AgentBrowserTransport,
  BrowserRegistration,
} from '../../cli-composition/types.js';
import {
  writeLine,
  type Writer,
} from '../../presentation/index.js';
import { MarqueeError } from '../../transport/index.js';
import { cliExitCode } from '../../cli-composition/top-level-error.js';
import type { TransportOpts } from '../browser-transport.js';
const SIGN_IN_HOST = 'idfs.gs.com';

// agent-browser surface marquee does not forward, launch options included;
// contract/browser-agent-parity.yaml records the rationale for each entry and its parity
// contract keeps these lists in step.
const DENIED_COMMANDS = new Set([
  'auth', 'batch', 'chat', 'clipboard', 'confirm', 'connect', 'console', 'cookies',
  'dashboard', 'deny', 'doctor', 'download', 'errors', 'highlight', 'inspect', 'install',
  'mcp', 'mouse', 'pdf', 'plugin', 'profiles', 'profiler', 'pushstate', 'react', 'read',
  'record', 'removeinitscript', 'set', 'skills', 'state', 'storage', 'stream', 'trace',
  'upgrade', 'upload', 'vitals',
]);
const DENIED_OPTIONS = [
  '--namespace', '--cdp', '--auto-connect', '--profile', '--state', '--headers',
  '--restore', '--restore-save', '--restore-check-url', '--restore-check-text',
  '--restore-check-fn', '--session-name', '--config',
];
// agent-browser relaunches Chrome, dropping the synced Marquee cookies, whenever a call's launch
// options differ from the running browser's; each option's env form applies to every call alike.
const LAUNCH_OPTION_ENV = new Map([
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
  // AGENT_BROWSER_HEADED takes a value, so the hint names it.
  ['--headed', 'AGENT_BROWSER_HEADED=1'],
]);

function writeErrorLine(write: Writer, line: string, error?: unknown): void {
  process.exitCode = cliExitCode(error);
  writeLine(write, line);
}

function formatTransportCommandError(command: string, error: unknown): string {
  if (error instanceof MarqueeError) return error.message;
  return `${command} failed: ${error instanceof Error ? error.message : String(error)}`;
}

// The tab has settled on Marquee, or on the IDFS sign-in form that `marquee auth login` waits for.
// `tab new` returns while its tab is still about:blank, and an idfsSSO resume passes through IDFS
// without that form on its way back to Marquee.
const TAB_SETTLED = `location.hostname === 'marquee.gs.com' || document.querySelector('input[name="username"]') !== null`;

// A Marquee navigation that settles on the IDFS sign-in page means the session has expired.
async function assertTabSignedIn(transport: AgentBrowserTransport): Promise<void> {
  await transport.run('wait', ['--fn', TAB_SETTLED]);
  const tabUrl = await transport.run('get', ['url']);
  if (URL.parse(tabUrl)?.hostname === SIGN_IN_HOST) {
    throw new MarqueeError('auth_expired', 'Not authenticated. Run: marquee auth login');
  }
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.reject(new Error('--stdin requires piped input'));
  }
  return new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    if (process.stdin.isPaused()) process.stdin.resume();
  });
}

function isMarqueeWebUrl(url: string): boolean {
  try {
    return new URL(url.trim()).hostname === 'marquee.gs.com';
  } catch {
    return false;
  }
}

type Argv = [command: string, ...args: string[]];

/**
 * Takes agent-browser's `--session <name>` out of `argv`, since the transport passes the resolved
 * session. A `--session` without a value stays in argv; agent-browser ignores it after the
 * transport's own `--session`.
 */
function takeSession(argv: Argv): { session?: string; argv: Argv } {
  const index = argv.findIndex((arg) => arg === '--session' || arg.startsWith('--session='));
  const flag = argv[index];
  const isInline = flag !== '--session';
  const session = isInline ? flag?.slice('--session='.length) : argv[index + 1];
  if (session === undefined) return { argv };
  const rest = [...argv.slice(0, index), ...argv.slice(index + (isInline ? 1 : 2))] as Argv;
  return { session, argv: rest };
}

/** What marquee refuses to forward in `argv`: a denied command or option, plus the env var for a launch option. */
function denial(argv: Argv): string | undefined {
  if (DENIED_COMMANDS.has(argv[0])) return argv[0];
  // agent-browser 0.38.1 reads its global flags anywhere in argv, operands and `--` included:
  // `fill @e1 -p` fills nothing and takes -p as --provider, so every token is checked.
  for (const arg of argv) {
    const matches = (option: string): boolean => arg === option || arg.startsWith(`${option}=`);
    if (DENIED_OPTIONS.some(matches)) return arg;
    // Only the option name: a launch value such as a proxy URL can carry credentials.
    const launch = [...LAUNCH_OPTION_ENV].find(([option]) => matches(option));
    if (launch) return `${launch[0]}; set ${launch[1]} instead`;
  }
  return undefined;
}

/** Whether `argv` is an `open` or `tab new` that navigates to a Marquee URL. */
function navigatesToMarquee([command, ...args]: Argv): boolean {
  // agent-browser takes global flags, some with values, before the operation too.
  const navigates = command === 'open' || (command === 'tab' && args.includes('new'));
  return navigates && args.some(isMarqueeWebUrl);
}

function run(transport: AgentBrowserTransport, argv: Argv, opts?: TransportOpts): Promise<string> {
  const [command, ...args] = argv;
  return opts ? transport.run(command, args, opts) : transport.run(command, args);
}

export function registerBrowserCommands(parent: Command, ctx: BrowserRegistration): void {
  const { write } = ctx;

  /**
   * Runs `argv` through agent-browser unless denied, emitting its stdout byte-for-byte (ADR 0050),
   * in the Browser Session a `--session` flag before or after the command names.
   */
  async function forward(
    commandArgv: Argv,
    invoke: (transport: AgentBrowserTransport, argv: Argv) => Promise<string> = run,
    fail: (error: unknown) => void = (error) => writeErrorLine(write, formatTransportCommandError(commandArgv[0], error), error),
  ): Promise<void> {
    const { session: trailingSession, argv } = takeSession(commandArgv);
    const session = trailingSession ?? browser.opts<{ session?: string }>().session;
    if (session === '') {
      writeErrorLine(write, 'Error: --session needs a Browser Session name');
      return;
    }
    const denied = denial(argv);
    if (denied) {
      writeErrorLine(write, `Error: marquee browser does not forward agent-browser ${denied}`);
      return;
    }
    try {
      const transport = ctx.getBrowserTransport(session);
      const output = await invoke(transport, argv);
      if (navigatesToMarquee(argv)) await assertTabSignedIn(transport);
      write(output);
    } catch (error) {
      fail(error);
    }
  }

  const browser = parent
    .command('browser')
    .description('Interact with Marquee pages in a browser')
    .option('--session <name>', 'Browser Session to run in (default: AGENT_BROWSER_SESSION, then marquee-<hash> of the agent host session, else marquee)')
    .argument('[command...]', 'any other agent-browser command, forwarded verbatim with its flags')
    .allowUnknownOption()
    .passThroughOptions()
    .helpCommand(true)
    .action(async (argv: string[]) => {
      const [command, ...args] = argv;
      if (command === undefined) return browser.help({ error: true });
      if (command.startsWith('-')) {
        writeErrorLine(write, `Error: put ${command} after the command: marquee browser <command> [flags]`);
        return;
      }
      await forward([command, ...args]);
    });

  /** A command with Marquee-owned logic; flags it does not declare pass through verbatim. */
  function ownedCommand(name: string, description: string): Command {
    return browser.command(name).description(description).allowUnknownOption().allowExcessArguments();
  }

  ownedCommand('open', 'Open in browser')
    .argument('[target]', 'Marquee ID or URL')
    .action(async (_target: string | undefined, _options: object, command: Command) => {
      const args = command.args;
      // Flag values are operands too, so the target is the ref or ID/URL naming a Marquee page.
      const index = args.findIndex((arg) => {
        if (arg.startsWith('@')) return true;
        const { url } = ctx.resolveBrowserOpenTarget(arg);
        return url !== undefined && isMarqueeWebUrl(url);
      });
      const target = args[index];
      if (target === undefined) {
        await forward(['open', ...args]);
        return;
      }
      const { url, error } = ctx.resolveBrowserOpenTarget(target);
      if (!url) {
        writeErrorLine(write, error ?? `Error: cannot open ${target}`);
        return;
      }
      await forward(['open', ...args.slice(0, index), url, ...args.slice(index + 1)]);
    });

  ownedCommand('close', 'Shut down browser session')
    .action(async (_options: object, command: Command) => {
      await forward(['close', ...command.args], (transport, argv) => (
        argv.length > 1 ? run(transport, argv) : transport.close()
      ));
    });

  ownedCommand('snapshot', 'Show interactive element refs')
    .option('--all', 'full accessibility tree (default: interactive only)')
    .option('--cursor', 'include cursor-interactive elements')
    .option('--scope <selector>', 'scope to CSS selector')
    .action(async (options: { all?: boolean; cursor?: boolean; scope?: string }, command: Command) => {
      await forward([
        'snapshot',
        ...(options.all ? [] : ['-i']),
        ...(options.cursor ? ['-C'] : []),
        ...(options.scope ? ['-s', options.scope] : []),
        ...command.args,
      ]);
    });

  ownedCommand('eval', 'Evaluate raw JS in browser')
    .argument('[code]', 'JavaScript code to evaluate')
    .option('--stdin', 'read code from stdin')
    .action(async (_code: string | undefined, options: { stdin?: boolean }, command: Command) => {
      if (!options.stdin) {
        await forward(['eval', ...command.args]);
        return;
      }
      let stdin: string;
      try {
        stdin = await readStdin();
      } catch (error) {
        writeErrorLine(write, `Error: ${(error as Error).message}`);
        return;
      }
      await forward(['eval', '--stdin', ...command.args], (transport, argv) => run(transport, argv, { stdin }));
    });

  ownedCommand('is', 'Check element state')
    .argument('<state>', 'visible, enabled, or checked')
    .argument('<ref>', 'element ref or selector')
    .action(async (state: string, _ref: string, _options: object, command: Command) => {
      await forward(['is', ...command.args], undefined, (error) => {
        writeLine(write, `browser is ${state}: unavailable: ${formatTransportCommandError(`is ${state}`, error)}`);
      });
    });
}
