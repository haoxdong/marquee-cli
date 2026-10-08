import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { apiOwnerAttachment } from '../owners/api.js';
import type { ApiRegistration } from '../registrations.js';

function fixtureCommand() {
  const request = vi.fn<ApiRegistration['request']>(async () => 'fixture response');
  const program = new Command();
  apiOwnerAttachment.register(program, { request, write: () => {}, writeError: () => {} });
  return { program, request };
}

describe('registered API method defaults', () => {
  it('documents the conditional default in visible help', () => {
    const { program } = fixtureCommand();
    expect(program.commands[0]?.helpInformation().replace(/\s+/g, ' ')).toContain(
      'The HTTP method for the request (default GET; POST when fields or --input are provided)',
    );
  });

  it.each([
    { name: 'no fields', args: [], method: 'GET', payload: {} },
    { name: 'raw fields', args: ['-f', 'id=fixture-id'], method: 'POST', payload: { body: { id: 'fixture-id' } } },
    { name: 'typed fields', args: ['-F', 'count=2'], method: 'POST', payload: { body: { count: 2 } } },
    { name: 'explicit GET with fields', args: ['-X', 'GET', '-f', 'id=fixture-id'], method: 'GET', payload: { query: { id: 'fixture-id' } } },
  ])('preserves method and payload placement for $name', async ({ args, method, payload }) => {
    const { program, request } = fixtureCommand();
    await program.parseAsync(['api', '/v1/local-method-probe', ...args], { from: 'user' });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      { method, path: '/v1/local-method-probe' },
      { responseType: 'text', isErrorBodyPreserved: true, ...payload },
    );
  });

  it('defaults --input to POST and keeps accompanying fields in the query', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'api-method-'));
    try {
      const input = join(directory, 'body.json');
      await writeFile(input, '{"fixture":"body"}');
      const { program, request } = fixtureCommand();
      await program.parseAsync(['api', '/v1/local-method-probe', '--input', input, '-f', 'id=fixture-id'], { from: 'user' });
      expect(request).toHaveBeenCalledExactlyOnceWith(
        { method: 'POST', path: '/v1/local-method-probe' },
        { responseType: 'text', isErrorBodyPreserved: true, body: { fixture: 'body' }, query: { id: 'fixture-id' } },
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
