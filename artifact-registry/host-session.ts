import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_REFS_DIR = join(homedir(), '.marquee', 'sessions');
const PROCESS_START_IDENTITY = String(Date.now() - Math.floor(process.uptime() * 1_000));

interface TerminalSessionIdentity {
  terminalSessionId: string;
  shellStartIdentity: string;
}

export interface InteractionSessionOptions {
  env?: NodeJS.ProcessEnv;
  processId?: number;
  processStartIdentity?: string;
  terminal?: TerminalSessionIdentity | null;
}

function identityDigest(kind: string, value: string): string {
  return createHash('sha256')
    .update(`${kind}\0${value}`)
    .digest('hex')
    .slice(0, 16);
}

function interactionId(kind: string, value: string): string {
  return `interaction-${identityDigest(kind, value)}`;
}

function configuredAgentIdentity(env: NodeJS.ProcessEnv): [string, string] | undefined {
  const candidates: Array<[string, string | undefined]> = [
    ['host', env.MARQUEE_INTERACTION_SESSION_ID],
    ['agentcore', env.MARQUEE_OWNER_SESSION_ID],
    ['codex', env.CODEX_THREAD_ID],
    ['claude-code', env.CLAUDE_CODE_SESSION_ID ?? env.CLAUDE_SESSION_ID],
  ];
  return candidates.find(([, value]) => Boolean(value?.trim())) as [string, string] | undefined;
}

function nativeTerminalIdentity(env: NodeJS.ProcessEnv): TerminalSessionIdentity | undefined {
  const id = [
    env.TERM_SESSION_ID,
    env.ITERM_SESSION_ID,
    env.WEZTERM_PANE,
    env.WT_SESSION,
    env.SSH_TTY,
  ].find((value) => Boolean(value?.trim()));
  return id ? { terminalSessionId: id, shellStartIdentity: 'native-terminal-session' } : undefined;
}

function psValue(field: 'tty' | 'lstart', processId: number): string | undefined {
  const result = spawnSync('ps', ['-o', `${field}=`, '-p', String(processId)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0 || result.error) return undefined;
  const value = result.stdout.trim();
  return value && value !== '??' ? value : undefined;
}

function detectedTerminalIdentity(env: NodeJS.ProcessEnv): TerminalSessionIdentity | undefined {
  const native = nativeTerminalIdentity(env);
  if (native) return native;

  const shellProcessId = process.ppid;
  const terminalId = psValue('tty', shellProcessId);
  const shellStartIdentity = psValue('lstart', shellProcessId);
  return terminalId && shellStartIdentity
    ? { terminalSessionId: terminalId, shellStartIdentity }
    : undefined;
}

/** The digest of the agent host's identity for this CLI Interaction Session, if an agent host set one. */
export function resolveHostIdentityDigest(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const agent = configuredAgentIdentity(env);
  return agent ? identityDigest(agent[0], agent[1].trim()) : undefined;
}

export function resolveInteractionSessionId(
  options: InteractionSessionOptions = {},
): string {
  const env = options.env ?? process.env;
  const agent = configuredAgentIdentity(env);
  if (agent) {
    return interactionId(agent[0], agent[1].trim());
  }

  const terminal = options.terminal === undefined
    ? detectedTerminalIdentity(env)
    : options.terminal ?? undefined;
  if (terminal) {
    return interactionId(
      'terminal',
      `${terminal.terminalSessionId}\0${terminal.shellStartIdentity}`,
    );
  }

  const processId = options.processId ?? process.pid;
  const processStartIdentity = options.processStartIdentity ?? PROCESS_START_IDENTITY;
  return interactionId('process', `${processId}\0${processStartIdentity}`);
}

export function resolveRegistrySessionId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveInteractionSessionId({ env });
}

export function resolveRegistryRefsDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MARQUEE_REF_STORE_DIR?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_REFS_DIR;
}
