import { configureGhHelp } from '../help.js';
import {
  createProviderEvidenceLog,
} from '../evidence.js';
import {
  createAgentBrowserRuntime,
  type AgentBrowserInvocation,
  type AgentBrowserRuntime,
} from '../../agent-browser-runtime/index.js';
import {
  createBrowserTransport,
  resolveBrowserSession,
} from '../../cli/browser-transport.js';
import {
  MarqueeError,
  type Transport,
  type TransportConfig,
  createTransport,
} from '../../transport/index.js';
import { createAuth } from '../../auth/index.js';
import {
  createAuthBrowserRuntime,
  readBrowserStateCookies,
} from '../../auth/adapters/browser-runtime.js';
import { createEntityModule } from '../../entity/index.js';
import { createControlGroupModule } from '../../control-group/index.js';
import { createMarketView } from '../../marketview/index.js';
import { createConfiguredWidgetProjection } from '../../widget/composition.js';
import { createDocumentModule } from '../../document/index.js';
import { createContent } from '../../content/index.js';
import { createData } from '../../data/index.js';
import { createDashboardModule } from '../../dashboard/index.js';
import { createEntityFeedComposition } from '../../entity-feed/composition.js';
import { registerMarketviewCommands } from './marketview.js';
import { registerContentCommands } from './content.js';
import { registerDataCommands } from './data.js';
import { registerBrowserCommands } from '../../cli/commands/browser.js';
import { authOwnerAttachment } from './owners/auth.js';
import { apiOwnerAttachment } from './owners/api.js';
import type {
  MarketViewRegistration,
  ContentRegistration,
  DataRegistration,
  AuthRegistration,
  ApiRegistration,
} from './registrations.js';
import type {
  AgentBrowserTransport,
  BrowserRegistration,
  ProgramDependencies,
} from '../types.js';
import type { Writer } from '../../presentation/index.js';
import { createReferentRegistry } from '../../referent-registry/index.js';
import {
  resolveBrowserOpenTarget as resolveBrowserOpenTargetFromRegistry,
} from './browser-target.js';
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';

function defaultCookieJarPath(): string {
  return process.env.MARQUEE_COOKIE_JAR ?? join(homedir(), '.marquee', 'cookies.json');
}

function defaultBrowserStatePath(): string {
  return process.env.MARQUEE_BROWSER_STATE ?? join(homedir(), '.marquee', 'browser-state.json');
}

function lazy<T>(configured: T | undefined, create: () => T): () => T {
  let value = configured;
  return () => value ??= create();
}

function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined
  );
}

function parseUserArgs(
  argv: readonly string[] | undefined,
  from: 'node' | 'electron' | 'user' | undefined,
): string[] {
  const raw = Array.from(argv ?? process.argv);
  if (from === 'user') return raw;
  if (from === 'electron') return raw.slice(1);
  return raw.slice(2);
}

function findSubcommand(command: Command, name: string): Command | undefined {
  return command.commands.find((candidate) => (
    candidate.name() === name || candidate.aliases().includes(name)
  ));
}

const RESERVED_VERBS = new Set(['explain', 'list', 'delete', 'describe', 'apply']);

class ReservedVerbError extends Error {
  override readonly name = 'ReservedVerbError';
  readonly code = 'marquee.reservedVerb';
}

function nearestImplementedVerb(command: Command, reservedVerb: string): Command | undefined {
  const terminalCommands = command.commands.filter((candidate) => candidate.commands.length === 0);
  const preferredNames = reservedVerb === 'delete' || reservedVerb === 'apply'
    ? ['edit', 'view', 'search', 'create']
    : ['view', 'search', 'edit', 'create'];
  return preferredNames
    .map((name) => terminalCommands.find((candidate) => candidate.name() === name))
    .find((candidate) => candidate !== undefined);
}

function commandPath(command: Command, child: Command): string {
  const names = [child.name()];
  let current: Command | null = command;
  while (current) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(' ');
}

