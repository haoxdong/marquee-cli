import type { Ref } from '../../artifact-registry/index.js';
import type { ConfigId, WidgetId } from '../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { createMarketViewDashboardCreation } from '../dashboard-create.js';
import { createFakeDashboardModule } from './fake-dashboard.js';

describe('MarketView Dashboard creation', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resolves ordered Widget refs without mutating their identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-create-'));
    directories.push(directory);
    const registry = createArtifactRegistry(directory, 'dashboard-create-test');
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId, selectedContext: null },
      w2: { type: 'widget', widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId, selectedContext: null },
    });
    const creation = createMarketViewDashboardCreation({
      dashboard: createFakeDashboardModule(),
      registry,
    });

    const result = await creation.create({ name: 'Macro Desk', widgetRefs: ['@w1', '@w2'] });

    expect(result).toEqual({
      ok: true,
      value: {
        ref: 'd1',
        dashboard: expect.objectContaining({ name: 'Macro Desk' }),
        seededWidgetCount: 2,
      },
    });
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
    expect(registry.resolveRef('d1' as Ref)).toEqual({ type: 'dashboard', dashboardId: 'MD_TEST_1' });
  });

  it('preserves blank-name validation before resolving Widget refs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-create-'));
    directories.push(directory);
    const creation = createMarketViewDashboardCreation({
      dashboard: createFakeDashboardModule(),
      registry: createArtifactRegistry(directory, 'dashboard-create-test'),
    });

    await expect(creation.create({ name: '   ', widgetRefs: ['@missing'] })).resolves.toEqual({
      ok: false,
      error: { kind: 'dashboard', error: { kind: 'invalid-name', name: '   ' } },
    });
  });

  it('resolves Widget refs before delegating exact-title creation checks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-create-'));
    directories.push(directory);
    const creation = createMarketViewDashboardCreation({
      dashboard: createFakeDashboardModule([{
        dashboardId: 'MD_EXISTING',
        name: 'Macro Desk',
        kind: 'custom',
        tags: [],
        permissions: { viewers: [], editors: [], administrators: [] },
        children: [],
        sections: [],
        link: 'https://marquee.gs.com/s/marketview/dashboards/MD_EXISTING',
      }]),
      registry: createArtifactRegistry(directory, 'dashboard-create-test'),
    });

    await expect(creation.create({ name: ' Macro Desk ', widgetRefs: ['@missing'] })).resolves.toEqual({
      ok: false,
      error: { kind: 'unknown-ref', refName: 'missing' },
    });
  });

  it('rejects a configuration-less Widget Artifact without resolving a default Config', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-create-'));
    directories.push(directory);
    const registry = createArtifactRegistry(directory, 'dashboard-create-no-config-test');
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW_ONE' as WidgetId, selectedContext: 'MA_CONTEXT', configurationId: null },
    });
    const dashboard = createFakeDashboardModule();
    const creation = createMarketViewDashboardCreation({ dashboard, registry });

    await expect(creation.create({ name: 'Macro Desk', widgetRefs: ['@w1'] })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dashboard',
        error: {
          kind: 'invalid-widget',
          widget: {
            widgetId: 'MW_ONE',
            selectedContext: 'MA_CONTEXT',
          },
        },
      },
    });
  });
});
