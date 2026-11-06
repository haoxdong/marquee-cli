import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Agent Browser Runtime binary resolution', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:module');
    vi.doUnmock('node:url');
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('resolves each Replay command binary from its current environment', async () => {
    vi.stubEnv('MARQUEE_HTTP_REPLAY', 'scenario');
    vi.stubEnv('MARQUEE_AGENT_BROWSER_REPLAY_BIN', 'fixtures/first-agent-browser.js');
    const { resolveAgentBrowserBinForRuntime } = await import('../process.js');

    expect(resolveAgentBrowserBinForRuntime())
      .toBe(resolve('fixtures/first-agent-browser.js'));

    vi.stubEnv('MARQUEE_AGENT_BROWSER_REPLAY_BIN', 'fixtures/second-agent-browser.js');
    expect(resolveAgentBrowserBinForRuntime())
      .toBe(resolve('fixtures/second-agent-browser.js'));
  });

  it('resolves the JavaScript entry from an installed dependency', async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'mq-agent-browser-package-'));
    const dependencyEntry = join(packageRoot, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
    mkdirSync(dirname(dependencyEntry), { recursive: true });
    writeFileSync(dependencyEntry, '#!/usr/bin/env node\n', 'utf-8');

    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: (specifier: string) => {
          if (specifier === 'agent-browser/bin/agent-browser.js') return dependencyEntry;
          throw new Error(`module not found: ${specifier}`);
        },
      }),
    }));

    const { resolveAgentBrowserBinForRuntime } = await import('../process.js');

    expect(resolveAgentBrowserBinForRuntime()).toBe(dependencyEntry);
  });

  it('resolves from the primary checkout when the worktree lacks dependencies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-agent-browser-worktree-'));
    const primary = join(dir, 'primary');
    const worktree = join(dir, 'worktree');
    const primaryBin = join(primary, 'node_modules', '.bin', 'agent-browser');
    mkdirSync(dirname(primaryBin), { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(primaryBin, '#!/usr/bin/env node\n', 'utf-8');
    chmodSync(primaryBin, 0o755);

    vi.doMock('node:module', () => ({
      createRequire: () => ({ resolve: () => { throw new Error('module not found'); } }),
    }));
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: vi.fn((file: string, args: string[]) => {
          if (file === 'which') throw new Error('not on PATH');
          if (file === 'git' && args.includes('--show-toplevel')) return `${worktree}\n`;
          if (file === 'git' && args.includes('--git-common-dir')) return `${primary}/.git\n`;
          throw new Error(`unexpected command: ${file} ${args.join(' ')}`);
        }),
      };
    });

    const { resolveAgentBrowserBinForRuntime } = await import('../process.js');

    expect(resolveAgentBrowserBinForRuntime()).toBe(primaryBin);
  });

  it('resolves a relative common dir from the git command cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-agent-browser-common-dir-'));
    const topLevel = join(dir, 'checkout', 'root');
    const gitCwd = join(topLevel, 'marquee-cli', 'agent-browser-runtime');
    const commonDirRaw = '../../primary/.git';
    const primary = dirname(resolve(gitCwd, commonDirRaw));
    const primaryBin = join(primary, 'node_modules', '.bin', 'agent-browser');
    mkdirSync(dirname(primaryBin), { recursive: true });
    mkdirSync(gitCwd, { recursive: true });
    writeFileSync(primaryBin, '#!/usr/bin/env node\n', 'utf-8');
    chmodSync(primaryBin, 0o755);

    vi.doMock('node:url', async () => {
      const actual = await vi.importActual<typeof import('node:url')>('node:url');
      return { ...actual, fileURLToPath: () => join(gitCwd, 'process.ts') };
    });
    vi.doMock('node:module', () => ({
      createRequire: () => ({ resolve: () => { throw new Error('module not found'); } }),
    }));
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: vi.fn((file: string, args: string[], options?: { cwd?: string }) => {
          if (file === 'which') throw new Error('not on PATH');
          if (file === 'git' && options?.cwd !== gitCwd) {
            throw new Error(`unexpected git cwd: ${options?.cwd ?? 'undefined'}`);
          }
          if (file === 'git' && args.includes('--show-toplevel')) return `${topLevel}\n`;
          if (file === 'git' && args.includes('--git-common-dir')) return `${commonDirRaw}\n`;
          throw new Error(`unexpected command: ${file} ${args.join(' ')}`);
        }),
      };
    });

    const { resolveAgentBrowserBinForRuntime } = await import('../process.js');

    expect(resolveAgentBrowserBinForRuntime()).toBe(primaryBin);
  });
});