function resolveCommandToken(
  command: Command,
  arg: string,
  helpRequested: boolean,
  writeError: Writer,
): Command | undefined {
  const subcommand = findSubcommand(command, arg);
  if (subcommand) return subcommand;

  const nearest = RESERVED_VERBS.has(arg)
    ? nearestImplementedVerb(command, arg)
    : undefined;
  if (nearest) {
    const message = `reserved verb '${arg}' is not implemented here; use '${commandPath(command, nearest)}'`;
    writeError(`Error: ${message}\n`);
    throw new ReservedVerbError(message);
  }

  // A group that declares its own operands (browser forwards them to agent-browser) owns unknown ones.
  if (helpRequested && command.commands.length > 0 && command.registeredArguments.length === 0) {
    command.error(`error: unknown command '${arg}'`, { code: 'commander.unknownCommand' });
  }
  return undefined;
}

function validateCommandArgs(program: Command, args: string[], writeError: Writer): void {
  const helpRequested = args.some((arg) => arg === '--help' || arg === '-h');
  let command = program;
  for (const arg of args) {
    if (arg === '--' || arg === '--help' || arg === '-h') break;
    if (arg.startsWith('-')) continue;
    const nextCommand = resolveCommandToken(command, arg, helpRequested, writeError);
    if (!nextCommand) break;
    command = nextCommand;
  }
}

function installUnknownHelpGuard(program: Command, writeError: Writer): void {
  const parseAsync = program.parseAsync.bind(program);
  program.parseAsync = (async (
    argv?: readonly string[],
    parseOptions?: Parameters<Command['parseAsync']>[1],
  ) => {
    const args = parseUserArgs(argv, parseOptions?.from);
    const [command, ...rest] = args;
    const bareHelpCommand = command === undefined
      ? program
      : rest.length === 0 && ['marketview', 'content', 'data', 'auth'].includes(command)
        ? findSubcommand(program, command)
        : undefined;
    if (bareHelpCommand) {
      bareHelpCommand.outputHelp();
      return program;
    }
    validateCommandArgs(program, args, writeError);

    return parseAsync(argv, parseOptions);
  });
}

function createLoginRuntimeForProgram(
  authTransport: AgentBrowserTransport | undefined,
): AgentBrowserRuntime | undefined {
  if (!authTransport) return undefined;
  return {
    async execute(invocation: AgentBrowserInvocation) {
      // Login always names an agent-browser command.
      const [command, ...rest] = invocation.argv as readonly [string, ...string[]];
      if (command === '--version') {
        const stdout = await authTransport.run('--version');
        return { stdout, stderr: '' };
      }
      if (command === 'eval') {
        const script = rest[0] ?? '';
        return {
          stdout: script.includes('"authed"') ? 'authed' : 'true',
          // Stryker disable next-line StringLiteral: login reads only an eval's stdout, never its stderr
          stderr: '',
        };
      }
      if (command === 'cookies' && rest[0] === 'get') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: { cookies: [{ name: 'test', value: '1', domain: 'marquee.gs.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }] },
          }),
          stderr: '',
        };
      }
      const stdout = command === 'auth'
        ? invocation.stdin === undefined
          ? await authTransport.run(command, rest)
          : await authTransport.run(command, rest, { stdin: invocation.stdin })
        : await authTransport.run(command, rest, {
            headed: invocation.headed === true,
            stdin: invocation.stdin,
          });
      return { stdout, stderr: '' };
    },
  };
}

