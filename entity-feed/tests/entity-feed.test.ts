import { describe, expect, it } from 'vitest';
import type { Entity } from '../../entity/index.js';
import { createEntityFeedInMemoryAdapter } from '../in-memory-adapter.js';
import { createEntityFeedModuleFromAdapter } from '../module.js';

describe('Entity Feed', () => {
  it('returns an empty read-only feed for an Entity with no matching Widgets', async () => {
    const entity: Entity = {
      kind: 'country',
      entityId: 'US',
      label: 'United States',
      aliases: [],
      region: 'Americas',
      subRegion: 'Northern America',
    };
    const module = createEntityFeedModuleFromAdapter({
      adapter: createEntityFeedInMemoryAdapter({ feeds: [{
        entityId: 'US',
        entries: [],
      }] }),
    });

    expect(Object.keys(module)).toEqual(['get']);
    await expect(module.get({ entity })).resolves.toEqual({
      ok: true,
      value: {
        entity: {
          kind: 'country',
          entityId: 'US',
          label: 'United States',
          aliases: [],
          region: 'Americas',
          subRegion: 'Northern America',
        },
        entries: [],
        total: 0,
      },
    });
  });

  it('orders saved pins first, then ranked Widgets with missing ranks last', async () => {
    const entity: Entity = {
      kind: 'asset',
      entityId: 'MA_AAPL',
      label: 'Example Corp A',
      aliases: ['AAPL'],
    };
    const module = createEntityFeedModuleFromAdapter({
      adapter: createEntityFeedInMemoryAdapter({ feeds: [{
        entityId: 'MA_AAPL',
        pins: [
          { widgetId: 'MW_UNRANKED' },
          { widgetId: 'MW_SECOND', configurationId: 'WC_SECOND' },
        ],
        entries: [
          { widgetId: 'MW_SECOND', configurationId: 'WC_SECOND', title: 'Second', rank: 2 },
          { widgetId: 'MW_UNRANKED', title: 'Unranked' },
          { widgetId: 'MW_FIRST_A', title: 'First A', rank: 1 },
          { widgetId: 'MW_FIRST_B', title: 'First B', rank: 1 },
          { widgetId: 'MW_LATE', title: 'Late', rank: 4 },
        ],
      }] }),
    });

    const result = await module.get({ entity });

    expect(result.ok && result.value.entries.map(({ widgetId }) => widgetId)).toEqual([
      'MW_UNRANKED',
      'MW_SECOND',
      'MW_FIRST_A',
      'MW_FIRST_B',
      'MW_LATE',
    ]);
  });

  it('matches a configured pin only to its configuration and an unconfigured pin to any', async () => {
    const entity: Entity = { kind: 'asset', entityId: 'MA_AAPL', label: 'Example Corp A', aliases: ['AAPL'] };
    const module = createEntityFeedModuleFromAdapter({
      adapter: createEntityFeedInMemoryAdapter({ feeds: [{
        entityId: 'MA_AAPL',
        pins: [
          { widgetId: 'MW_CHART', configurationId: 'WC_B' },
          { widgetId: 'MW_TABLE' },
        ],
        entries: [
          { widgetId: 'MW_CHART', configurationId: 'WC_A', title: 'Chart A', rank: 1 },
          { widgetId: 'MW_OTHER', title: 'Other', rank: 2 },
          { widgetId: 'MW_CHART', configurationId: 'WC_B', title: 'Chart B', rank: 3 },
          { widgetId: 'MW_TABLE', configurationId: 'WC_C', title: 'Table', rank: 4 },
        ],
      }] }),
    });

    const result = await module.get({ entity });

    expect(result.ok && result.value.entries.map(({ title }) => title)).toEqual([
      'Chart B',
      'Table',
      'Chart A',
      'Other',
    ]);
  });

  it('skips a saved pin whose Widget is not in the feed', async () => {
    const entity: Entity = { kind: 'asset', entityId: 'MA_AAPL', label: 'Example Corp A', aliases: ['AAPL'] };
    const module = createEntityFeedModuleFromAdapter({
      adapter: createEntityFeedInMemoryAdapter({ feeds: [{
        entityId: 'MA_AAPL',
        pins: [{ widgetId: 'MW_GONE' }],
        entries: [
          { widgetId: 'MW_FIRST', title: 'First', rank: 1 },
          { widgetId: 'MW_LATE', title: 'Late', rank: 2 },
        ],
      }] }),
    });

    const result = await module.get({ entity });

    expect(result.ok && result.value.entries.map(({ widgetId }) => widgetId)).toEqual(['MW_FIRST', 'MW_LATE']);
  });
});
