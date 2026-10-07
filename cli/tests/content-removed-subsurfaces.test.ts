import assert from 'node:assert/strict';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../../cli-composition/index.js';

// ADR 0049 §1: the content markets / content research
// subsurfaces are deleted; old spellings get the §1-style typed error naming
// the folded path — never commander's generic unknown-command error — and
// never reach a router action.
describe('removed content subsurfaces', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it.each([
    ['markets', ['content', 'markets', 'get', '123e4567-e89b-12d3-a456-426614174000']],
    ['research', ['content', 'research', 'get', '123e4567-e89b-12d3-a456-426614174001', '--date', '2026-06-09']],
    ['markets', ['content', 'markets']],
    ['research', ['content', 'research']],
  ])('errors with the folded path for content %s spellings', async (removed, argv) => {
    let output = '';
    let error = '';
    const { program } = createProgram(
      (chunk) => { output += chunk; },
      { writeError: (chunk) => { error += chunk; } },
    );

    await expect(program.parseAsync(argv, { from: 'user' })).rejects.toMatchObject({
      name: 'RemovedPathError',
      code: 'marquee.removedPath',
      message: `'content ${removed}' was removed; use 'marquee content view <ref|url|uuid>'`,
    });

    expect(output).toBe('');
    expect(error).toBe(
      `Error: 'content ${removed}' was removed; use 'marquee content view <ref|url|uuid>'\n`,
    );
  });

  it('keeps the removed subsurfaces out of content help', () => {
    const { program } = createProgram(() => {});

    const content = program.commands.find((command) => command.name() === 'content');
    assert(content);
    const help = content.helpInformation();
    expect(help).not.toContain('markets');
    expect(help).not.toContain('research');
    expect(help).toContain('view');
  });
});