function buildProgram(write: Writer, programOptions: ProgramDependencies = {}) {
  const program = new Command();
  const writeError = programOptions.writeError ?? ((chunk: string) => process.stderr.write(chunk));
  let httpTransport: Transport | undefined;
  let browserAuthState: ReturnType<typeof createAuthBrowserRuntime> | undefined;
  const evidence = createProviderEvidenceLog();
  const { refStoreDir } = programOptions;
  const requester = (owner: string) => getHttpTransport().provider({ owner, evidence });
  const moduleCache = () => (
    isTestEnvironment() && refStoreDir === undefined
      ? false
      : { ...(refStoreDir ? { dir: refStoreDir } : {}) }
  );
  const getRegistry = lazy(undefined, () => createReferentRegistry(refStoreDir));
  const getEntity = lazy(programOptions.entity, () => createEntityModule(
    { request: requester('entity.request').request },
    { cache: moduleCache() },
  ));
  const getControlGroup = lazy(programOptions.controlGroup, () => createControlGroupModule(
    { request: requester('control-group.request').request },
    { cache: moduleCache() },
  ));
  const getEntityFeed = lazy(programOptions.entityFeed, () => createEntityFeedComposition(
    { request: requester('entity-feed.request').request },
  ));
  const getDashboard = lazy(programOptions.dashboard, () => createDashboardModule(
    { request: requester('dashboard').request },
    createConfiguredWidgetProjection(requester('widget')),
  ));
  const getMarketView = lazy(programOptions.marketView, () => {
    const widgetTransport = requester('widget');
    return createMarketView({
      controlGroup: getControlGroup(),
      dashboard: getDashboard(),
      entity: getEntity(),
      entityFeed: getEntityFeed().entityFeed,
      readEntityFeedPage: getEntityFeed().readPage,
      registry: getRegistry(),
      searchRequester: requester('marketview-search'),
      widgetTransport,
      evidence,
      ...(programOptions.widget ? { widget: programOptions.widget } : {}),
    });
  });
  const getDocument = lazy(programOptions.document, () => createDocumentModule({
    request: requester('document').request,
    recordAdapterFailure(operation, value) {
      evidence.reserve({
        owner: 'document.adapter',
        operation,
      })?.fail(value);
    },
  }));
  const getContent = lazy(programOptions.content, () => createContent({
    document: getDocument(),
    evidence,
    registry: getRegistry(),
    requester: (contentEvidence) => ({
      request: getHttpTransport().provider({ owner: 'content.request', evidence: contentEvidence }).request,
    }),
  }));

  const getData = lazy(programOptions.data, () => createData({ request: requester('data').request }));

  configureGhHelp(program.name('marquee').description('Work with Marquee from the command line'));
  program.helpCommand(false).exitOverride().enablePositionalOptions()
    .configureOutput({ writeErr: writeError });

  /**
   * The transport for the resolved Browser Session, signing it in to Marquee before its first
   * command other than `close` and `session`: the sign-in launches the session's browser.
   */
  function getBrowserTransport(sessionFlag?: string): AgentBrowserTransport {
    const session = resolveBrowserSession(sessionFlag);
    const transport = programOptions.browserTransport
      ?? programOptions.authTransport
      ?? createBrowserTransport({ session, runtime: programOptions.browserRuntime });
    let signedIn = false;
    return {
      ...transport,
      async run(...call: Parameters<AgentBrowserTransport['run']>): Promise<string> {
        if (!signedIn && call[0] !== 'close' && call[0] !== 'session') {
          await getBrowserAuthState().syncBrowserSession(session);
          signedIn = true;
        }
        return transport.run(...call);
      },
    };
  }

  function getCookieJarPath(): string {
    return programOptions.cookieJarPath ?? defaultCookieJarPath();
  }

  function getHttpTransport(): Transport {
    // The auth gate runs identically in every mode — offline replay relies on a
    // fixture cookie jar to pass it, so error-state screens that override the jar
    // (e.g. "Not authenticated") still fail faithfully offline.
    return httpTransport ??= createTransport(resolveProxyConfig() ?? {
      execution: 'direct',
      authentication: {
        cookieJarPath: getCookieJarPath(),
        required: true,
      },
      recording: {
        environment: process.env,
        naming: process.env.MARQUEE_HTTP_RECORD_NAMING === 'readable' ? 'readable' : 'hash',
        manifestPath: process.env.MARQUEE_HTTP_RECORD_MANIFEST,
        replayFetch: programOptions.replayFetch,
      },
    });
  }

  function getBrowserAuthState(): ReturnType<typeof createAuthBrowserRuntime> {
    return browserAuthState ??= createAuthBrowserRuntime({
      getCookies: () => {
        // A standard browser state file, when named, signs the browser in instead of the cookie jar.
        const statePath = process.env.MARQUEE_BROWSER_STATE?.trim();
        if (statePath) return readBrowserStateCookies(statePath);
        return isTestEnvironment() && !programOptions.cookieJarPath
          ? undefined
          : getHttpTransport().browserAuthenticationCookies();
      },
      runtime: programOptions.browserRuntime ?? createAgentBrowserRuntime(),
    });
  }

  const getAuth = lazy(undefined, () => createAuth({
    cookieJarPath: getCookieJarPath(),
    transport: getHttpTransport(),
    runtime: createLoginRuntimeForProgram(programOptions.authTransport),
    statePaths: [programOptions.browserStatePath ?? defaultBrowserStatePath()],
  }));

  const marketViewRegistration: MarketViewRegistration = Object.freeze({ write, writeError, getMarketView });
  const contentRegistration: ContentRegistration = Object.freeze({ write, writeError, getContent });
  const browserRegistration: BrowserRegistration = Object.freeze({
    write,
    writeError,
    getBrowserTransport,
    resolveBrowserOpenTarget: (target: string) => resolveBrowserOpenTargetFromRegistry(
      getRegistry(),
      getEntity(),
      target,
    ),
  });
  const dataRegistration: DataRegistration = Object.freeze({ write, writeError, getData });
  const authRegistration: AuthRegistration = Object.freeze({ write, writeError, getAuth });
  const apiRegistration: ApiRegistration = Object.freeze({
    write,
    writeError,
    // Stryker disable next-line StringLiteral: no evidence recorder reads a `marquee api` request's owner
    request: (endpoint, init) => getHttpTransport().provider({ owner: 'api' }).request(endpoint, init),
  });

  registerMarketviewCommands(program, marketViewRegistration);
  registerContentCommands(program, contentRegistration);
  registerDataCommands(program, dataRegistration);
  registerBrowserCommands(program, browserRegistration);
  authOwnerAttachment.register(program, authRegistration);
  apiOwnerAttachment.register(program, apiRegistration);
  installUnknownHelpGuard(program, writeError);

  return {
    program,
  };
}

