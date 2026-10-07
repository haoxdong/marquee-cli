import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentBrowserRuntime,
} from '../index.js';

describe('Agent Browser Runtime interface', () => {
  it('passes an invocation unchanged to an in-memory adapter', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'ok\n', stderr: 'trace\n' });
    const runtime = { execute };
    const invocation = {
      session: 'login-session',
      headed: true,
      argv: ['open', 'https://example.com'],
      stdin: 'input',
      timeoutMs: 4_000,
    };

    await expect(runtime.execute(invocation)).resolves.toEqual({
      stdout: 'ok\n',
      stderr: 'trace\n',
    });
    expect(execute).toHaveBeenCalledWith(invocation);
  });

  it('retains raw stderr as process evidence', async () => {
    const runtime = createAgentBrowserRuntime({
      process: vi.fn().mockResolvedValue({ stdout: 'page\n', stderr: 'Session: opaque\n' }),
    });

    await expect(runtime.execute({ argv: ['snapshot'] })).resolves.toEqual({
      stdout: 'page\n',
      stderr: 'Session: opaque\n',
    });
  });

  it('closes and retries one stale named session', async () => {
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('Session with given id not found'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
    const runtime = createAgentBrowserRuntime({ process, defaultSession: 'default' });

    await expect(runtime.execute({ session: 'named', argv: ['snapshot'] }))
      .resolves.toEqual({ stdout: 'ok', stderr: '' });
    expect(process.mock.calls.map(([invocation]) => invocation)).toEqual([
      { session: 'named', argv: ['snapshot'] },
      { session: 'named', argv: ['close'], timeoutMs: 5_000 },
      { session: 'named', argv: ['snapshot'] },
    ]);
  });

  it('names the default session it closes on a stale session', async () => {
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('Session with given id not found'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
    const runtime = createAgentBrowserRuntime({ process, defaultSession: 'marquee' });

    await runtime.execute({ argv: ['snapshot'] });

    expect(process.mock.calls[1]?.[0]).toEqual({ session: 'marquee', argv: ['close'], timeoutMs: 5_000 });
  });
});

describe('production Agent Browser process adapter', () => {
  const originalReplay = process.env.MARQUEE_HTTP_REPLAY;
  const originalReplayBin = process.env.MARQUEE_AGENT_BROWSER_REPLAY_BIN;

  afterEach(() => {
    if (originalReplay === undefined) delete process.env.MARQUEE_HTTP_REPLAY;
    else process.env.MARQUEE_HTTP_REPLAY = originalReplay;
    if (originalReplayBin === undefined) delete process.env.MARQUEE_AGENT_BROWSER_REPLAY_BIN;
    else process.env.MARQUEE_AGENT_BROWSER_REPLAY_BIN = originalReplayBin;
    vi.resetModules();
  });

  it('assembles session, headed, argv, stdin, and raw evidence exactly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-agent-browser-runtime-'));
    const fake = join(dir, 'agent-browser.js');
    writeFileSync(fake, [
      'process.stdin.setEncoding("utf8");',
      'let input = "";',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), input }));',
      '  process.stderr.write("process-evidence");',
      '});',
    ].join('\n'));
    chmodSync(fake, 0o755);
    process.env.MARQUEE_HTTP_REPLAY = 'fixture';
    process.env.MARQUEE_AGENT_BROWSER_REPLAY_BIN = fake;
    const { createAgentBrowserRuntime: createFreshRuntime } = await import('../index.js');
    const runtime = createFreshRuntime();

    const evidence = await runtime.execute({
      session: 'named',
      headed: true,
      argv: ['eval', '--stdin'],
      stdin: '21 * 2',
      timeoutMs: 5_000,
    });

    expect(JSON.parse(evidence.stdout)).toEqual({
      argv: ['--session', 'named', '--headed', 'eval', '--stdin'],
      input: '21 * 2',
    });
    expect(evidence.stderr).toBe('process-evidence');
  });
});
