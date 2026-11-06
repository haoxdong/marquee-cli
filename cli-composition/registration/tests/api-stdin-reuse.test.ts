import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Command } from 'commander';
import { expect, it } from 'vitest';
import { apiOwnerAttachment } from '../owners/api.js';
import { renderTopLevelCliError } from '../../top-level-error.js';

// ADR 0085 decision 4: written by the command, then classed `usage`.
it('explains as usage how to replace shared stdin with a file before sending a request', async () => {
  let requests = 0;
  const stderr: string[] = [];
  const program = new Command();
  apiOwnerAttachment.register(program, {
    request: async () => { requests += 1; return '{}'; },
    write: () => {},
    writeError: (chunk) => void stderr.push(chunk),
  });
  const error = await program.parseAsync([
    'api', '/v1/local-stdin-probe', '--input', '-', '-F', 'query=@-',
  ], { from: 'user' }).then(() => undefined, (failure: unknown) => failure);

  expect({ code: (error as { code?: unknown }).code, stderr: stderr.join(''), topLevel: renderTopLevelCliError(error) }).toEqual({
    code: 'marquee.usage',
    stderr: 'Error: stdin can only feed one of --input or --field; write the other to a file (e.g. -F query=@query.txt)\n',
    topLevel: { exitCode: 1 },
  });
  expect(requests).toBe(0);
});

it.each([
  { name: 'stdin body only', args: ['--input', '-'] },
  { name: 'stdin body and field', args: ['--input', '-', '-F', 'query=@-'] },
])('$name settles the API invocation', async ({ args }) => {
  const bundled = await build({
    stdin: {
      contents: `
        import { Command } from 'commander';
        import { apiOwnerAttachment } from './owners/api.ts';
        const program = new Command();
        program.exitOverride();
        apiOwnerAttachment.register(program, {
          request: async () => '{}',
          write: () => {},
          writeError: () => {},
        });
        try {
          await program.parseAsync(['api', '/v1/local-stdin-probe', ...${JSON.stringify(args)}], { from: 'user' });
        } catch {
          process.exitCode = 1;
        }
        process.stdout.write('settled\\n');
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'local-stdin-probe.mjs',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const directory = mkdtempSync(join(tmpdir(), 'api-stdin-reuse-'));
  try {
    const script = join(directory, 'probe.mjs');
    const output = bundled.outputFiles[0];
    if (!output) throw new Error('API probe bundle is missing');
    writeFileSync(script, output.text);
    const result = spawnSync(process.execPath, [script], {
      input: '{}',
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect([0, 1]).toContain(result.status);
    expect(result.stdout).toBe('settled\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
