import { mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createEntityModule, type EntityResolveInput } from '../index.js';
import { createEntityInMemoryModule } from '../in-memory-adapter.js';
import type { EntityCache } from '../cache.js';
import type { EntityAdapter } from '../port.js';
import { assembleEntityModule } from '../resolver.js';
import { MarqueeError } from '../../transport/index.js';

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'entity-session-'));
  tempDirs.push(dir);
  return dir;
}

describe('Entity', () => {
  const semantics = createEntityInMemoryModule();

  it('exposes exactly the three Entity resolution kinds', () => {
    expectTypeOf<EntityResolveInput['kind']>()
      .toEqualTypeOf<'asset' | 'country' | 'portfolio'>();
  });

  it('canonicalizes stable Marquee identifier spellings', () => {
    expect(semantics.resolveCanonicalIdentity(' mw123abc ')).toBe('MW123ABC');
    expect(semantics.resolveCanonicalIdentity('md456')).toBe('MD456');
    expect(semantics.resolveCanonicalIdentity('maXyz789')).toBe('MAXYZ789');
    expect(semantics.resolveCanonicalIdentity('mpBook1')).toBe('MPBOOK1');
    expect(semantics.resolveCanonicalIdentity('CH12345')).toBe('CH12345');
    expect(semantics.resolveCanonicalIdentity('other-id')).toBe('other-id');
  });

  it('owns unresolved identifier and normalized source labels', () => {
    expect(semantics.resolveIsUnresolvedIdentifier('MA_RAW', {})).toBe(true);
    expect(semantics.resolveIsUnresolvedIdentifier('MA_AAPL', { MA_AAPL: 'Example Corp A' })).toBe(false);
    expect(semantics.resolveSourceLabels([
      { service: 'Plot', dataset: 'Prices' },
      { id: 'Marquee' },
      { id: 'Marquee' },
      null,
    ])).toEqual(['Plot Prices', 'Marquee']);
  });

  it('owns entity-backed option display rules', () => {
    const entityMap = { MA_AAPL: 'Example Corp A', 'AAPL UW': 'Example Corp A' };

    expect(semantics.resolveIsMarketCode('AAPL UW')).toBe(true);
    expect(semantics.resolveIsMarketCode('AAPL')).toBe(false);
    expect(semantics.resolveIsAssetCode('AAPL')).toBe(true);
    expect(semantics.resolveIsAssetCode('MW123')).toBe(false);
    expect(semantics.resolveDisplayKey('MA_AAPL', entityMap)).toBe('Example Corp A');
    expect(semantics.resolveDeduplicatedValues(['MA_AAPL', 'AAPL UW'], entityMap)).toEqual(['MA_AAPL']);
    expect(semantics.resolveSelectedValues(['MA_MISSING', 'MA_AAPL'], entityMap, 1)).toEqual(['MA_AAPL']);
  });

  it('returns canonical typed entities through its entry point', async () => {
    const entity = createEntityInMemoryModule({
      entities: [
        {
          kind: 'asset',
          entityId: 'MA_AAPL',
          label: 'Example Corp A',
          aliases: ['AAPL', 'AAPL UW'],
          ticker: 'AAPL',
          bbid: 'AAPL UW',
          exchange: 'NASD',
        },
        {
          kind: 'country',
          entityId: 'US',
          label: 'United States',
          aliases: [],
        },
      ],
    });

    await expect(entity.resolve([
      { kind: 'country', value: 'US' },
      { kind: 'asset', value: 'AAPL' },
      { kind: 'asset', value: 'AAPL' },
    ])).resolves.toEqual({
      ok: true,
      value: [
        {
          kind: 'country',
          entityId: 'US',
          label: 'United States',
          aliases: [],
        },
        {
          kind: 'asset',
          entityId: 'MA_AAPL',
          label: 'Example Corp A',
          aliases: ['AAPL', 'AAPL UW'],
          ticker: 'AAPL',
          bbid: 'AAPL UW',
          exchange: 'NASD',
        },
        {
          kind: 'asset',
          entityId: 'MA_AAPL',
          label: 'Example Corp A',
          aliases: ['AAPL', 'AAPL UW'],
          ticker: 'AAPL',
          bbid: 'AAPL UW',
          exchange: 'NASD',
        },
      ],
    });
  });

  it('returns an ordered not-found result when an in-memory sibling is missing', async () => {
    const entity = createEntityInMemoryModule({
      entities: [{
        kind: 'asset',
        entityId: 'MA_AAPL',
        label: 'Example Corp A',
        aliases: ['AAPL'],
      }],
    });

    await expect(entity.resolve([
      { kind: 'asset', value: 'AAPL' },
      { kind: 'asset', value: 'MA_MISSING' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [
        { kind: 'asset', entityId: 'MA_AAPL' },
        { kind: 'asset', value: 'MA_MISSING', status: 'not-found' },
      ],
    });
  });

  it('uses the focused identity capability for one canonical entity', async () => {
    const entity = createEntityInMemoryModule({
      entities: [{
        kind: 'asset',
        entityId: 'MA_AAPL',
        label: 'Example Corp A',
        aliases: ['AAPL'],
        ticker: 'AAPL',
      }],
    });

    await expect(entity.resolveIdentity({ kind: 'asset', value: 'AAPL' })).resolves.toEqual({
      ok: true,
      value: {
        kind: 'asset',
        entityId: 'MA_AAPL',
        label: 'Example Corp A',
        aliases: ['AAPL'],
        ticker: 'AAPL',
      },
    });
  });

  it('coalesces concurrent focused identity lookups', async () => {
    const calls: string[][] = [];
    let release!: (value: unknown) => void;
    const provider = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const entity = createEntityModule({
      async request(_path, init) {
        calls.push([...((init?.query?.ids as string[] | undefined) ?? [])]);
        return provider;
      },
    });

    const first = entity.resolveIdentity({ kind: 'asset', value: 'AAPL' });
    const second = entity.resolveIdentity({ kind: 'asset', value: 'AAPL' });
    await Promise.resolve();

    expect(calls).toEqual([['AAPL']]);
    release({ assets: [{ id: 'MA_AAPL', name: 'Example Corp A', ticker: 'AAPL' }] });
    await expect(first).resolves.toMatchObject({ ok: true, value: { entityId: 'MA_AAPL' } });
    await expect(second).resolves.toMatchObject({ ok: true, value: { entityId: 'MA_AAPL' } });
  });

  it('rejects blank identifiers before dispatch', async () => {
    const entity = createEntityInMemoryModule();

    await expect(entity.resolve([
      { kind: 'asset', value: '   ' },
    ])).resolves.toEqual({
      ok: false,
      error: {
        kind: 'invalid-identifier',
        identifier: { kind: 'asset', value: '   ' },
      },
    });
  });

  it('matches identifier-scoped candidates through its owner entry point', async () => {
    const entity = createEntityInMemoryModule({
      entities: [
        { kind: 'asset', entityId: 'MA_A', label: 'Acme', aliases: ['ACME UW'] },
        { kind: 'asset', entityId: 'MA_B', label: 'Acme', aliases: ['ACME LN'] },
        { kind: 'asset', entityId: 'MA_C', label: 'Beta', aliases: ['BETA'] },
      ],
    });

    await expect(entity.resolveMatches(
      ['MA_A', 'MA_B', 'MA_C'],
      'acme',
      2,
    )).resolves.toEqual({
      ok: true,
      value: [
        { entityId: 'MA_A', display: 'Acme (ACME UW)', aliases: ['ACME UW'] },
        { entityId: 'MA_B', display: 'Acme (ACME LN)', aliases: ['ACME LN'] },
      ],
    });
  });

  it('returns the first dependency failure without waiting for sibling resolution', async () => {
    const entity = createEntityModule({
      async request(_path, init) {
        if (init?.query?.type === 'Country') return new Promise(() => undefined);
        throw new Error('entity dependency unavailable');
      },
    });

    await expect(Promise.race([
      entity.resolve([
        { kind: 'asset', value: 'MA_FAIL' },
        { kind: 'country', value: 'US' },
      ]),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ])).resolves.toEqual({
      ok: false,
      error: { kind: 'dependency', failure: { kind: 'unavailable' } },
    });
  });

  it('unions pending work and shares overlapping in-flight resolution', async () => {
    const calls: string[][] = [];
    let release!: (value: unknown) => void;
    const provider = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const entity = createEntityModule({
      async request(_path, init) {
        calls.push([...((init?.query?.ids as string[] | undefined) ?? [])]);
        return provider;
      },
    });

    const first = entity.resolve([{ kind: 'asset', value: 'MA_A' }]);
    const second = entity.resolve([
      { kind: 'asset', value: 'MA_B' },
      { kind: 'asset', value: 'MA_A' },
    ]);
    await Promise.resolve();

    expect(calls).toEqual([['MA_A', 'MA_B']]);
    const overlapping = entity.resolve([{ kind: 'asset', value: 'MA_A' }]);
    await Promise.resolve();
    expect(calls).toEqual([['MA_A', 'MA_B']]);

    release({
      assets: [
        { id: 'MA_A', name: 'Alpha' },
        { id: 'MA_B', name: 'Beta' },
      ],
    });
    await expect(first).resolves.toMatchObject({
      ok: true,
      value: [{ kind: 'asset', entityId: 'MA_A' }],
    });
    await expect(second).resolves.toMatchObject({
      ok: true,
      value: [
        { kind: 'asset', entityId: 'MA_B' },
        { kind: 'asset', entityId: 'MA_A' },
      ],
    });
    await expect(overlapping).resolves.toMatchObject({
      ok: true,
      value: [{ kind: 'asset', entityId: 'MA_A' }],
    });
  });

  it('preserves caller order across cached and fresh resolutions', async () => {
    const calls: string[][] = [];
    const entity = createEntityModule({
      async request(_path, init) {
        const ids = [...((init?.query?.ids as string[] | undefined) ?? [])];
        calls.push(ids);
        return {
          assets: ids.map((id) => ({ id, name: id })),
        };
      },
    });

    await expect(entity.resolve([
      { kind: 'asset', value: 'MA_CACHED' },
    ])).resolves.toMatchObject({ ok: true });
    await expect(entity.resolve([
      { kind: 'asset', value: 'MA_FRESH' },
      { kind: 'asset', value: 'MA_CACHED' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [
        { kind: 'asset', entityId: 'MA_FRESH' },
        { kind: 'asset', entityId: 'MA_CACHED' },
      ],
    });
    expect(calls).toEqual([
      ['MA_CACHED'],
      ['MA_FRESH'],
    ]);
  });

  it('reads one cache snapshot for a resolution batch', async () => {
    let cacheReads = 0;
    const cache: EntityCache = {
      read(input) {
        cacheReads += 1;
        return input.map(() => undefined);
      },
      merge() {},
    };
    const adapter: EntityAdapter = {
      batchKey() {
        return 'asset';
      },
      maxBatchSize() {
        return 50;
      },
      async resolve(input) {
        return {
          ok: true,
          value: {
            resolutions: input.map(({ value }) => ({
              kind: 'asset' as const,
              entityId: value,
              label: value,
              aliases: [],
            })),
            discoveredEntities: [],
          },
        };
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };
    const entity = assembleEntityModule(adapter, cache);

    await entity.resolve([
      { kind: 'asset', value: 'MA_A' },
      { kind: 'asset', value: 'MA_B' },
      { kind: 'asset', value: 'MA_C' },
    ]);

    expect(cacheReads).toBe(1);
  });

  it('refuses a focused identity whose cached entity is another kind', async () => {
    const cache: EntityCache = {
      read(input) {
        return input.map(({ value }) => ({ kind: 'country' as const, entityId: value, label: value, aliases: [] }));
      },
      merge() {},
    };
    const adapter: EntityAdapter = {
      batchKey() {
        return 'asset';
      },
      maxBatchSize() {
        return 50;
      },
      async resolve() {
        throw new Error('a cached identity is not dispatched');
      },
      async resolveMatches() {
        return { ok: true, value: [] };
      },
    };
    const entity = assembleEntityModule(adapter, cache);

    await expect(entity.resolveIdentity({ kind: 'asset', value: 'MA_A' })).resolves.toEqual({
      ok: false,
      error: { kind: 'malformed-entity', identifier: { kind: 'asset', value: 'MA_A' } },
    });
  });

  it('preserves a valid result when a coalesced sibling is missing', async () => {
    const calls: string[][] = [];
    const entity = createEntityModule({
      async request(_path, init) {
        const ids = [...((init?.query?.ids as string[] | undefined) ?? [])];
        calls.push(ids);
        return {
          assets: ids
            .filter((id) => id === 'MA_VALID')
            .map((id) => ({ id, name: 'Valid' })),
        };
      },
    });

    const valid = entity.resolve([{ kind: 'asset', value: 'MA_VALID' }]);
    const missing = entity.resolve([{ kind: 'asset', value: 'MA_MISSING' }]);

    await expect(valid).resolves.toMatchObject({
      ok: true,
      value: [{ kind: 'asset', entityId: 'MA_VALID' }],
    });
    await expect(missing).resolves.toEqual({
      ok: true,
      value: [{ kind: 'asset', value: 'MA_MISSING', status: 'not-found' }],
    });
    expect(calls).toEqual([['MA_VALID', 'MA_MISSING']]);
  });

  it('caches a successful sibling and re-probes a not-found input', async () => {
    const calls: string[][] = [];
    const entity = createEntityModule({
      async request(_path, init) {
        const ids = [...((init?.query?.ids as string[] | undefined) ?? [])];
        calls.push(ids);
        return {
          assets: ids
            .filter((id) => id === 'MA_VALID')
            .map((id) => ({ id, name: 'Valid' })),
        };
      },
    });

    await expect(entity.resolve([
      { kind: 'asset', value: 'MA_VALID' },
      { kind: 'asset', value: 'MA_MISSING' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [
        { kind: 'asset', entityId: 'MA_VALID' },
        { kind: 'asset', value: 'MA_MISSING', status: 'not-found' },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(entity.resolve([
      { kind: 'asset', value: 'MA_VALID' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [{ kind: 'asset', entityId: 'MA_VALID' }],
    });
    await expect(entity.resolve([
      { kind: 'asset', value: 'MA_MISSING' },
    ])).resolves.toEqual({
      ok: true,
      value: [{ kind: 'asset', value: 'MA_MISSING', status: 'not-found' }],
    });
    expect(calls).toEqual([
      ['MA_VALID', 'MA_MISSING'],
      ['MA_MISSING'],
    ]);
  });

  it('uses the exact production route when isolating padded asset input', async () => {
    const calls: Array<{ ids: string[]; type?: unknown }> = [];
    const entity = createEntityModule({
      async request(_path, init) {
        const ids = [...((init?.query?.ids as string[] | undefined) ?? [])];
        const type = init?.query?.type;
        calls.push({ ids, type });
        if (type === 'Asset') throw new MarqueeError('timeout', 'query timed out');
        return { assets: [{ id: 'MA_TWO', name: 'Two' }] };
      },
    });

    const padded = entity.resolve([{ kind: 'asset', value: ' MA_ONE ' }]);
    const canonical = entity.resolve([{ kind: 'asset', value: 'MA_TWO' }]);

    await expect(padded).resolves.toMatchObject({
      ok: false,
      error: { kind: 'dependency', failure: { kind: 'timeout' } },
    });
    await expect(canonical).resolves.toMatchObject({
      ok: true,
      value: [{ entityId: 'MA_TWO' }],
    });
    expect(calls).toEqual([
      { ids: ['MA_ONE'], type: 'Asset' },
      { ids: ['MA_TWO'], type: undefined },
    ]);
  });

  it('dispatches one large same-kind batch and maps its failure to every input', async () => {
    const calls: Array<{
      method: unknown;
      query: unknown;
      body: unknown;
    }> = [];
    const entity = createEntityModule({
      async request(target, init) {
        calls.push({
          method: target.method,
          query: init?.query,
          body: init?.body,
        });
        throw new MarqueeError('timeout', 'batch timed out');
      },
    });

    const resolutions = Array.from({ length: 51 }, (_, index) => (
      entity.resolve([{ kind: 'asset', value: `MA_${index}` }])
    ));
    const results = await Promise.all(resolutions);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0]).toMatchObject({
      ok: false,
      error: { kind: 'dependency', failure: { kind: 'timeout' } },
    });
    expect(calls).toEqual([{
      method: 'POST',
      query: undefined,
      body: {
        ids: Array.from({ length: 51 }, (_, index) => `MA_${index}`),
        types: ['Asset', 'Control_Group'],
      },
    }]);
  });

  it('keeps canonical IDs and queries together in one large asset POST', async () => {
    const calls: Array<{
      method: unknown;
      query: unknown;
      body: unknown;
      hedgeDelaysMs: unknown;
    }> = [];
    const entity = createEntityModule({
      async request(target, init) {
        calls.push({
          method: target.method,
          query: init?.query,
          body: init?.body,
          hedgeDelaysMs: (init as { hedgeDelaysMs?: readonly number[] } | undefined)
            ?.hedgeDelaysMs,
        });
        return { assets: [] };
      },
    });
    const canonicalIds = Array.from({ length: 21 }, (_, index) => `MA_${index}`);
    const queries = Array.from({ length: 20 }, (_, index) => `ticker-${index}`);

    await Promise.all([
      ...canonicalIds.map((value) => entity.resolve([{ kind: 'asset', value }])),
      ...queries.map((value) => entity.resolve([{ kind: 'asset', value }])),
    ]);

    expect(calls).toEqual([{
      method: 'POST',
      query: undefined,
      body: {
        ids: [...canonicalIds, ...queries.map((value) => value.toUpperCase())],
        types: ['Asset', 'Control_Group'],
      },
      hedgeDelaysMs: [500, 1250],
    }]);
  });

  it('preserves query hedges for one 41-query asset POST', async () => {
    const calls: Array<{
      method: unknown;
      body: unknown;
      hedgeDelaysMs: unknown;
    }> = [];
    const entity = createEntityModule({
      async request(target, init) {
        calls.push({
          method: target.method,
          body: init?.body,
          hedgeDelaysMs: (init as { hedgeDelaysMs?: readonly number[] } | undefined)
            ?.hedgeDelaysMs,
        });
        return { assets: [] };
      },
    });
    const queries = Array.from({ length: 41 }, (_, index) => `ticker-${index}`);

    await Promise.all(queries.map((value) => (
      entity.resolve([{ kind: 'asset', value }])
    )));

    expect(calls).toEqual([{
      method: 'POST',
      body: {
        ids: queries.map((value) => value.toUpperCase()),
        types: ['Asset', 'Control_Group'],
      },
      hedgeDelaysMs: [500, 1250],
    }]);
  });

  it('reuses successful canonical and alias resolutions by kind in one Interaction Session', async () => {
    const dir = tempSessionDir();
    const cache = { dir, session: 'interaction-a' } as const;
    const first = createEntityModule({
      async request(_path, init) {
        if (init?.query?.type === 'Country') {
          return { countries: [{ id: 'AAPL', name: 'Country AAPL' }] };
        }
        return {
          assets: [{
            id: 'MA_AAPL',
            name: 'Example Corp A',
            ticker: 'AAPL',
            bbid: 'AAPL UW',
          }],
        };
      },
    }, { cache });

    await expect(first.resolve([
      { kind: 'asset', value: 'AAPL' },
      { kind: 'country', value: 'AAPL' },
    ])).resolves.toMatchObject({ ok: true });

    const reused = createEntityModule({
      async request() {
        throw new Error('successful session resolutions should be cached');
      },
    }, { cache });

    await expect(reused.resolve([
      { kind: 'asset', value: 'MA_AAPL' },
      { kind: 'asset', value: 'AAPL UW' },
      { kind: 'country', value: 'AAPL' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [
        { kind: 'asset', entityId: 'MA_AAPL' },
        { kind: 'asset', entityId: 'MA_AAPL' },
        { kind: 'country', entityId: 'AAPL' },
      ],
    });
  });

  it('keeps an explicit requested-value mapping ahead of ambiguous discovered aliases', async () => {
    const dir = tempSessionDir();
    const cache = { dir, session: 'interaction-a' } as const;
    const first = createEntityModule({
      async request() {
        return {
          assets: [
            { id: 'MA_AAPL_UW', name: 'Apple US', ticker: 'AAPL' },
            { id: 'MA_AAPL_LN', name: 'Apple UK', ticker: 'AAPL' },
          ],
        };
      },
    }, { cache });

    await expect(first.resolve([{ kind: 'asset', value: 'AAPL' }]))
      .resolves.toMatchObject({
        ok: true,
        value: [{ entityId: 'MA_AAPL_UW' }],
      });

    const reused = createEntityModule({
      async request() {
        throw new Error('the explicit requested mapping should be cached');
      },
    }, { cache });
    await expect(reused.resolve([{ kind: 'asset', value: 'AAPL' }]))
      .resolves.toMatchObject({
        ok: true,
        value: [{ entityId: 'MA_AAPL_UW' }],
      });
  });

  it('keeps an explicit same-process mapping ahead of ambiguous discovered aliases', async () => {
    let calls = 0;
    const entity = createEntityModule({
      async request() {
        calls += 1;
        return {
          assets: [
            { id: 'MA_AAPL_UW', name: 'Apple US', ticker: 'AAPL' },
            { id: 'MA_AAPL_LN', name: 'Apple UK', ticker: 'AAPL' },
          ],
        };
      },
    });

    await expect(entity.resolve([{ kind: 'asset', value: 'AAPL' }]))
      .resolves.toMatchObject({
        ok: true,
        value: [{ entityId: 'MA_AAPL_UW' }],
      });
    await expect(entity.resolve([{ kind: 'asset', value: 'AAPL' }]))
      .resolves.toMatchObject({
        ok: true,
        value: [{ entityId: 'MA_AAPL_UW' }],
      });
    expect(calls).toBe(1);
  });

  it('keeps an earlier explicit mapping ahead of aliases discovered by a later merge', async () => {
    const dir = tempSessionDir();
    const cache = { dir, session: 'interaction-a' } as const;
    const first = createEntityModule({
      async request() {
        return { assets: [{ id: 'MA_US', name: 'US listing', ticker: 'AAPL' }] };
      },
    }, { cache });
    await expect(first.resolve([{ kind: 'asset', value: 'AAPL' }]))
      .resolves.toMatchObject({ ok: true, value: [{ entityId: 'MA_US' }] });

    const later = createEntityModule({
      async request() {
        return { assets: [{ id: 'MA_UK', name: 'UK listing', ticker: 'AAPL' }] };
      },
    }, { cache });
    await expect(later.resolve([{ kind: 'asset', value: 'MA_UK' }]))
      .resolves.toMatchObject({ ok: true, value: [{ entityId: 'MA_UK' }] });

    const reused = createEntityModule({
      async request() {
        throw new Error('the earlier explicit mapping should remain stable');
      },
    }, { cache });
    await expect(reused.resolve([{ kind: 'asset', value: 'AAPL' }]))
      .resolves.toMatchObject({ ok: true, value: [{ entityId: 'MA_US' }] });
  });

  it('applies every explicit requested mapping after same-batch alias discovery', async () => {
    const dir = tempSessionDir();
    const cache = { dir, session: 'interaction-a' } as const;
    const first = createEntityModule({
      async request() {
        return {
          assets: [
            { id: 'MA_US', name: 'US listing' },
            { id: 'MA_UK', name: 'UK listing', ticker: 'MA_US' },
          ],
        };
      },
    }, { cache });

    await expect(first.resolve([
      { kind: 'asset', value: 'MA_US' },
      { kind: 'asset', value: 'MA_UK' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [{ entityId: 'MA_US' }, { entityId: 'MA_UK' }],
    });

    const reused = createEntityModule({
      async request() {
        throw new Error('same-batch requested mappings should be cached last');
      },
    }, { cache });
    await expect(reused.resolve([{ kind: 'asset', value: 'MA_US' }]))
      .resolves.toMatchObject({
        ok: true,
        value: [{ entityId: 'MA_US' }],
      });
  });

  it('caches successful records beside not-found and expires the inactive session', async () => {
    const dir = tempSessionDir();
    let now = 1_000;
    const cache = {
      dir,
      session: 'interaction-a',
      inactivityMs: 500,
      now: () => now,
    } as const;
    const partial = createEntityModule({
      async request() {
        return { assets: [{ id: 'MA_A', name: 'Alpha' }] };
      },
    }, { cache });

    await expect(partial.resolve([
      { kind: 'asset', value: 'MA_A' },
      { kind: 'asset', value: 'MA_B' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [
        { entityId: 'MA_A' },
        { kind: 'asset', value: 'MA_B', status: 'not-found' },
      ],
    });

    let calls = 0;
    const completeRequests: string[][] = [];
    const complete = createEntityModule({
      async request(_path, init) {
        completeRequests.push([...((init?.query?.ids as string[] | undefined) ?? [])]);
        calls += 1;
        return {
          assets: [
            { id: 'MA_A', name: 'Alpha' },
            { id: 'MA_B', name: 'Beta' },
          ],
        };
      },
    }, { cache });
    await expect(complete.resolve([
      { kind: 'asset', value: 'MA_A' },
      { kind: 'asset', value: 'MA_B' },
    ])).resolves.toMatchObject({ ok: true });
    expect(calls).toBe(1);
    expect(completeRequests).toEqual([['MA_B']]);

    now = 1_501;
    const expired = createEntityModule({
      async request() {
        throw new Error('expired cache must call the provider');
      },
    }, { cache });
    await expect(expired.resolve([{ kind: 'asset', value: 'MA_A' }]))
      .resolves.toMatchObject({ ok: false });
  });

  it('merges successful resolutions written by concurrent CLI processes', async () => {
    const dir = tempSessionDir();
    await Promise.all(([
      ['MA_A', 'Alpha'],
      ['MA_B', 'Beta'],
    ] as const).map(([entityId, label]) => execFileAsync(
      'node_modules/.bin/vite-node',
      [
        'marquee-cli/entity/tests/cache-worker.ts',
        dir,
        'interaction-a',
        entityId,
        label,
      ],
      { cwd: process.cwd() },
    )));

    const reused = createEntityInMemoryModule({}, {
      cache: { dir, session: 'interaction-a' },
    });
    await expect(reused.resolve([
      { kind: 'asset', value: 'MA_A' },
      { kind: 'asset', value: 'MA_B' },
    ])).resolves.toMatchObject({
      ok: true,
      value: [
        { entityId: 'MA_A', label: 'Alpha' },
        { entityId: 'MA_B', label: 'Beta' },
      ],
    });
  }, 20_000);

  it('does not hold the Interaction Session lock during provider work', async () => {
    const dir = tempSessionDir();
    const cache = { dir, session: 'interaction-a' } as const;
    let release!: (value: unknown) => void;
    const heldProvider = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const first = createEntityModule({
      async request() {
        return heldProvider;
      },
    }, { cache });
    const pending = first.resolve([{ kind: 'asset', value: 'MA_A' }]);
    await Promise.resolve();

    const second = createEntityModule({
      async request() {
        return { assets: [{ id: 'MA_B', name: 'Beta' }] };
      },
    }, { cache });
    await expect(second.resolve([{ kind: 'asset', value: 'MA_B' }]))
      .resolves.toMatchObject({ ok: true });

    release({ assets: [{ id: 'MA_A', name: 'Alpha' }] });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });
});
