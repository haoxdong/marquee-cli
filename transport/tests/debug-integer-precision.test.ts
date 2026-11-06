import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { createDebugFetch } from '../debug.js';
import { wrapFetch } from '../recording.js';

afterEach(() => { vi.restoreAllMocks(); });

it('redacts credentials without changing large integers in API diagnostics', async () => {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  const body = '{"id":9007199254740993,"token":"fixture-secret","nested":[-9007199254740993,1.234567890123456789,1e400,-0]}';
  const debugFetch = createDebugFetch(async () => new Response(body, {
    headers: { 'content-type': 'application/json' },
  }), 'api');

  const response = await debugFetch('https://marquee.gs.com/v1/integer-probe', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });

  expect(await response.text()).toBe(body);
  expect(chunks.join('')).not.toContain('fixture-secret');
  expect(chunks.join('').split('\n').filter((line) => line.startsWith('{'))).toEqual(['{"id":9007199254740993,"token":"redacted.contract.fixture.credential","nested":[-9007199254740993,1.234567890123456789,1e400,-0]}',
    '{"id":9007199254740993,"token":"redacted.contract.fixture.credential","nested":[-9007199254740993,1.234567890123456789,1e400,-0]}',
  ]);
});


it('preserves noncredential numbers in recorded API response bodies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recording-numbers-'));
  try {
    const fetchFn = wrapFetch({
      mode: 'record', dir,
      realFetch: async () => new Response('{"id":9007199254740993,"token":"fixture-secret"}', {
        headers: { 'content-type': 'application/json' },
      }),
    });
    await fetchFn('https://marquee.gs.com/v1/integer-probe');
    const [file] = await readdir(dir);
    if (!file) throw new Error('Recording was not written');
    const recorded: { responses: Array<{ body: string }> } = JSON.parse(gunzipSync(await readFile(join(dir, file))).toString());
    expect(recorded.responses[0]?.body).toBe('{"id":9007199254740993,"token":"redacted.contract.fixture.credential"}');
  } finally {
    await rm(dir, { recursive: true });
  }
});
