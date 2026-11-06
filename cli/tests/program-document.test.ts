import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../cli-composition/index.js';

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A signed-in offline session's cookie jar, written at run time: the public mirror publishes no saved browser session. */
function offlineCookieJar(): string {
  const directory = mkdtempSync(join(tmpdir(), 'marquee-cookie-jar-'));
  directories.push(directory);
  const cookie = (name: string, value: string) => ({ name, value, domain: 'marquee.gs.com', path: '/' });
  const path = join(directory, 'cookies.json');
  writeFileSync(path, JSON.stringify({
    cookies: [cookie('MarqueeLogin', 'offline-replay'), cookie('MarqueeIdToken', 'offline-replay-id-token'), cookie('MARQUEE-CSRF-TOKEN', 'offline-replay-csrf-token')],
    updatedAt: 0,
  }));
  return path;
}

describe('program Document wiring', () => {
  it('preserves doc-search request headers through the canonical Document port', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => (
      new Response(JSON.stringify({
        id: '123e4567-e89b-12d3-a456-426614174001',
        digitalPath: '/content/research/en/reports/2026/06/09/123e4567-e89b-12d3-a456-426614174001.html',
        publicationDateTime: 1_765_756_800_000,
        distributionHeadline_input_en: 'Example Research Summary',
        content_input_en: 'First GIR body paragraph.',
        sourceDisplayName: 'Global Investment Research',
        tags: [],
      }), {
        headers: { 'content-type': 'application/prs.gir-search-service.v3+json;charset=UTF-8' },
      })
    ));
    vi.stubGlobal('fetch', fetchFn);

    const id = '123e4567-e89b-12d3-a456-426614174001';
    const url = `https://marquee.gs.com/content/research/en/reports/2026/06/09/${id}.html`;
    const { program } = createProgram(() => {}, {
      cookieJarPath: offlineCookieJar(),
    });
    await program.parseAsync(['content', 'view', url, '--json', 'id'], { from: 'user' });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Accept: '*/*' }),
    });
  });
});
