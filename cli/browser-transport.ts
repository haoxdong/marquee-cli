import {
  createAgentBrowserRuntime,
  type AgentBrowserRuntime,
} from '../agent-browser-runtime/index.js';
import { resolveHostIdentityDigest } from '../referent-registry/index.js';
import { diagnoseConnectionFailure, MarqueeError } from '../transport/index.js';

const DEFAULT_SESSION = 'marquee';
const MARQUEE_HOST = 'marquee.gs.com';
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
    const sessionOutput = extractAgentCoreSessionOutput(evidence.stderr);
    if (sessionOutput) writeStderr(sessionOutput);
    return evidence.stdout;
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
  const diagnostic = diagnoseConnectionFailure(MARQUEE_HOST, failure, { canMatchAllHosts: true });
  return targetsMarquee || diagnostic.details.toLowerCase().includes(MARQUEE_HOST)
    ? diagnostic.guidance
    : undefined;
}
