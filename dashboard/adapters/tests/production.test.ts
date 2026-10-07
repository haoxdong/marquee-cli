import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { describe, expect, it, vi } from 'vitest';

import { createDashboardProductionPort } from '../production.js';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';

function renderInput(
  widgetId: string,
  configurationId: string | null,
  targetId = 'CH_TEST',
) {
  return {
    widget: {
      widgetId,
      configurationId,
      configuration: configurationId
        ? {
            configurationId,
            widgetId,
            targetId,
            relativeDate: null,
          }
        : null,
      projection: { kind: 'complete' as const },
      title: { embedded: null, fallback: widgetId },
      target: { family: 'plot' as const, targetId },
      parameters: [],
      contextParameter: null,
      controls: [],
      componentInputs: [],
      tags: [],
      sources: [],
    },
    parameters: [],
    selectedContext: null,
    relativeDate: null,
  };
}

const widgetProjection = {
  decode: vi.fn((input: {
    widgetId: string;
    configurationId: string | null;
  }) => renderInput(input.widgetId, input.configurationId)),
  project: vi.fn(async (input: {
    widget: { widgetId: string; configurationId: string };
    purpose: 'create' | 'add';
  }) => ({
    ok: true as const,
    value: {
      widget: input.widget,
      bindings: [],
      ...(input.purpose === 'add' ? { dateRangeOverride: '5y' } : {}),
    },
  })),
};

