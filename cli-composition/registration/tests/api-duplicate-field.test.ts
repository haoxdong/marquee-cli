import { Command } from 'commander';
import { expect, it } from 'vitest';
import { apiOwnerAttachment } from '../owners/api.js';

it('rejects duplicate API fields before sending a request', async () => {
  const bodies: unknown[] = [];
  const program = new Command();
  apiOwnerAttachment.register(program, {
    request: async (_endpoint, init) => {
      bodies.push(init.body);
      return '{}';
    },
    write: () => {},
    writeError: () => {},
  });

  const outcome = await program.parseAsync([
    'api', '/v1/duplicate-probe', '-f', 'value=first', '-f', 'value=second',
  ], { from: 'user' }).then(() => 'success', () => 'rejected');
  expect({ outcome, bodies }).toEqual({ outcome: 'rejected', bodies: [] });
});
