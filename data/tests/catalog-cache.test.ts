import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cachedCatalog } from '../catalog-cache.js';

describe('cachedCatalog', () => {
  const now = () => new Date('2026-11-05T12:00:00Z');

  it.each([
    ['keeps a whole catalog for the next run', true, 1],
    ['asks Marquee again for a catalog holding a failed part', false, 2],
  ])('%s', async (_case, isWhole, fetches) => {
    const cache = { directory: mkdtempSync(join(tmpdir(), 'marquee-catalog-cache-')), now };
    const fetch = vi.fn(async () => ({ ok: true as const, value: { folders: ['FX - Spot'] } }));

    await cachedCatalog(cache, 'quickstart-folders', fetch, () => isWhole);
    const second = await cachedCatalog(cache, 'quickstart-folders', fetch, () => isWhole);

    expect(second).toEqual({ ok: true, value: { folders: ['FX - Spot'] } });
    expect(fetch).toHaveBeenCalledTimes(fetches);
  });
});
