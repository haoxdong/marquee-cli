import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { expect, it } from 'vitest';
import { createProgram } from '../../index.js';

const skill = readFileSync(new URL('../../../skills/marquee/SKILL.md', import.meta.url), 'utf8');

it('resolves every documented command through the registered marquee tree', () => {
  const section = skill.split('## Commands\n')[1]?.split('\n## ')[0];
  const block = section?.match(/```\n([\s\S]*?)```/)?.[1];
  assert(block, 'the Commands section needs a command block');
  const { program } = createProgram();
  const resolved: string[] = [];
  for (const line of block.trim().split('\n')) {
    const [root, ...tokens] = line.replace(/#.*/, '').trim().split(/\s+/);
    expect(root).toBe('marquee');
    let commands: Command[] = [program];
    for (const token of tokens) {
      if (token.startsWith('<') || token.startsWith('"') || token === '…') break;
      commands = commands.flatMap((parent) => token.split('|').map((name) => {
        const command = parent.commands.find((child) => child.name() === name || child.aliases().includes(name));
        assert(command, `${line} refers to unregistered command ${name}`);
        return command;
      }));
    }
    resolved.push(...commands.map((command) => command.name()));
  }
  expect(resolved).toEqual(['search', 'view', 'view', 'edit', 'create', 'search', 'view', 'open']);
});
