import { describe, expect, it } from 'vitest';
import {
  assembleWidgetSnippetParamNames,
  discoverSnippetFields,
  isParameterDefinition,
  requireWidgetSnippetControlGroupExpansion,
  requireWidgetSnippetEntityResolution,
  WidgetSnippetDisplayError,
  widgetSnippetParams,
  isOpaqueWidgetValue,
} from '../snippet.js';
import {
  contextualWidgetTitle,
  resolvedContextualWidgetTitle,
  resolveWidgetSnippetTitle,
  resolveWidgetTitle,
  widgetFallbackTitle,
} from '../snippet-title.js';
import type { WidgetEntityModule } from '../input-resolution.js';

describe('widget snippet module', () => {
  it.each([
    [`MA${'J'.repeat(15)}`, true],
    [`MW${'L'.repeat(15)}`, true],
    ['0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d', true],
    ['MWSHORT', false],
    [`xMW${'L'.repeat(15)}`, false],
    [`MW${'L'.repeat(15)} x`, false],
    ['0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d x', false],
    ['x0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d', false],
    ['Apple', false],
    [42, false],
  ])('treats %s as opaque: %s', (value, opaque) => {
    expect(isOpaqueWidgetValue(value)).toBe(opaque);
  });

  it('maps typed Entity and Control Group failures at the snippet boundary', () => {
    expect(() => requireWidgetSnippetEntityResolution(
      'MW_ONE',
      'Asset',
      { ok: false, error: { kind: 'malformed-entity' } },
    )).toThrow(WidgetSnippetDisplayError);

    const pending = [{
      input: { kind: 'control-group' as const, value: 'CG_ONE' },
      field: 'Basket',
    }] as const;
    expect(() => requireWidgetSnippetControlGroupExpansion(
      'MW_ONE',
      pending,
      {
        ok: false,
        error: {
          kind: 'dependency',
          controlGroupIds: ['CG_ONE'],
          failure: { kind: 'rate-limited' },
        },
      },
    )).toThrow('widget-load-failure');
    expect(() => requireWidgetSnippetControlGroupExpansion(
      'MW_ONE',
      pending,
      {
        ok: false,
        error: {
          kind: 'malformed-member',
          controlGroupIds: ['CG_OTHER'],
          problem: 'invalid-response',
        },
      },
    )).toThrow(WidgetSnippetDisplayError);
  });

  it('uses the saved title before its legacy name fallback', () => {
    expect(widgetFallbackTitle('Saved title', 'Legacy name')).toBe('Saved title');
    expect(widgetFallbackTitle('', 'Legacy name')).toBe('Legacy name');
  });

  it('leaves a title unchanged when context cannot substitute a string placeholder', () => {
    expect(contextualWidgetTitle({
      widget: {
        contextParameter: { field: 'Asset', value: 42 },
      },
      parameters: [],
    }, 'Saved <Asset:MA_STALE>')).toBe('Saved <Asset:MA_STALE>');
  });

  it('pre-substitutes an active context that overrides the saved default', () => {
    expect(contextualWidgetTitle({
      widget: {
        contextParameter: { field: 'Asset', value: 'MA_STALE' },
      },
      parameters: [{
        field: 'Asset',
        value: `MA${'K'.repeat(15)}`,
        displayValue: 'Active Asset',
        titleDisplayValue: 'ACTIVE UW',
      }],
    }, 'Saved <Asset:MA_STALE>')).toBe('Saved ACTIVE UW');
  });

  it('pre-substitutes the selected-context BBID without a duplicate parameter override', async () => {
    let resolveCalls = 0;
    const entity: WidgetEntityModule = {
      async resolve() {
        resolveCalls += 1;
        return {
          ok: true,
          value: [{
            kind: 'asset',
            entityId: `MA${'K'.repeat(15)}`,
            label: 'Active Asset',
            aliases: [],
            bbid: 'ACTIVE UW',
          }],
        };
      },
      async resolveIdentity() {
        return { ok: true, value: null };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };
    const input = {
      widget: {
        contextParameter: { field: 'Asset', value: `MA${'K'.repeat(15)}` },
      },
      parameters: [],
    };

    await expect(resolveWidgetTitle({
      widgetId: 'MW_SELECTED_CONTEXT',
      embeddedTitle: null,
      fallbackTitle: 'Saved <Asset:MA_STALE>',
      useEntityTitle: false,
      entityLabels: [],
      contextualFallbackTitle: () => resolvedContextualWidgetTitle(
        entity,
        'MW_SELECTED_CONTEXT',
        input,
        'Saved <Asset:MA_STALE>',
        `MA${'K'.repeat(15)}`,
      ),
      metadataTitle: async () => undefined,
    }, entity)).resolves.toEqual({
      title: 'Saved ACTIVE UW',
      entityLabels: [],
    });
    expect(resolveCalls).toBe(1);
  });

  it.each([
    'Saved title',
    'Saved <Country:US>',
  ])('does not resolve an active Entity without a matching context tag: %s', async (title) => {
    const entity: WidgetEntityModule = {
      async resolve() {
        throw new Error('unexpected Entity resolution');
      },
      async resolveIdentity() {
        return { ok: true, value: null };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };

    await expect(resolvedContextualWidgetTitle(entity, 'MW_NO_ACTIVE_TAG', {
      widget: {
        contextParameter: { field: 'Asset', value: 'MA_STALE' },
      },
      parameters: [{ field: 'Asset', value: `MA${'K'.repeat(15)}` }],
    }, title)).resolves.toBe(title);
  });

  it('keeps the title of a Widget without a context parameter', async () => {
    const entity: WidgetEntityModule = {
      async resolve() {
        throw new Error('unexpected Entity resolution');
      },
      async resolveIdentity() {
        return { ok: true, value: null };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };

    await expect(resolvedContextualWidgetTitle(entity, 'MW_NO_CONTEXT', {
      widget: { contextParameter: null },
      parameters: [],
    }, 'Saved <Asset:MA_STALE>')).resolves.toBe('Saved <Asset:MA_STALE>');
  });

  it('keeps the active raw context when Entity has no display evidence', async () => {
    let resolveCalls = 0;
    const entity: WidgetEntityModule = {
      async resolve() {
        resolveCalls += 1;
        return { ok: true, value: [] };
      },
      async resolveIdentity() {
        return { ok: true, value: null };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };
    const input = {
      widget: {
        contextParameter: { field: 'Asset', value: 'MA_STALE' },
      },
      parameters: [{ field: 'Asset', value: `MA${'K'.repeat(15)}` }],
    };

    await expect(resolveWidgetTitle({
      widgetId: 'MW_ACTIVE_RAW',
      embeddedTitle: null,
      fallbackTitle: 'Saved <Asset:MA_STALE>',
      useEntityTitle: true,
      entityLabels: [],
      contextualFallbackTitle: () => resolvedContextualWidgetTitle(
        entity,
        'MW_ACTIVE_RAW',
        input,
        'Saved <Asset:MA_STALE>',
      ),
      metadataTitle: async () => undefined,
    }, entity)).resolves.toEqual({
      title: `Saved MA${'K'.repeat(15)}`,
      entityLabels: [],
    });
    expect(resolveCalls).toBe(1);
  });

  it('keeps the active raw context when Entity returns not-found', async () => {
    let resolveCalls = 0;
    const entity: WidgetEntityModule = {
      async resolve() {
        resolveCalls += 1;
        return {
          ok: true,
          value: [{ kind: 'asset', value: `MA${'K'.repeat(15)}`, status: 'not-found' }],
        };
      },
      async resolveIdentity() {
        return { ok: true, value: null };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };

    const input = {
      widget: {
        contextParameter: { field: 'Asset', value: 'MA_STALE' },
      },
      parameters: [{ field: 'Asset', value: `MA${'K'.repeat(15)}` }],
    };

    await expect(resolveWidgetTitle({
      widgetId: 'MW_ACTIVE_NOT_FOUND',
      embeddedTitle: null,
      fallbackTitle: 'Saved <Asset:MA_STALE>',
      useEntityTitle: true,
      entityLabels: [],
      contextualFallbackTitle: () => resolvedContextualWidgetTitle(
        entity,
        'MW_ACTIVE_NOT_FOUND',
        input,
        'Saved <Asset:MA_STALE>',
      ),
      metadataTitle: async () => undefined,
    }, entity)).resolves.toEqual({
      title: `Saved MA${'K'.repeat(15)}`,
      entityLabels: [],
    });
    expect(resolveCalls).toBe(1);
  });

  it('follows the literal ADR 0056 title workflow chart', async () => {
    const never = () => {
      throw new Error('unexpected title workflow branch');
    };

    await expect(resolveWidgetTitle({
      widgetId: 'MW_STATIC',
      embeddedTitle: 'Embedded title',
      fallbackTitle: 'Static saved title',
      useEntityTitle: true,
      entityLabels: [],
      contextualFallbackTitle: never,
      metadataTitle: never,
    }, undefined)).resolves.toEqual({
      title: 'Static saved title',
      entityLabels: [],
    });

    const embeddedEvents: string[] = [];
    await expect(resolveWidgetTitle({
      widgetId: 'MW_EMBEDDED',
      embeddedTitle: 'Embedded title',
      fallbackTitle: 'Saved <Asset:MA_STALE>',
      useEntityTitle: true,
      entityLabels: [],
      contextualFallbackTitle: never,
      metadataTitle: async () => {
        embeddedEvents.push('META');
        return 'Unexpected META title';
      },
    }, undefined)).resolves.toEqual({
      title: 'Embedded title',
      entityLabels: [],
    });
    expect(embeddedEvents).toEqual([]);

    const metaEvents: string[] = [];
    await expect(resolveWidgetTitle({
      widgetId: 'MW_META',
      embeddedTitle: null,
      fallbackTitle: 'Saved <Asset:MA_STALE>',
      useEntityTitle: true,
      entityLabels: [],
      contextualFallbackTitle: never,
      metadataTitle: async () => {
        metaEvents.push('META');
        return 'META title';
      },
    }, undefined)).resolves.toEqual({
      title: 'META title',
      entityLabels: [],
    });
    expect(metaEvents).toEqual(['META']);

    const falseEmbeddedEvents: string[] = [];
    await expect(resolveWidgetTitle({
      widgetId: 'MW_FALSE_EMBEDDED',
      embeddedTitle: 'Embedded FALSE title',
      fallbackTitle: 'Saved <Asset:MA_RAW>',
      useEntityTitle: false,
      entityLabels: [],
      contextualFallbackTitle: never,
      metadataTitle: async () => {
        falseEmbeddedEvents.push('META');
        return 'Unexpected META title';
      },
    }, undefined)).resolves.toEqual({
      title: 'Embedded FALSE title',
      entityLabels: [],
    });
    expect(falseEmbeddedEvents).toEqual([]);

    const falseMetaEvents: string[] = [];
    await expect(resolveWidgetTitle({
      widgetId: 'MW_FALSE_META',
      embeddedTitle: null,
      fallbackTitle: 'Saved <Asset:MA_RAW>',
      useEntityTitle: false,
      entityLabels: [],
      contextualFallbackTitle: never,
      metadataTitle: async () => {
        falseMetaEvents.push('META');
        return 'META FALSE title';
      },
    }, undefined)).resolves.toEqual({
      title: 'META FALSE title',
      entityLabels: [],
    });
    expect(falseMetaEvents).toEqual(['META']);

    const labelEvents: string[] = [];
    const entity = {
      async resolve() {
        labelEvents.push('LABELS');
        return {
          ok: true as const,
          value: [{
            kind: 'asset' as const,
            entityId: `MA${'K'.repeat(15)}`,
            label: 'Active Asset',
            aliases: [],
          }],
        };
      },
      async resolveIdentity() {
        return { ok: true as const, value: null };
      },
      async resolveMatches() {
        return { ok: true as const, value: [] };
      },
    } satisfies WidgetEntityModule;
    await expect(resolveWidgetTitle({
      widgetId: 'MW_LABELS',
      embeddedTitle: null,
      fallbackTitle: `Saved <Asset:MA${'K'.repeat(15)}>`,
      useEntityTitle: true,
      entityLabels: [],
      contextualFallbackTitle: () => {
        labelEvents.push('context');
        return `Saved <Asset:MA${'K'.repeat(15)}>`;
      },
      metadataTitle: async () => {
        labelEvents.push('META');
        return undefined;
      },
    }, entity)).resolves.toEqual({
      title: 'Saved Active Asset',
      entityLabels: [{ identity: `MA${'K'.repeat(15)}`, label: 'Active Asset' }],
    });
    expect(labelEvents).toEqual(['META', 'context', 'LABELS']);

    const falseEvents: string[] = [];
    const falseEntity: WidgetEntityModule = {
      ...entity,
      async resolve() {
        falseEvents.push('LABELS');
        return entity.resolve();
      },
    };
    await expect(resolveWidgetTitle({
      widgetId: 'MW_FALSE',
      embeddedTitle: null,
      fallbackTitle: 'Saved <Asset:MA_RAW>',
      useEntityTitle: false,
      entityLabels: [],
      contextualFallbackTitle: () => {
        falseEvents.push('context');
        return 'Saved Context <Asset:MA_RAW>';
      },
      metadataTitle: async () => {
        falseEvents.push('META');
        return undefined;
      },
    }, falseEntity)).resolves.toEqual({
      title: 'Saved Context Active Asset',
      entityLabels: [{ identity: 'MA_RAW', label: 'Active Asset' }],
    });
    expect(falseEvents).toEqual(['META', 'context', 'LABELS']);
  });

  it('resolves repeated-kind title placeholders by exact identity', async () => {
    await expect(resolveWidgetSnippetTitle(
      undefined,
      'MW_MULTI_ASSET_TITLE',
      '<Asset:MA_ONE> vs <Asset:MA_TWO>',
      [
        { identity: 'MA_ONE', label: 'One' },
        { identity: 'MA_TWO', label: 'Two' },
      ],
    )).resolves.toEqual({
      title: 'One vs Two',
      entityLabels: [],
    });
  });

  it('keeps raw placeholder values when Entity returns partial display evidence', async () => {
    const entity: WidgetEntityModule = {
      async resolve() {
        return {
          ok: true,
          value: [{
            kind: 'asset',
            entityId: 'MA_ONE',
            label: 'One',
            aliases: [],
          }],
        };
      },
      async resolveIdentity() {
        return { ok: true, value: null };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };

    await expect(resolveWidgetSnippetTitle(
      entity,
      'MW_PARTIAL_ENTITY_TITLE',
      '<Asset:MA_ONE> vs <Asset:MA_TWO>',
    )).resolves.toEqual({
      title: 'One vs MA_TWO',
      entityLabels: [{ identity: 'MA_ONE', label: 'One' }],
    });
  });

  it('recognizes parameter definitions without treating a default-only value as one', () => {
    expect(isParameterDefinition('x')).toBe(false);
    expect(isParameterDefinition(null)).toBe(false);
    expect(isParameterDefinition(['a'])).toBe(false);
    expect(isParameterDefinition({ type: 'Enum' })).toBe(true);
    expect(isParameterDefinition({ options: [] })).toBe(true);
    expect(isParameterDefinition({ defaultValue: 1 })).toBe(true);
    expect(isParameterDefinition({ values: { default: 1 } })).toBe(false);
    expect(isParameterDefinition({ values: { default: 1, min: 0 } })).toBe(true);
    expect(isParameterDefinition({ values: [1, 2] })).toBe(true);
    expect(isParameterDefinition({ field: 'x' })).toBe(false);
  });

  it('does not treat lowercase display text as an opaque provider identifier', () => {
    expect(widgetSnippetParams([
      { field: 'metric', value: 'marketCapitalization' },
    ])).toEqual(['metric=marketCapitalization']);
  });

  it('keys params by the -p name and prints unset params as name=', () => {
    expect(widgetSnippetParams([
      { field: 'Pricing Date', value: '-1b' },
      { field: 'undefinedValue', value: undefined },
      { field: 'nullValue', value: null },
      { field: 'disabled', value: false },
      { field: 'threshold', value: 0 },
      { field: 'emptyLabel', value: '' },
    ])).toEqual([
      'pricingDate=-1b',
      'undefinedValue=',
      'nullValue=',
      'disabled=false',
      'threshold=0',
      'emptyLabel=',
    ]);
  });

  it('keeps the first of two fields that share a -p name', () => {
    expect(widgetSnippetParams([
      { field: 'Relative Date', value: '2Y' },
      { field: 'relativeDate', value: '5Y' },
    ])).toEqual(['relativeDate=2Y']);
  });

  it('prints the implicit Relative Date as relativeDate=<value>', () => {
    expect(widgetSnippetParams([
      { field: 'cross', value: 'USDTRY' },
      { field: 'Relative Date', value: '2Y' },
    ])).toEqual(['cross=USDTRY', 'relativeDate=2Y']);
  });

  it('prints array-valued snippet parameters as -p takes them', () => {
    expect(widgetSnippetParams([
      { field: 'tenors', value: ['1y', '2y'] },
      { field: 'customizedCcys', value: [] },
    ])).toEqual(['tenors=1y,2y', 'customizedCcys=']);
  });

  it('caps array-valued snippet parameters with the omitted value count', () => {
    expect(widgetSnippetParams([
      {
        field: 'assets',
        value: Array.from({ length: 10 }, (_, index) => `Asset ${index + 1}`),
      },
    ])).toEqual([
      'assets=Asset 1,Asset 2,Asset 3,Asset 4,Asset 5,Asset 6,Asset 7,Asset 8 (+2 more)',
    ]);
  });

  it('discovers snippet fields grouped by raw source', () => {
    expect(discoverSnippetFields({
      contextParameter: { field: 'cross' },
      renderParams: {
        controls: [{ field: 'tenorField', id: 'tenor', name: 'Tenor' }],
        component: { annualized: true },
      },
      parameters: [
        { field: 'universe', type: 'Enum' },
        { field: 'pricingDate' },
      ],
    })).toEqual({
      contextParameter: ['cross'],
      controls: ['tenorField', 'tenor', 'Tenor'],
      params: [
        { field: 'universe', kind: 'definition' },
        { field: 'pricingDate', kind: 'fallback' },
      ],
      component: ['annualized'],
    });
  });

  it('discovers the implicit Relative Date control only for a CH Plot without render controls', () => {
    const chPlotTool = { underlyingChartId: 'CH_SYNTH_004', visualizationType: 'Plot' };

    expect(discoverSnippetFields({ ...chPlotTool, renderParams: { controls: [] } }).controls)
      .toEqual(['Relative Date']);
    expect(discoverSnippetFields({ ...chPlotTool, renderParams: { controls: [{ id: 'tenor' }] } }).controls)
      .toEqual(['tenor']);
  });

  it('assembles search snippet names in current search order with CH repairs', () => {
    expect(assembleWidgetSnippetParamNames({
      widgetId: 'MW_CH_CONTROL',
      title: 'CH widget with explicit control',
      underlyingChartId: 'CH_SYNTH_005',
      visualizationType: 'Plot',
      contextParameter: { field: 'ASSET' },
      renderParams: { controls: [{ id: 'ASSET' }] },
    })).toEqual(['ASSET', 'Relative Date']);

    expect(assembleWidgetSnippetParamNames({
      widgetId: 'MW_CH_RELATIVE_DATE',
      title: 'CH widget with implicit relative date',
      underlyingChartId: 'CH_SYNTH_004',
      visualizationType: 'Plot',
      renderParams: { controls: [] },
      parameters: [{ field: 'lookback' }],
    })).toEqual(['Relative Date', 'lookback']);
  });

  it('assembles snippet names for dashboard widgets through the unified search path', () => {
    expect(assembleWidgetSnippetParamNames({
      widgetId: 'MW_DASHBOARD_ORDER',
      title: 'Dashboard widget',
      underlyingChartId: 'DV_DASHBOARD_ORDER',
      contextParameter: { field: 'cross' },
      renderParams: {
        controls: [{ id: 'controlOnly' }],
        component: { annualized: true },
      },
      parameters: [
        { field: 'pricingDate', type: 'Date' },
        { field: 'customFallback' },
        { field: 'universe', options: ['G10'] },
        { field: 'tenor', offset: 1 },
      ],
    })).toEqual([
      'cross',
      'controlOnly',
      'pricingDate',
      'customFallback',
      'universe',
      'tenor',
      'annualized',
    ]);
  });

  it('appends CH relative-date repair for dashboard widgets', () => {
    expect(assembleWidgetSnippetParamNames({
      widgetId: 'MW_DASHBOARD_CH',
      title: 'Dashboard CH widget',
      underlyingChartId: 'CH_DASHBOARD',
      visualizationType: 'Plot',
      renderParams: { controls: [] },
      parameters: [{ field: 'lookback' }],
    })).toEqual(['Relative Date', 'lookback']);
  });

});
