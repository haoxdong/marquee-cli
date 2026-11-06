import { describe, expect, it } from 'vitest';
import { catalogCacheDirectory } from '../index.js';

describe('catalogCacheDirectory', () => {
  it('caches under MARQUEE_CACHE_DIR, else the home directory, when no proxy identity is set', () => {
    expect(catalogCacheDirectory({ MARQUEE_CACHE_DIR: '/cache' }, '/home/a')).toBe('/cache');
    expect(catalogCacheDirectory({}, '/home/a')).toBe('/home/a/.marquee/cache');
  });

  it('gives each proxy account and endpoint a directory of its own', () => {
    const directory = (accountId: string, baseUrl = 'https://proxy.example') => catalogCacheDirectory(
      { MARQUEE_CACHE_DIR: '/cache', MARQUEE_BASE_URL: baseUrl, MARQUEEBOT_ACCOUNT_ID: accountId },
      '/home/a',
    );

    expect(directory('account-1')).toMatch(/^\/cache\/[0-9a-f]{16}$/);
    expect(directory('account-1')).toBe(directory('account-1'));
    expect(directory('account-1')).not.toBe(directory('account-2'));
    expect(directory('account-1')).not.toBe(directory('account-1', 'https://other.example'));
  });
});
