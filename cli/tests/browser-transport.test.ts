import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserTransport, resolveBrowserSession } from '../browser-transport.js';

describe('delegated Browser transport compatibility', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not add an auth preflight to an ordinary command', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const transport = createBrowserTransport({
      runtime: { execute },
    });

    await expect(transport.run('snapshot')).resolves.toBe('ok\n');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      session: 'marquee',
      headed: undefined,
      argv: ['snapshot'],
      stdin: undefined,
      timeoutMs: 30_000,
    });
  });

  it('closes the default session', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'closed\n', stderr: '' });
    const transport = createBrowserTransport({
      runtime: { execute },
    });

    await expect(transport.close()).resolves.toBe('closed\n');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      session: 'marquee',
      headed: undefined,
      argv: ['close'],
      stdin: undefined,
      timeoutMs: 30_000,
    });
  });

  it('saves the default session state to the given path', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const transport = createBrowserTransport({
      runtime: { execute },
    });

    await transport.saveState('/tmp/state.json');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      session: 'marquee',
      argv: ['state', 'save', '/tmp/state.json'],
    }));
  });

  it('returns sign-in page HTML unchanged without a retry', async () => {
    const html = '<!DOCTYPE html><html><body><form><input name="username"></form></body></html>';
    const execute = vi.fn().mockResolvedValue({ stdout: html, stderr: '' });
    const transport = createBrowserTransport({
      runtime: { execute },
    });

    await expect(transport.run('eval', ['document.documentElement.outerHTML'])).resolves.toBe(html);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('classifies a failed command as a Browser adapter failure', async () => {
    const transport = createBrowserTransport({
      runtime: { execute: async () => {
        throw new Error('exit code 1: Unknown ref: e999');
      } },
    });

    await expect(transport.run('click', ['@e999'])).rejects.toMatchObject({
      name: 'MarqueeError',
      code: 'adapter',
      message: 'Command failed: click. exit code 1: Unknown ref: e999',
    });
  });

  it('classifies a stale Browser Session with the login recovery hint', async () => {
    const transport = createBrowserTransport({
      runtime: { execute: async () => {
        throw new Error('Session with given id not found');
      } },
    });

    await expect(transport.run('get', ['url'])).rejects.toMatchObject({
      name: 'MarqueeError',
      code: 'adapter',
      message: 'Command failed: get. Browser session expired. Retrying failed — try: marquee auth login',
    });
  });

  it.each([
    [undefined, {}, 'marquee'],
    [undefined, { CODEX_THREAD_ID: ' ' }, 'marquee'],
    [undefined, { CODEX_THREAD_ID: 'conversation-a' }, 'marquee-6a46a0e170d8bf41'],
    [undefined, { CODEX_THREAD_ID: ' conversation-a ' }, 'marquee-6a46a0e170d8bf41'],
    [undefined, { AGENT_BROWSER_SESSION: 's2' }, 's2'],
    [undefined, { AGENT_BROWSER_SESSION: 's2', CODEX_THREAD_ID: 'conversation-a' }, 's2'],
    ['s1', { AGENT_BROWSER_SESSION: 's2' }, 's1'],
  ])('resolves flag %s with env %j to Browser Session %s', (flag, env, session) => {
    expect(resolveBrowserSession(flag, env)).toBe(session);
  });

  it('maps process timeouts without leaking process details', async () => {
    const transport = createBrowserTransport({
      runtime: { execute: async () => {
        throw new Error('ETIMEDOUT');
      } },
    });

    await expect(transport.run('snapshot'))
      .rejects.toMatchObject({ name: 'MarqueeError', code: 'timeout', message: 'Command timed out.' });
  });

  it('passes headed mode and stdin through to the runtime', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: '42', stderr: '' });
    const transport = createBrowserTransport({
      runtime: { execute },
    });

    await expect(transport.run('eval', ['--stdin'], {
      headed: true,
      stdin: '21 * 2',
    })).resolves.toBe('42');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      headed: true,
      argv: ['eval', '--stdin'],
      stdin: '21 * 2',
    }));
  });

  it('keeps Marquee NO_PROXY guidance in the Browser adapter', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');
    vi.stubEnv('NO_PROXY', '.gs.com');
    const transport = createBrowserTransport({
      runtime: { execute: async () => {
        throw new Error('net::ERR_NAME_NOT_RESOLVED');
      } },
    });

    await expect(transport.run(
      'open',
      ['https://marquee.gs.com/s/'],
    )).rejects.toThrow(
      'NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1"',
    );
  });

  it('preserves DNS-looking stdout from a successful open', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');
    vi.stubEnv('NO_PROXY', '.gs.com');
    const stdout = 'net::ERR_NAME_NOT_RESOLVED\n';
    const transport = createBrowserTransport({
      runtime: { execute: async () => ({ stdout, stderr: '' }) },
    });

    await expect(transport.run(
      'open',
      ['https://marquee.gs.com/s/'],
    )).resolves.toBe(stdout);
  });
});
