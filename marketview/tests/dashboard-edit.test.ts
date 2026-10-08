import type { Ref } from '../../artifact-registry/index.js';
import type { Dashboard, DashboardModule } from '../../dashboard/index.js';
import type { ConfigId, WidgetId } from '../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { createMarketViewDashboardEdit } from '../dashboard-edit.js';
import { createFakeDashboardModule } from './fake-dashboard.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('MarketView Dashboard edit', () => {
  it('rejects local input errors before preparing the Dashboard mutation', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      'd1.s1': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_ONE' },
    });
    const dashboard = createFakeDashboardModule([]);
    const dashboardEdit = vi.spyOn(dashboard, 'edit');
    const edit = createMarketViewDashboardEdit({ dashboard, registry });

    await expect(edit.edit({
      target: 'MD_MISSING',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: [],
      removeSectionRefs: [],
    })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-input', reason: 'no-mutations' },
    });
    await expect(edit.edit({
      target: '@d1.s1',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: ['Nested'],
      removeSectionRefs: [],
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        reason: 'section-add-section',
        targetLabel: '@d1.s1',
      },
    });
    await expect(edit.edit({
      target: 'MD_MISSING',
      addWidgetRefs: [],
      removeWidgetRefs: ['@missing'],
      addSectionNames: [],
      removeSectionRefs: [],
    })).resolves.toEqual({
      ok: false,
      error: { kind: 'unknown-ref', refName: 'missing' },
    });
    expect(dashboardEdit).not.toHaveBeenCalled();
  });

  it('rejects a foreign Dashboard Child ref before an identified Dashboard edit', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('other', {
      other: {
        type: 'dashboard',
        dashboardId: 'MD_OTHER',
      },
      'other.w1': {
        type: 'widget',
        widgetId: 'MW_OLD' as WidgetId,
        configurationId: 'WC_OLD' as ConfigId,
        dashboardId: 'MD_OTHER',
        childId: 'CHILD_OLD',
        selectedContext: null,
      },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD',
        rank: 1,
        widget: { widgetId: 'MW_OLD' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const get = vi.spyOn(dashboard, 'get');
    const dashboardEdit = vi.spyOn(dashboard, 'edit');

    const result = await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: 'MD_MACRO',
      addWidgetRefs: [],
      removeWidgetRefs: ['@other.w1'],
      addSectionNames: [],
      removeSectionRefs: [],
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'foreign-ref', refName: 'other.w1', dashboardId: 'MD_OTHER' },
    });
    expect(dashboardEdit).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    await expect(dashboard.get('MD_MACRO')).resolves.toMatchObject({
      ok: true,
      value: { children: [expect.objectContaining({ childId: 'CHILD_OLD' })] },
    });
  });

  it('resolves local change Refs before delegating an identifier target', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    const dashboard = createFakeDashboardModule([]);
    const get = vi.spyOn(dashboard, 'get');

    const result = await createMarketViewDashboardEdit({
      dashboard,
      registry,
    }).edit({
      target: 'market-regime',
      addWidgetRefs: [],
      removeWidgetRefs: ['@missing'],
      addSectionNames: [],
      removeSectionRefs: [],
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unknown-ref', refName: 'missing' },
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects a free-text Dashboard target before calling the Dashboard module', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    const dashboard = createFakeDashboardModule([]);
    const dashboardEdit = vi.spyOn(dashboard, 'edit');

    const result = await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: 'Desk',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: ['New section'],
      removeSectionRefs: [],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        reason: 'free-text-target',
        targetLabel: 'Desk',
      },
    });
    expect(dashboardEdit).not.toHaveBeenCalled();
  });

  it('delegates a provider-valid single-segment alias as the Dashboard identity', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    const dashboard = createFakeDashboardModule([]);
    const dashboardEdit = vi.spyOn(dashboard, 'edit');

    await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: 'rates',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: ['New section'],
      removeSectionRefs: [],
    });

    expect(dashboardEdit).toHaveBeenCalled();
    expect(dashboardEdit.mock.calls[0]?.[0]).toEqual({ kind: 'id', dashboardId: 'rates' });
  });

  it('always delegates removal preflight to the fresh Dashboard owner state', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD_MACRO' },
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW_OLD' as WidgetId,
        configurationId: 'WC_OLD' as ConfigId,
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_OLD',
        selectedContext: null,
      },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD',
        rank: 1,
        widget: { widgetId: 'MW_OLD' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const dashboardEdit = vi.spyOn(dashboard, 'edit');

    await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: '@d1',
      addWidgetRefs: [],
      removeWidgetRefs: ['@d1.w1'],
      addSectionNames: [],
      removeSectionRefs: [],
    });

    expect(dashboardEdit).toHaveBeenCalledWith(
      { kind: 'id', dashboardId: 'MD_MACRO' },
      [expect.objectContaining({ kind: 'remove-child', childId: 'CHILD_OLD' })],
    );
  });

  it('resolves typed Artifact refs into one canonical Dashboard mutation', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD_MACRO' },
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW_OLD' as WidgetId,
        configurationId: 'WC_OLD' as ConfigId,
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_OLD',
        selectedContext: null,
      },
      w2: {
        type: 'widget',
        widgetId: 'MW_NEW' as WidgetId,
        configurationId: 'WC_NEW' as ConfigId,
        selectedContext: null,
      },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD',
        rank: 1,
        widget: { widgetId: 'MW_OLD' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);

    const result = await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: '@d1',
      addWidgetRefs: ['@w2'],
      removeWidgetRefs: ['@d1.w1'],
      addSectionNames: ['New views'],
      removeSectionRefs: [],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        ref: 'd1',
        dashboard: expect.objectContaining({ dashboardId: 'MD_MACRO', name: 'Macro Desk' }),
        entries: [
          expect.objectContaining({ action: 'remove', target: '@d1.w1', status: 'applied' }),
          expect.objectContaining({ action: 'add', target: '@w2', status: 'applied' }),
          expect.objectContaining({ action: 'add-section', target: 'New views', status: 'applied' }),
        ],
      },
    });
  });

  it('accepts a configuration-less Widget Artifact without resolving a default Config', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('w1', {
      w1: { type: 'widget', widgetId: 'MW_NEW' as WidgetId, selectedContext: 'MA_CONTEXT', configurationId: null },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);

    await expect(createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: 'MD_MACRO',
      addWidgetRefs: ['@w1'],
      removeWidgetRefs: [],
      addSectionNames: [],
      removeSectionRefs: [],
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dashboard',
        error: {
          kind: 'invalid-widget',
          widget: { widgetId: 'MW_NEW', selectedContext: 'MA_CONTEXT' },
        },
      },
    });
  });

  it('preserves the exact repeated Dashboard Child selected for a Section addition', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD_MACRO' },
      'd1.s1': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_ONE' },
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW_REPEAT' as WidgetId,
        configurationId: 'WC_REPEAT' as ConfigId,
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_ONE',
        selectedContext: null,
      },
      'd1.w2': {
        type: 'widget',
        widgetId: 'MW_REPEAT' as WidgetId,
        configurationId: 'WC_REPEAT' as ConfigId,
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_TWO',
        selectedContext: null,
      },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [
        {
          kind: 'widget',
          childId: 'CHILD_ONE',
          rank: 1,
          widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REPEAT' as ConfigId },
          parameters: [],
        },
        {
          kind: 'widget',
          childId: 'CHILD_TWO',
          rank: 2,
          widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REPEAT' as ConfigId },
          parameters: [],
        },
      ],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: ['CHILD_ONE'] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);

    const result = await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: '@d1.s1',
      addWidgetRefs: ['@d1.w2'],
      removeWidgetRefs: [],
      addSectionNames: [],
      removeSectionRefs: [],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: {
          sections: [{ sectionId: 'SECTION_ONE', childIds: ['CHILD_ONE', 'CHILD_TWO'] }],
        },
        entries: [{ status: 'applied' }],
      },
    });
  });

  it('removes Widgets and Sections only through their own flags', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD_MACRO' },
      'd1.s1': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_ONE' },
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW_OLD' as WidgetId,
        configurationId: 'WC_OLD' as ConfigId,
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_OLD',
        selectedContext: null,
      },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD',
        rank: 1,
        widget: { widgetId: 'MW_OLD' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        parameters: [],
      }],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: [] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const dashboardEdit = vi.spyOn(dashboard, 'edit');
    const edit = createMarketViewDashboardEdit({ dashboard, registry });
    const noChanges = { addWidgetRefs: [], removeWidgetRefs: [], addSectionNames: [], removeSectionRefs: [] };

    await expect(edit.edit({ ...noChanges, target: '@d1', removeWidgetRefs: ['@d1.s1'] })).resolves.toEqual({
      ok: false,
      error: { kind: 'wrong-change-ref', refName: 'd1.s1', artifactType: 'section' },
    });
    await expect(edit.edit({ ...noChanges, target: '@d1', removeSectionRefs: ['@d1.w1'] })).resolves.toEqual({
      ok: false,
      error: { kind: 'wrong-change-ref', refName: 'd1.w1', artifactType: 'widget' },
    });
    expect(dashboardEdit).not.toHaveBeenCalled();

    const result = await edit.edit({
      ...noChanges,
      target: '@d1',
      removeWidgetRefs: ['@d1.w1'],
      removeSectionRefs: ['@d1.s1'],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: [
          { action: 'remove', target: '@d1.w1' },
          { action: 'remove', target: '@d1.s1' },
        ],
      },
    });
    expect(dashboardEdit).toHaveBeenCalledWith(
      { kind: 'id', dashboardId: 'MD_MACRO' },
      [
        expect.objectContaining({ kind: 'remove-child', childId: 'CHILD_OLD' }),
        { kind: 'remove-section', sectionId: 'SECTION_ONE' },
      ],
    );
  });

  it('reports the order change by the refs it was given, under the Dashboard ref of a Section target', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('s1.d1', {
      's1.d1': { type: 'dashboard', dashboardId: 'MD_MACRO' },
      's1.d1.s1': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_ONE' },
      's1.d1.s2': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_TWO' },
      's1.d1.w1': { type: 'widget', widgetId: 'MW_ONE' as WidgetId, dashboardId: 'MD_MACRO', childId: 'CHILD_ONE', configurationId: null, selectedContext: null },
      's1.d1.w2': { type: 'widget', widgetId: 'MW_TWO' as WidgetId, dashboardId: 'MD_MACRO', childId: 'CHILD_TWO', configurationId: null, selectedContext: null },
    });
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [
        { kind: 'widget', childId: 'CHILD_ONE', rank: 1, widget: { widgetId: 'MW_ONE' as WidgetId }, parameters: [] },
        { kind: 'widget', childId: 'CHILD_TWO', rank: 2, widget: { widgetId: 'MW_TWO' as WidgetId }, parameters: [] },
      ],
      sections: [
        { sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: ['CHILD_ONE', 'CHILD_TWO'] },
        { sectionId: 'SECTION_TWO', name: 'Detail', rank: 2, childIds: [] },
      ],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const edit = createMarketViewDashboardEdit({ dashboard, registry });
    const noChanges = { addWidgetRefs: [], removeWidgetRefs: [], addSectionNames: [], removeSectionRefs: [] };

    await expect(edit.edit({ ...noChanges, target: '@s1.d1.s1', orderRefs: ['@s1.d1.w2', '@s1.d1.w1'] }))
      .resolves.toMatchObject({
        ok: true,
        value: { ref: 's1.d1', entries: [{ action: 'order', target: ['@s1.d1.w2', '@s1.d1.w1'] }] },
      });
    await expect(edit.edit({ ...noChanges, target: '@s1.d1', orderRefs: ['@s1.d1.s2', '@s1.d1.s1'] }))
      .resolves.toMatchObject({
        ok: true,
        value: { ref: 's1.d1', entries: [{ action: 'order', target: ['@s1.d1.s2', '@s1.d1.s1'] }] },
      });
  });

  it('claims a Dashboard ref for a Dashboard edited by its ID', async () => {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    const dashboard = createFakeDashboardModule([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);

    const result = await createMarketViewDashboardEdit({ dashboard, registry }).edit({
      target: 'MD_MACRO',
      addWidgetRefs: [],
      removeWidgetRefs: [],
      addSectionNames: ['Notes'],
      removeSectionRefs: [],
    });

    expect(result).toMatchObject({ ok: true, value: { ref: 'd1' } });
    expect(registry.resolveRef('d1' as Ref)).toEqual({ type: 'dashboard', dashboardId: 'MD_MACRO' });
  });
});

