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
} from '../../transport/index.js';
import {
  createTransport,
} from '../../transport/index.js';
import {
  createAuth,
  type Auth,
} from '../../auth/index.js';
import {
  createAuthBrowserRuntime,
} from '../../auth/adapters/browser-runtime.js';
import {
  createEntityModule,
  type EntityModule,
} from '../../entity/index.js';
import {
  createControlGroupModule,
  type ControlGroupModule,
} from '../../control-group/index.js';
import {
  createMarketView,
  type MarketView,
} from '../../marketview/index.js';
import {
  type WidgetModule,
} from '../../widget/index.js';
import { createConfiguredWidgetProjection } from '../../widget/composition.js';
import {
  createDocumentModule,
  type DocumentModule,
} from '../../document/index.js';
import { createContent, type Content } from '../../content/index.js';
import {
  createDashboardModule,
  type DashboardModule,
} from '../../dashboard/index.js';
import {
  createEntityFeedComposition,
  type EntityFeedComposition,
} from '../../entity-feed/composition.js';
import { registerMarketviewCommands } from './marketview.js';
import { registerContentCommands } from './content.js';
import { registerBrowserCommands } from '../../cli/commands/browser.js';
import { authOwnerAttachment } from './owners/auth.js';
import { apiOwnerAttachment } from './owners/api.js';
import type {
  MarketViewRegistration,
  ContentRegistration,
  AuthRegistration,
  ApiRegistration,
} from './registrations.js';
import type {
  AgentBrowserTransport,
  BrowserRegistration,
  ProgramDependencies,
} from '../types.js';
import type { Writer } from '../../presentation/index.js';
import {
  createArtifactRegistry,
  type ArtifactRegistry,
} from '../../artifact-registry/index.js';
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

type ProxyConfig = {
  baseUrl: string;
  accountId: string;
  sessionId: string;
  invocationToken: string;
};

function createProgramEntity(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
  refStoreDir: string | undefined,
): EntityModule {
  const request = getHttpTransport().provider({
    owner: 'entity.request',
    evidence,
  }).request;
  return createEntityModule(
    { request },
    {
      cache: isTestEnvironment() && refStoreDir === undefined
        ? false
        : { ...(refStoreDir ? { dir: refStoreDir } : {}) },
    },
  );
}

function createProgramEntityGetter(
  configured: EntityModule | undefined,
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
  refStoreDir: string | undefined,
): () => EntityModule {
  let entity = configured;
  return () => entity ??= createProgramEntity(getHttpTransport, evidence, refStoreDir);
}

function createProgramControlGroup(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
  refStoreDir: string | undefined,
): ControlGroupModule {
  const request = getHttpTransport().provider({
    owner: 'control-group.request',
    evidence,
  }).request;
  return createControlGroupModule(
    { request },
    {
      cache: isTestEnvironment() && refStoreDir === undefined
        ? false
        : { ...(refStoreDir ? { dir: refStoreDir } : {}) },
    },
  );
}

function createProgramControlGroupGetter(
  configured: ControlGroupModule | undefined,
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
  refStoreDir: string | undefined,
): () => ControlGroupModule {
  let controlGroup = configured;
  return () => controlGroup ??= createProgramControlGroup(
    getHttpTransport,
    evidence,
    refStoreDir,
  );
}

function createProgramEntityFeed(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): EntityFeedComposition {
  const request = getHttpTransport().provider({
    owner: 'entity-feed.request',
    evidence,
  }).request;
  return createEntityFeedComposition(
    { request },
  );
}

function createProgramEntityFeedGetter(
  configured: ProgramDependencies['entityFeed'],
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): () => EntityFeedComposition {
  let composition: EntityFeedComposition | undefined;
  return () => configured
    ?? (composition ??= createProgramEntityFeed(getHttpTransport, evidence));
}

function createProgramDocument(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): DocumentModule {
  const request = getHttpTransport().provider({
    owner: 'document',
    evidence,
  }).request;
  return createDocumentModule({
    request,
    recordAdapterFailure(operation, value) {
      evidence.reserve({
        owner: 'document.adapter',
        operation,
      })?.fail(value);
    },
  });
}

function createProgramDocumentGetter(
  configured: DocumentModule | undefined,
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): () => DocumentModule {
  let document = configured;
  return () => document ??= createProgramDocument(getHttpTransport, evidence);
}

function createProgramWidgetTransport(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): Pick<Transport, 'request'> {
  return getHttpTransport().provider({ owner: 'widget', evidence });
}

function createProgramDashboard(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): DashboardModule {
  const request = getHttpTransport().provider({
    owner: 'dashboard',
    evidence,
  }).request;
  return createDashboardModule(
    { request },
    createConfiguredWidgetProjection(createProgramWidgetTransport(getHttpTransport, evidence)),
  );
}

