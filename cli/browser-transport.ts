import {
  createAgentBrowserRuntime,
  type AgentBrowserRuntime,
} from '../agent-browser-runtime/index.js';
import { resolveHostIdentityDigest } from '../artifact-registry/index.js';
import { MarqueeError } from '../transport/index.js';

const DEFAULT_SESSION = 'marquee';
const MARQUEE_HOST = 'marquee.gs.com';
const NO_PROXY_REMEDIATION = 'NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1"';
const PROXY_ENV_NAMES = new Set([
  'AGENT_BROWSER_PROXY',
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
]);

export interface TransportOpts {
  headed?: boolean | undefined;
  timeout?: number | undefined;
  stdin?: string | undefined;
}

export interface BrowserTransport {
  run(command: string, args?: string[], opts?: TransportOpts): Promise<string>;
  saveState(path: string): Promise<void>;
  close(): Promise<string>;
}

interface BrowserTransportConfig {
  session?: string;
  runtime?: AgentBrowserRuntime | undefined;
  writeStderr?: (chunk: string) => void;
}

/**
 * The Browser Session a `marquee browser` command runs in: its `--session` flag, then a non-empty
 * AGENT_BROWSER_SESSION, then `marquee-<hash>` of the agent host's identity, then `marquee`.
 */
export function resolveBrowserSession(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const digest = resolveHostIdentityDigest(env);
  return flag ?? (env.AGENT_BROWSER_SESSION || (digest ? `${DEFAULT_SESSION}-${digest}` : DEFAULT_SESSION));
}

export function createBrowserTransport(
  config: BrowserTransportConfig = {},
): BrowserTransport {
  const defaultSession = config.session ?? DEFAULT_SESSION;
  const runtime = config.runtime ?? createAgentBrowserRuntime({
    defaultSession,
  });
  const writeStderr = config.writeStderr ?? ((chunk: string) => {
    process.stderr.write(chunk);
  });

  async function invoke(
    command: string,
    args: string[] = [],
    opts: TransportOpts = {},
  ): Promise<string> {
    const evidence = await runtime.execute({
      session: defaultSession,
      headed: opts.headed,
      argv: [command, ...args],
      stdin: opts.stdin,
      timeoutMs: opts.timeout ?? 30_000,
    });
    return commandOutput(evidence.stdout, evidence.stderr);
  }

  function commandOutput(
    stdout: string,
    stderr: string,
  ): string {
    const sessionOutput = extractAgentCoreSessionOutput(stderr);
    if (sessionOutput) writeStderr(sessionOutput);
    return stdout;
  }

  return {
    async close(): Promise<string> {
      return invoke('close');
    },

    async saveState(path: string): Promise<void> {
      await invoke('state', ['save', path]);
    },

    async run(
      command: string,
      args: string[] = [],
      opts: TransportOpts = {},
    ): Promise<string> {
      try {
        return await invoke(command, args, opts);
      } catch (error) {
        const message = errorMessage(error);
        if (isTimeout(message)) {
          throw new MarqueeError('timeout', 'Command timed out.');
        }
        const diagnostic = marqueeNoProxyDnsDiagnostic(error, command, args);
        throw new MarqueeError(
          'adapter',
          `Command failed: ${command}. ${diagnostic ?? sanitizeErrorMessage(message)}`,
        );
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractAgentCoreSessionOutput(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:Session|Live View):\s+/.test(line));
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function isTimeout(message: string): boolean {
  return message.includes('ETIMEDOUT') || message.includes('timed out');
}

function sanitizeErrorMessage(message: string): string {
  if (message.includes('Session with given id not found')) {
    return 'Browser session expired. Retrying failed — try: marquee auth login';
  }
  return message;
}

function marqueeNoProxyDnsDiagnostic(
  failure: unknown,
  command: string,
  args: string[],
): string | undefined {
  const target = args[0];
  const targetsMarquee = command === 'open'
    && target !== undefined
    && URL.canParse(target)
    && new URL(target).hostname === MARQUEE_HOST;
  return targetsMarquee || browserFailureText(failure).toLowerCase().includes(MARQUEE_HOST)
    ? browserNoProxyDnsDiagnostic(MARQUEE_HOST, failure)
    : undefined;
}

function browserFailureText(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure);
  const details = [failure.name, failure.message];
  const error = failure as Error & {
    cause?: unknown;
    // Node's system errors (NodeJS.ErrnoException) carry these as strings.
    code?: string;
    hostname?: string;
    syscall?: string;
  };
  details.push(String(error.code ?? ''), String(error.hostname ?? ''), String(error.syscall ?? ''));
  if (error.cause !== undefined && error.cause !== failure) {
    details.push(browserFailureText(error.cause));
  }
  return details.join(' ');
}

function browserNoProxyDnsDiagnostic(
  host: string,
  failure: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!/(?:ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|getaddrinfo)/i.test(
    browserFailureText(failure),
  )) {
    return undefined;
  }
  const hasProxy = Object.entries(env).some(([name, value]) => (
    Boolean(value?.trim()) && PROXY_ENV_NAMES.has(name.toUpperCase())
  ));
  if (!hasProxy) return undefined;
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  const noProxyEntry = Object.entries(env)
    .filter(([name]) => name.toLowerCase() === 'no_proxy')
    .flatMap(([, value]) => value?.split(',') ?? [])
    .map((entry) => entry.trim())
    .find((entry) => {
      if (entry === '*') return true;
      const entryHost = entry
        .replace(/^\*\./, '')
        .replace(/^\./, '')
        .replace(/:\d+$/, '')
        .replace(/\.$/, '')
        .toLowerCase();
      return entryHost.length > 0
        && (normalizedHost === entryHost || normalizedHost.endsWith(`.${entryHost}`));
    });
  if (!noProxyEntry) return undefined;
  return `${host} failed to resolve directly, and NO_PROXY (${noProxyEntry}) is routing it around your proxy. Either remove the matching entry from NO_PROXY, or run with: ${NO_PROXY_REMEDIATION}`;
}
