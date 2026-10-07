export interface AgentBrowserInvocation {
  session?: string | undefined;
  headed?: boolean | undefined;
  argv: readonly string[];
  stdin?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface AgentBrowserProcessEvidence {
  stdout: string;
  stderr: string;
}

export interface AgentBrowserRuntime {
  execute(invocation: AgentBrowserInvocation): Promise<AgentBrowserProcessEvidence>;
}
