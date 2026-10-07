import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readableRecordingName, requestSignature, wrapFetch } from '../recording.js';

function tmpRecordingDir(): string {
  return mkdtempSync(join(tmpdir(), 'recording-test-'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function binaryResponse(bytes: Uint8Array, contentType = 'application/pdf'): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('requestSignature', () => {
  it('is stable across calls and ignores volatile auth headers', () => {
    const a = requestSignature('https://marquee.gs.com/v1/marketview/widgets/MW1', {
      method: 'GET',
      headers: { Authorization: 'Bearer token-one', Cookie: 'sid=aaa', 'X-MARQUEE-CSRF-TOKEN': 'csrf-1' },
    });
    const b = requestSignature('https://marquee.gs.com/v1/marketview/widgets/MW1', {
      method: 'GET',
      headers: { Authorization: 'Bearer token-two', Cookie: 'sid=bbb', 'X-MARQUEE-CSRF-TOKEN': 'csrf-2' },
    });

    expect(a).toBe(b);
  });

  it('distinguishes by method, url, and body', () => {
    const base = 'https://marquee.gs.com/v1/configurations';
    const get = requestSignature(base, { method: 'GET' });
    const post = requestSignature(base, { method: 'POST' });
    const otherUrl = requestSignature(base + '/other', { method: 'GET' });
    const bodyA = requestSignature(base, { method: 'POST', body: JSON.stringify({ id: 'A' }) });
    const bodyB = requestSignature(base, { method: 'POST', body: JSON.stringify({ id: 'B' }) });

    expect(new Set([get, post, otherUrl, bodyA, bodyB]).size).toBe(5);
  });
});

describe('readableRecordingName', () => {
  it('keeps long query filenames below common filesystem limits with a stable hash suffix', () => {
    const ids = Array.from({ length: 50 }, (_, index) => `ids=MA${String(index).padStart(14, '0')}`).join('&');
    const name = readableRecordingName(`https://marquee.gs.com/v1/plots/entities?${ids}&type=Asset`);

    expect(name.length).toBeLessThanOrEqual(200);
    expect(name).toMatch(/^GET_v1_plots_entities_/);
    expect(name).toMatch(/_[a-f0-9]{12}\.json\.gz$/);
  });
});

describe('wrapFetch — record', () => {
  it('rejects a Request input in record and replay, since its signature would ignore its method and body', async () => {
    const dir = tmpRecordingDir();
    try {
      const realFetch = vi.fn();
      const recorder = wrapFetch({ mode: 'record', dir, realFetch });
      const player = wrapFetch({ mode: 'replay', dir });
      const request = new Request('https://marquee.gs.com/v1/users/self');

      await expect(recorder(request)).rejects.toThrow('recording fetch takes a URL and init, not a Request');
      await expect(player(request)).rejects.toThrow('recording fetch takes a URL and init, not a Request');
      expect(realFetch).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls the real fetch, returns its response unconsumed, and writes a recording', async () => {
    const dir = tmpRecordingDir();
    try {
      const realFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      const fetchFn = wrapFetch({ mode: 'record', dir, realFetch: realFetch });

      const res = await fetchFn('https://marquee.gs.com/v1/users/self', { method: 'GET' });

      expect(realFetch).toHaveBeenCalledTimes(1);
      // The caller must still be able to read the body — recording must not consume it.
      expect(await res.json()).toEqual({ ok: true });
      expect(readdirSync(dir).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates a pre-existing corrupt recording (concurrent torn read) and overwrites it', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/users/self';
      // Simulate a half-written file from a racing recorder process.
      const hash = createHash('sha256').update(requestSignature(url, { method: 'GET' })).digest('hex').slice(0, 16);
      writeFileSync(join(dir, `${hash}.json.gz`), 'not-valid-gzip-bytes');

      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        realFetch: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
      });
      const res = await fetchFn(url, { method: 'GET' });
      expect(await res.json()).toEqual({ ok: true });

      // The corrupt file was replaced with a valid recording — verify via replay.
      const player = wrapFetch({ mode: 'replay', dir });
      const replayed = await player(url, { method: 'GET' });
      expect(await replayed.json()).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves redirect status and location header for record and replay', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/research/services/documentRedirect?id=doc-1';
      const redirect = new Response(null, {
        status: 301,
        headers: { location: '../content/markets/en/2026/06/10/doc-1.html' },
      });
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        realFetch: vi.fn().mockResolvedValue(redirect),
      });

      const recorded = await fetchFn(url, { method: 'GET' });
      expect(recorded.status).toBe(301);

      const player = wrapFetch({ mode: 'replay', dir });
      const replayed = await player(url, { method: 'GET' });
      expect(replayed.status).toBe(301);
      expect(replayed.headers.get('location')).toBe('../content/markets/en/2026/06/10/doc-1.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves binary response bytes for record and replay', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/content/research/en/reports/doc.pdf';
      const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00, 0x0a]);
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        realFetch: vi.fn().mockResolvedValue(binaryResponse(bytes)),
      });

      const recorded = await fetchFn(url, { method: 'GET' });
      expect(Array.from(new Uint8Array(await recorded.arrayBuffer()))).toEqual(Array.from(bytes));

      const player = wrapFetch({ mode: 'replay', dir });
      const replayed = await player(url, { method: 'GET' });
      expect(Array.from(new Uint8Array(await replayed.arrayBuffer()))).toEqual(Array.from(bytes));
      expect(replayed.headers.get('content-type')).toContain('application/pdf');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scrubs JWT-shaped values and credential fields in recordings without consuming the live response', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/research/session-exchange';
      const jwt = `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`;
      const liveBody = {
        accessToken: jwt,
        access_token: 'opaque-research-token',
        expiryInMillis: 999_999,
        nested: {
          token: 'opaque-session-token',
          message: `Bearer ${jwt}`,
          headers: {
            'set-cookie': `MarqueeIdToken=${jwt}; Path=/`,
          },
        },
        profile: 'keep',
      };
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        naming: 'readable',
        realFetch: vi.fn().mockResolvedValue(jsonResponse(liveBody)),
      });

      const response = await fetchFn(url, { method: 'GET' });

      expect(await response.json()).toEqual(liveBody);
      const recording = JSON.parse(
        gunzipSync(readFileSync(join(dir, 'GET_research_session-exchange.json.gz'))).toString('utf8'),
      ) as { responses: Array<{ body: string }> };
      const recorded = JSON.parse(recording.responses[0].body) as Record<string, unknown>;
      expect(recorded).toEqual({
        accessToken: 'redacted.contract.fixture.credential',
        access_token: 'redacted.contract.fixture.credential',
        expiryInMillis: 999_999,
        nested: {
          token: 'redacted.contract.fixture.credential',
          message: 'Bearer redacted.contract.fixture.jwt',
          headers: {
            'set-cookie': 'redacted.contract.fixture.credential',
          },
        },
        profile: 'keep',
      });

      const player = wrapFetch({ mode: 'replay', dir });
      const replayed = await player(url, { method: 'GET' });
      expect(await replayed.json()).toEqual(recorded);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scrubs credential fields from recorded request body metadata without changing replay matching', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/content/feed/article/id';
      const jwt = `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`;
      const requestBody = JSON.stringify({
        accessToken: jwt,
        nested: {
          token: 'opaque-request-token',
          note: `Bearer ${jwt}`,
        },
      });
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        naming: 'readable',
        realFetch: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
      });

      await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
      });

      const recordingFile = readdirSync(dir).find((name) => name.endsWith('.json.gz'));
      expect(recordingFile).toBeDefined();
      const recording = JSON.parse(
        gunzipSync(readFileSync(join(dir, recordingFile as string))).toString('utf8'),
      ) as { request: { body?: string } };
      expect(JSON.stringify(recording)).not.toContain(jwt);
      expect(recording.request.body).toBe(JSON.stringify({
        accessToken: 'redacted.contract.fixture.credential',
        nested: {
          token: 'redacted.contract.fixture.credential',
          note: 'Bearer redacted.contract.fixture.jwt',
        },
      }));

      const player = wrapFetch({ mode: 'replay', dir });
      const replayed = await player(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
      });
      expect(await replayed.json()).toEqual({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scrubs nested strings inside structured credential fields', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/research/session-exchange';
      const liveBody = {
        accessToken: {
          value: 'opaque-session-token',
          chain: ['nested-session-token'],
          empty: '',
        },
        profile: {
          value: 'keep',
        },
      };
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        naming: 'readable',
        realFetch: vi.fn().mockResolvedValue(jsonResponse(liveBody)),
      });

      await fetchFn(url, { method: 'GET' });

      const recording = JSON.parse(
        gunzipSync(readFileSync(join(dir, 'GET_research_session-exchange.json.gz'))).toString('utf8'),
      ) as { responses: Array<{ body: string }> };
      expect(JSON.parse(recording.responses[0].body)).toEqual({
        accessToken: {
          value: 'redacted.contract.fixture.credential',
          chain: ['redacted.contract.fixture.credential'],
          empty: '',
        },
        profile: {
          value: 'keep',
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves blank credential fields so replay keeps missing-auth semantics', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/research/session-exchange';
      const liveBody = {
        accessToken: '',
        access_token: '   ',
        nested: {
          token: '\t',
        },
      };
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        naming: 'readable',
        realFetch: vi.fn().mockResolvedValue(jsonResponse(liveBody)),
      });

      await fetchFn(url, { method: 'GET' });

      const recording = JSON.parse(
        gunzipSync(readFileSync(join(dir, 'GET_research_session-exchange.json.gz'))).toString('utf8'),
      ) as { responses: Array<{ body: string }> };
      expect(JSON.parse(recording.responses[0].body)).toEqual(liveBody);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes readable scenario recording names and a manifest when requested', async () => {
    const dir = tmpRecordingDir();
    try {
      const manifestPath = join(dir, '.recordings.jsonl');
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        naming: 'readable',
        manifestPath,
        realFetch: vi.fn().mockResolvedValue(jsonResponse({ title: 'Readable' })),
      });

      await fetchFn('https://marquee.gs.com/v1/marketview/widgets/MW1?mergeParams=true&context=WC1', {
        method: 'GET',
      });

      expect(readdirSync(dir).sort()).toEqual([
        '.recordings.jsonl',
        'GET_v1_marketview_widgets_MW1_mergeParams=true&context=WC1.json.gz',
      ]);
      expect(readFileSync(manifestPath, 'utf8').trim()).toBe(
        'GET_v1_marketview_widgets_MW1_mergeParams=true&context=WC1.json.gz',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes distinct readable POST recordings when request bodies differ', async () => {
    const dir = tmpRecordingDir();
    try {
      const manifestPath = join(dir, '.recordings.jsonl');
      const url = 'https://marquee.gs.com/v1/plots/runner';
      const realFetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ title: 'Body A' }))
        .mockResolvedValueOnce(jsonResponse({ title: 'Body B' }));
      const fetchFn = wrapFetch({
        mode: 'record',
        dir,
        naming: 'readable',
        manifestPath,
        realFetch: realFetch,
      });

      await fetchFn(url, { method: 'POST', body: JSON.stringify({ variables: { cross: 'AUDJPY' } }) });
      await fetchFn(url, { method: 'POST', body: JSON.stringify({ variables: { cross: 'USDJPY' } }) });

      const recordings = readdirSync(dir).filter((name) => name.endsWith('.json.gz')).sort();
      const manifest = readFileSync(manifestPath, 'utf8').trim().split('\n').sort();
      expect(recordings).toHaveLength(2);
      expect(new Set(recordings).size).toBe(2);
      expect(recordings.every((name) => /^POST_v1_plots_runner_[a-f0-9]{8}\.json\.gz$/.test(name))).toBe(true);
      expect(manifest).toEqual(recordings);

      const player = wrapFetch({ mode: 'replay', dir });
      const replayed = await player(url, {
        method: 'POST',
        body: JSON.stringify({ variables: { cross: 'USDJPY' } }),
      });
      expect(await replayed.json()).toEqual({ title: 'Body B' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can materialize readable recordings from a replay-backed fetch', async () => {
    const sourceDir = tmpRecordingDir();
    const targetDir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/marketview/widgets/MW1?mergeParams=true&context=WC1';
      const liveFetch = vi.fn().mockResolvedValue(jsonResponse({ title: 'From replay' }));
      const sourceRecorder = wrapFetch({
        mode: 'record',
        dir: sourceDir,
        realFetch: liveFetch,
      });
      await sourceRecorder(url, { method: 'GET' });

      const replayFetch = wrapFetch({ mode: 'replay', dir: sourceDir });
      const manifestPath = join(targetDir, '.recordings.jsonl');
      const targetRecorder = wrapFetch({
        mode: 'record',
        dir: targetDir,
        naming: 'readable',
        manifestPath,
        realFetch: replayFetch,
      });

      const response = await targetRecorder(url, { method: 'GET' });

      expect(liveFetch).toHaveBeenCalledTimes(1);
      expect(await response.json()).toEqual({ title: 'From replay' });
      expect(readdirSync(targetDir).sort()).toEqual([
        '.recordings.jsonl',
        'GET_v1_marketview_widgets_MW1_mergeParams=true&context=WC1.json.gz',
      ]);

      const replayedReadable = wrapFetch({ mode: 'replay', dir: targetDir });
      expect(await (await replayedReadable(url, { method: 'GET' })).json()).toEqual({ title: 'From replay' });
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});

