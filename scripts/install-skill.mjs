import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../skills/marquee', import.meta.url));
const ownerMarker = '.marquee-cli-owner';
const owner = '@haoxdong/marquee-cli';
const packageSkillSuffix = '/node_modules/@haoxdong/marquee-cli/skills/marquee';
const home = process.env.HOME ?? homedir();

const agents = [
  {
    name: 'claude',
    configDir: process.env.CLAUDE_CONFIG_DIR ?? resolve(home, '.claude'),
    installWhenMissing: true,
  },
  {
    name: 'codex',
    configDir: resolve(home, '.agents'),
  },
];

function selectedAgentNames() {
  const configured = process.env.MARQUEE_SKILL_TARGETS;
  if (configured === undefined) return undefined;
  return new Set(configured.split(',').map((name) => name.trim()).filter(Boolean));
}

/**
 * @param {string} target
 * @param {import('node:fs').Stats} installed
 */
function packageOwns(target, installed) {
  if (installed.isSymbolicLink()) {
    try {
      if (realpathSync(target) === realpathSync(source)) return true;
    } catch {
      // A package uninstall or npx cache cleanup can leave our old link broken.
    }
    try {
      const linkedPath = resolve(dirname(target), readlinkSync(target)).replaceAll('\\', '/');
      return linkedPath.endsWith(packageSkillSuffix);
    } catch {
      return false;
    }
  }
  if (!installed.isDirectory()) return false;

  try {
    return readFileSync(resolve(target, ownerMarker), 'utf8').trim() === owner;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {(typeof agents)[number]} agent */
function install(agent) {
  const configDirExists = existsSync(agent.configDir);
  if (!configDirExists && !agent.installWhenMissing) return;
  if (configDirExists && !statSync(agent.configDir).isDirectory()) return;

  const target = resolve(agent.configDir, 'skills/marquee');
  let installed;
  try {
    installed = lstatSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }

  if (installed && !packageOwns(target, installed)) {
    console.warn(`Skipping marquee skill installation: ${target} already exists.`);
    return;
  }

  if (installed) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  writeFileSync(resolve(target, ownerMarker), `${owner}\n`);
}

const selected = selectedAgentNames();
for (const agent of agents) {
  if (!selected || selected.has(agent.name)) install(agent);
}
