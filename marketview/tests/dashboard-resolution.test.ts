import { describe, expect, it, vi } from 'vitest';
import type { EntityModule } from '../../entity/index.js';
import {
  canonicalDashboardIdentity,
  resolveDashboardReadTarget,
} from '../dashboard-resolution.js';

function resolver(
  resolveIdentity: EntityModule['resolveIdentity'],
): Pick<EntityModule, 'resolveIdentity'> {
  return { resolveIdentity };
}

describe('Dashboard target resolution', () => {
  it('resolves an asset symbol through Entity without a Search capability', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === 'asset'
        ? {
            ok: true,
            value: {
              kind: 'asset',
              entityId: 'MA_AAPL',
              label: 'Example Asset',
              aliases: ['AAPL'],
              ticker: 'AAPL',
            },
          }
        : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'AAPL' },
      { entity: resolver(resolveEntity) },
    )).resolves.toMatchObject({
      ok: true,
      target: {
        kind: 'context',
        entityKind: 'asset',
        identifier: 'AAPL',
        entity: { entityId: 'MA_AAPL', label: 'Example Asset', ticker: 'AAPL' },
      },
    });
    expect(resolveEntity).toHaveBeenCalledTimes(2);
  });

  it('does not treat a free-text Dashboard title as a saved Dashboard identifier', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({
      ok: true,
      value: null,
    }));

    await expect(resolveDashboardReadTarget(
      { identifier: 'G4 Rates' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: false,
      error: { kind: 'unresolved', identifier: 'G4 Rates' },
    });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it('does not treat an unmatched single word as a saved Dashboard identifier', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({
      ok: true,
      value: null,
    }));

    await expect(resolveDashboardReadTarget(
      { identifier: 'Desk' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: false,
      error: { kind: 'unresolved', identifier: 'Desk' },
    });
    expect(resolveEntity).toHaveBeenCalledTimes(2);
  });

  it('accepts a namespaced Dashboard alias without resolution calls', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier: 'example-user/market-regime' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: true,
      target: { kind: 'saved', dashboardId: 'example-user/market-regime' },
    });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous namespaced Dashboard alias after Entity misses', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({
      ok: true,
      value: null,
    }));

    await expect(resolveDashboardReadTarget(
      { identifier: 'user/rates' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: true,
      target: { kind: 'saved', dashboardId: 'user/rates' },
    });
    expect(resolveEntity).toHaveBeenCalledTimes(2);
  });

  it('canonicalizes a lowercase Dashboard ID without resolution calls', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier: 'mdabc123' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: true,
      target: { kind: 'saved', dashboardId: 'MDABC123' },
    });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it('accepts a provider-valid single-segment Dashboard alias after Entity misses', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({
      ok: true,
      value: null,
    }));

    await expect(resolveDashboardReadTarget(
      { identifier: 'rates' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: true,
      target: { kind: 'saved', dashboardId: 'rates' },
    });
    expect(resolveEntity).toHaveBeenCalledTimes(2);
  });

  it('preserves an agg-suffixed single-segment alias after canonical Entity probes miss', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({
      ok: true,
      value: null,
    }));

    await expect(resolveDashboardReadTarget(
      { identifier: 'ratesagg' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: true,
      target: { kind: 'saved', dashboardId: 'ratesagg' },
    });
    expect(resolveEntity).toHaveBeenCalledWith({ kind: 'country', value: 'RATESagg' });
  });

  it('does not let a single-segment alias candidate preempt a lowercase asset ticker', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === 'asset'
        ? {
            ok: true,
            value: {
              kind: 'asset',
              entityId: 'MA_AAPL',
              label: 'Example Asset',
              aliases: ['AAPL'],
              ticker: 'AAPL',
            },
          }
        : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'aapl' },
      { entity: resolver(resolveEntity) },
    )).resolves.toMatchObject({
      ok: true,
      target: { kind: 'context', entityKind: 'asset', entity: { entityId: 'MA_AAPL' } },
    });
  });

  it('does not let an ambiguous slash-form alias preempt a lowercase asset ticker', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === 'asset'
        ? {
            ok: true,
            value: {
              kind: 'asset',
              entityId: 'MA_BRKB',
              label: 'Example Share Class',
              aliases: ['BRK/B'],
              ticker: 'BRK/B',
            },
          }
        : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'brk/b' },
      { entity: resolver(resolveEntity) },
    )).resolves.toMatchObject({
      ok: true,
      target: { kind: 'context', entityKind: 'asset', entity: { entityId: 'MA_BRKB' } },
    });
  });

  it('resolves a direct country entity ID without Search', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === 'country'
        ? {
            ok: true,
            value: {
              kind: 'country',
              entityId: 'GLagg',
              label: 'Global',
              aliases: [],
              region: 'Global',
            },
          }
        : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'glagg' },
      { entity: resolver(resolveEntity) },
    )).resolves.toMatchObject({
      ok: true,
      target: { kind: 'context', entityKind: 'country', identifier: 'GLagg' },
    });
    expect(resolveEntity).toHaveBeenCalledWith({ kind: 'country', value: 'GLagg' });
  });

  it('canonicalizes a lowercase ISO country ID before alias routing', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier: 'us' },
      { entity: resolver(resolveEntity) },
    )).resolves.toMatchObject({
      ok: true,
      target: { kind: 'context', entityKind: 'country', identifier: 'US' },
    });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it('does not treat a single-word country display name as a direct entity ID', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === 'country'
        ? {
            ok: true,
            value: {
              kind: 'country',
              entityId: 'GLagg',
              label: 'Global',
              aliases: [],
              region: 'Global',
            },
          }
        : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'Global' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: false,
      error: { kind: 'unresolved', identifier: 'Global' },
    });
  });

  it('rejects a direct country response without country-shaped region evidence', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === 'country'
        ? {
            ok: true,
            value: {
              kind: 'country',
              entityId: 'GLagg',
              label: 'Global',
              aliases: [],
            },
          }
        : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'GLagg' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: false,
      error: { kind: 'unresolved', identifier: 'GLagg' },
    });
  });

  it('rejects a multi-word country display name as free text without provider calls', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier: 'United States' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({
      ok: false,
      error: { kind: 'unresolved', identifier: 'United States' },
    });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it.each([
    ['asset', 'aapl'],
    ['country', 'united-states'],
    ['portfolio', 'rates book'],
  ] as const)('takes an explicit %s kind as an Entity Feed target without resolution calls', async (entityKind, identifier) => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier: `  ${identifier}  `, entityKind },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({ ok: true, target: { kind: 'context', entityKind, identifier } });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it.each([
    ['MA_EURUSD', 'asset'],
    ['MP_BOOK', 'portfolio'],
  ] as const)('reads the qualified entity ID %s as a %s Entity Feed without resolution calls', async (identifier, entityKind) => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({ ok: true, target: { kind: 'context', entityKind, identifier } });
    expect(resolveEntity).not.toHaveBeenCalled();
  });

  it('trims a hyphenated Dashboard alias before taking it as saved', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>();

    await expect(resolveDashboardReadTarget(
      { identifier: '  market-regime  ' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({ ok: true, target: { kind: 'saved', dashboardId: 'market-regime' } });
  });

  it.each([
    ['xmw1', 'xmw1'],
    ['mw1.x', 'mw1.x'],
    ['mw1', 'MW1'],
    ['x.glagg', 'x.glagg'],
    ['glagg.x', 'glagg.x'],
  ])('probes Entity with %s canonicalized as %s', async (identifier, canonical) => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({ ok: true, value: null }));

    await resolveDashboardReadTarget({ identifier }, { entity: resolver(resolveEntity) });

    expect(resolveEntity).toHaveBeenCalledWith({ kind: 'country', value: canonical });
    expect(resolveEntity).toHaveBeenCalledWith({ kind: 'asset', value: canonical });
  });

  it('does not take a word with a trailing symbol as a Dashboard alias', async () => {
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async () => ({ ok: true, value: null }));

    await expect(resolveDashboardReadTarget(
      { identifier: 'rates!' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({ ok: false, error: { kind: 'unresolved', identifier: 'rates!' } });
  });

  it.each(['country', 'asset'] as const)('reports a failed %s probe', async (failing) => {
    const error = { kind: 'malformed-entity' } as const;
    const resolveEntity = vi.fn<EntityModule['resolveIdentity']>(async (input) => (
      input.kind === failing ? { ok: false, error } : { ok: true, value: null }
    ));

    await expect(resolveDashboardReadTarget(
      { identifier: 'rates' },
      { entity: resolver(resolveEntity) },
    )).resolves.toEqual({ ok: false, error: { kind: 'entity', error } });
  });
});

describe('Dashboard identity for edits', () => {
  it('trims and uppercases a Dashboard ID', () => {
    expect(canonicalDashboardIdentity('  mdabc_1  ')).toBe('MDABC_1');
  });

  it('trims a Dashboard alias without changing its case', () => {
    expect(canonicalDashboardIdentity('  user/rates  ')).toBe('user/rates');
  });
});
