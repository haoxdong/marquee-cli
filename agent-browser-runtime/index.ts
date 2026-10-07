import {
  createProductionAgentBrowserProcess,
  resolveAgentBrowserBinForRuntime,
} from './process.js';
import type {
  AgentBrowserInvocation,
  AgentBrowserProcessEvidence,
  AgentBrowserRuntime,
} from './types.js';
export type {
  AgentBrowserInvocation,
  AgentBrowserRuntime,
} from './types.js';

interface AgentBrowserRuntimeOptions {
  process?: (
    invocation: AgentBrowserInvocation,
  ) => Promise<AgentBrowserProcessEvidence>;
  defaultSession?: string;
  isBinaryResolutionRequired?: boolean;
}

export function createAgentBrowserRuntime(
  options: AgentBrowserRuntimeOptions = {},
): AgentBrowserRuntime {
  if (options.isBinaryResolutionRequired) resolveAgentBrowserBinForRuntime();
  const executeProcess = options.process ?? createProductionAgentBrowserProcess();

  return {
    async execute(invocation) {
      const session = invocation.session ?? options.defaultSession;
      const scoped = { ...invocation, session };
      try {
        const evidence = await executeProcess(scoped);
        return evidence;
      } catch (error) {
        if (!isStaleSessionError(error) || invocation.argv[0] === 'close') throw error;
        try {
          await executeProcess({
            session,
            argv: ['close'],
            timeoutMs: 5_000,
          });
        } catch (closeError) {
          if (!isStaleSessionError(closeError)) throw closeError;
        }
        const evidence = await executeProcess(scoped);
        return evidence;
      }
    },
  };
}

function isStaleSessionError(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error))
    .includes('Session with given id not found');
}
