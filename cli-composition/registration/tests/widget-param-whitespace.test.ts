import { Command } from 'commander';
import { expect, it } from 'vitest';
import { registerMarketviewCommands } from '../marketview.js';

it.each([
  { name: 'plain text', value: 'rolling volatility' },
  { name: 'embedded equals', value: 'a=b=c' },
  { name: 'surrounding spaces', value: '  rolling volatility  ' },
  { name: 'whitespace only', value: '   ' },
  { name: 'empty text', value: '' },
])('preserves $name in a Widget parameter override', async ({ value }) => {
  const overrides: unknown[] = [];
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected operation'); };
  const program = new Command().exitOverride();
  registerMarketviewCommands(program, {
    write: () => {},
    writeError: () => {},
    getMarketView: () => ({
      search: unexpected,
      dashboard: { get: unexpected, edit: unexpected, create: unexpected },
      widget: {
        get: async (input) => {
          overrides.push(input.overrides);
          throw new Error('Fake Widget boundary reached');
        },
      },
    }),
  });

  await expect(program.parseAsync([
    'marketview', 'widget', 'view', 'MW_PROBE', '-p', `text=${value}`,
  ], { from: 'user' })).rejects.toThrow('Fake Widget boundary reached');

  expect(overrides).toEqual([[{ field: 'text', value }]]);
});

it.each(['text', '=value', '   =value'])(
  'rejects malformed Widget parameter assignment %j before Widget get',
  async (assignment) => {
    const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
    registerMarketviewCommands(program, {
      write: () => {},
      writeError: () => {},
      getMarketView: () => { throw new Error('Unexpected Widget boundary'); },
    });

    await expect(program.parseAsync([
      'marketview', 'widget', 'view', 'MW_PROBE', '-p', assignment,
    ], { from: 'user' })).rejects.toThrow('expected <name=value>');
  },
);
