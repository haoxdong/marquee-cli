import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlGroupModule } from '../index.js';
import { createControlGroupInMemoryModule } from '../in-memory-adapter.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'control-group-session-'));
  tempDirs.push(dir);
  return dir;
}

describe('Control Group', () => {
  it('uses current in-memory members and defaults the match limit to 30', async () => {
    const members = Array.from({ length: 30 }, (_, index) => ({
      kind: 'asset' as const,
      entityId: `MA_${index}`,
      label: `Member ${index}`,
      aliases: [`MEMBER_${index}`],
    }));
    const controlGroup = createControlGroupInMemoryModule({
      groups: [{ controlGroupId: 'CG_ONE', members }],
    });

    await expect(controlGroup.match(['CG_ONE'])).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([expect.objectContaining({ entityId: 'MA_29' })]),
    });

    members.unshift({
      kind: 'asset',
      entityId: 'MA_CURRENT',
      label: 'Current member',
      aliases: ['CURRENT'],
    });
    const current = await controlGroup.match(['CG_ONE']);
    if (!current.ok) throw new Error(JSON.stringify(current.error));
    expect(current.value[0]).toMatchObject({ entityId: 'MA_CURRENT' });
    expect(current.value).toHaveLength(30);
    expect(current.value).not.toContainEqual(expect.objectContaining({ entityId: 'MA_29' }));
  });

  it('reuses a successful expansion across one Interaction Session', async () => {
    const dir = tempSessionDir();
    let release!: (value: unknown) => void;
    const provider = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(() => provider);
    const options = { cache: { dir, session: 'interaction-a' } } as const;
    const firstModule = createControlGroupModule({ request }, options);

    const first = firstModule.expand(['CG_ONE']);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    release({
      results: [{
        constituentId: 'MA_ONE',
        name: 'First member',
        controlGroups: ['CG_ONE'],
      }],
    });
    await expect(first).resolves.toMatchObject({
      ok: true,
      value: [{ controlGroupId: 'CG_ONE', members: [{ entityId: 'MA_ONE' }] }],
    });

    const secondModule = createControlGroupModule({ request }, options);
    await expect(secondModule.expand(['CG_ONE'])).resolves.toMatchObject({
      ok: true,
      value: [{ controlGroupId: 'CG_ONE', members: [{ entityId: 'MA_ONE' }] }],
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not cache failures and does cache successful empty expansions', async () => {
    const dir = tempSessionDir();
    const responses: unknown[] = [
      new Error('provider unavailable'),
      { results: [] },
    ];
    const request = vi.fn(async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    });
    const controlGroup = createControlGroupModule(
      { request },
      { cache: { dir, session: 'interaction-a' } },
    );

    await expect(controlGroup.expand(['CG_ONE'])).resolves.toMatchObject({ ok: false });
    await expect(controlGroup.expand(['CG_ONE'])).resolves.toEqual({
      ok: true,
      value: [{ controlGroupId: 'CG_ONE', members: [] }],
    });
    await expect(controlGroup.expand(['CG_ONE'])).resolves.toEqual({
      ok: true,
      value: [{ controlGroupId: 'CG_ONE', members: [] }],
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never caches match results in the expansion namespace', async () => {
    const dir = tempSessionDir();
    const request = vi.fn(async () => ({
      results: [{
        constituentId: 'MA_ONE',
        name: 'First member',
        controlGroups: ['CG_ONE'],
      }],
    }));
    const controlGroup = createControlGroupModule(
      { request },
      { cache: { dir, session: 'interaction-a' } },
    );

    await expect(controlGroup.match(['CG_ONE'], 'First')).resolves.toMatchObject({ ok: true });
    await expect(controlGroup.match(['CG_ONE'], 'First')).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
