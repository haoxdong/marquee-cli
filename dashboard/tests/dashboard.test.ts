import type { ConfigId, WidgetId } from '../../widget/index.js';
import { describe, expect, it, vi } from 'vitest';

import {
  type Dashboard,
  type DashboardChange,
  type DashboardEditTarget,
  type DashboardModule,
} from '../index.js';
import { createDashboardInMemoryPort } from '../in-memory-port.js';
import {
  createDashboardModuleFromPort,
  type DashboardPort,
} from '../module.js';

async function runMutation(
  dashboard: Pick<DashboardModule, 'edit'>,
  input: {
    target: DashboardEditTarget;
    changes: readonly DashboardChange[];
  },
) {
  return dashboard.edit(input.target, input.changes);
}

function unusedMutationPort(): Pick<
  DashboardPort,
  | 'removeChild'
  | 'addWidget'
  | 'createSection'
  | 'deleteSection'
  | 'setSectionChildren'
  | 'setSectionRank'
> {
  return {
    removeChild: vi.fn(),
    addWidget: vi.fn(),
    createSection: vi.fn(),
    deleteSection: vi.fn(),
    setSectionChildren: vi.fn(),
    setSectionRank: vi.fn(),
  };
}

describe('Dashboard', () => {
  it('removes a Dashboard Child through the mutation planner', async () => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const dashboard = createDashboardModuleFromPort(port);

    const result = await runMutation(dashboard, {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_ONE' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: expect.objectContaining({ dashboardId: 'MD_MACRO', children: [] }),
        results: [{
          change: { kind: 'remove-child', childId: 'CHILD_ONE' },
          status: 'applied',
        }],
      },
    });
  });

  it('reconciles an ambiguous write and leaves later changes unattempted', async () => {
    let current: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom' as const,
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [
        {
          kind: 'widget' as const,
          childId: 'CHILD_ONE',
          rank: 1,
          widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
          parameters: [],
        },
        {
          kind: 'widget' as const,
          childId: 'CHILD_TWO',
          rank: 2,
          widget: { widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId },
          parameters: [],
        },
      ],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    const port: DashboardPort = {
      read: vi.fn<DashboardPort['read']>(async () => ({ ok: true, value: current })),
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      removeChild: vi.fn<DashboardPort['removeChild']>(async ({ childId }) => {
        current = {
          ...current,
          children: current.children.filter((child) => child.childId !== childId),
        };
        return {
          ok: false,
          error: {
            kind: 'dependency',
            failure: { kind: 'timeout' },
          },
        };
      }),
    };

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [
        { kind: 'remove-child', childId: 'CHILD_ONE' },
        { kind: 'remove-child', childId: 'CHILD_TWO' },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: expect.objectContaining({
          children: [expect.objectContaining({ childId: 'CHILD_TWO' })],
        }),
        results: [
          { change: { kind: 'remove-child', childId: 'CHILD_ONE' }, status: 'applied' },
          { change: { kind: 'remove-child', childId: 'CHILD_TWO' }, status: 'not-attempted' },
        ],
      },
    });
    expect(port.removeChild).toHaveBeenCalledOnce();
  });

  it('polls ambiguous writes and keeps an unobserved outcome uncertain', async () => {
    const initial: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    const updated = { ...initial, children: [] };
    const writeError = {
      kind: 'dependency' as const,
      failure: { kind: 'timeout' as const },
    };
    const delayedRead = vi.fn<DashboardPort['read']>()
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({ ok: true, value: updated });
    const mutationPort = {
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      removeChild: vi.fn<DashboardPort['removeChild']>(async () => ({ ok: false, error: writeError })),
    };

    const applied = await runMutation(createDashboardModuleFromPort({ read: delayedRead, ...mutationPort }), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_ONE' }],
    });

    expect(applied).toMatchObject({
      ok: true,
      value: { results: [{ status: 'applied' }] },
    });
    expect(delayedRead).toHaveBeenCalledTimes(4);

    const staleRead = vi.fn<DashboardPort['read']>(async () => ({ ok: true, value: initial }));
    const uncertain = await runMutation(createDashboardModuleFromPort({ read: staleRead, ...mutationPort }), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_ONE' }],
    });

    expect(uncertain).toMatchObject({
      ok: true,
      value: {
        results: [{ status: 'uncertain', error: writeError }],
      },
    });
    expect(staleRead).toHaveBeenCalledTimes(11);
  });

  it('classifies a post-write read failure as a typed verification failure', async () => {
    const initial: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_STALE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    let readCount = 0;
    const port: DashboardPort = {
      read: vi.fn<DashboardPort['read']>(async () => {
        readCount += 1;
        return readCount === 1
          ? { ok: true, value: initial }
          : {
              ok: false,
              error: {
                kind: 'dependency',
                failure: { kind: 'authentication-required', realm: 'marquee' },
              },
            };
      }),
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      removeChild: vi.fn<DashboardPort['removeChild']>(async () => ({ ok: true, value: undefined })),
    };

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_STALE' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [{
          status: 'uncertain',
          error: {
            kind: 'verification-failed',
            cause: {
              kind: 'dependency',
              failure: { kind: 'authentication-required', realm: 'marquee' },
            },
          },
        }],
      },
    });
  });

  it('polls bounded verification reads until an accepted write becomes observable', async () => {
    const initial: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_STALE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    const updated = { ...initial, children: [] };
    const read = vi.fn<DashboardPort['read']>()
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({ ok: true, value: updated });
    const port: DashboardPort = {
      read,
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      removeChild: vi.fn<DashboardPort['removeChild']>(async () => ({ ok: true, value: undefined })),
    };

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_STALE' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [{ status: 'applied' }],
        dashboard: { children: [] },
      },
    });
    expect(read).toHaveBeenCalledTimes(4);

    const staleRead = vi.fn<DashboardPort['read']>(async () => ({ ok: true, value: initial }));
    const exhausted = await runMutation(createDashboardModuleFromPort({
      read: staleRead,
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      removeChild: vi.fn<DashboardPort['removeChild']>(async () => ({ ok: true, value: undefined })),
    }), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_STALE' }],
    });

    expect(exhausted).toMatchObject({
      ok: true,
      value: {
        results: [{
          status: 'failed',
          error: { kind: 'effect-not-observed' },
        }],
      },
    });
    expect(staleRead).toHaveBeenCalledTimes(11);
  });

  it('preserves an ambiguous write error when verification also fails', async () => {
    const initial: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    const read = vi.fn<DashboardPort['read']>()
      .mockResolvedValueOnce({ ok: true, value: initial })
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'dependency', failure: { kind: 'unavailable' } },
      });
    const port: DashboardPort = {
      read,
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      removeChild: vi.fn<DashboardPort['removeChild']>(async () => ({
        ok: false,
        error: { kind: 'dependency', failure: { kind: 'timeout' } },
      })),
    };

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'remove-child', childId: 'CHILD_ONE' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [{
          status: 'uncertain',
          error: {
            kind: 'verification-failed',
            cause: { kind: 'dependency', failure: { kind: 'unavailable' } },
            writeError: { kind: 'dependency', failure: { kind: 'timeout' } },
          },
        }],
      },
    });
  });

  it('applies Dashboard removals, additions, and new Sections in canonical order', async () => {
    const port = createDashboardInMemoryPort([{
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

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [
        { kind: 'add-section', name: 'New views' },
        { kind: 'add-widget', widget: { widgetId: 'MW_NEW' as WidgetId, configurationId: 'WC_NEW' as ConfigId } },
        { kind: 'remove-child', childId: 'CHILD_OLD' },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: expect.objectContaining({
          children: [expect.objectContaining({
            kind: 'widget',
            widget: { widgetId: 'MW_NEW', configurationId: 'WC_NEW' },
          })],
          sections: [expect.objectContaining({ name: 'New views', childIds: [] })],
        }),
        results: [
          { change: { kind: 'remove-child', childId: 'CHILD_OLD' }, status: 'applied' },
          {
            change: { kind: 'add-widget', widget: { widgetId: 'MW_NEW', configurationId: 'WC_NEW' } },
            status: 'applied',
          },
          { change: { kind: 'add-section', name: 'New views' }, status: 'applied' },
        ],
      },
    });
  });

  it('prevalidates the complete plan before the first write', async () => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const removeChild = vi.spyOn(port, 'removeChild');

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [
        { kind: 'remove-child', childId: 'CHILD_ONE' },
        { kind: 'order-sections', sectionIds: ['SECTION_MISSING'] },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [
          { change: { kind: 'remove-child' }, status: 'not-attempted' },
          { change: { kind: 'order-sections' }, status: 'failed', error: { kind: 'invalid-mutation' } },
        ],
      },
    });
    expect(removeChild).not.toHaveBeenCalled();
  });

  it('validates complete Section order against the projected post-removal state', async () => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [],
      sections: [
        { sectionId: 'SECTION_ONE', name: 'One', rank: 1, childIds: [] },
        { sectionId: 'SECTION_TWO', name: 'Two', rank: 2, childIds: [] },
      ],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [
        { kind: 'remove-section', sectionId: 'SECTION_ONE' },
        { kind: 'order-sections', sectionIds: ['SECTION_TWO'] },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: { sections: [{ sectionId: 'SECTION_TWO', rank: 1 }] },
        results: [
          { change: { kind: 'remove-section', sectionId: 'SECTION_ONE' }, status: 'applied' },
          { change: { kind: 'order-sections', sectionIds: ['SECTION_TWO'] }, status: 'applied' },
        ],
      },
    });
  });

  it('validates Section Child order against projected membership removal', async () => {
    const port = createDashboardInMemoryPort([{
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
          widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
          parameters: [],
        },
        {
          kind: 'widget',
          childId: 'CHILD_TWO',
          rank: 2,
          widget: { widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId },
          parameters: [],
        },
      ],
      sections: [{
        sectionId: 'SECTION_ONE',
        name: 'One',
        rank: 1,
        childIds: ['CHILD_ONE', 'CHILD_TWO'],
      }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [
        { kind: 'remove-child', childId: 'CHILD_ONE', sectionId: 'SECTION_ONE' },
        { kind: 'order-section-children', sectionId: 'SECTION_ONE', childIds: ['CHILD_TWO'] },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: {
          sections: [{ sectionId: 'SECTION_ONE', childIds: ['CHILD_TWO'] }],
        },
        results: [
          { change: { kind: 'remove-child', childId: 'CHILD_ONE' }, status: 'applied' },
          { change: { kind: 'order-section-children', childIds: ['CHILD_TWO'] }, status: 'applied' },
        ],
      },
    });
  });

  it('reuses the prior exact configured Child despite concurrent additions and reconfiguration', async () => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [
        {
          kind: 'widget',
          childId: 'CHILD_OLD_CONFIG',
          rank: 1,
          widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
          parameters: [],
        },
        {
          kind: 'widget',
          childId: 'CHILD_EXACT_CONFIG',
          rank: 2,
          widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_EXACT' as ConfigId },
          parameters: [],
        },
      ],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: [] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const read = port.read;
    const setSectionChildren = port.setSectionChildren;
    let membershipWritten = false;
    vi.spyOn(port, 'setSectionChildren').mockImplementation(async (input) => {
      const result = await setSectionChildren(input);
      membershipWritten = true;
      return result;
    });
    vi.spyOn(port, 'read').mockImplementation(async (dashboardId) => {
      const result = await read(dashboardId);
      if (!result.ok || !membershipWritten) return result;
      return {
        ok: true,
        value: {
          ...result.value,
          children: [...result.value.children.map((child) => child.kind === 'widget' && child.childId === 'CHILD_EXACT_CONFIG'
            ? { ...child, widget: { ...child.widget, configurationId: 'WC_CHANGED' as ConfigId } }
            : child), ...['CHILD_CONCURRENT_ONE', 'CHILD_CONCURRENT_TWO'].map((childId, index) => ({
            kind: 'widget' as const,
            childId,
            rank: index + 3,
            widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_CONCURRENT' as ConfigId },
            parameters: [],
          }))],
        },
      };
    });
    const addWidget = vi.spyOn(port, 'addWidget');

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{
        kind: 'add-widget',
        widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_EXACT' as ConfigId },
        sectionId: 'SECTION_ONE',
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: {
          sections: [{ sectionId: 'SECTION_ONE', childIds: ['CHILD_EXACT_CONFIG'] }],
        },
        results: [{ status: 'applied' }],
      },
    });
    expect(addWidget).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'attaches a new Child with a reminted configuration', addedWidgetId: 'MW_REPEAT', addChild: true, attach: true, failPut: false, failPost: false, status: 'applied', error: undefined },
    { name: 'keeps an ambiguous no-op add uncertain despite an old wrong-config Child in the Section', addedWidgetId: 'MW_REPEAT', addChild: false, attach: false, failPut: false, failPost: true, status: 'uncertain', error: { kind: 'dependency', failure: { kind: 'timeout' } } },
    { name: 'rejects a no-op add despite an old wrong-config Child in the Section', addedWidgetId: 'MW_REPEAT', addChild: false, attach: true, failPut: false, failPost: false, status: 'failed', error: { kind: 'invalid-mutation' } },
    { name: 'rejects a new Child for the wrong Widget', addedWidgetId: 'MW_OTHER', addChild: true, attach: true, failPut: false, failPost: false, status: 'failed', error: { kind: 'invalid-mutation' } },
    { name: 'rejects a new Child that never becomes attached', addedWidgetId: 'MW_REPEAT', addChild: true, attach: false, failPut: false, failPost: false, status: 'failed', error: { kind: 'effect-not-observed' } },
    { name: 'propagates a failed Section membership write', addedWidgetId: 'MW_REPEAT', addChild: true, attach: false, failPut: true, failPost: false, status: 'failed', error: { kind: 'permission-denied', dashboardId: 'MD_MACRO' } },
  ])('$name', async ({ addedWidgetId, addChild, attach, failPut, failPost, status, error }) => {
    let current: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD_CONFIG',
        rank: 1,
        widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        parameters: [],
      }],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: ['CHILD_OLD_CONFIG'] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    const port: DashboardPort = {
      read: async () => ({ ok: true, value: current }),
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      addWidget: async () => {
        if (addChild) current = {
          ...current,
          children: [...current.children, {
            kind: 'widget',
            childId: 'CHILD_REMINTED',
            rank: 2,
            widget: { widgetId: addedWidgetId as WidgetId, configurationId: 'WC_REMINTED' as ConfigId },
            parameters: [],
          }],
        };
        if (failPost) return { ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } };
        return { ok: true, value: undefined };
      },
      setSectionChildren: async ({ childIds }) => {
        if (failPut) return { ok: false, error: { kind: 'permission-denied', dashboardId: 'MD_MACRO' } };
        if (attach) current = {
          ...current,
          sections: current.sections.map((section) => ({ ...section, childIds })),
        };
        return { ok: true, value: undefined };
      },
    };

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{
        kind: 'add-widget',
        widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REQUESTED' as ConfigId },
        sectionId: 'SECTION_ONE',
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: {
          sections: [{ childIds: status === 'applied' ? ['CHILD_OLD_CONFIG', 'CHILD_REMINTED'] : ['CHILD_OLD_CONFIG'] }],
        },
        results: [{ status, ...(error ? { error } : {}) }],
      },
    });
  });

  it.each([
    { name: 'rejects two new reminted Children without changing Section membership', otherConfiguration: 'WC_OTHER', failPost: false, changePriorConfiguration: false, status: 'failed', error: { kind: 'invalid-mutation' }, sectionChildIds: [] },
    { name: 'rejects two new Children even when one retains the requested configuration', otherConfiguration: 'WC_REQUESTED', failPost: false, changePriorConfiguration: false, status: 'failed', error: { kind: 'invalid-mutation' }, sectionChildIds: [] },
    { name: 'keeps a failed POST uncertain when an ambiguous Child is already sectioned', otherConfiguration: 'WC_OTHER', failPost: true, changePriorConfiguration: false, status: 'uncertain', error: { kind: 'dependency', failure: { kind: 'timeout' } }, sectionChildIds: ['CHILD_OTHER'] },
    { name: 'does not verify an old wrong-config Child reconfigured during a failed POST', otherConfiguration: 'WC_OTHER', failPost: true, changePriorConfiguration: true, status: 'uncertain', error: { kind: 'dependency', failure: { kind: 'timeout' } }, sectionChildIds: ['CHILD_OLD_CONFIG'] },
  ])('$name', async ({ otherConfiguration, failPost, changePriorConfiguration, status, error, sectionChildIds }) => {
    let current: Dashboard = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD_CONFIG',
        rank: 1,
        widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        parameters: [],
      }],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: [] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    };
    const setSectionChildren = vi.fn<DashboardPort['setSectionChildren']>(async ({ childIds }) => {
      current = { ...current, sections: current.sections.map((section) => ({ ...section, childIds })) };
      return { ok: true, value: undefined };
    });
    const port: DashboardPort = {
      read: async () => ({ ok: true, value: current }),
      findByTitle: vi.fn(),
      create: vi.fn(),
      ...unusedMutationPort(),
      addWidget: async () => {
        current = {
          ...current,
          children: changePriorConfiguration ? current.children.map((child) => child.kind === 'widget'
            ? { ...child, widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REQUESTED' as ConfigId } }
            : child) : [...current.children, ...[
            { childId: 'CHILD_OTHER', configurationId: otherConfiguration },
            { childId: 'CHILD_OURS', configurationId: 'WC_REMINTED' },
          ].map(({ childId, configurationId }, index) => ({
            kind: 'widget' as const,
            childId,
            rank: index + 2,
            widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: configurationId as ConfigId },
            parameters: [],
          }))],
          sections: current.sections.map((section) => ({ ...section, childIds: sectionChildIds })),
        };
        return failPost
          ? { ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } }
          : { ok: true, value: undefined };
      },
      setSectionChildren,
    };

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{
        kind: 'add-widget',
        widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REQUESTED' as ConfigId },
        sectionId: 'SECTION_ONE',
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        dashboard: { sections: [{ childIds: sectionChildIds }] },
        results: [{ status, error }],
      },
    });
    expect(setSectionChildren).not.toHaveBeenCalled();
  });

  it.each(['WC_OTHER', 'WC_REQUESTED'])('keeps a failed POST uncertain when a foreign singleton with %s is sectioned', async (configurationId) => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO', name: 'Macro Desk', kind: 'custom', tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: [] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const addWidget = port.addWidget;
    const setSectionChildren = port.setSectionChildren;
    vi.spyOn(port, 'addWidget').mockImplementation(async ({ dashboardId }) => {
      await addWidget({ dashboardId, widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: configurationId as ConfigId } });
      const added = await port.read(dashboardId);
      if (!added.ok) return added;
      await setSectionChildren({ dashboardId, sectionId: 'SECTION_ONE', childIds: added.value.children.map(({ childId }) => childId) });
      return { ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } };
    });

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'add-widget', sectionId: 'SECTION_ONE', widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REQUESTED' as ConfigId } }],
    });

    expect(result).toMatchObject({ ok: true, value: { results: [{ status: 'uncertain', error: { kind: 'dependency', failure: { kind: 'timeout' } } }] } });
  });

  it.each([
    { name: 'keeps a new Child attachment uncertain after an ambiguous PUT', knownChild: false, status: 'uncertain', error: { kind: 'dependency', failure: { kind: 'timeout' } } },
    { name: 'reconciles an existing configured Child attachment after an ambiguous PUT', knownChild: true, status: 'applied', error: undefined },
  ])('$name', async ({ knownChild, status, error }) => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO', name: 'Macro Desk', kind: 'custom', tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: knownChild ? [{ kind: 'widget', childId: 'CHILD_KNOWN', rank: 1, widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REQUESTED' as ConfigId }, parameters: [] }] : [],
      sections: [{ sectionId: 'SECTION_ONE', name: 'Overview', rank: 1, childIds: [] }],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const setSectionChildren = port.setSectionChildren;
    vi.spyOn(port, 'setSectionChildren').mockImplementation(async (input) => {
      await setSectionChildren(input);
      return { ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } };
    });
    const addWidget = vi.spyOn(port, 'addWidget');

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{ kind: 'add-widget', sectionId: 'SECTION_ONE', widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_REQUESTED' as ConfigId } }],
    });

    expect(result).toMatchObject({ ok: true, value: { dashboard: { sections: [{ childIds: [knownChild ? 'CHILD_KNOWN' : expect.any(String)] }] }, results: [{ status, ...(error ? { error } : {}) }] } });
    if (knownChild) expect(addWidget).not.toHaveBeenCalled();
  });

  it('rejects adding one Dashboard Child to a second Section before writing', async () => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_ONE',
        rank: 1,
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        parameters: [],
      }],
      sections: [
        { sectionId: 'SECTION_ONE', name: 'One', rank: 1, childIds: ['CHILD_ONE'] },
        { sectionId: 'SECTION_TWO', name: 'Two', rank: 2, childIds: [] },
      ],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    }]);
    const setSectionChildren = vi.spyOn(port, 'setSectionChildren');

    const result = await runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_MACRO' },
      changes: [{
        kind: 'add-widget',
        widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        childId: 'CHILD_ONE',
        sectionId: 'SECTION_TWO',
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [{
          status: 'failed',
          error: {
            kind: 'invalid-mutation',
            reason: 'Dashboard Child CHILD_ONE is already in Section SECTION_ONE',
          },
        }],
      },
    });
    expect(setSectionChildren).not.toHaveBeenCalled();
  });

  it('requires edit or admin permission before writing', async () => {
    const port = createDashboardInMemoryPort([{
      dashboardId: 'MD_READ_ONLY',
      name: 'Read only',
      kind: 'custom',
      tags: [],
      permissions: { viewers: ['guid:viewer'], editors: [], administrators: [] },
      children: [],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_READ_ONLY',
    }]);
    const addWidget = vi.spyOn(port, 'addWidget');

    await expect(runMutation(createDashboardModuleFromPort(port), {
      target: { kind: 'id', dashboardId: 'MD_READ_ONLY' },
      changes: [{ kind: 'add-widget', widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId } }],
    })).resolves.toEqual({
      ok: false,
      error: { kind: 'permission-denied', dashboardId: 'MD_READ_ONLY' },
    });
    expect(addWidget).not.toHaveBeenCalled();
  });

  it('creates one Custom Dashboard with ordered Configured Widgets', async () => {
    const port = createDashboardInMemoryPort();
    const dashboard = createDashboardModuleFromPort(port);

    const result = await dashboard.create({
      name: 'Macro Desk',
      widgets: [
        { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        { widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        dashboardId: expect.stringMatching(/^MD/),
        name: 'Macro Desk',
        kind: 'custom',
        children: [
          expect.objectContaining({
            kind: 'widget',
            rank: 1,
            widget: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
          }),
          expect.objectContaining({
            kind: 'widget',
            rank: 2,
            widget: { widgetId: 'MW_TWO', configurationId: 'WC_TWO' },
          }),
        ],
      }),
    });
  });

  it('rejects an invalid name before lookup and an invalid Widget after lookup', async () => {
    const port: DashboardPort = {
      read: vi.fn(),
      findByTitle: vi.fn<DashboardPort['findByTitle']>(async () => ({ ok: true, value: [] })),
      create: vi.fn(),
      ...unusedMutationPort(),
    };
    const dashboard = createDashboardModuleFromPort(port);

    await expect(dashboard.create({ name: '  ', widgets: [] })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-name', name: '  ' },
    });
    expect(port.findByTitle).not.toHaveBeenCalled();

    await expect(dashboard.create({
      name: 'Macro Desk',
      widgets: [{ widgetId: ' ' as WidgetId, selectedContext: 'MA_CONTEXT' }],
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-widget',
        widget: { widgetId: ' ', selectedContext: 'MA_CONTEXT' },
      },
    });
    expect(port.findByTitle).toHaveBeenCalledOnce();
    expect(port.create).not.toHaveBeenCalled();
  });

  it('passes configuration-less Widget Artifacts through the public create boundary', async () => {
    const create = vi.fn<DashboardPort['create']>(async () => ({
      ok: true,
      value: { dashboardId: 'MD_NEW', name: 'Macro Desk', link: 'https://example.test/MD_NEW' },
    }));
    const port: DashboardPort = {
      read: vi.fn(),
      findByTitle: vi.fn<DashboardPort['findByTitle']>(async () => ({ ok: true, value: [] })),
      create,
      ...unusedMutationPort(),
    };

    await expect(createDashboardModuleFromPort(port).create({
      name: 'Macro Desk',
      widgets: [{ widgetId: 'MW_ONE' as WidgetId, selectedContext: 'MA_CONTEXT' }],
    })).resolves.toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledWith({
      name: 'Macro Desk',
      widgets: [{ widgetId: 'MW_ONE', selectedContext: 'MA_CONTEXT' }],
    });
  });

  it('refuses exact-title duplicates and lookup failures without creating', async () => {
    const create = vi.fn<DashboardPort['create']>();
    const duplicatePort: DashboardPort = {
      read: vi.fn(),
      findByTitle: vi.fn<DashboardPort['findByTitle']>(async () => ({
        ok: true,
        value: [{ dashboardId: 'MD_EXISTING', name: 'Macro Desk', kind: 'custom' }],
      })),
      create,
      ...unusedMutationPort(),
    };
    await expect(createDashboardModuleFromPort(duplicatePort).create({
      name: ' Macro Desk ',
      widgets: [],
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dashboard-exists',
        name: 'Macro Desk',
        matches: [{ dashboardId: 'MD_EXISTING', name: 'Macro Desk', kind: 'custom' }],
      },
    });
    expect(create).not.toHaveBeenCalled();

    const lookupFailurePort: DashboardPort = {
      ...duplicatePort,
      findByTitle: vi.fn<DashboardPort['findByTitle']>(async () => ({
        ok: false,
        error: {
          kind: 'dependency',
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      })),
    };
    await expect(createDashboardModuleFromPort(lookupFailurePort).create({
      name: 'Macro Desk',
      widgets: [],
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'lookup-failed',
        name: 'Macro Desk',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
