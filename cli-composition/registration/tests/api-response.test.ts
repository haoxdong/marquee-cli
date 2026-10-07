import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { apiOwnerAttachment } from '../owners/api.js';
import { createTransport } from '../../../transport/index.js';
import { renderTopLevelCliError } from '../../top-level-error.js';

function fixtureCommand(responses: Response[], execution: 'direct' | 'proxy' = 'direct') {
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fixture request');
    return response;
  });
  const transport = createTransport(execution === 'proxy' ? {
    execution: 'proxy', baseUrl: 'http://fixture.invalid', accountId: 'fixture-account', sessionId: 'fixture-session', invocationToken: 'fixture-invocation', fetchFn,
  } : {
    execution: 'direct',
    authentication: { cookieJarPath: '/dev/null', jar: { cookies: [], updatedAt: 0 }, persistCookies: false },
    fetchFn,
  });
  return {
    fetchFn,
    async invoke() {
      let stdout = '';
      let stderr = '';
      process.exitCode = undefined;
      const program = new Command();
      apiOwnerAttachment.register(program, {
        request: transport.request,
        write: (chunk) => { stdout += chunk; },
        writeError: (chunk) => { stderr += chunk; },
      });
      try {
        await program.parseAsync(['api', '/v1/probe'], { from: 'user' });
      } catch (error) {
        const rendered = renderTopLevelCliError(error);
        stderr += rendered.stderr ?? '';
        process.exitCode = rendered.exitCode;
      }
      return { stdout, stderr, exitCode: process.exitCode ?? 0 };
    },
  };
}

afterEach(() => { process.exitCode = undefined; });

describe('registered API response lifecycle', () => {
  it.each([
    ['empty 204', new Response(null, { status: 204 }), ''],
    ['plain text', new Response('raw line one\nraw line two\n', { headers: { 'content-type': 'text/plain' } }), 'raw line one\nraw line two\n'],
    ['raw JSON', new Response('{ "results": [] }\n', { headers: { 'content-type': 'application/json' } }), '{ "results": [] }\n'],
  ])('preserves %s without inventing a JSON requirement', async (_name, response, expected) => {
    const fixture = fixtureCommand([response]);
    expect(await fixture.invoke()).toEqual({ stdout: expected, stderr: '', exitCode: 0 });
    expect(fixture.fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 429, 500])('prints a short %i error and recovers on the next explicit invocation', async (status) => {
    const fixture = fixtureCommand([new Response('{"detail":"refused"}', { status }), new Response('healthy\n')]);
    expect(await fixture.invoke()).toEqual({ stdout: '', stderr: `Marquee returned ${status} for /v1/probe\n{"detail":"refused"}\n`, exitCode: 1 });
    expect(await fixture.invoke()).toEqual({ stdout: 'healthy\n', stderr: '', exitCode: 0 });
    expect(fixture.fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each(['direct', 'proxy'] as const)('preserves the whole ordinary %s refusal body beyond the diagnostic hint limit', async (execution) => {
    const body = JSON.stringify({ detail: 'refused', context: 'fixture '.repeat(150), resolution: 'correct the input' });
    const fixture = fixtureCommand([new Response(body, { status: 400, headers: { 'content-type': 'application/json' } }), new Response('healthy\n')], execution);
    const service = execution === 'direct' ? 'Marquee' : 'Credential Service';
    expect(await fixture.invoke()).toEqual({ stdout: '', stderr: `${service} returned 400 for /v1/probe\n${body}\n`, exitCode: 1 });
    expect(await fixture.invoke()).toEqual({ stdout: 'healthy\n', stderr: '', exitCode: 0 });
  });

  it('reports a broken successful response body and recovers explicitly', async () => {
    const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('fixture body read failed')); } });
    const fixture = fixtureCommand([new Response(broken), new Response('healthy\n')]);
    const failure = await fixture.invoke();
    expect(failure.stdout).toBe('');
    expect(failure.stderr).toContain('fixture body read failed');
    expect(failure.exitCode).toBe(1);
    expect(await fixture.invoke()).toEqual({ stdout: 'healthy\n', stderr: '', exitCode: 0 });
  });
});
