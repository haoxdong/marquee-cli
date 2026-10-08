import type { Ref } from '../../../artifact-registry/index.js';
import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { createArtifactRegistry } from '../../../artifact-registry/index.js';
import { createControlGroupModule } from '../../../control-group/index.js';
import {
  type DashboardModule,
} from '../../../dashboard/index.js';
import { createEntityModule } from '../../../entity/index.js';
import { createEntityFeedComposition } from '../../../entity-feed/composition.js';
import { createMarketView } from '../../../marketview/index.js';
import type { MarketViewRegistration } from '../registrations.js';
import { registerMarketviewCommands } from '../marketview.js';

function commandContext(
  write: (chunk: string) => void,
  dashboard: DashboardModule,
  registry: ReturnType<typeof createArtifactRegistry>,
): MarketViewRegistration {
  const unexpected = (): never => {
    throw new Error('unexpected MarketView registration dependency');
  };
  const request = async (): Promise<never> => unexpected();
  const entity = createEntityModule({ request });
  const entityFeed = createEntityFeedComposition({ request });
  return {
    write,
    writeError: write,
    getMarketView: () => createMarketView({
      controlGroup: createControlGroupModule({ request }),
      dashboard,
      entity,
      entityFeed: entityFeed.entityFeed,
      readEntityFeedPage: entityFeed.readPage,
      registry,
      searchRequester: { request },
      dashboardPreferencesRequester: { request },
      widgetTransport: { request },
    }),
  };
}

function dashboardCreation(options: {
  existingName?: string;
} = {}): {
  dashboard: DashboardModule;
  create: ReturnType<typeof vi.fn<DashboardModule['create']>>;
} {
  const create = vi.fn<DashboardModule['create']>(async (input) => {
    const name = input.name.trim();
    if (!name) return { ok: false, error: { kind: 'invalid-name', name: input.name } };
    if (options.existingName === name) {
      return {
        ok: false,
        error: {
          kind: 'dashboard-exists',
          name,
          matches: [{ dashboardId: 'MD_EXISTING', name, kind: 'custom' }],
        },
      };
    }
    return {
      ok: true,
      value: {
        dashboardId: 'MD_TEST_1',
        name,
        link: 'https://marquee.gs.com/s/marketview/dashboards/MD_TEST_1',
      },
    };
  });
  const unexpected = async (): Promise<never> => {
    throw new Error('unexpected Dashboard operation');
  };
  return {
    dashboard: {
      get: unexpected,
      create,
      edit: unexpected,
    },
    create,
  };
}

describe('MarketView Dashboard create registration', () => {
  const directories: string[] = [];

  afterEach(() => {
    process.exitCode = undefined;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes ordered semantic Widget identities without mutating their Refs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dashboard-create-registration-'));
    directories.push(directory);
    const registry = createArtifactRegistry(directory, 'dashboard-create-registration');
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId, selectedContext: null },
      w2: { type: 'widget', widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId, selectedContext: null },
    });
    const creation = dashboardCreation();
    let output = '';
    const program = new Command();
    program.exitOverride();
    registerMarketviewCommands(
      program,
      commandContext((chunk) => { output += chunk; }, creation.dashboard, registry),
    );

    await program.parseAsync([
      'marketview',
      'dashboard',
      'create',
      'Macro Desk',
      '--add',
      '@w2',
      '--add',
      '@w1',
    ], { from: 'user' });

    expect(creation.create).toHaveBeenCalledOnce();
    expect(creation.create).toHaveBeenCalledWith({
      name: 'Macro Desk',
      widgets: [
        { widgetId: 'MW_TWO', configurationId: 'WC_TWO' },
        { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
      ],
    });
    expect(output.trim()).toMatch(
      /^ref:\t@d1\nurl:\thttps:\/\/marquee\.gs\.com\/s\/marketview\/dashboards\/MD_TEST_\w+\nwidgets:\t2$/,
    );
    expect(registry.resolveRef('w1' as Ref)).toEqual({
      type: 'widget',
      widgetId: 'MW_ONE',
      configurationId: 'WC_ONE',
      selectedContext: null,
    });
    expect(registry.resolveRef('w2' as Ref)).toEqual({
      type: 'widget',
      widgetId: 'MW_TWO',
      configurationId: 'WC_TWO',
      selectedContext: null,
    });
    expect(registry.resolveRef('d1' as Ref)).toEqual({
      type: 'dashboard',
      dashboardId: expect.stringMatching(/^MD_TEST_/),
    });
  });

  it('creates an empty Dashboard with one create and no reread', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dashboard-create-registration-'));
    directories.push(directory);
    const registry = createArtifactRegistry(directory, 'dashboard-create-registration');
    const creation = dashboardCreation();
    let output = '';
    const program = new Command();
    program.exitOverride();
    registerMarketviewCommands(
      program,
      commandContext((chunk) => { output += chunk; }, creation.dashboard, registry),
    );

    await program.parseAsync([
      'marketview',
      'dashboard',
      'create',
      'Empty Desk',
    ], { from: 'user' });

    expect(creation.create).toHaveBeenCalledOnce();
    expect(creation.create).toHaveBeenCalledWith({ name: 'Empty Desk', widgets: [] });
    expect(output.trim()).toMatch(
      /^ref:\t@d1\nurl:\thttps:\/\/marquee\.gs\.com\/s\/marketview\/dashboards\/MD_TEST_\w+\nwidgets:\t0$/,
    );
    expect(registry.resolveRef('d1' as Ref)).toEqual({
      type: 'dashboard',
      dashboardId: expect.stringMatching(/^MD_TEST_/),
    });
  });

  it('rejects invalid names and unresolved Widget Refs before Dashboard creation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dashboard-create-registration-'));
    directories.push(directory);
    const registry = createArtifactRegistry(directory, 'dashboard-create-registration');
    const creation = dashboardCreation({ existingName: 'Macro Desk' });
    let output = '';
    const program = new Command();
    program.exitOverride();
    registerMarketviewCommands(
      program,
      commandContext((chunk) => { output += chunk; }, creation.dashboard, registry),
    );

    await program.parseAsync([
      'marketview',
      'dashboard',
      'create',
      '   ',
      '--add',
      '@missing',
    ], { from: 'user' });
    expect(creation.create).not.toHaveBeenCalled();
    expect(output.trim()).toBe('Error: dashboard name must not be empty');
    expect(process.exitCode).toBe(1);

    output = '';
    process.exitCode = undefined;
    await program.parseAsync([
      'marketview',
      'dashboard',
      'create',
      ' Macro Desk ',
      '--add',
      '@missing',
    ], { from: 'user' });
    expect(creation.create).not.toHaveBeenCalled();
    expect(output.trim()).toBe([
      'Error: ref @missing not found',
      'Hint: run the previous command again or use one of the refs printed above.',
    ].join('\n'));
    expect(process.exitCode).toBe(1);
  });
});
