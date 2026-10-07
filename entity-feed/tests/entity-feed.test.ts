import { describe, expect, it } from 'vitest';
import type { Entity } from '../../entity/index.js';
import { createEntityFeedInMemoryAdapter } from '../in-memory-adapter.js';
import { createEntityFeedModuleFromAdapter, type EntityFeedAdapter } from '../module.js';
import type { EntityFeedEntry, EntityFeedResult } from '../types.js';

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

describe('Entity Feed requested window', () => {
  const entity: Entity = { kind: 'country', entityId: 'BR', label: 'Brazil', aliases: [], region: 'Americas', subRegion: 'South America' };
  const entry = (index: number): EntityFeedEntry => ({ widgetId: `MW_${index}`, title: `Widget ${index}`, widgetDefinition: {}, widgetParameterOverrides: [], selectedContext: null, rank: index });
  const entries = Array.from({ length: 105 }, (_, index) => entry(index));
  const feed = (page: EntityFeedAdapter['page'], pins: { widgetId: string }[] = []) => createEntityFeedModuleFromAdapter({ adapter: {
    async read() { return { ok: true, value: { entries: entries.slice(0, 100), total: 105, pins } }; },
    page,
  } });

  it.each([101, 105, 200])('loads the requested window up to the total for limit %s', async (limit) => {
    const module = feed(async (_, input) => ({ ok: true, value: { entries: entries.slice(input.offset, (input.offset ?? 0) + input.limit), total: 105 } }));
    const result = await module.get({ entity, limit });
    expect(result.ok && result.value.entries.at(-1)?.title).toBe(limit === 101 ? 'Widget 100' : 'Widget 104');
    expect(result.ok && result.value.entries.length).toBe(limit === 101 ? 101 : 105);
    expect(result.ok && result.value.total).toBe(105);
  });

  it('advances through positive short pages by the entries actually returned', async () => {
    const module = feed(async (_, input) => ({ ok: true, value: { entries: entries.slice(input.offset, (input.offset ?? 0) + Math.min(2, input.limit)), total: 105 } }));
    const result = await module.get({ entity, limit: 105 });
    expect(result.ok && result.value.entries.slice(100).map(({ title }) => title)).toEqual(['Widget 100', 'Widget 101', 'Widget 102', 'Widget 103', 'Widget 104']);
  });

  it.each([undefined, 50, 100])('keeps the first window without loading a tail for limit %s', async (limit) => {
    const module = feed(async () => { throw new Error('Unexpected tail request'); });
    const result = await module.get({ entity, limit });
    expect(result.ok && result.value.entries.length).toBe(100);
    expect(result.ok && result.value.entries[0]?.title).toBe('Widget 0');
  });

  it('orders prefix pins once and appends tail pins in provider order', async () => {
    const module = feed(async (_, input) => ({ ok: true, value: { entries: entries.slice(input.offset, (input.offset ?? 0) + input.limit), total: 105 } }), [{ widgetId: 'MW_104' }, { widgetId: 'MW_99' }]);
    const result = await module.get({ entity, limit: 105 });
    expect(result.ok && result.value.entries.slice(0, 2).map(({ title }) => title)).toEqual(['Widget 99', 'Widget 0']);
    expect(result.ok && result.value.entries.slice(100).map(({ title }) => title)).toEqual(['Widget 100', 'Widget 101', 'Widget 102', 'Widget 103', 'Widget 104']);
  });

  it('classifies an empty page before the requested window is complete', async () => {
    const module = feed(async () => ({ ok: true, value: { entries: [], total: 105 } }));
    await expect(module.get({ entity, limit: 101 })).resolves.toEqual({ ok: false, error: { kind: 'invalid-feed', problem: 'response' } });
  });

  it('propagates a tail dependency failure', async () => {
    const failure: EntityFeedResult<never> = { ok: false, error: { kind: 'dependency', source: 'feed', failure: { kind: 'unavailable' } } };
    const module = feed(async () => failure);
    await expect(module.get({ entity, limit: 101 })).resolves.toEqual({ ok: false, error: { kind: 'dependency', source: 'feed', failure: { kind: 'unavailable' } } });
  });
});
