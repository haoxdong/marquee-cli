import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { apiOwnerAttachment } from '../owners/api.js';
import { renderTopLevelCliError } from '../../top-level-error.js';
import type { ApiRegistration } from '../registrations.js';

function fixtureCommand() {
  const request = vi.fn<ApiRegistration['request']>(async () => 'fixture response');
  const program = new Command().exitOverride();
  const stderr: string[] = [];
  apiOwnerAttachment.register(program, { request, write: () => {}, writeError: (chunk) => void stderr.push(chunk) });
  return { program, request, stderr };
}

describe('registered API method defaults', () => {
  // ADR 0085 decision 4: written by the command, then classed `usage`.
  it('rejects unsafe typed JSON integers as usage before sending a request', async () => {
    const { program, request, stderr } = fixtureCommand();
    const error = await program.parseAsync([
      'api', '/v1/local-method-probe', '-F', 'id=9007199254740993',
    ], { from: 'user' }).then(() => undefined, (failure: unknown) => failure);
    expect({ code: (error as { code?: unknown }).code, stderr: stderr.join(''), topLevel: renderTopLevelCliError(error) }).toEqual({
      code: 'marquee.usage',
      stderr: 'Error: integer field exceeds the safe JSON integer range; use --raw-field to send a string\n',
      topLevel: { exitCode: 1 },
    });
    expect(request).not.toHaveBeenCalled();
  });

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
    { name: 'explicit PUT with fields', args: ['-X', 'PUT', '-F', 'count=2'], method: 'PUT', payload: { body: { count: 2 } } },
    { name: 'explicit DELETE', args: ['-X', 'DELETE'], method: 'DELETE', payload: {} },
    { name: 'explicit PATCH with fields', args: ['-X', 'PATCH', '-f', 'name=fixture'], method: 'PATCH', payload: { body: { name: 'fixture' } } },
    { name: 'extension method', args: ['-X', 'PROPFIND'], method: 'PROPFIND', payload: {} },
    { name: 'explicit HEAD with fields', args: ['-X', 'HEAD', '-f', 'id=fixture-id'], method: 'HEAD', payload: { query: { id: 'fixture-id' } } },
    { name: 'lowercase GET with fields', args: ['-X', 'get', '-f', 'id=fixture-id'], method: 'get', payload: { query: { id: 'fixture-id' } } },
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
        { responseType: 'text', isErrorBodyPreserved: true, rawBody: '{"fixture":"body"}', query: { id: 'fixture-id' } },
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});


it.each(['GET', 'HEAD', 'get', 'head'])('rejects an explicit %s input body before any request', async (method) => {
  const directory = await mkdtemp(join(tmpdir(), 'api-get-input-'));
  try {
    const input = join(directory, 'body.json');
    await writeFile(input, '{}');
    const { program, request } = fixtureCommand();
    await expect(program.parseAsync(['api', '/v1/local-method-probe', '-X', method, '--input', input], { from: 'user' }))
      .rejects.toThrow(`${method} requests cannot have a body; remove --input`);
    expect(request).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true });
  }
});
