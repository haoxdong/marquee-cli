import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createTransport } from '../../../transport/index.js';
import { apiOwnerAttachment } from '../owners/api.js';

describe.each(['direct', 'proxy', 'session'] as const)('%s input JSON', (execution) => {
  it.each(['{"id":42}', '{"id":9007199254740993}', '{ "id":-9007199254740993,"nested":[1.234567890123456789],"id":42 }\n'])(
    'preserves the --input body %s',
    async (body) => {
      const directory = await mkdtemp(join(tmpdir(), 'api-input-integer-'));
      try {
        const path = join(directory, 'body.json');
        await writeFile(path, body);
        const sent: unknown[] = [];
        const fetchFn: typeof fetch = async (_input, init) => {
          sent.push(init?.body);
          expect(new Headers(init?.headers).get('content-type')).toBe('application/json;charset=utf-8');
          return new Response('{}', { headers: { 'content-type': 'application/json' } });
        };
        const transport = createTransport(execution === 'direct' ? {
          execution,
          authentication: {
            cookieJarPath: '/dev/null',
            jar: { cookies: [], updatedAt: 0 },
            persistCookies: false,
          },
          fetchFn,
        } : execution === 'session' ? {
          execution, baseUrl: 'https://api.marqueebot.com', sessionToken: 'sess_fixture', fetchFn,
        } : {
          execution, baseUrl: 'http://fixture.invalid', accountId: 'fixture-account', sessionId: 'fixture-session', invocationToken: 'fixture-invocation', fetchFn,
        });
        const program = new Command();
        apiOwnerAttachment.register(program, {
          request: transport.request,
          write: () => {},
          writeError: () => {},
        });

        await program.parseAsync([
          'api', '/v1/input-integer-probe', '--input', path,
        ], { from: 'user' });

        expect(sent).toEqual([body]);
      } finally {
        await rm(directory, { recursive: true });
      }
    },
  );
});