function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): TransportConfig | undefined {
  const baseUrl = env.MARQUEE_BASE_URL?.trim();
  const accountId = env.MARQUEEBOT_ACCOUNT_ID?.trim();
  const sessionId = env.MARQUEE_OWNER_SESSION_ID?.trim();
  const invocationToken = env.MARQUEE_AUTH_TOKEN?.trim();
  const proxyPresent = ['MARQUEE_BASE_URL', 'MARQUEEBOT_ACCOUNT_ID', 'MARQUEE_AUTH_TOKEN'].filter((name) => env[name] !== undefined).length;
  const ownerInvocationWithSession = env.MARQUEE_OWNER_SESSION_ID !== undefined && env.MARQUEEBOT_SESSION !== undefined;
  if (proxyPresent === 0 && !ownerInvocationWithSession) {
    if (env.MARQUEEBOT_SESSION !== undefined) {
      return { execution: 'session', baseUrl: env.MARQUEEBOT_GATEWAY_URL ?? 'https://api.marqueebot.com/marquee', sessionToken: env.MARQUEEBOT_SESSION };
    }
    if (env.MARQUEEBOT_GATEWAY_URL !== undefined) throw new MarqueeError('config', 'Marquee gateway configuration requires MARQUEEBOT_SESSION');
    return undefined;
  }
  if (!baseUrl || !accountId || !invocationToken || !sessionId) {
    throw new MarqueeError(
      'config',
      'Incomplete Marquee proxy configuration: set MARQUEE_BASE_URL, MARQUEEBOT_ACCOUNT_ID, MARQUEE_OWNER_SESSION_ID, and MARQUEE_AUTH_TOKEN',
    );
  }
  return {
    execution: 'proxy',
    baseUrl,
    accountId,
    sessionId,
    invocationToken,
  };
}

export function createProgramImplementation(
  write: Writer = (chunk) => process.stdout.write(chunk),
  dependencies: ProgramDependencies = {},
) {
  return buildProgram(write, dependencies);
}
