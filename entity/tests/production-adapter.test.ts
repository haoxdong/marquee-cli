import { describe, expect, it } from 'vitest';
import {
  type EntityIdentifier,
} from '../index.js';
import { createEntityProductionAdapter } from '../production-adapter.js';
import type { HttpRequestInit } from '../../transport/index.js';
import { MarqueeError } from '../../transport/index.js';

type EntityTestTransport = {
  request(
    path: string,
    init?: HttpRequestInit & { hedgeDelaysMs?: number[] },
  ): Promise<unknown>;
};

// Fakes answer paths: an Endpoint reaches them as its path and method.
function sendsPaths(fake: EntityTestTransport): Parameters<typeof createEntityProductionAdapter>[0] {
  return { request: (endpoint, init) => fake.request(endpoint.path, { ...init, method: endpoint.method }) };
}

describe('Entity production adapter', () => {
  it('resolves asset identifiers with the evidenced entity request', async () => {
    const calls: Array<{ path: string; init?: HttpRequestInit | undefined }> = [];
    const transport: EntityTestTransport = {
      async request(path, init) {
        calls.push({ path, init });
        return {
          assets: [{
            id: 'MA_AAPL',
            name: 'Example Corp A',
            short_name: 'AAPL UW',
            ticker: 'AAPL',
            bbid: 'AAPL UW',
            assetClass: 'Equity',
            type: 'Single Stock',
            currency: 'USD',
          }],
        };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));
    const identifiers: readonly EntityIdentifier[] = [
      { kind: 'asset', value: 'MA_AAPL' },
    ];

    await expect(adapter.resolve(identifiers)).resolves.toEqual({
      ok: true,
      value: {
        resolutions: [{
          kind: 'asset',
          entityId: 'MA_AAPL',
          label: 'Example Corp A',
          aliases: ['AAPL UW', 'AAPL'],
          assetClass: 'Equity',
          assetType: 'Single Stock',
          ticker: 'AAPL',
          bbid: 'AAPL UW',
          exchange: 'NASD',
          currency: 'USD',
        }],
        discoveredEntities: [{
          kind: 'asset',
          entityId: 'MA_AAPL',
          label: 'Example Corp A',
          aliases: ['AAPL UW', 'AAPL'],
          assetClass: 'Equity',
          assetType: 'Single Stock',
          ticker: 'AAPL',
          bbid: 'AAPL UW',
          exchange: 'NASD',
          currency: 'USD',
        }],
      },
    });
    expect(calls).toEqual([{
      path: '/v1/plots/entities',
      init: {
        method: 'GET',
        query: { ids: ['MA_AAPL'] },
      },
    }]);
  });

  it('normalizes free-form asset identifiers without assuming an exchange', async () => {
    const calls: Array<{ path: string; init?: HttpRequestInit | undefined }> = [];
    const transport: EntityTestTransport = {
      async request(path, init) {
        calls.push({ path, init });
        return { assets: [] };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([
      { kind: 'asset', value: 'brk.b' },
      { kind: 'asset', value: 'EURUSD' },
    ])).resolves.toEqual({
      ok: true,
      value: {
        resolutions: [
          { kind: 'asset', value: 'brk.b', status: 'not-found' },
          { kind: 'asset', value: 'EURUSD', status: 'not-found' },
        ],
        discoveredEntities: [],
      },
    });
    expect(calls).toEqual([{
      path: '/v1/plots/entities',
      init: {
        method: 'GET',
        query: { ids: ['BRK/B', 'EURUSD'], type: 'Asset' },
        hedgeDelaysMs: [500, 1250],
      },
    }]);
  });

  it('matches asset results against the normalized free-form query', async () => {
    const transport: EntityTestTransport = {
      async request() {
        return {
          assets: [{
            id: 'MA_BRKB',
            name: 'Berkshire Hathaway Inc',
            ticker: 'BRK/B',
            bbid: 'BRK/B US',
          }],
        };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([
      { kind: 'asset', value: 'brk.b' },
    ])).resolves.toMatchObject({
      ok: true,
      value: {
        resolutions: [{
          kind: 'asset',
          entityId: 'MA_BRKB',
          ticker: 'BRK/B',
          bbid: 'BRK/B US',
        }],
      },
    });
  });

  it('keeps typed identity requests distinct from batched label resolution', async () => {
    const calls: Array<{ path: string; init?: HttpRequestInit | undefined }> = [];
    const transport: EntityTestTransport = {
      async request(path, init) {
        calls.push({ path, init });
        return { assets: [] };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await adapter.resolve([{ kind: 'asset', value: 'MA_AAPL' }], { purpose: 'identity' });
    await adapter.resolve([{ kind: 'asset', value: 'brk.b' }], { purpose: 'identity' });

    expect(calls).toEqual([
      {
        path: '/v1/plots/entities',
        init: {
          method: 'GET',
          query: { ids: ['MA_AAPL'], type: 'Asset' },
        },
      },
      {
        path: '/v1/plots/entities',
        init: {
          method: 'GET',
          query: { ids: ['BRK/B'], type: 'Asset' },
          hedgeDelaysMs: [500, 1250],
        },
      },
    ]);
  });

  it('decodes country and portfolio identities', async () => {
    const transport: EntityTestTransport = {
      async request(_path, init) {
        if (init?.query?.type === 'Country') {
          return { countries: [{ id: 'BR', name: 'Brazil', region: 'Americas', subRegion: 'South America' }] };
        }
        return { portfolios: [{ id: 'MP_BOOK', name: 'Macro Book', currency: 'USD' }] };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([
      { kind: 'country', value: 'BR' },
      { kind: 'portfolio', value: 'MP_BOOK' },
    ])).resolves.toEqual({
      ok: true,
      value: {
        resolutions: [
          {
            kind: 'country',
            entityId: 'BR',
            label: 'Brazil',
            aliases: [],
            region: 'Americas',
            subRegion: 'South America',
          },
          {
            kind: 'portfolio',
            entityId: 'MP_BOOK',
            label: 'Macro Book',
            aliases: [],
            currency: 'USD',
          },
        ],
        discoveredEntities: [
          {
            kind: 'country',
            entityId: 'BR',
            label: 'Brazil',
            aliases: [],
            region: 'Americas',
            subRegion: 'South America',
          },
          {
            kind: 'portfolio',
            entityId: 'MP_BOOK',
            label: 'Macro Book',
            aliases: [],
            currency: 'USD',
          },
        ],
      },
    });
  });

  it('routes every Entity operation without a MarketView request', async () => {
    const paths: string[] = [];
    const adapter = createEntityProductionAdapter(sendsPaths({
      async request(path, init) {
        paths.push(path);
        if (path.startsWith('/v1/marketview/')) {
          throw new Error(`unexpected MarketView request: ${path}`);
        }
        if (init?.query?.type === 'Country') return { countries: [] };
        if (init?.query?.type === 'Portfolio') return { portfolios: [] };
        return { assets: [] };
      },
    }));

    await expect(adapter.resolve([
      { kind: 'asset', value: 'MA_AAPL' },
      { kind: 'country', value: 'US' },
      { kind: 'portfolio', value: 'MP_BOOK' },
    ])).resolves.toMatchObject({ ok: true });
    await expect(adapter.resolveMatches(['MA_AAPL'], 'aapl', 30))
      .resolves.toMatchObject({ ok: true });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path === '/v1/plots/entities')).toBe(true);
  });

  it('treats an asset-shaped Country response as an unresolved Country identity', async () => {
    const transport: EntityTestTransport = {
      async request() {
        return {
          countries: [{ id: 'MA_GLOBAL', name: 'Global PLC', ticker: 'GLOBAL' }],
        };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([{ kind: 'country', value: 'Global' }]))
      .resolves.toEqual({
        ok: true,
        value: {
          resolutions: [{ kind: 'country', value: 'Global', status: 'not-found' }],
          discoveredEntities: [],
        },
      });
  });

  it('fails loud on a malformed ticker-only Country record', async () => {
    const transport: EntityTestTransport = {
      async request() {
        return {
          countries: [{ ticker: 'GLOBAL' }],
        };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([{ kind: 'country', value: 'Global' }]))
      .resolves.toEqual({ ok: false, error: { kind: 'malformed-entity' } });
  });

  it('returns an entity dependency failure without waiting for sibling provider calls', async () => {
    const transport: EntityTestTransport = {
      async request(_path, init) {
        if (init?.query?.type === 'Country') return new Promise(() => undefined);
        throw new Error('asset provider unavailable');
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(Promise.race([
      adapter.resolve([
        { kind: 'asset', value: 'MA_FAIL' },
        { kind: 'country', value: 'US' },
      ]),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ])).resolves.toEqual({
      ok: false,
      error: { kind: 'dependency', failure: { kind: 'unavailable' } },
    });
  });

  it('treats an embedded provider 404 sentinel as an unresolved identity', async () => {
    const transport: EntityTestTransport = {
      async request() {
        return {
          countries: [{ status_code: 404, log_message: 'Resource not found.' }],
        };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([{ kind: 'country', value: 'EURUSD' }]))
      .resolves.toEqual({
        ok: true,
        value: {
          resolutions: [{ kind: 'country', value: 'EURUSD', status: 'not-found' }],
          discoveredEntities: [],
        },
      });
  });

  it('treats a request-id-only typed response as an unresolved identity', async () => {
    const transport: EntityTestTransport = {
      async request() {
        return { requestId: 'request-1' };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve([{ kind: 'country', value: 'rates' }]))
      .resolves.toEqual({
        ok: true,
        value: {
          resolutions: [{ kind: 'country', value: 'rates', status: 'not-found' }],
          discoveredEntities: [],
        },
      });
  });

  it('treats a request-id-only Asset response as an unresolved identity', async () => {
    const transport: EntityTestTransport = {
      async request() {
        return { requestId: 'request-1' };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));

    await expect(adapter.resolve(
      [{ kind: 'asset', value: 'EU19' }],
      { purpose: 'identity' },
    )).resolves.toEqual({
      ok: true,
      value: {
        resolutions: [{ kind: 'asset', value: 'EU19', status: 'not-found' }],
        discoveredEntities: [],
      },
    });
  });

  it('fails loud when an Asset response has request metadata plus an unknown field', async () => {
    const adapter = createEntityProductionAdapter({
      async request() {
        return { requestId: 'request-1', unexpected: true };
      },
    });

    await expect(adapter.resolve(
      [{ kind: 'asset', value: 'EU19' }],
      { purpose: 'identity' },
    )).resolves.toEqual({ ok: false, error: { kind: 'malformed-entity' } });
  });

  it('uses one GET request for exactly 40 asset identifiers', async () => {
    const calls: Array<{ path: string; init?: HttpRequestInit | undefined }> = [];
    const transport: EntityTestTransport = {
      async request(path, init) {
        calls.push({ path, init });
        return { assets: [] };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));
    const identifiers = Array.from({ length: 40 }, (_, index) => `ticker-${index}`);

    await expect(adapter.resolveMatches(identifiers, undefined, 30))
      .resolves.toEqual({ ok: true, value: [] });
    expect(calls).toEqual([{
      path: '/v1/plots/entities',
      init: {
        method: 'GET',
        query: {
          ids: identifiers.map((identifier) => identifier.toUpperCase()),
          type: 'Asset',
        },
        hedgeDelaysMs: [500, 1250],
      },
    }]);
  });

  it('uses one POST request for 41 asset identifiers', async () => {
    const calls: Array<{ path: string; init?: HttpRequestInit | undefined }> = [];
    const transport: EntityTestTransport = {
      async request(path, init) {
        calls.push({ path, init });
        return { assets: [] };
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));
    const identifiers = Array.from({ length: 41 }, (_, index) => `ticker-${index}`);

    await expect(adapter.resolveMatches(identifiers, undefined, 30))
      .resolves.toEqual({ ok: true, value: [] });
    expect(calls).toEqual([{
      path: '/v1/plots/entities',
      init: {
        method: 'POST',
        body: {
          ids: identifiers.map((identifier) => identifier.toUpperCase()),
          types: ['Asset', 'Control_Group'],
        },
        hedgeDelaysMs: [500, 1250],
      },
    }]);
  });

  it('maps one large POST failure to a typed dependency failure', async () => {
    const calls: Array<{ path: string; init?: HttpRequestInit | undefined }> = [];
    const transport: EntityTestTransport = {
      async request(path, init) {
        calls.push({ path, init });
        throw new MarqueeError('timeout', 'timed out');
      },
    };
    const adapter = createEntityProductionAdapter(sendsPaths(transport));
    const identifiers = Array.from({ length: 41 }, (_, index) => `ticker-${index}`);

    await expect(adapter.resolveMatches(identifiers, undefined, 30)).resolves.toEqual({
      ok: false,
      error: { kind: 'dependency', failure: { kind: 'timeout' } },
    });
    expect(calls).toEqual([{
      path: '/v1/plots/entities',
      init: {
        method: 'POST',
        body: {
          ids: identifiers.map((identifier) => identifier.toUpperCase()),
          types: ['Asset', 'Control_Group'],
        },
        hedgeDelaysMs: [500, 1250],
      },
    }]);
  });
});
