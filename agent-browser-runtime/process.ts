import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentBrowserInvocation, AgentBrowserProcessEvidence } from './types.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export type AgentBrowserProcess = (
  invocation: AgentBrowserInvocation,
) => Promise<AgentBrowserProcessEvidence>;

let agentBrowserBin: string | undefined;

export function createProductionAgentBrowserProcess(): AgentBrowserProcess {
  return async (invocation) => {
    const command = agentBrowserCommand(invocationArgs(invocation));
    return spawnCommand(command.file, command.args, invocation);
  };
}

function invocationArgs(invocation: AgentBrowserInvocation): string[] {
  const args: string[] = [];
  if (invocation.session) {
    args.push('--session', invocation.session);
  }
  if (invocation.headed) {
    args.push('--headed');
  }
  args.push(...invocation.argv);
  return args;
}

function spawnCommand(
  file: string,
  args: string[],
  invocation: AgentBrowserInvocation,
): Promise<AgentBrowserProcessEvidence> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = invocation.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, invocation.timeoutMs)
      : undefined;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        reject(new Error('ETIMEDOUT'));
        return;
      }
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim();
      reject(new Error(detail ? `exit code ${code}: ${detail}` : `exit code ${code}`));
    });

    if (invocation.stdin !== undefined) {
      child.stdin.write(invocation.stdin);
    }
    child.stdin.end();
  });
}

function agentBrowserCommand(args: string[]): { file: string; args: string[] } {
  const bin = resolveAgentBrowserBinForRuntime();
  return /(?:^|[\\/])agent-browser\.js$/.test(bin)
    ? { file: process.execPath, args: [bin, ...args] }
    : { file: bin, args };
}

export function resolveAgentBrowserBinForRuntime(): string {
  const replayBin = process.env.MARQUEE_AGENT_BROWSER_REPLAY_BIN?.trim();
  if (process.env.MARQUEE_HTTP_REPLAY && replayBin) {
    return resolve(replayBin);
  }

  if (agentBrowserBin) return agentBrowserBin;

  try {
    const require = createRequire(import.meta.url);
    agentBrowserBin = require.resolve('agent-browser/bin/agent-browser.js');
    return agentBrowserBin;
  } catch {
    // Fall through to worktree and PATH resolution.
  }

  for (const root of resolveGitCheckoutRoots()) {
    const bin = join(root, 'node_modules', '.bin', 'agent-browser');
    if (existsSync(bin)) {
      agentBrowserBin = bin;
      return agentBrowserBin;
    }
  }

  try {
    agentBrowserBin = execFileSync('which', ['agent-browser'], { encoding: 'utf8' }).trim();
    if (agentBrowserBin) return agentBrowserBin;
  } catch {
    // Report one stable mechanical failure below.
  }

  throw new Error('agent-browser not found. Install it: npm install -D agent-browser');
}

function resolveGitCheckoutRoots(): string[] {
  const roots: string[] = [];
  const topLevel = readGitPath(['rev-parse', '--show-toplevel']);
  if (topLevel) roots.push(topLevel);

  const commonDirRaw = readGitPath(['rev-parse', '--git-common-dir']);
  if (commonDirRaw) {
    const commonDir = isAbsolute(commonDirRaw)
      ? commonDirRaw
      : resolve(MODULE_DIR, commonDirRaw);
    roots.push(dirname(commonDir));
  }
  return [...new Set(roots)];
}

function readGitPath(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: MODULE_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}
