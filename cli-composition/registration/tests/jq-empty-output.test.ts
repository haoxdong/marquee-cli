import { afterEach, expect, it } from 'vitest';
import { fixture, runData } from './data-search-harness.js';

afterEach(() => { process.exitCode = undefined; });

it.each([
  ['empty', ''],
  ['.[] | select(false)', ''],
  ['""', '\n'],
  ['"", ""', '\n\n'],
  ['"  value  ", "\\n"', '  value  \n\n\n'],
  ['null, false, 0, [], {}', 'null\nfalse\n0\n[]\n{}\n'],
])('preserves jq result lines for %s', async (filter, stdout) => {
  const library = fixture('plots-functions.json') as Readonly<{ body: unknown }>;
  const result = await runData(
    ['list', 'functions', '--json', 'name', '--jq', filter],
    () => library.body,
  );

  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(stdout);
});
