import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../cli-composition/index.js';
import { resolve } from 'node:path';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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
      cookieJarPath: resolve('tests/fixtures/offline-cookie-jar.json'),
    });
    await program.parseAsync(['content', 'view', url, '--json', 'id'], { from: 'user' });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Accept: '*/*' }),
    });
  });
});
