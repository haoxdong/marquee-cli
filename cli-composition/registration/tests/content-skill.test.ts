import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../../../artifact-registry/index.js';
import { createContent } from '../../../content/index.js';
import { createProviderEvidenceLog } from '../../evidence.js';
import { commandJsonFields } from '../../output-mode.js';
import { registerContentCommands } from '../content.js';

const skill = readFileSync(new URL('../../../skills/marquee/SKILL.md', import.meta.url), 'utf8');
const response: unknown = JSON.parse(readFileSync(
  new URL('../../../content/search/adapters/tests/fixtures/content-skill-response.json', import.meta.url),
  'utf8',
));
let refsDir: string | undefined;

afterEach(() => {
  if (refsDir) rmSync(refsDir, { recursive: true, force: true });
  refsDir = undefined;
  process.exitCode = undefined;
});

function registeredSearch() {
  refsDir = mkdtempSync(join(tmpdir(), 'marquee-content-skill-'));
  const request = vi.fn(async () => response);
  const content = createContent({
    registry: createArtifactRegistry(refsDir, process.ppid),
    document: { async get() { throw new Error('unexpected document retrieval'); } },
    evidence: createProviderEvidenceLog(),
    requester: () => ({ request }),
  });
  let stdout = '';
  let stderr = '';
  const program = new Command().exitOverride().configureOutput({ writeErr: (chunk) => { stderr += chunk; } });
  registerContentCommands(program, {
    getContent: () => content,
    write: (chunk) => { stdout += chunk; },
    writeError: (chunk) => { stderr += chunk; },
  });
  return { program, request, stdout: () => stdout, stderr: () => stderr };
}

it('runs the Content skill JSON example against registered fields and provider response', async () => {
  const section = skill.split('## Content')[1]?.split('\n## ')[0];
  const example = section?.match(/`(marquee content search [^`]*--json [^`]+)`/)?.[1];
  assert(example, 'Content guidance needs a runnable JSON document-record example');
  const argv = [...example.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => {
    const argument = match[1] ?? match[2];
    assert(argument !== undefined);
    return argument;
  });
  const { program, request, stdout, stderr } = registeredSearch();
  const contentCommand = program.commands.find((command) => command.name() === 'content');
  assert(contentCommand);
  const search = contentCommand.commands.find((command) => command.name() === 'search');
  assert(search);
  const selectedFields = argv[argv.indexOf('--json') + 1];
  assert(selectedFields);
  const fields = selectedFields.split(',');
  expect(fields.length).toBeGreaterThan(1);
  for (const field of fields) expect(commandJsonFields(search)).toContain(field);
  await program.parseAsync(argv.slice(1), { from: 'user' });
  expect(request).toHaveBeenCalledOnce();
  expect(stderr()).toBe('');
  expect(process.exitCode).toBeUndefined();
  expect(JSON.parse(stdout())).toEqual([{ published: '2026-06-15T12:00:00.000Z', title: 'Weekly outlook: US CPI' }]);
});

it.each([{ fields: [] }, { fields: ['facets'] }])('rejects unsupported JSON fields %j before any provider read', async ({ fields }) => {
  const { program, request, stdout, stderr } = registeredSearch();
  await expect(program.parseAsync(['content', 'search', 'US CPI', '--json', ...fields], { from: 'user' }))
    .rejects.toMatchObject({ code: 'marquee.usage', exitCode: 1 });
  expect(request).not.toHaveBeenCalled();
  expect(stdout()).toBe('');
  expect(stderr()).toContain('title');
  expect(stderr()).toContain('published');
});
