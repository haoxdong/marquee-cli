import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { packageRoot } from './package-root.js';

type PluginManifest = {
  name: string;
  skills: string;
  version?: string;
  interface?: {
    defaultPrompt?: string[];
  };
};

type MarketplaceManifest = {
  name: string;
  plugins: Array<{
    name: string;
    source: string;
  }>;
};

type HookManifest = {
  hooks: {
    SessionStart: Array<{
      hooks: Array<{ command: string }>;
    }>;
  };
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('plugin distribution', () => {
  it('publishes Claude and Codex manifests for the same packaged skill', () => {
    const claudeManifest = readJson<PluginManifest>(resolve(packageRoot, '.claude-plugin/plugin.json'));
    const codexManifest = readJson<PluginManifest>(resolve(packageRoot, '.codex-plugin/plugin.json'));
    const skillPath = resolve(packageRoot, 'skills/marquee/SKILL.md');

    expect(claudeManifest).toMatchObject({ name: 'marquee', skills: './skills/' });
    expect(claudeManifest.version).toBeUndefined();
    expect(codexManifest).toMatchObject({ name: 'marquee', skills: './skills/' });
    expect(codexManifest.interface?.defaultPrompt).toEqual([
      'Use Marquee to research this request.',
    ]);
    expect(existsSync(skillPath)).toBe(true);
  });

  it('exposes the repository-root plugin from the Claude marketplace', () => {
    const marketplacePath = resolve(packageRoot, '.claude-plugin/marketplace.json');
    const marketplace = readJson<MarketplaceManifest>(marketplacePath);

    expect(marketplace.name).toBe('marquee-private');
    expect(marketplace.plugins).toContainEqual(expect.objectContaining({
      name: 'marquee',
      source: './',
    }));
  });

  it('ships public install instructions with the mirror', () => {
    const installPath = resolve(packageRoot, 'INSTALL.md');
    const install = readFileSync(installPath, 'utf8');

    expect(existsSync(installPath)).toBe(true);
    expect(install).toContain('npm install --global @haoxdong/marquee-cli');
    expect(install).toContain('/plugin marketplace add haoxdong/marquee-cli');
    expect(install).toContain('/plugin install marquee@marquee-private');
    expect(install).toContain('public read-only distribution mirrors');
    expect(install).toContain('for compatibility with existing installations');
  });

  it('persists the Claude Code interaction session for CLI subprocesses', () => {
    const hooks = readJson<HookManifest>(resolve(packageRoot, 'hooks/hooks.json'));
    expect(hooks.hooks.SessionStart[0]?.hooks[0]?.command).toContain('session-start.mjs');

    const dir = mkdtempSync(resolve(tmpdir(), 'marquee-claude-hook-'));
    const envFile = resolve(dir, 'claude.env');
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(packageRoot, 'hooks/session-start.mjs')],
        {
          input: JSON.stringify({ session_id: 'claude-session-1' }),
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_ENV_FILE: envFile },
        },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(envFile, 'utf8')).toBe(
        "export CLAUDE_CODE_SESSION_ID='claude-session-1'\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed Claude Code session identifiers', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'marquee-claude-hook-'));
    const envFile = resolve(dir, 'claude.env');
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(packageRoot, 'hooks/session-start.mjs')],
        {
          input: JSON.stringify({ session_id: 'bad\nsession' }),
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_ENV_FILE: envFile },
        },
      );

      expect(result.status).not.toBe(0);
      expect(existsSync(envFile)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