function createProgramDashboardGetter(
  configured: DashboardModule | undefined,
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): () => DashboardModule {
  let dashboard = configured;
  return () => dashboard ??= createProgramDashboard(getHttpTransport, evidence);
}

function createProgramContentTransport(
  getHttpTransport: () => Transport,
  evidence: ReturnType<typeof createProviderEvidenceLog>,
): Pick<Transport, 'request'> {
  return {
    request: getHttpTransport().provider({
      owner: 'content.request',
      evidence,
    }).request,
  };
}

function createProgramContentGetter(configured: Content | undefined, wiring: {
  getDocument(): DocumentModule;
  getRegistry(): ArtifactRegistry;
  getHttpTransport(): Transport;
  evidence: ReturnType<typeof createProviderEvidenceLog>;
}): () => Content {
  let content = configured;
  return () => content ??= createContent({
    document: wiring.getDocument(),
    evidence: wiring.evidence,
    registry: wiring.getRegistry(),
    requester: (evidence) => createProgramContentTransport(
      wiring.getHttpTransport,
      evidence,
    ),
  });
}

function createProgramMarketViewGetter(
  configured: MarketView | undefined,
  dependencies: {
    getControlGroup(): ControlGroupModule;
    getDashboard(): DashboardModule;
    getEntity(): EntityModule;
    getEntityFeed(): EntityFeedComposition;
    getHttpTransport(): Transport;
    getRegistry(): ArtifactRegistry;
    widget?: WidgetModule | undefined;
    evidence: ReturnType<typeof createProviderEvidenceLog>;
  },
): () => MarketView {
  let marketView = configured;
  let widgetTransport: Pick<Transport, 'request'> | undefined;
  return () => {
    if (marketView) return marketView;
    widgetTransport ??= createProgramWidgetTransport(
      dependencies.getHttpTransport,
      dependencies.evidence,
    );
    return marketView = createMarketView({
      controlGroup: dependencies.getControlGroup(),
      dashboard: dependencies.getDashboard(),
      entity: dependencies.getEntity(),
      entityFeed: dependencies.getEntityFeed().entityFeed,
      readEntityFeedPage: dependencies.getEntityFeed().readPage,
      registry: dependencies.getRegistry(),
      searchRequester: dependencies.getHttpTransport().provider({
        owner: 'marketview-search',
        evidence: dependencies.evidence,
      }),
      dashboardPreferencesRequester: dependencies.getHttpTransport().provider({
        owner: 'dashboard-preferences.request',
        evidence: dependencies.evidence,
      }),
      widgetTransport,
      evidence: dependencies.evidence,
      ...(dependencies.widget ? { widget: dependencies.widget } : {}),
    });
  };
}

type ProgramOptions = ProgramDependencies;

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

// ADR 0049 §1: deleted subsurfaces whose old spellings
// get the §1-style typed pointer to the folded path, not commander's generic
// unknown-command error.
const REMOVED_SUBSURFACES = new Map<string, string>([
  ['content markets', 'marquee content view <ref|url|uuid>'],
  ['content research', 'marquee content view <ref|url|uuid>'],
]);

class RemovedPathError extends Error {
  override readonly name = 'RemovedPathError';
  readonly code = 'marquee.removedPath';
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

