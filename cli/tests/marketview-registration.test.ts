import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../cli-composition/index.js';
import type { MarketView } from '../../marketview/index.js';

describe('marketview command module', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('registers noun-first marketview commands with owner-specific dependencies', async () => {
    const search = vi.fn<MarketView['search']>(async () => ({
      result: {
        ok: false,
        error: { kind: 'invalid-query' },
      },
      evidence: [],
    }));
    const getWidget = vi.fn<MarketView['widget']['get']>(async (input) => ({
      result: { ok: false, error: { kind: 'invalid-widget-id', input: input.target } },
      evidence: [],
    }));
    const getDashboard = vi.fn<MarketView['dashboard']['get']>(async () => ({
      result: {
        ok: false,
        error: { kind: 'artifact-not-found', ref: 'test', availableRefs: [] },
      },
      evidence: [],
    }));
    const marketView: MarketView = {
      search,
      widget: { get: getWidget },
      dashboard: {
        get: getDashboard,
        edit: async () => ({
          result: { ok: false, error: { kind: 'invalid-input', reason: 'no-mutations' } },
          evidence: [],
        }),
        create: async () => ({
          result: {
            ok: false,
            error: { kind: 'dashboard', error: { kind: 'invalid-name', name: '' } },
          },
          evidence: [],
        }),
      },
    };

    const { program } = createProgram(() => {}, { marketView });

    await program.parseAsync(['marketview', 'search', 'spx carry', '--limit', '3', '--json', 'title'], { from: 'user' });
    await program.parseAsync([
      'marketview',
      'widget',
      'view',
      'mw456',
      '--config',
      'WC456',
      '--param',
      'currency=EUR',
      '--param',
      'formula=a=b',
      '--json',
      'data',
      '--jq',
      '.data',
    ], { from: 'user' });
    await program.parseAsync(['marketview', 'dashboard', 'view', '@d1', '-S', 'carry', '--json', 'title'], { from: 'user' });

    expect(search).toHaveBeenCalledWith({
      query: 'spx carry',
      selectors: ['keyword-widget', 'thematic', 'asset', 'country', 'portfolio'],
      limit: 3,
    });
    expect(getWidget).toHaveBeenCalledWith({
      target: 'mw456',
      configurationId: 'WC456',
      overrides: [
        { field: 'currency', value: 'EUR' },
        { field: 'formula', value: 'a=b' },
      ],
      detail: 'full',
    });
    expect(getDashboard).toHaveBeenCalledWith({
      target: '@d1',
      search: 'carry',
    });
  });

  it('passes dashboard -L as the widget limit and rejects a non-positive one', async () => {
    const getDashboard = vi.fn<MarketView['dashboard']['get']>(async () => ({
      result: {
        ok: false,
        error: { kind: 'artifact-not-found', ref: 'test', availableRefs: [] },
      },
      evidence: [],
    }));
    const marketView = { dashboard: { get: getDashboard } } as unknown as MarketView;
    const errors: string[] = [];
    const { program } = createProgram(() => {}, {
      marketView,
      writeError: (chunk) => errors.push(chunk),
    });

    await program.parseAsync(['marketview', 'dashboard', 'view', '@d1', '-L', '48'], { from: 'user' });
    await program.parseAsync(['marketview', 'dashboard', 'view', '@d1', '-L', '0'], { from: 'user' });

    expect(getDashboard).toHaveBeenCalledTimes(1);
    expect(getDashboard).toHaveBeenCalledWith({ target: '@d1', limit: 48 });
    expect(errors.join('')).toContain('Error: -L must be a positive integer');
    expect(process.exitCode).toBe(1);
  });

  it.each(['open', 'expand', 'eval', 'filter'])(
    'rejects the retired widget %s verb',
    async (verb) => {
      const { program } = createProgram(() => {});

      await expect(program.parseAsync(['marketview', 'widget', verb, '@w1'], { from: 'user' }))
        .rejects.toMatchObject({ code: 'commander.unknownCommand' });
    },
  );

});
