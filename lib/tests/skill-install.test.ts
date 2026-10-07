import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const installScript = resolve(packageRoot, 'scripts/install-skill.mjs');
const packageSkill = resolve(packageRoot, 'skills/marquee');
const temporaryHomes: string[] = [];

function createTemporaryHome(prefix: string): string {
  const home = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryHomes.push(home);
  return home;
}

function runInstaller(home: string, env: NodeJS.ProcessEnv = {}): void {
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.CLAUDE_CONFIG_DIR;
  execFileSync(process.execPath, [installScript], {
    env: { ...inheritedEnv, HOME: home, ...env },
  });
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('marquee skill installation', () => {
  it('makes the packaged skill discoverable from a plain install', () => {
    const home = createTemporaryHome('marquee-skill-install-');

    runInstaller(home);

    const installedSkill = resolve(home, '.claude/skills/marquee');
    expect(lstatSync(installedSkill).isDirectory()).toBe(true);
    expect(lstatSync(installedSkill).isSymbolicLink()).toBe(false);
    expect(readFileSync(resolve(installedSkill, 'SKILL.md'), 'utf8')).toBe(
      readFileSync(resolve(packageSkill, 'SKILL.md'), 'utf8'),
    );
  });

  it('honors Claude Code custom config directories', () => {
    const home = createTemporaryHome('marquee-skill-config-');
    const configDir = resolve(home, 'custom-claude');

    runInstaller(home, { CLAUDE_CONFIG_DIR: configDir });

    expect(lstatSync(resolve(configDir, 'skills/marquee')).isDirectory()).toBe(true);
  });

  it('is idempotent when a package upgrade reruns postinstall', () => {
    const home = createTemporaryHome('marquee-skill-upgrade-');

    runInstaller(home);
    runInstaller(home);

    expect(lstatSync(resolve(home, '.claude/skills/marquee')).isDirectory()).toBe(true);
  });

  it('does not replace an existing skill owned by the user', () => {
    const home = createTemporaryHome('marquee-skill-existing-');
    const existingSkill = resolve(home, 'existing-skill');
    const installedSkill = resolve(home, '.claude/skills/marquee');
    mkdirSync(existingSkill);
    mkdirSync(dirname(installedSkill), { recursive: true });
    symlinkSync(existingSkill, installedSkill, 'dir');

    runInstaller(home);

    expect(realpathSync(installedSkill)).toBe(realpathSync(existingSkill));
  });
});
