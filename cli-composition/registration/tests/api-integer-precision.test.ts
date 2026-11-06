import { Command } from 'commander';
import { expect, it } from 'vitest';
import { createTransport } from '../../../transport/index.js';
import { apiOwnerAttachment } from '../owners/api.js';

it('preserves a signed 64-bit integer in an API query field', async () => {
  const urls: string[] = [];
  const transport = createTransport({
    execution: 'direct',
    authentication: {
      cookieJarPath: '/dev/null',
      jar: { cookies: [], updatedAt: 0 },
      persistCookies: false,
    },
    fetchFn: async (input) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  const program = new Command();
  apiOwnerAttachment.register(program, {
    request: transport.request,
    write: () => {},
    writeError: () => {},
  });

  await program.parseAsync([
    'api', '/v1/integer-probe', '-X', 'GET', '-F', 'id=9007199254740993',
  ], { from: 'user' });

  expect(urls).toHaveLength(1);
  expect(new URL(urls[0] ?? '').searchParams.get('id')).toBe('9007199254740993');
});
