import { describe, expect, it } from 'vitest';
import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { marketViewSearchRefs } from '../artifact-policy.js';

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
});
