import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cliEntry = fileURLToPath(new URL('../../cli-composition/main.ts', import.meta.url));
const skill = readFileSync(resolve(root, 'skills/marquee/SKILL.md'), 'utf8');
const execution = skill.split('## Execution\n')[1]?.split('\n## Browser')[0] ?? '';

function batch(commands: string[]): string {
  const example = /```bash\n([\s\S]*?)```/.exec(execution)?.[1];
  if (!example && execution.includes('`&` + `wait`')) {
    return `${commands.map((command) => `${command} &`).join('\n')}\nwait\n`;
  }
  if (!example) throw new Error('Execution guidance needs a runnable Bash batch');
  let next = 0;
  const script = example.replace(/^marquee .+ &$/gm, () => `${commands[next++]} &`);
  if (next !== commands.length) throw new Error('Supply one child per example command');
  return script;
}

function run(script: string) {
  const result = spawnSync('bash', ['-euc', script], {
    encoding: 'utf8',
    cwd: resolve(root, '..'),
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  return result;
}

describe('Marquee skill concurrent batch', () => {
  it('has valid Bash syntax', () => {
    const result = spawnSync('bash', ['-n'], {
      input: batch(['true', 'true', 'true']),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each([
    { name: 'all-success', codes: [0, 0, 0], aggregate: 0 },
    { name: 'one-failed child', codes: [0, 4, 0], aggregate: 4 },
    { name: 'multiple-failed children', codes: [4, 7, 0], aggregate: 4 },
  ])('waits every concurrent child and preserves output/status for $name', ({ codes, aggregate }) => {
    const directory = mkdtempSync(resolve(tmpdir(), 'marquee-skill-batch-'));
    try {
      const commands = codes.map((code, index) => `(
        touch '${directory}/started-${index}'
        ready=0
        for attempt in {1..200}; do
          if [[ -f '${directory}/started-0' && -f '${directory}/started-1' && -f '${directory}/started-2' ]]; then
            ready=1
            break
          fi
          sleep 0.01
        done
        if [[ "$ready" != 1 ]]; then echo 'concurrency barrier timed out' >&2; exit 99; fi
        printf 'output-${index}\\n'
        exit ${code}
      )`);
      const result = run(batch(commands));
      expect(result.status).toBe(aggregate);
      expect(result.stdout.trim().split('\n').sort()).toEqual(['output-0', 'output-1', 'output-2']);
      expect(result.stderr).toBe(codes.map((code, index) => `Batch child ${index + 1} exited ${code}\n`).join(''));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('checks direct actual CLI help and failure statuses', () => {
    const helpArgs = [cliEntry, '--help'];
    const failureArgs = [cliEntry, 'invalid-batch-command'];
    const help = spawnSync('node_modules/.bin/vite-node', helpArgs, {
      encoding: 'utf8', cwd: resolve(root, '..'), timeout: 15_000,
    });
    const failure = spawnSync('node_modules/.bin/vite-node', failureArgs, {
      encoding: 'utf8', cwd: resolve(root, '..'), timeout: 15_000,
    });
    expect(help.error).toBeUndefined();
    expect(failure.error).toBeUndefined();
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('marquee <command> [flags]');
    expect(failure.status).toBe(1);
    expect(failure.stderr).toBe("error: unknown command 'invalid-batch-command'\n");
  }, 20_000);

  it.each([
    { name: 'all-success', args: ['--help', '--help', '--help'], aggregate: 0, codes: [0, 0, 0] },
    { name: 'one-failed child', args: ['--help', 'invalid-batch-command', '--help'], aggregate: 1, codes: [0, 1, 0] },
    { name: 'multiple-failed children', args: ['invalid-batch-command', 'invalid-batch-command', '--help'], aggregate: 1, codes: [1, 1, 0] },
  ])('propagates actual offline CLI outcomes for $name', ({ args, aggregate, codes }) => {
    const commands = args.map((argument) => `node_modules/.bin/vite-node '${cliEntry.replaceAll("'", "'\\''")}' ${argument}`);
    const result = run(batch(commands));
    expect(result.status).toBe(aggregate);
    expect(result.stdout.match(/marquee <command> \[flags\]/g)).toHaveLength(codes.filter((code) => code === 0).length);
    for (const [index, code] of codes.entries()) {
      expect(result.stderr).toContain(`Batch child ${index + 1} exited ${code}\n`);
    }
    expect(result.stderr.match(/error: unknown command 'invalid-batch-command'/g) ?? []).toHaveLength(codes.filter((code) => code !== 0).length);
  }, 20_000);
});
