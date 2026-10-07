import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { createControlGroupModule } from '../index.js';
import { MarqueeError } from '../../transport/index.js';

describe('Control Group production adapter', () => {
  it('expands memberships in input order through one batched constituents request', async () => {
    const request = vi.fn(async () => ({
      results: [
        {
          constituentId: 'MA_ONE',
          name: 'First member',
          controlGroups: ['CG_ONE'],
        },
        {
          constituentId: 'MA_TWO',
          name: 'Second member',
          controlGroups: ['CG_TWO'],
        },
      ],
    }));
    const controlGroup = createControlGroupModule({ request });

    await expect(controlGroup.expand(['CG_TWO', 'CG_ONE'])).resolves.toEqual({
      ok: true,
      value: [
        {
          controlGroupId: 'CG_TWO',
          members: [{
            kind: 'asset',
            entityId: 'MA_TWO',
            label: 'Second member',
            aliases: [],
          }],
        },
        {
          controlGroupId: 'CG_ONE',
          members: [{
            kind: 'asset',
            entityId: 'MA_ONE',
            label: 'First member',
            aliases: [],
          }],
        },
      ],
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/marketview/constituents' }, {
      query: { groupIds: ['CG_TWO', 'CG_ONE'], limit: 100 },
    });
  });

  it('carries a member\'s asset class, type and currency onto its Asset', async () => {
    const request = vi.fn(async () => ({
      results: [{
        constituentId: 'MA_ONE',
        name: 'First member',
        assetClass: 'Equity',
        type: 'Single Stock',
        currency: 'USD',
        controlGroups: ['CG_ONE'],
      }],
    }));
    const controlGroup = createControlGroupModule({ request });

    await expect(controlGroup.expand(['CG_ONE'])).resolves.toEqual({
      ok: true,
      value: [{
        controlGroupId: 'CG_ONE',
        members: [{
          kind: 'asset',
          entityId: 'MA_ONE',
          label: 'First member',
          aliases: [],
          assetClass: 'Equity',
          assetType: 'Single Stock',
          currency: 'USD',
        }],
      }],
    });
  });

  it('falls back per group when a batched expansion reaches its limit', async () => {
    const releases = new Map<string, (value: unknown) => void>();
    const request = vi.fn(async (_path: string, init?: { query?: Record<string, unknown> }) => {
      const groupIds = init?.query?.groupIds as string[];
      if (groupIds.length > 1) {
        return {
          results: Array.from({ length: 100 }, (_, index) => ({
            constituentId: `MA_PAGE_${index}`,
            name: `Page ${index}`,
            controlGroups: groupIds,
          })),
        };
      }
      const [groupId] = groupIds;
      assert(groupId);
      return new Promise((resolve) => {
        releases.set(groupId, resolve);
      });
    });
    const controlGroup = createControlGroupModule({ request });

    const expansion = controlGroup.expand(['CG_TWO', 'CG_ONE']);
    await vi.waitFor(() => expect(releases.size).toBe(2));
    releases.get('CG_ONE')?.({
      results: [{
        constituentId: 'MA_ONE',
        name: 'First member',
        controlGroups: ['CG_ONE'],
      }],
    });
    releases.get('CG_TWO')?.({
      results: [{
        constituentId: 'MA_TWO',
        name: 'Second member',
        controlGroups: ['CG_TWO'],
      }],
    });

    await expect(expansion).resolves.toMatchObject({
      ok: true,
      value: [
        { controlGroupId: 'CG_TWO', members: [{ entityId: 'MA_TWO' }] },
        { controlGroupId: 'CG_ONE', members: [{ entityId: 'MA_ONE' }] },
      ],
    });
    expect(request.mock.calls.map(([, init]) => init?.query)).toEqual([
      { groupIds: ['CG_TWO', 'CG_ONE'], limit: 100 },
      { groupIds: ['CG_TWO'], limit: 100 },
      { groupIds: ['CG_ONE'], limit: 100 },
    ]);
  });

  it('returns a closed incomplete-expansion error when one group exhausts the limit', async () => {
    const controlGroup = createControlGroupModule({
      async request() {
        return {
          results: Array.from({ length: 100 }, (_, index) => ({
            constituentId: `MA_PAGE_${index}`,
            name: `Page ${index}`,
            controlGroups: ['CG_ONE'],
          })),
        };
      },
    });

    await expect(controlGroup.expand(['CG_ONE'])).resolves.toEqual({
      ok: false,
      error: {
        kind: 'malformed-member',
        controlGroupIds: ['CG_ONE'],
        problem: 'incomplete-expansion',
      },
    });
  });

  it('fails fast when one per-group fallback fails', async () => {
    let rejectFirst!: (error: Error) => void;
    const firstFallback = new Promise<unknown>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const pendingFallback = new Promise<unknown>(() => undefined);
    const request = vi.fn(async (_path: string, init?: { query?: Record<string, unknown> }) => {
      const groupIds = init?.query?.groupIds as string[];
      if (groupIds.length > 1) {
        return {
          results: Array.from({ length: 100 }, (_, index) => ({
            constituentId: `MA_PAGE_${index}`,
            name: `Page ${index}`,
            controlGroups: groupIds,
          })),
        };
      }
      return groupIds[0] === 'CG_ONE' ? firstFallback : pendingFallback;
    });
    const controlGroup = createControlGroupModule({ request });

    const expansion = controlGroup.expand(['CG_ONE', 'CG_TWO']);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    rejectFirst(new MarqueeError('http', 'Too many requests', { status: 429 }));

    await expect(expansion).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dependency',
        controlGroupIds: ['CG_ONE'],
        failure: { kind: 'rate-limited' },
      },
    });
  });

  it('matches decoded member Assets with a verbatim query and no result cache', async () => {
    const request = vi.fn(async () => ({
      results: [{
        constituentId: 'MA_MSFT',
        name: 'Microsoft Corp',
        bbid: 'MSFT UW',
        ticker: 'MSFT',
      }],
    }));
    const controlGroup = createControlGroupModule({ request });

    const expected = {
      ok: true,
      value: [{
        kind: 'asset',
        entityId: 'MA_MSFT',
        label: 'Microsoft Corp',
        aliases: ['MSFT UW', 'MSFT'],
        ticker: 'MSFT',
        bbid: 'MSFT UW',
        exchange: 'NASD',
      }],
    } as const;
    await expect(controlGroup.match(['CG_TECH'], '  MSFT  ')).resolves.toEqual(expected);
    await expect(controlGroup.match(['CG_TECH'], '  MSFT  ')).resolves.toEqual(expected);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/v1/marketview/constituents' }, {
      query: { groupIds: ['CG_TECH'], query: '  MSFT  ', limit: 30 },
      hedgeDelaysMs: [500, 1250],
    });
  });

  it('maps provider rate limits to a typed dependency failure', async () => {
    const controlGroup = createControlGroupModule({
      async request() {
        throw new MarqueeError('http', 'Too many requests', { status: 429 });
      },
    });

    await expect(controlGroup.match(['CG_TECH'], 'MSFT')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'dependency',
        controlGroupIds: ['CG_TECH'],
        failure: { kind: 'rate-limited' },
      },
    });
  });
});
