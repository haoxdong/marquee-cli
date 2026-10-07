import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';

import { createProgram } from '../../cli-composition/index.js';

function commandAt(root: ReturnType<typeof createProgram>['program'], path: string[]) {
  let command = root;
  for (const name of path) {
    const child = command.commands.find((candidate) => candidate.name() === name);
    assert(child, `missing command: ${path.join(' ')}`);
    command = child;
  }
  return command;
}

function childNames(root: ReturnType<typeof createProgram>['program'], path: string[]): string[] {
  return commandAt(root, path).commands
    .map((command) => command.name())
    .filter((name) => !name.startsWith('__legacy-'));
}

describe('ADR 0047 hard-cutover command grammar', () => {
  it('registers only the noun-first command surface', () => {
    const { program } = createProgram(() => {});

    expect(childNames(program, ['marketview', 'widget'])).toEqual([
      'view',
    ]);
    expect(childNames(program, ['marketview', 'dashboard'])).toEqual([
      'view',
      'edit',
      'create',
    ]);
    expect(childNames(program, ['auth'])).toEqual(['status', 'login', 'logout']);

    expect(program.commands.map((command) => command.name())).toEqual([
      'marketview',
      'content',
      'browser',
      'auth',
      'api',
    ]);
    expect(program.commands.flatMap((command) => command.commands.map((child) => child.name())))
      .not.toContain('__legacy-widget');
    expect(program.commands.flatMap((command) => command.commands.map((child) => child.name())))
      .not.toContain('__legacy-dashboard');
    expect(childNames(program, ['marketview'])).toEqual(['search', 'widget', 'dashboard']);

    expect(childNames(program, ['content'])).toEqual([
      'search',
      'view',
    ]);
  });

  it.each(['markets', 'research'])('guides the retired content %s path to unified content view', async (subsurface) => {
    const { program } = createProgram(() => {});

    await expect(program.parseAsync([
      'content',
      subsurface,
      'view',
      '123e4567-e89b-12d3-a456-426614174000',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'marquee.removedPath',
      message: expect.stringContaining('marquee content view <ref|url|uuid>'),
    });
  });

  it.each([
    ['load', '@w1'],
    ['select', '@w1.relativeDate', '1Y'],
    ['status'],
    ['marketview', 'widget', 'MW123'],
    ['asset', 'search', 'AAPL'],
    ['marketview', 'discover'],
    ['content', 'open', '@s1.c1'],
    ['marketview', 'dashboard', 'add', 'Temp', '@w1'],
    ['marketview', 'dashboard', 'remove', '@d1.w1'],
    ['marketview', 'dashboard', 'reorder', '@d1.s1', '@d1.w1'],
    ['marketview', 'dashboard', 'add-section', '@d1', 'Section'],
    ['marketview', 'dashboard', 'remove-section', '@d1.s1'],
  ])('rejects the retired form: marquee %s', async (...args) => {
    const { program } = createProgram(() => {});

    await expect(program.parseAsync(args, { from: 'user' })).rejects.toMatchObject({
      code: 'commander.unknownCommand',
    });
  });
});