describe('wrapFetch — replay', () => {
  it('serves the recorded response without touching the network', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/marketview/widgets/MW1';
      const init: RequestInit = { method: 'GET', headers: { Authorization: 'Bearer recorded' } };

      const recorder = wrapFetch({
        mode: 'record',
        dir,
        realFetch: vi.fn().mockResolvedValue(jsonResponse({ title: 'CPI' })),
      });
      await recorder(url, init);

      // Replay with a different auth header and a fetch that would throw if called.
      const liveFetch = vi.fn(() => { throw new Error('network used during replay'); });
      const player = wrapFetch({ mode: 'replay', dir, realFetch: liveFetch });
      const res = await player(url, { method: 'GET', headers: { Authorization: 'Bearer rotated' } });

      expect(liveFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ title: 'CPI' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves readable named recordings by request metadata', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/marketview/widgets/MW1?mergeParams=true';
      const recorder = wrapFetch({
        mode: 'record',
        dir,
        realFetch: vi.fn().mockResolvedValue(jsonResponse({ title: 'Readable' })),
      });
      await recorder(url, { method: 'GET' });
      const [hashName] = readdirSync(dir);
      renameSync(join(dir, hashName), join(dir, 'GET_v1_marketview_widgets_MW1_mergeParams=true.json.gz'));

      const liveFetch = vi.fn(() => { throw new Error('network used during replay'); });
      const player = wrapFetch({ mode: 'replay', dir, realFetch: liveFetch });
      const res = await player(url, { method: 'GET' });

      expect(liveFetch).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ title: 'Readable' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not replay a readable named POST recording for a different request body', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/plots/runner';
      const recorder = wrapFetch({
        mode: 'record',
        dir,
        realFetch: vi.fn().mockResolvedValue(jsonResponse({ title: 'Body A' })),
      });
      await recorder(url, { method: 'POST', body: JSON.stringify({ variables: { cross: 'AUDJPY' } }) });
      const [hashName] = readdirSync(dir);
      renameSync(join(dir, hashName), join(dir, 'POST_v1_plots_runner.json.gz'));

      const player = wrapFetch({ mode: 'replay', dir });

      await expect(player(url, { method: 'POST', body: JSON.stringify({ variables: { cross: 'USDJPY' } }) }))
        .rejects.toThrow(/replay miss/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on a miss instead of reaching the network', async () => {
    const dir = tmpRecordingDir();
    try {
      const liveFetch = vi.fn(() => { throw new Error('network used during replay'); });
      const player = wrapFetch({ mode: 'replay', dir, realFetch: liveFetch });

      await expect(player('https://marquee.gs.com/v1/unrecorded', { method: 'GET' }))
        .rejects.toThrow(/replay miss/);
      expect(liveFetch).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replays duplicate signatures in recorded order (401 → retry chains)', async () => {
    const dir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/marketview/widgets/MW1';
      const realFetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ step: 'first' }, 401))
        .mockResolvedValueOnce(jsonResponse({ step: 'second' }, 200));
      const recorder = wrapFetch({ mode: 'record', dir, realFetch: realFetch });
      await recorder(url, { method: 'GET' });
      await recorder(url, { method: 'GET' });

      const player = wrapFetch({ mode: 'replay', dir });
      const first = await player(url, { method: 'GET' });
      const second = await player(url, { method: 'GET' });

      expect(first.status).toBe(401);
      expect(await first.json()).toEqual({ step: 'first' });
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ step: 'second' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
