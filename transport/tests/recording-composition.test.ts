import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRecordingFetch,
  resolveRecordingRecordDir,
  wrapFetch,
} from '../recording.js';

function tmpRecordingDir(): string {
  return mkdtempSync(join(tmpdir(), 'program-recording-'));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createRecordingFetch', () => {
  it('records readable recordings from a replay-backed source when both dirs are set', async () => {
    const replayDir = tmpRecordingDir();
    const recordDir = tmpRecordingDir();
    try {
      const url = 'https://marquee.gs.com/v1/marketview/widgets/MW1?mergeParams=true';
      const liveFetch = vi.fn().mockResolvedValue(jsonResponse({ title: 'Recorded once' }));
      const sourceRecorder = wrapFetch({
        mode: 'record',
        dir: replayDir,
        realFetch: liveFetch,
      });
      await sourceRecorder(url, { method: 'GET' });

      const fetchFn = createRecordingFetch({
        replayDir,
        recordDir,
        recordNaming: 'readable',
      });

      assert(fetchFn);
      const response = await fetchFn(url, { method: 'GET' });

      expect(await response.json()).toEqual({ title: 'Recorded once' });
      expect(liveFetch).toHaveBeenCalledTimes(1);
      expect(readdirSync(recordDir)).toEqual([
        'GET_v1_marketview_widgets_MW1_mergeParams=true.json.gz',
      ]);
    } finally {
      rmSync(replayDir, { recursive: true, force: true });
      rmSync(recordDir, { recursive: true, force: true });
    }
  });
});

describe('resolveRecordingRecordDir (record-while-live)', () => {
  it('prefers an explicit MARQUEE_HTTP_RECORD (scenario runner / re-record)', () => {
    expect(resolveRecordingRecordDir({ MARQUEE_HTTP_RECORD: '/x/scenario/step-1' }, 4242))
      .toBe('/x/scenario/step-1');
  });

  it('falls back to a per-process subdir under MARQUEE_RECORD_LIVE so non-scenario CLI entries still record', () => {
    // Covers CLI entries spawned without the scenario runner.
    expect(resolveRecordingRecordDir({ MARQUEE_RECORD_LIVE: '/live' }, 4242))
      .toBe('/live/cli-4242');
  });

  it('keys the fallback per process, so concurrent CLI invocations never share a recording dir', () => {
    const a = resolveRecordingRecordDir({ MARQUEE_RECORD_LIVE: '/live' }, 1);
    const b = resolveRecordingRecordDir({ MARQUEE_RECORD_LIVE: '/live' }, 2);
    expect(a).not.toBe(b);
  });

  it('never records while replaying, and is a no-op when neither var is set', () => {
    expect(resolveRecordingRecordDir({ MARQUEE_RECORD_LIVE: '/live', MARQUEE_HTTP_REPLAY: '/rec' }, 4242))
      .toBeUndefined();
    expect(resolveRecordingRecordDir({}, 4242)).toBeUndefined();
  });
});
