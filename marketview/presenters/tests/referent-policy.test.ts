import { describe, expect, it } from 'vitest';
import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { marketViewSearchRefs } from '../referent-policy.js';

describe('MarketView Search Widget refs', () => {
  it('stores complete identity without promoting search parameter hints to Selected Context', () => {
    expect(marketViewSearchRefs({
      entries: [{
        entry: {
          kind: 'configured-widget',
          identity: { widgetId: 'MW_CARRY' as WidgetId, configurationId: 'WC_CARRY' as ConfigId },
          snippet: { title: 'Carry', isTitleResolved: true, parameterLines: ['Asset: EURUSD'] },
        },
      }],
    }, 's1')).toEqual({
      's1.w1': {
        type: 'widget',
        widgetId: 'MW_CARRY',
        configurationId: 'WC_CARRY',
        selectedContext: null,
      },
    });
  });

  it('keeps the ref of a failed Widget row so widget view reports the same error', () => {
    expect(marketViewSearchRefs({
      entries: [{
        entry: {
          kind: 'failed-widget',
          identity: { widgetId: 'MW_DEAD' as WidgetId, configurationId: null },
          title: 'Dead widget',
          error: { kind: 'missing-display-evidence', identity: { widgetId: 'MW_DEAD' }, field: 'asset' },
        },
      }, {
        entry: {
          kind: 'configured-widget',
          identity: { widgetId: 'MW_OK' as WidgetId, configurationId: 'WC_OK' as ConfigId },
          snippet: { title: 'Live', isTitleResolved: true, parameterLines: [] },
        },
      }],
    }, 's1')).toEqual({
      's1.w1': { type: 'widget', widgetId: 'MW_DEAD', configurationId: null, selectedContext: null },
      's1.w2': { type: 'widget', widgetId: 'MW_OK', configurationId: 'WC_OK', selectedContext: null },
    });
  });
});
