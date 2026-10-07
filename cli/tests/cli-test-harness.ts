import { vi } from 'vitest';
import {
  createProgram as createCliProgram,
  type AgentBrowserTransport,
  type ProgramDependencies,
} from '../../cli-composition/index.js';
import type { Writer } from '../../presentation/index.js';
import {
  createArtifactRegistry as createArtifactRegistryForSession,
} from '../../artifact-registry/index.js';
import type { TransportOpts } from '../browser-transport.js';
import type { AgentBrowserRuntime } from '../../agent-browser-runtime/index.js';

export { afterEach, describe, expect, it, vi } from 'vitest';

export { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
export { tmpdir } from 'node:os';
export { join } from 'node:path';

export function createProgram(
  write?: Writer,
  transport?: AgentBrowserTransport,
  refStoreDir?: string,
  dependencies: Omit<ProgramDependencies, 'authTransport' | 'refStoreDir'> = {},
) {
  return createCliProgram(write, {
    ...dependencies,
    ...(transport ? { authTransport: transport } : {}),
    ...(transport && !dependencies.browserRuntime
      ? { browserRuntime: runtimeForTransport(transport) }
      : {}),
    ...(refStoreDir ? { refStoreDir } : {}),
  });
}

function runtimeForTransport(transport: AgentBrowserTransport): AgentBrowserRuntime {
  return {
    async execute(invocation) {
      const command = invocation.argv[0] ?? '';
      const stdout = await transport.run(command, [...invocation.argv.slice(1)], {
        headed: invocation.headed === true,
        stdin: invocation.stdin,
        timeout: invocation.timeoutMs,
      });
      return { stdout, stderr: '' };
    },
  };
}

export function createArtifactRegistry(
  dir: string,
  _sessionId: number | string,
  options?: { inactivityMs?: number; now?: () => number },
) {
  return createArtifactRegistryForSession(
    dir,
    process.env,
    options,
  );
}

export function createMockTransport(responses: Record<string, string> = {}) {
  return {
    run: vi.fn(async (
      command: string,
      args: string[] = [],
      _opts: TransportOpts = {},
    ) => {
      const key = `${command} ${args.join(' ')}`.trim();
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.includes(pattern)) return response;
      }
      return responses['*'] ?? '';
    }),
    saveState: vi.fn(async () => {}),
    close: vi.fn(async () => responses.close ?? responses['*'] ?? ''),
  };
}

export function mockStdin(input: string): () => void {
  const setEncoding = vi.spyOn(process.stdin, 'setEncoding').mockReturnValue(process.stdin);
  const isPaused = vi.spyOn(process.stdin, 'isPaused').mockReturnValue(true);
  const resume = vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
  const on = vi.spyOn(process.stdin, 'on').mockImplementation(((
    event: string,
    listener: (...args: unknown[]) => void,
  ) => {
    if (event === 'data') process.nextTick(() => listener(input));
    if (event === 'end') process.nextTick(() => listener());
    return process.stdin;
  }) as typeof process.stdin.on);
  return () => {
    setEncoding.mockRestore();
    isPaused.mockRestore();
    resume.mockRestore();
    on.mockRestore();
  };
}