  const removedTarget = REMOVED_SUBSURFACES.get(`${command.name()} ${arg}`);
  if (removedTarget) {
    const message = `'${command.name()} ${arg}' was removed; use '${removedTarget}'`;
    writeError(`Error: ${message}\n`);
    throw new RemovedPathError(message);
  }

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
      : rest.length === 0 && ['marketview', 'content', 'auth'].includes(command)
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

type ProgramAuthWiring = Readonly<{
  programOptions: ProgramOptions;
  getCookieJarPath: () => string;
  getBrowserStatePath: () => string;
  getHttpTransport: () => Transport;
}>;

function createProgramAuthGetter(wiring: ProgramAuthWiring): () => Auth {
  let auth: Auth | undefined;
  return () => auth ??= createAuth({
    cookieJarPath: wiring.getCookieJarPath(),
    transport: wiring.getHttpTransport(),
    runtime: createLoginRuntimeForProgram(wiring.programOptions.authTransport),
    statePaths: [wiring.getBrowserStatePath()],
  });
}

function buildProgram(write: Writer, programOptions: ProgramOptions = {}) {
  const program = new Command();
  const writeError = programOptions.writeError ?? ((chunk: string) => process.stderr.write(chunk));
  let httpTransport: Transport | undefined;
  let registry: ArtifactRegistry | undefined;
  let browserAuthState: ReturnType<typeof createAuthBrowserRuntime> | undefined;
  const evidence = createProviderEvidenceLog();
  const getEntity = createProgramEntityGetter(
    programOptions.entity,
    getHttpTransport,
    evidence,
    programOptions.refStoreDir,
  );
  const getControlGroup = createProgramControlGroupGetter(
    programOptions.controlGroup,
    getHttpTransport,
    evidence,
    programOptions.refStoreDir,
  );
  const getEntityFeed = createProgramEntityFeedGetter(
    programOptions.entityFeed,
    getHttpTransport,
    evidence,
  );
  const getDashboard = createProgramDashboardGetter(
    programOptions.dashboard,
    getHttpTransport,
    evidence,
  );
  const getMarketView = createProgramMarketViewGetter(programOptions.marketView, {
    getControlGroup,
    getDashboard,
    getEntity,
    getEntityFeed,
    getHttpTransport,
    getRegistry,
    widget: programOptions.widget,
    evidence,
  });
  const getDocument = createProgramDocumentGetter(programOptions.document, getHttpTransport, evidence);
  const getContent = createProgramContentGetter(programOptions.content, {
    getDocument,
    getRegistry,
    getHttpTransport,
    evidence,
  });

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

  function getBrowserStatePath(): string {
    return programOptions.browserStatePath ?? defaultBrowserStatePath();
  }

  function getHttpTransport(): Transport {
    if (!httpTransport) {
      const proxyConfig = resolveProxyConfig();
      if (proxyConfig) {
        httpTransport = createTransport({ execution: 'proxy', ...proxyConfig });
        return httpTransport;
      }
      // The auth gate runs identically in every mode — offline replay relies on a
      // fixture cookie jar to pass it, so error-state screens that override the jar
      // (e.g. "Not authenticated") still fail faithfully offline.
      const recordNaming = process.env.MARQUEE_HTTP_RECORD_NAMING === 'readable'
        ? 'readable'
        : 'hash' as const;
      httpTransport = createTransport({
        execution: 'direct',
        authentication: {
          cookieJarPath: getCookieJarPath(),
          required: true,
        },
        recording: {
          environment: process.env,
          naming: recordNaming,
          manifestPath: process.env.MARQUEE_HTTP_RECORD_MANIFEST,
          replayFetch: programOptions.replayFetch,
        },
      });
    }
    return httpTransport;
  }

  function getBrowserAuthState(): ReturnType<typeof createAuthBrowserRuntime> {
    return browserAuthState ??= createAuthBrowserRuntime({
      getCookies: () => (
        isTestEnvironment() && !programOptions.cookieJarPath
          ? undefined
          : getHttpTransport().browserAuthenticationCookies()
      ),
      runtime: programOptions.browserRuntime ?? createAgentBrowserRuntime(),
    });
  }

  const getAuth = createProgramAuthGetter({
    programOptions,
    getCookieJarPath,
    getBrowserStatePath,
    getHttpTransport,
  });

  function getRegistry(): ArtifactRegistry {
    if (!registry) {
      registry = createArtifactRegistry(programOptions.refStoreDir);
    }
    return registry;
  }

  const marketViewRegistration: MarketViewRegistration = Object.freeze({ write, writeError, getMarketView });
  const contentRegistration: ContentRegistration = Object.freeze({ write, writeError, getContent });
  const browserRegistration: BrowserRegistration = Object.freeze({
    write,
    getBrowserTransport,
    resolveBrowserOpenTarget: (target: string) => resolveBrowserOpenTargetFromRegistry(
      getRegistry(),
      getEntity(),
      target,
    ),
  });
  const authRegistration: AuthRegistration = Object.freeze({ write, writeError, getAuth });
  const apiRegistration: ApiRegistration = Object.freeze({
    write,
    writeError,
    // Stryker disable next-line StringLiteral: no evidence recorder reads a `marquee api` request's owner
    request: (endpoint, init) => getHttpTransport().provider({ owner: 'api' }).request(endpoint, init),
  });

  registerMarketviewCommands(program, marketViewRegistration);
  registerContentCommands(program, contentRegistration);
  registerBrowserCommands(program, browserRegistration);
  authOwnerAttachment.register(program, authRegistration);
  apiOwnerAttachment.register(program, apiRegistration);
  installUnknownHelpGuard(program, writeError);

  return {
    program,
  };
}

function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig | undefined {
  const baseUrl = env.MARQUEE_BASE_URL?.trim();
  const accountId = env.MARQUEEBOT_ACCOUNT_ID?.trim();
  const sessionId = env.MARQUEE_OWNER_SESSION_ID?.trim();
  const invocationToken = env.MARQUEE_AUTH_TOKEN?.trim();
  const proxyPresent = [baseUrl, accountId, invocationToken].filter(Boolean).length;
  if (proxyPresent === 0) {
    return undefined;
  }
  if (!baseUrl || !accountId || !invocationToken || !sessionId) {
    throw new MarqueeError(
      'config',
      'Incomplete Marquee proxy configuration: set MARQUEE_BASE_URL, MARQUEEBOT_ACCOUNT_ID, MARQUEE_OWNER_SESSION_ID, and MARQUEE_AUTH_TOKEN',
    );
  }
  return {
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