describe('MarketView Dashboard edit change resolution', () => {
  const noChanges = { addWidgetRefs: [], removeWidgetRefs: [], addSectionNames: [], removeSectionRefs: [] };
  const macroDesk: Dashboard = {
    dashboardId: 'MD_MACRO',
    name: 'Macro Desk',
    kind: 'custom',
    tags: [],
    permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
    children: [
      { kind: 'widget', childId: 'CHILD_ONE', rank: 1, widget: { widgetId: 'MW_ONE' as WidgetId }, parameters: [] },
      { kind: 'widget', childId: 'CHILD_TWO', rank: 2, widget: { widgetId: 'MW_TWO' as WidgetId }, parameters: [] },
    ],
    sections: [
      { sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: ['CHILD_ONE', 'CHILD_TWO'] },
      { sectionId: 'SECTION_TWO', name: 'Detail', rank: 2, childIds: [] },
    ],
    link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
  };

  function setup(dashboardModule: Pick<DashboardModule, 'edit'> = createFakeDashboardModule([macroDesk])) {
    const refsDirectory = mkdtempSync(join(tmpdir(), 'marketview-dashboard-edit-'));
    temporaryDirectories.push(refsDirectory);
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD_MACRO' },
      'd1.s1': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_ONE' },
      'd1.s2': { type: 'section', dashboardId: 'MD_MACRO', sectionId: 'SECTION_TWO' },
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW_ONE' as WidgetId,
        configurationId: 'WC_ONE' as ConfigId,
        selectedContext: 'MA_ONE',
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_ONE',
      },
      'd1.w2': { type: 'widget', widgetId: 'MW_TWO' as WidgetId, dashboardId: 'MD_MACRO', childId: 'CHILD_TWO', configurationId: null, selectedContext: null },
    });
    registry.setRefs('d2', {
      d2: { type: 'dashboard', dashboardId: 'MD_OTHER' },
      'd2.s1': { type: 'section', dashboardId: 'MD_OTHER', sectionId: 'SECTION_OTHER' },
      'd2.w1': {
        type: 'widget',
        widgetId: 'MW_OTHER' as WidgetId,
        configurationId: 'WC_OTHER' as ConfigId,
        dashboardId: 'MD_OTHER',
        childId: 'CHILD_OTHER',
        selectedContext: null,
      },
    });
    registry.setRefs('w3', {
      w3: {
        type: 'widget',
        widgetId: 'MW_NEW' as WidgetId,
        configurationId: 'WC_NEW' as ConfigId,
        selectedContext: 'MA_NEW',
      },
    });
    registry.setRefs('w4', { w4: { type: 'widget', widgetId: 'MW_BARE' as WidgetId, configurationId: null, selectedContext: null } });
    const edit = vi.spyOn(dashboardModule, 'edit');
    return { edit, marketView: createMarketViewDashboardEdit({ dashboard: dashboardModule, registry }) };
  }

  it('rejects a blank Section title among valid ones and an empty order before anything else', async () => {
    const { edit, marketView } = setup();

    await expect(marketView.edit({ ...noChanges, target: '@missing', addSectionNames: ['Valid', '  '] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'invalid-input', reason: 'blank-section' } });
    await expect(marketView.edit({ ...noChanges, target: '@missing', orderRefs: [] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'invalid-input', reason: 'empty-order' } });
    expect(edit).not.toHaveBeenCalled();
  });

  it('rejects a target ref that is unknown or neither a Dashboard nor a Section', async () => {
    const { edit, marketView } = setup();

    await expect(marketView.edit({ ...noChanges, target: '@missing', addSectionNames: ['Notes'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'unknown-ref', refName: 'missing' } });
    await expect(marketView.edit({ ...noChanges, target: '@w3', addSectionNames: ['Notes'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'wrong-target', refName: 'w3', artifactType: 'widget' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1' }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'invalid-input', reason: 'no-mutations' } });
    expect(edit).not.toHaveBeenCalled();
  });

  it('rejects removal refs that are unknown, from another Dashboard, or of the wrong kind', async () => {
    const { edit, marketView } = setup();

    await expect(marketView.edit({ ...noChanges, target: '@d1', removeWidgetRefs: ['@w3'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'foreign-ref', refName: 'w3', dashboardId: '' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1', removeWidgetRefs: ['@d1'] }))
      .resolves.toStrictEqual({
        ok: false,
        error: { kind: 'wrong-change-ref', refName: 'd1', artifactType: 'dashboard' },
      });
    await expect(marketView.edit({ ...noChanges, target: '@d1', removeSectionRefs: ['@missing'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'unknown-ref', refName: 'missing' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1', removeSectionRefs: ['@d2.s1'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'foreign-ref', refName: 'd2.s1', dashboardId: 'MD_OTHER' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1.s1', removeSectionRefs: ['@d1.s2'] }))
      .resolves.toStrictEqual({
        ok: false,
        error: { kind: 'wrong-change-ref', refName: 'd1.s2', artifactType: 'section' },
      });
    expect(edit).not.toHaveBeenCalled();
  });

  it('rejects addition refs that are unknown or not Widgets', async () => {
    const { edit, marketView } = setup();

    await expect(marketView.edit({ ...noChanges, target: '@d1', addWidgetRefs: ['@missing'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'unknown-ref', refName: 'missing' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1', addWidgetRefs: ['@d1.s1'] }))
      .resolves.toStrictEqual({
        ok: false,
        error: { kind: 'wrong-change-ref', refName: 'd1.s1', artifactType: 'section' },
      });
    expect(edit).not.toHaveBeenCalled();
  });

  it('rejects order refs that are unknown, from another Dashboard, or of the wrong kind for the target', async () => {
    const { edit, marketView } = setup();

    await expect(marketView.edit({ ...noChanges, target: '@d1.s1', orderRefs: ['@d1.w1', '@missing'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'unknown-ref', refName: 'missing' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1.s1', orderRefs: ['@d2.w1'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'foreign-ref', refName: 'd2.w1', dashboardId: 'MD_OTHER' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1.s1', orderRefs: ['@d1.s2'] }))
      .resolves.toStrictEqual({
        ok: false,
        error: { kind: 'wrong-change-ref', refName: 'd1.s2', artifactType: 'section' },
      });
    await expect(marketView.edit({ ...noChanges, target: '@d1', orderRefs: ['@d1.s1', '@missing'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'unknown-ref', refName: 'missing' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1', orderRefs: ['@d2.s1'] }))
      .resolves.toStrictEqual({ ok: false, error: { kind: 'foreign-ref', refName: 'd2.s1', dashboardId: 'MD_OTHER' } });
    await expect(marketView.edit({ ...noChanges, target: '@d1', orderRefs: ['@d1.w1'] }))
      .resolves.toStrictEqual({
        ok: false,
        error: { kind: 'wrong-change-ref', refName: 'd1.w1', artifactType: 'widget' },
      });
    expect(edit).not.toHaveBeenCalled();
  });

  it('sends a Dashboard target its changes with the Widget identity each ref carries', async () => {
    const { edit, marketView } = setup();

    await marketView.edit({
      ...noChanges,
      target: '@d1',
      removeWidgetRefs: ['@d1.w1'],
      removeSectionRefs: ['@d1.s2'],
      addWidgetRefs: ['@w3', '@w4', '@d1.w2'],
      orderRefs: ['@d1.s1'],
    });

    expect(edit.mock.calls).toStrictEqual([[
      { kind: 'id', dashboardId: 'MD_MACRO' },
      [
        {
          kind: 'remove-child',
          childId: 'CHILD_ONE',
          widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE', selectedContext: 'MA_ONE' },
        },
        { kind: 'remove-section', sectionId: 'SECTION_TWO' },
        { kind: 'add-widget', widget: { widgetId: 'MW_NEW', configurationId: 'WC_NEW', selectedContext: 'MA_NEW' } },
        { kind: 'add-widget', widget: { widgetId: 'MW_BARE' } },
        { kind: 'add-widget', widget: { widgetId: 'MW_TWO' } },
        { kind: 'order-sections', sectionIds: ['SECTION_ONE'] },
      ],
    ]]);
  });

  it('scopes changes to a Section target, placing an existing tile of its Dashboard by its Child', async () => {
    const { edit, marketView } = setup();

    await marketView.edit({
      ...noChanges,
      target: '@d1.s2',
      removeWidgetRefs: ['@d1.w2'],
      addWidgetRefs: ['@d1.w1', '@w4'],
      orderRefs: ['@d1.w2', '@d1.w1'],
    });

    expect(edit.mock.calls).toStrictEqual([[
      { kind: 'id', dashboardId: 'MD_MACRO' },
      [
        { kind: 'remove-child', childId: 'CHILD_TWO', widget: { widgetId: 'MW_TWO' }, sectionId: 'SECTION_TWO' },
        {
          kind: 'add-widget',
          widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE', selectedContext: 'MA_ONE' },
          sectionId: 'SECTION_TWO',
          childId: 'CHILD_ONE',
        },
        { kind: 'add-widget', widget: { widgetId: 'MW_BARE' }, sectionId: 'SECTION_TWO' },
        { kind: 'order-section-children', sectionId: 'SECTION_TWO', childIds: ['CHILD_TWO', 'CHILD_ONE'] },
      ],
    ]]);
  });

  it('adds another Dashboard\'s tile to a Section as a new Child', async () => {
    const { edit, marketView } = setup();

    await marketView.edit({ ...noChanges, target: '@d1.s1', addWidgetRefs: ['@d2.w1'] });

    expect(edit.mock.calls).toStrictEqual([[
      { kind: 'id', dashboardId: 'MD_MACRO' },
      [{ kind: 'add-widget', widget: { widgetId: 'MW_OTHER', configurationId: 'WC_OTHER' }, sectionId: 'SECTION_ONE' }],
    ]]);
  });

  it('reports each Dashboard result with its change presentation, note and error', async () => {
    const failure = { kind: 'permission-denied', dashboardId: 'MD_MACRO' } as const;
    const dashboardModule: Pick<DashboardModule, 'edit'> = {
      async edit(_target, changes) {
        const [removal, addition] = changes;
        if (!removal || !addition) throw new Error('expected two changes');
        return {
          ok: true,
          value: {
            before: macroDesk,
            dashboard: macroDesk,
            results: [
              { change: addition, status: 'applied', dashboard: macroDesk, note: 'already-present' },
              { change: removal, status: 'failed', error: failure },
            ],
          },
        };
      },
    };
    const { marketView } = setup(dashboardModule);

    const result = await marketView.edit({
      ...noChanges,
      target: '@d1',
      removeSectionRefs: ['@d1.s2'],
      addSectionNames: ['Notes'],
    });

    expect(result).toStrictEqual({
      ok: true,
      value: {
        ref: 'd1',
        dashboard: macroDesk,
        entries: [
          {
            change: { kind: 'add-section', name: 'Notes' },
            action: 'add-section',
            target: 'Notes',
            status: 'applied',
            note: 'already-present',
          },
          {
            change: { kind: 'remove-section', sectionId: 'SECTION_TWO' },
            action: 'remove',
            target: '@d1.s2',
            status: 'failed',
            error: failure,
          },
        ],
      },
    });
  });

  it('fails loud on a Dashboard result for a change it was not asked to make', async () => {
    const dashboardModule: Pick<DashboardModule, 'edit'> = {
      async edit() {
        return {
          ok: true,
          value: {
            before: macroDesk,
            dashboard: macroDesk,
            results: [{ change: { kind: 'add-section', name: 'Notes' }, status: 'applied' }],
          },
        };
      },
    };
    const { marketView } = setup(dashboardModule);

    await expect(marketView.edit({ ...noChanges, target: '@d1', addSectionNames: ['Notes'] }))
      .rejects.toThrow('Missing Dashboard mutation presentation for add-section');
  });
});
