import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveInteractionSessionId } from '../host-session.js';

describe('Interaction Session host adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['Codex', { CODEX_THREAD_ID: 'codex-thread-1' }, 'codex-thread-1'],
    ['Claude Code', { CLAUDE_CODE_SESSION_ID: 'claude-session-1' }, 'claude-session-1'],
    ['AgentCore/DeepAgents', { MARQUEE_OWNER_SESSION_ID: 'agentcore-session-1' }, 'agentcore-session-1'],
  ])('automatically acquires one stable %s conversation identity', (_host, env, rawId) => {
    const first = resolveInteractionSessionId({
      env,
      processId: 11,
      processStartIdentity: 'process-start-a',
      terminal: { terminalSessionId: 'terminal-a', shellStartIdentity: 'shell-start-a' },
    });
    const second = resolveInteractionSessionId({
      env,
      processId: 22,
      processStartIdentity: 'process-start-b',
      terminal: { terminalSessionId: 'terminal-b', shellStartIdentity: 'shell-start-b' },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^interaction-[a-f0-9]{16}$/);
    expect(first).not.toContain(rawId);
  });

  it('gives an agent conversation precedence over the terminal that launched it', () => {
    const agent = resolveInteractionSessionId({
      env: { CODEX_THREAD_ID: 'codex-thread-1' },
      processId: 11,
      processStartIdentity: 'process-start-a',
      terminal: { terminalSessionId: 'terminal-a', shellStartIdentity: 'shell-start-a' },
    });
    const terminal = resolveInteractionSessionId({
      env: {},
      processId: 11,
      processStartIdentity: 'process-start-a',
      terminal: { terminalSessionId: 'terminal-a', shellStartIdentity: 'shell-start-a' },
    });

    expect(agent).not.toBe(terminal);
  });

  it('shares one human terminal while isolating terminal reuse and non-interactive processes', () => {
    const terminalA = resolveInteractionSessionId({
      env: {},
      processId: 11,
      processStartIdentity: 'process-start-a',
      terminal: { terminalSessionId: 'ttys001', shellStartIdentity: 'shell-start-a' },
    });
    const terminalAChild = resolveInteractionSessionId({
      env: {},
      processId: 22,
      processStartIdentity: 'process-start-b',
      terminal: { terminalSessionId: 'ttys001', shellStartIdentity: 'shell-start-a' },
    });
    const reusedTerminal = resolveInteractionSessionId({
      env: {},
      processId: 11,
      processStartIdentity: 'process-start-a',
      terminal: { terminalSessionId: 'ttys001', shellStartIdentity: 'shell-start-b' },
    });
    const isolatedA = resolveInteractionSessionId({
      env: {},
      processId: 11,
      processStartIdentity: 'process-start-a',
      terminal: null,
    });
    const isolatedB = resolveInteractionSessionId({
      env: {},
      processId: 11,
      processStartIdentity: 'process-start-b',
      terminal: null,
    });

    expect(terminalAChild).toBe(terminalA);
    expect(reusedTerminal).not.toBe(terminalA);
    expect(isolatedB).not.toBe(isolatedA);
  });

  it('reuses one fallback identity throughout a non-interactive process', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_001);
    vi.spyOn(process, 'uptime').mockReturnValue(0);

    const first = resolveInteractionSessionId({ env: {}, processId: 11, terminal: null });
    const second = resolveInteractionSessionId({ env: {}, processId: 11, terminal: null });

    expect(second).toBe(first);
  });
});
