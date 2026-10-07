import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { MarketView } from '../../../marketview/index.js';
import { registerMarketviewCommands } from '../marketview.js';

describe('MarketView Widget registration', () => {
  it('forwards Selected Context to Widget get', async () => {
    const getWidget = vi.fn<MarketView['widget']['get']>(async (input) => ({
      result: { ok: false, error: { kind: 'invalid-widget-id', input: input.target } },
      evidence: [],
    }));
    const unexpected = async (): Promise<never> => {
      throw new Error('unexpected MarketView operation');
    };
    const marketView: MarketView = {
      search: unexpected,
      widget: { get: getWidget },
      dashboard: { get: unexpected, edit: unexpected, create: unexpected },
    };
    const program = new Command();
    program.exitOverride();
    registerMarketviewCommands(program, {
      write() {},
      writeError() {},
      getMarketView() {
        return marketView;
      },
    });

    await program.parseAsync([
      'marketview',
      'widget',
      'view',
      'MW_CONTEXT',
      '--selected-context',
      'MA_EXPLICIT',
    ], { from: 'user' });

    expect(getWidget).toHaveBeenCalledWith({
      target: 'MW_CONTEXT',
      selectedContext: 'MA_EXPLICIT',
      overrides: [],
      detail: 'full',
    });
  });

  it('keeps private Widget Snippet parsing out of public help', async () => {
    const getWidget = vi.fn<MarketView['widget']['get']>(async (input) => ({
      result: { ok: false, error: { kind: 'invalid-widget-id', input: input.target } },
      evidence: [],
    }));
    const unexpected = async (): Promise<never> => {
      throw new Error('unexpected MarketView operation');
    };
    const program = new Command();
    program.exitOverride();
    registerMarketviewCommands(program, {
      write() {},
      writeError() {},
      getMarketView() {
        return {
          search: unexpected,
          widget: { get: getWidget },
          dashboard: { get: unexpected, edit: unexpected, create: unexpected },
        };
      },
    });

    await program.parseAsync([
      'marketview',
      'widget',
      'view',
      'MW_SNIPPET',
      '--snippet',
    ], { from: 'user' });

    const commandNamed = (parent: Command, name: string): Command => {
      const child = parent.commands.find((command) => command.name() === name);
      assert(child, `missing command: ${name}`);
      return child;
    };
    const getCommand = commandNamed(commandNamed(commandNamed(program, 'marketview'), 'widget'), 'view');
    expect(getWidget).toHaveBeenCalledWith({
      target: 'MW_SNIPPET',
      overrides: [],
      detail: 'snippet',
    });
    expect(getCommand.helpInformation()).not.toContain('--snippet');
  });
});
