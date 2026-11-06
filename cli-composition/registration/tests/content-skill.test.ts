import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { expect, it } from 'vitest';
import { createProgram } from '../../index.js';

const skill = readFileSync(new URL('../../../skills/marquee/SKILL.md', import.meta.url), 'utf8');
const data = readFileSync(new URL('../../../skills/marquee/data.md', import.meta.url), 'utf8');

function documentedCommands(document: string, heading: string): string[] {
  const section = document.split(`## ${heading}\n`)[1]?.split('\n## ')[0];
  const block = [...(section ?? '').matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].find(([, language]) => !language)?.[2];
  assert(block, `the ${heading} section needs a command block`);
  const { program } = createProgram();
  const resolved: string[] = [];
  // A line may run commands together in the background: `a & b & wait`.
  const lines = block.trim().split('\n').flatMap((line) => line.replace(/#.*/, '').split(' & '));
  for (const line of lines.filter((command) => command.trim() !== 'wait')) {
    const [root, ...tokens] = line.trim().split(/\s+/);
    expect(root).toBe('marquee');
    let commands: Command[] = [program];
    for (const token of tokens) {
      // A leaf command takes the rest as its arguments.
      if (/^[<"'[-]/.test(token) || token === '…' || commands.every((command) => command.commands.length === 0)) break;
      commands = commands.flatMap((parent) => token.split('|').map((name) => {
        const command = parent.commands.find((child) => child.name() === name || child.aliases().includes(name));
        assert(command, `${line} refers to unregistered command ${name}`);
        return command;
      }));
    }
    resolved.push(...commands.map((command) => command.name()));
  }
  return resolved;
}

it('resolves every documented command through the registered marquee tree', () => {
  expect(documentedCommands(skill, 'Commands')).toEqual(['search', 'view', 'view', 'edit', 'create', 'search', 'view', 'open', 'eval']);
  expect(documentedCommands(data, 'Look up')).toEqual(['search', 'list', 'search', 'view', 'list']);
});

it('points the skill to the data.md beside it', () => {
  expect(skill).toContain('read [data.md](data.md)');
});