describe('Dashboard production port', () => {
  it('maps a saved Widget Child directly into the four Widget.render values', async () => {
    const request = vi.fn(async () => ({
      id: 'MD_SEMANTIC',
      title: 'Semantic Dashboard',
      type: 'Personal',
      entitlements: { view: [], edit: [], admin: [] },
      children: [{
        id: 'CHILD_SEMANTIC',
        entity_id: 'MW_SEMANTIC',
        type: 'Widget',
        rank: 1,
        configurationId: 'WC_SEMANTIC' as ConfigId,
        relativeDate: '6M',
        calculatedDates: {
          startDate: '2026-01-01',
          endDate: '2026-07-01',
          interval: '1d',
        },
        parameters: [
          { field: 'asset', value: 'MA_SELECTED' },
          { field: 'Relative Date', value: '6M' },
          { field: 'tenor', value: '2y' },
        ],
        renderParams: {
          controls: [
            { id: 'asset', type: 'Asset', value: 'MA_SELECTED' },
            { id: 'tenor', type: 'Enum', value: '2y', values: ['1y', '2y'] },
          ],
        },
        data: {
          id: 'MW_SEMANTIC',
          title: 'Fallback <asset:MA_BASE>',
          metadata: { title: 'Resolved semantic title' },
          underlyingChartId: 'CH_SEMANTIC',
          visualizationType: 'Plot',
          contextParameter: {
            field: 'asset',
            type: 'Asset',
            options: ['MA_BASE', 'MA_SELECTED'],
            values: { default: 'MA_BASE' },
          },
          parameters: [{
            field: 'tenor',
            type: 'Enum',
            options: ['1y', '2y'],
            values: { default: '1y' },
          }],
          renderParams: {
            controls: [
              { id: 'asset', type: 'Asset', value: 'MA_BASE' },
              { id: 'tenor', type: 'Enum', value: '1y', values: ['1y', '2y'] },
            ],
          },
          tags: ['semantic'],
        },
      }],
      sections: [],
    }));
    const port = createDashboardProductionPort({ request }, widgetProjection);

    const result = await port.read('MD_SEMANTIC');

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'personal',
        children: [{
          kind: 'widget',
          widgetDefinition: expect.objectContaining({
            id: 'MW_SEMANTIC',
            underlyingChartId: 'CH_SEMANTIC',
            metadata: { title: 'Resolved semantic title' },
          }),
          widgetParameterOverrides: [
            { field: 'asset', value: 'MA_SELECTED' },
            { field: 'tenor', value: '2y' },
          ],
          selectedContext: 'MA_SELECTED',
          widgetDates: {
            startDate: '2026-01-01',
            endDate: '2026-07-01',
            interval: '1d',
            relativeDate: '6M',
          },
        }],
      },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('uses the later ordered Relative Date assignment for direct rendering', async () => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_RELATIVE_DATE',
        title: 'Relative Date Dashboard',
        type: 'Custom',
        entitlements: { view: [], edit: [], admin: [] },
        children: [{
          id: 'CHILD_RELATIVE_DATE',
          entity_id: 'MW_RELATIVE_DATE',
          type: 'Widget',
          parameters: [
            { field: 'Relative Date', value: '1M' },
            { field: 'Relative Date', value: '6M' },
          ],
          calculatedDates: {
            startDate: '2026-01-01',
            endDate: '2026-07-01',
            interval: '1d',
          },
          data: {
            id: 'MW_RELATIVE_DATE',
            underlyingChartId: 'CH_RELATIVE_DATE',
          },
        }],
        sections: [],
      })),
    }, widgetProjection);

    const result = await port.read('MD_RELATIVE_DATE');

    expect(result).toMatchObject({
      ok: true,
      value: {
        children: [{
          widgetParameterOverrides: [],
          widgetDates: { relativeDate: '6M' },
        }],
      },
    });
  });

  it('normalizes a Dashboard chartId alias for Widget.render', async () => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_ALIAS',
        title: 'Alias Dashboard',
        type: 'Custom',
        entitlements: { view: [], edit: [], admin: [] },
        children: [{
          id: 'CHILD_ALIAS',
          entity_id: 'MW_ALIAS',
          type: 'Widget',
          parameters: [],
          data: { id: 'MW_ALIAS', chartId: 'CH_ALIAS' },
        }],
        sections: [],
      })),
    }, widgetProjection);

    const result = await port.read('MD_ALIAS');

    expect(result).toMatchObject({
      ok: true,
      value: {
        children: [{
          widgetDefinition: {
            id: 'MW_ALIAS',
            chartId: 'CH_ALIAS',
            underlyingChartId: 'CH_ALIAS',
          },
        }],
      },
    });
  });

  it('passes a named Widget without a chart target to Widget.render unchanged', async () => {
    const data = { id: 'MW_NAMED', title: 'Named Widget' };
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_NAMED',
        title: 'Named Dashboard',
        type: 'Custom',
        entitlements: { view: [], edit: [], admin: [] },
        children: [{
          id: 'CHILD_NAMED',
          entity_id: 'MW_NAMED',
          type: 'Widget',
          parameters: [],
          data,
        }],
        sections: [],
      })),
    }, widgetProjection);

    const result = await port.read('MD_NAMED');

    expect(result.ok && result.value.children[0]).toMatchObject({ kind: 'widget' });
    expect(result.ok && result.value.children[0]?.kind === 'widget'
      && result.value.children[0].widgetDefinition).toStrictEqual(data);
  });

  it('decodes a saved Dashboard with distinct repeated placements and Sections', async () => {
    const request = vi.fn(async () => ({
      id: 'MD_MACRO',
      title: 'Macro Desk',
      type: 'Custom',
      description: 'Macro views',
      tags: ['macro'],
      entitlements: {
        view: ['internal'],
        edit: ['guid:owner'],
        admin: [],
      },
      children: [
        {
          id: 'CHILD_ONE',
          entity_id: 'mw_repeat',
          type: 'Widget',
          rank: 1,
          configurationId: '   ',
          configuration: { id: 'wc_one' },
          parameters: [{ field: 'tenor', value: '1y' }],
          data: {
            id: 'MW_REPEAT',
            title: 'Repeat Widget',
            underlyingChartId: 'CH_REPEAT',
            visualizationType: 'plot',
            parameters: [{
              field: 'tenor',
              type: 'Enum',
              options: ['1y', '2y'],
              values: { default: '1y' },
            }],
          },
        },
        {
          id: 'CHILD_TWO',
          entity_id: 'mw_repeat',
          type: 'Widget',
          rank: 2,
          renderParams: { component: { asset: 'MA_SECOND' }, visualization: {} },
          parameters: [],
          data: {
            contextParameter: {
              field: 'asset',
              options: ['MA_SECOND'],
              values: { default: 'MA_SECOND' },
            },
          },
        },
        {
          id: 'CHILD_TEXT',
          type: 'Text',
          rank: 3,
          data: { text: 'Watch the curve.' },
        },
      ],
      sections: [
        { id: 'SECTION_ONE', title: 'Overview', rank: 1, children: ['CHILD_ONE', 'CHILD_TEXT'] },
      ],
    }));
    const port = createDashboardProductionPort({ request }, widgetProjection);

    const result = await port.read('MD_MACRO');

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/dashboards/MD_MACRO' }, {
      query: { expand: true },
      hedgeDelaysMs: [1000, 2000],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        dashboardId: 'MD_MACRO',
        name: 'Macro Desk',
        kind: 'custom',
        description: 'Macro views',
        tags: ['macro'],
        permissions: {
          viewers: ['internal'],
          editors: ['guid:owner'],
          administrators: [],
        },
        children: [
          {
            kind: 'widget',
            childId: 'CHILD_ONE',
            rank: 1,
            widget: { widgetId: 'MW_REPEAT' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
            widgetDefinition: {
              id: 'MW_REPEAT',
              title: 'Repeat Widget',
              underlyingChartId: 'CH_REPEAT',
              visualizationType: 'plot',
              parameters: [{
                field: 'tenor',
                type: 'Enum',
                options: ['1y', '2y'],
                values: { default: '1y' },
              }],
            },
            widgetParameterOverrides: [{ field: 'tenor', value: '1y' }],
            name: 'Repeat Widget',
            renderTargetId: 'CH_REPEAT',
            visualizationKind: 'plot',
            configurationParameters: [{ field: 'tenor', value: '1y' }],
            parameterDefinitions: [{
              field: 'tenor',
              type: 'Enum',
              options: ['1y', '2y'],
              values: { default: '1y' },
            }],
            parameters: [{ field: 'tenor', value: '1y' }],
          },
          {
            kind: 'widget',
            childId: 'CHILD_TWO',
            rank: 2,
            widget: { widgetId: 'MW_REPEAT' as WidgetId },
            parameters: [],
            renderParameters: { component: { asset: 'MA_SECOND' } },
            contextParameter: {
              field: 'asset',
              options: ['MA_SECOND'],
              values: { default: 'MA_SECOND' },
            },
          },
          { kind: 'text', childId: 'CHILD_TEXT', rank: 3, text: 'Watch the curve.' },
        ],
        sections: [
          {
            sectionId: 'SECTION_ONE',
            name: 'Overview',
            rank: 1,
            childIds: ['CHILD_ONE', 'CHILD_TEXT'],
          },
        ],
        link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
      },
    });
  });

  it('looks up exact titles and creates once with the ordered seed body', async () => {
    const request = vi.fn(async (target: Endpoint) => {
      if (target.path === '/v1/marketview/dashboards') {
        return {
          results: [
            { id: 'MD_OTHER', title: 'Other Desk', type: 'Custom' },
            { id: 'MD_MATCH', title: 'Macro Desk', type: 'Custom' },
          ],
        };
      }
      return { id: 'MD_NEW' };
    });
    const project = vi.fn(widgetProjection.project);
    const port = createDashboardProductionPort(
      { request },
      { ...widgetProjection, project },
    );

    await expect(port.findByTitle(' macro desk ')).resolves.toEqual({
      ok: true,
      value: [{ dashboardId: 'MD_MATCH', name: 'Macro Desk', kind: 'custom' }],
    });
    await expect(port.create({
      name: 'Macro Desk',
      widgets: [
        { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        { widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId },
      ],
    })).resolves.toEqual({
      ok: true,
      value: {
        dashboardId: 'MD_NEW',
        name: 'Macro Desk',
        link: 'https://marquee.gs.com/s/marketview/dashboards/MD_NEW',
      },
    });

    expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/v1/marketview/dashboards' }, {
      query: { view_as: 'edit', size: 100, page: 1 },
    });
    expect(request).toHaveBeenNthCalledWith(2, { method: 'POST', path: '/v1/marketview/dashboards/default' }, {
      body: {
        title: 'Macro Desk',
        description: '',
        tags: [],
        relatedLinks: [],
        alias: 'macro-desk',
        addTagsFromChildren: true,
        isRequestable: false,
        children: [
          {
            entity_id: 'MW_ONE',
            type: 'Widget',
            parameters: [],
            configurationId: 'WC_ONE' as ConfigId,
            rank: 1,
          },
          {
            entity_id: 'MW_TWO',
            type: 'Widget',
            parameters: [],
            configurationId: 'WC_TWO' as ConfigId,
            rank: 2,
          },
        ],
      },
    });
    expect(project.mock.calls).toEqual([
      [{ widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId }, purpose: 'create' }],
      [{ widget: { widgetId: 'MW_TWO' as WidgetId, configurationId: 'WC_TWO' as ConfigId }, purpose: 'create' }],
    ]);
  });

  it('fails configuration-less Widget mutations at the provider adapter without hidden lookup', async () => {
    const request = vi.fn();
    const project = vi.fn(widgetProjection.project);
    const port = createDashboardProductionPort(
      { request },
      { ...widgetProjection, project },
    );
    const widget = { widgetId: 'MW_DEFAULT' as WidgetId, selectedContext: 'MA_CONTEXT' };

    await expect(port.create({ name: 'Macro Desk', widgets: [widget] })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-widget', widget },
    });
    await expect(port.addWidget({ dashboardId: 'MD_MACRO', widget })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-widget', widget },
    });
    expect(project).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('translates Dashboard mutation writes to the exact provider routes', async () => {
    const request = vi.fn(async (endpoint: Endpoint) => {
      if (endpoint.path.endsWith('/sections')) return { id: 'SECTION_NEW', title: 'New views' };
      return {};
    });
    const project = vi.fn(async (input: {
      widget: { widgetId: string; configurationId: string };
      purpose: 'create' | 'add';
    }) => ({
      ok: true as const,
      value: {
        widget: input.widget,
        bindings: [{ field: 'tenor', value: '1y' }],
        dateRangeOverride: '5y',
      },
    }));
    const port = createDashboardProductionPort(
      { request },
      { ...widgetProjection, project },
    );

    await expect(port.removeChild({ dashboardId: 'MD_MACRO', childId: 'CHILD_OLD' })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(port.addWidget({
      dashboardId: 'MD_MACRO',
      widget: { widgetId: 'MW_NEW' as WidgetId, configurationId: 'WC_NEW' as ConfigId },
      rank: 2,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(port.createSection({
      dashboardId: 'MD_MACRO',
      name: 'New views',
      childIds: ['CHILD_NEW'],
    })).resolves.toEqual({ ok: true, value: { sectionId: 'SECTION_NEW' } });
    await expect(port.setSectionChildren({
      dashboardId: 'MD_MACRO',
      sectionId: 'SECTION_ONE',
      childIds: ['CHILD_NEW'],
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(port.setSectionRank({
      dashboardId: 'MD_MACRO',
      sectionId: 'SECTION_ONE',
      rank: 1,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(port.deleteSection({
      dashboardId: 'MD_MACRO',
      sectionId: 'SECTION_ONE',
    })).resolves.toEqual({ ok: true, value: undefined });

    expect(project).toHaveBeenCalledWith({
      widget: { widgetId: 'MW_NEW' as WidgetId, configurationId: 'WC_NEW' as ConfigId },
      purpose: 'add',
    });
    expect(request.mock.calls).toEqual([
      [{ method: 'DELETE', path: '/v1/marketview/dashboards/MD_MACRO/children/CHILD_OLD' }],
      [{ method: 'POST', path: '/v1/marketview/dashboards/MD_MACRO/children' }, {
        body: [{
          entity_id: 'MW_NEW',
          type: 'Widget',
          parameters: [{ field: 'tenor', value: '1y' }],
          configurationId: 'WC_NEW' as ConfigId,
          rank: 2,
          relativeDate: '5y',
        }],
      }],
      [{ method: 'POST', path: '/v1/marketview/dashboards/MD_MACRO/sections' }, {
        body: { title: 'New views', children: ['CHILD_NEW'] },
      }],
      [{ method: 'PUT', path: '/v1/marketview/dashboards/MD_MACRO/sections/SECTION_ONE' }, {
        body: { children: ['CHILD_NEW'] },
      }],
      [{ method: 'PUT', path: '/v1/marketview/dashboards/MD_MACRO/sections/SECTION_ONE' }, {
        body: { rank: 1 },
      }],
      [{ method: 'DELETE', path: '/v1/marketview/dashboards/MD_MACRO/sections/SECTION_ONE' }],
    ]);
  });

  it('omits stale section child identities that have no returned Dashboard child', async () => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_STALE_SECTION_CHILD',
        title: 'Stale section child',
        type: 'Custom',
        entitlements: { view: [], edit: [], admin: [] },
        tags: [],
        children: [{
          id: 'CHILD_VISIBLE',
          entity_id: 'MW_VISIBLE',
          type: 'Widget',
          rank: 1,
          parameters: [],
        }],
        sections: [{
          id: 'SECTION_ONE',
          title: 'One',
          rank: 1,
          children: ['CHILD_VISIBLE', 'CHILD_STALE'],
        }],
      })),
    }, widgetProjection);

    await expect(port.read('MD_STALE_SECTION_CHILD')).resolves.toMatchObject({
      ok: true,
      value: {
        children: [{ childId: 'CHILD_VISIBLE' }],
        sections: [{ childIds: ['CHILD_VISIBLE'] }],
      },
    });
  });

  it('preserves provider order when Dashboard children share a rank', async () => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_EQUAL_RANKS',
        title: 'Equal ranks',
        type: 'Custom',
        entitlements: { view: [], edit: [], admin: [] },
        tags: [],
        children: [
          { id: 'CHILD_ONE', entity_id: 'MW_ONE', type: 'Widget', rank: 1, parameters: [] },
          { id: 'CHILD_TWO', entity_id: 'MW_TWO', type: 'Widget', rank: 1, parameters: [] },
        ],
        sections: [],
      })),
    }, widgetProjection);

    await expect(port.read('MD_EQUAL_RANKS')).resolves.toMatchObject({
      ok: true,
      value: {
        children: [
          { childId: 'CHILD_ONE', rank: 1 },
          { childId: 'CHILD_TWO', rank: 1 },
        ],
      },
    });
  });

  it.each([
    [new MarqueeError('http', 'denied', { status: 403 }), 'access-denied'],
    [new MarqueeError('http', 'missing', { status: 404 }), 'write-failed'],
    [new MarqueeError('timeout', 'request timed out'), 'dependency'],
    [new MarqueeError('http', 'cancelled', { isCanceled: true }), 'dependency'],
  ] as const)('classifies Dashboard mutation write failures', async (failure, kind) => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => { throw failure; }),
    }, widgetProjection);

    await expect(port.removeChild({
      dashboardId: 'MD_MACRO',
      childId: 'CHILD_ONE',
    })).resolves.toMatchObject({ ok: false, error: { kind } });
  });

  it.each([
    ['authentication' as const, 'authentication-required'],
    ['dependency' as const, 'unavailable'],
  ])('preserves typed Widget configuration failures (%s)', async (problem, kind) => {
    const request = vi.fn(async () => ({}));
    const port = createDashboardProductionPort({ request }, {
      project: vi.fn(async () => ({
        ok: false as const,
        error: {
          kind: 'dependency' as const,
          failure: problem === 'authentication'
            ? { kind: 'authentication-required' as const, realm: 'marquee' as const }
            : { kind: 'unavailable' as const },
        },
      })),
    });

    await expect(port.addWidget({
      dashboardId: 'MD_MACRO',
      widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
    })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'dependency', failure: { kind } },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('closes Widget configuration misses as a semantic placement failure', async () => {
    const request = vi.fn(async () => ({}));
    const port = createDashboardProductionPort({ request }, {
      project: vi.fn(async () => ({
        ok: false as const,
        error: { kind: 'not-found' as const },
      })),
    });

    await expect(port.addWidget({
      dashboardId: 'MD_MACRO',
      widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-widget-placement',
        configurationId: 'WC_ONE' as ConfigId,
        problem: 'configuration-not-found',
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [new MarqueeError('http', 'missing', { status: 404 }), 'not-found'],
    [new MarqueeError('http', 'denied', { status: 403 }), 'access-denied'],
    [new MarqueeError('auth_expired', 'login required'), 'dependency'],
  ] as const)('classifies Dashboard read failures', async (failure, kind) => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => { throw failure; }),
    }, widgetProjection);

    await expect(port.read('MD_MISSING')).resolves.toMatchObject({
      ok: false,
      error: { kind },
    });
  });

  it.each([
    ['missing entitlements', undefined],
    ['malformed entitlements', 'malformed'],
  ])('rejects saved Dashboard aggregates with %s', async (_label, entitlements) => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_BAD',
        title: 'Bad',
        type: 'Custom',
        ...(entitlements === undefined ? {} : { entitlements }),
      })),
    }, widgetProjection);

    await expect(port.read('MD_BAD')).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'invalid-dashboard',
        reason: expect.stringContaining('entitlements'),
      },
    });
  });

  it('credits a saved Dashboard without an author to its creator', async () => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_OWNED',
        title: 'Owned',
        createdBy: 'guid:owner',
        entitlements: { view: [], edit: [], admin: [] },
        children: [],
        sections: [],
      })),
    }, widgetProjection);

    await expect(port.read('MD_OWNED')).resolves.toMatchObject({
      ok: true,
      value: { dashboardId: 'MD_OWNED', author: 'guid:owner' },
    });
  });

  it.each([
    ['author', 'author is not a string'],
    ['description', 'description is not a string'],
  ])('rejects a saved Dashboard whose %s is not a string', async (field, reason) => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_BAD',
        title: 'Bad',
        [field]: 42,
        entitlements: { view: [], edit: [], admin: [] },
        children: [],
        sections: [],
      })),
    }, widgetProjection);

    await expect(port.read('MD_BAD')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-dashboard', reason: expect.stringContaining(reason) },
    });
  });

  it('decodes sparse recorded Widget placements without creating replacement configurations', async () => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_SPARSE',
        title: 'Sparse',
        entitlements: { view: [], edit: [], admin: [] },
        children: [{
          id: 'CHILD_ONE',
          entity_id: 'MW_ONE',
          type: 'Widget',
          configuration: { id: 'WC_ONE' },
          parameters: [],
          data: { id: 'MW_ONE', title: 'One' },
        }],
        sections: [{
          id: 'SECTION_ONE',
          title: 'Overview',
          children: ['CHILD_ONE'],
        }],
      })),
    }, widgetProjection);

    const result = await port.read('MD_SPARSE');

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'thematic',
        permissions: { viewers: [], editors: [], administrators: [] },
        children: [{
          childId: 'CHILD_ONE',
          rank: 1,
          widget: { widgetId: 'MW_ONE' as WidgetId, configurationId: 'WC_ONE' as ConfigId },
        }],
        sections: [{
          sectionId: 'SECTION_ONE',
          name: 'Overview',
          rank: 1,
          childIds: ['CHILD_ONE'],
        }],
      },
    });
    if (!result.ok) throw new Error('expected sparse Dashboard read to succeed');
    expect(result.value.children[0]).toMatchObject({
      widgetDefinition: { id: 'MW_ONE', title: 'One' },
    });
    expect(result.value.children[0]).not.toHaveProperty('renderTargetId');
  });

  it.each([
    [
      'duplicate child identities',
      {
        children: [
          { id: 'CHILD_ONE', entity_id: 'MW_ONE', type: 'Widget', rank: 1, parameters: [] },
          { id: 'CHILD_ONE', entity_id: 'MW_TWO', type: 'Widget', rank: 2, parameters: [] },
        ],
        sections: [],
      },
      'children ids must be distinct',
    ],
    [
      'duplicate section identities',
      {
        children: [],
        sections: [
          { id: 'SECTION_ONE', title: 'One', rank: 1, children: [] },
          { id: 'SECTION_ONE', title: 'Two', rank: 2, children: [] },
        ],
      },
      'sections ids must be distinct',
    ],
    [
      'duplicate section ranks',
      {
        children: [],
        sections: [
          { id: 'SECTION_ONE', title: 'One', rank: 1, children: [] },
          { id: 'SECTION_TWO', title: 'Two', rank: 1, children: [] },
        ],
      },
      'sections ranks must be distinct',
    ],
    [
      'duplicate child section membership',
      {
        children: [{ id: 'CHILD_ONE', entity_id: 'MW_ONE', type: 'Widget', rank: 1, parameters: [] }],
        sections: [{
          id: 'SECTION_ONE',
          title: 'One',
          rank: 1,
          children: ['CHILD_ONE', 'CHILD_ONE'],
        }],
      },
      'section SECTION_ONE child ids must be distinct',
    ],
    [
      'one child assigned to multiple sections',
      {
        children: [{ id: 'CHILD_ONE', entity_id: 'MW_ONE', type: 'Widget', rank: 1, parameters: [] }],
        sections: [
          { id: 'SECTION_ONE', title: 'One', rank: 1, children: ['CHILD_ONE'] },
          { id: 'SECTION_TWO', title: 'Two', rank: 2, children: ['CHILD_ONE'] },
        ],
      },
      'child CHILD_ONE belongs to multiple sections',
    ],
    [
      'one stale child assigned to multiple sections',
      {
        children: [],
        sections: [
          { id: 'SECTION_ONE', title: 'One', rank: 1, children: ['CHILD_STALE'] },
          { id: 'SECTION_TWO', title: 'Two', rank: 2, children: ['CHILD_STALE'] },
        ],
      },
      'child CHILD_STALE belongs to multiple sections',
    ],
    [
      'a child without a Widget ID',
      {
        children: [{ id: 'CHILD_ONE', type: 'Widget', rank: 1, parameters: [] }],
        sections: [],
      },
      'children[0].entity_id is missing',
    ],
    [
      'a child whose Widget ID is a Config ID',
      {
        children: [{ id: 'CHILD_ONE', entity_id: 'WC_ONE', type: 'Widget', rank: 1, parameters: [] }],
        sections: [],
      },
      'children[0].entity_id is malformed',
    ],
    [
      'a child whose Config ID is a Widget ID',
      {
        children: [{
          id: 'CHILD_ONE',
          entity_id: 'MW_ONE',
          configurationId: 'MW_TWO',
          type: 'Widget',
          rank: 1,
          parameters: [],
        }],
        sections: [],
      },
      'children[0].configurationId is malformed',
    ],
  ])('rejects %s in a saved Dashboard', async (_label, aggregate, reason) => {
    const port = createDashboardProductionPort({
      request: vi.fn(async () => ({
        id: 'MD_BAD',
        title: 'Bad',
        type: 'Custom',
        entitlements: { view: [], edit: [], admin: [] },
        tags: [],
        ...aggregate,
      })),
    }, widgetProjection);

    await expect(port.read('MD_BAD')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-dashboard', reason: expect.stringContaining(reason) },
    });
  });

  it('classifies failed, ambiguous, denied, and id-less creates', async () => {
    const input = { name: 'Macro Desk', widgets: [] };
    const createWith = (result: unknown) => createDashboardProductionPort({
      request: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      }),
    }, widgetProjection).create(input);

    await expect(createWith({ title: 'Macro Desk' })).resolves.toEqual({
      ok: false,
      error: { kind: 'missing-created-id', name: 'Macro Desk' },
    });
    await expect(createWith(new MarqueeError('timeout', 'request timed out'))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'ambiguous-creation', name: 'Macro Desk' },
    });
    await expect(createWith(new MarqueeError('http', 'denied', { status: 403 }))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'access-denied' },
    });
    await expect(createWith(new MarqueeError('http', 'unavailable', { status: 503 }))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'create-failed', failure: { kind: 'unavailable' } },
    });
  });

  it('classifies malformed and failed title lookups', async () => {
    const malformed = createDashboardProductionPort({ request: vi.fn(async () => ({})) }, widgetProjection);
    await expect(malformed.findByTitle('Macro Desk')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-dashboard' },
    });

    const failed = createDashboardProductionPort({
      request: vi.fn(async () => { throw new MarqueeError('auth_expired', 'login required'); }),
    }, widgetProjection);
    await expect(failed.findByTitle('Macro Desk')).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'dependency',
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    });
  });
});
