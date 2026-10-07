/**
 * HTTP recording: record/replay wrapper around `fetch` for Replay Lane Contract Tests.
 *
 * Keyed on method + URL + body only — auth/CSRF/cookie headers are deliberately
 * excluded so token rotation between record and replay never breaks a match.
 *
 * Record mode passes through to the real fetch and persists each response under a
 * signature-derived filename. Replay mode serves recorded responses without any
 * network access; a miss throws rather than falling back to the network.
 */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

type RecordingMode = 'record' | 'replay';
type RecordingNaming = 'hash' | 'readable';
const MAX_READABLE_RECORDING_NAME_LENGTH = 200;
const JWT_SHAPED_VALUE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const REDACTED_CREDENTIAL = 'redacted.contract.fixture.credential';
const REDACTED_JWT = 'redacted.contract.fixture.jwt';
const CREDENTIAL_FIELD_NAMES = new Set(['accesstoken', 'access_token', 'token', 'set-cookie']);

export interface RecordingOptions {
  mode: RecordingMode;
  dir: string;
  naming?: RecordingNaming | undefined;
  manifestPath?: string | undefined;
  realFetch?: typeof fetch | undefined;
}

export interface RecordingFetchOptions {
  replayDir?: string | undefined;
  recordDir?: string | undefined;
  recordNaming?: RecordingNaming | undefined;
  manifestPath?: string | undefined;
  realFetch?: typeof fetch | undefined;
}

export function createRecordingFetch(options: RecordingFetchOptions): typeof fetch | undefined {
  const { replayDir, recordDir, recordNaming, manifestPath, realFetch } = options;
  if (replayDir && recordDir) {
    return wrapFetch({
      mode: 'record',
      dir: recordDir,
      naming: recordNaming,
      manifestPath,
      realFetch: wrapFetch({ mode: 'replay', dir: replayDir }),
    });
  }
  if (replayDir) return wrapFetch({ mode: 'replay', dir: replayDir });
  if (recordDir) {
    return wrapFetch({
      mode: 'record',
      dir: recordDir,
      naming: recordNaming,
      manifestPath,
      realFetch,
    });
  }
  return undefined;
}

export function resolveRecordingRecordDir(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
): string | undefined {
  if (env.MARQUEE_HTTP_RECORD) return env.MARQUEE_HTTP_RECORD;
  if (env.MARQUEE_RECORD_LIVE && !env.MARQUEE_HTTP_REPLAY) {
    return join(env.MARQUEE_RECORD_LIVE, `cli-${pid}`);
  }
  return undefined;
}

interface RecordedResponse {
  status: number;
  contentType: string;
  body: string;
  bodyEncoding?: 'base64';
  // Redirect target, persisted so manual-redirect chains (content resolve)
  // replay with the header the resolver reads. Absent on non-redirect responses.
  location?: string;
}

interface Recording {
  request: { method: string; url: string; body?: string; signature?: string; signatureHash?: string };
  responses: RecordedResponse[];
}

export function requestSignature(
  url: string,
  init: Readonly<{ method?: string | undefined; body?: RequestInit['body'] }> = {},
): string {
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  return `${method} ${url}\n${body}`;
}

function recordingPath(dir: string, sig: string): string {
  const hash = requestSignatureHash(sig).slice(0, 16);
  // Gzipped: API payloads reach ~10MB each; compression keeps committed fixtures small.
  return join(dir, `${hash}.json.gz`);
}

function requestSignatureHash(sig: string): string {
  return createHash('sha256').update(sig).digest('hex');
}

export function readableRecordingName(url: string, init: RequestInit = {}): string {
  const method = (init.method ?? 'GET').toUpperCase();
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+/g, '_') || 'root';
  const query = parsed.search ? `_${parsed.search.slice(1)}` : '';
  const name = `${method}_${path}${query}.json.gz`;
  if (name.length <= MAX_READABLE_RECORDING_NAME_LENGTH) return name;

  const hash = createHash('sha256').update(requestSignature(url, init)).digest('hex').slice(0, 12);
  const suffix = `_${hash}.json.gz`;
  return `${name.slice(0, MAX_READABLE_RECORDING_NAME_LENGTH - suffix.length)}${suffix}`;
}

function readRecording(path: string): Recording | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf-8')) as Recording;
}

/** Record-side read that treats a corrupt/half-written file (concurrent recorder) as absent. */
function readRecordingTolerant(path: string): Recording | undefined {
  try {
    return readRecording(path);
  } catch {
    return undefined;
  }
}

function readRecordingByRequest(dir: string, sig: string): Recording | undefined {
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json.gz')) continue;
    const recording = readRecording(join(dir, name));
    if (!recording) continue;
    if (recordingMatchesSignature(recording, sig)) {
      return recording;
    }
  }
  return undefined;
}

function recordingMatchesSignature(recording: Recording, sig: string): boolean {
  if (recording.request.signatureHash) {
    return recording.request.signatureHash === requestSignatureHash(sig);
  }
  return recordingRequestSignature(recording) === sig;
}

function recordingRequestSignature(recording: Recording): string {
  return recording.request.signature ?? requestSignature(recording.request.url, {
    method: recording.request.method,
    body: recording.request.body ?? '',
  });
}

function readableRecordingNameForRequest(
  dir: string,
  url: string,
  init: RequestInit,
  sig: string,
): string {
  const baseName = readableRecordingName(url, init);
  const method = (init.method ?? 'GET').toUpperCase();
  const hasBody = sig.slice(sig.indexOf('\n') + 1).length > 0;
  if (method !== 'GET' && hasBody) {
    return appendReadableSignatureHash(baseName, sig);
  }
  const baseRecording = readRecordingTolerant(join(dir, baseName));
  if (!baseRecording || recordingMatchesSignature(baseRecording, sig)) {
    return baseName;
  }
  return appendReadableSignatureHash(baseName, sig);
}

function appendReadableSignatureHash(baseName: string, sig: string): string {
  const suffix = `_${createHash('sha256').update(sig).digest('hex').slice(0, 8)}.json.gz`;
  const stem = baseName.replace(/\.json\.gz$/, '');
  return `${stem.slice(0, MAX_READABLE_RECORDING_NAME_LENGTH - suffix.length)}${suffix}`;
}

/** Atomic write so concurrent recorders never expose a half-written file to readers. */
function atomicWrite(path: string, data: string | Buffer): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

async function toRecorded(response: Response): Promise<RecordedResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  const location = response.headers.get('location');
  const locationField = location === null ? {} : { location };
  if (isBinaryContentType(contentType)) {
    return {
      status: response.status,
      contentType,
      body: Buffer.from(await response.arrayBuffer()).toString('base64'),
      bodyEncoding: 'base64',
      ...locationField,
    };
  }
  return {
    status: response.status,
    contentType,
    body: sanitizeRecordedTextBody(contentType, await response.text()),
    ...locationField,
  };
}

export function sanitizeRecordedTextBody(contentType: string, body: string): string {
  if (!body) {
    return body;
  }

  const sanitizedText = body.replace(JWT_SHAPED_VALUE, REDACTED_JWT);
  const trimmed = body.trimStart();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!contentType.toLowerCase().includes('json') && !looksJson) {
    return sanitizedText;
  }

  try {
    const sanitized = sanitizeRecordedJson(JSON.parse(body));
    return sanitized.changed ? JSON.stringify(sanitized.value) : body;
  } catch {
    return sanitizedText;
  }
}

function sanitizeRecordedJson(value: unknown, key?: string): { value: unknown; changed: boolean } {
  const credentialKey = isCredentialField(key);
  if (typeof value === 'string') {
    const sanitized = credentialKey && value.trim() !== ''
      ? REDACTED_CREDENTIAL
      : value.replace(JWT_SHAPED_VALUE, REDACTED_JWT);
    return { value: sanitized, changed: sanitized !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const sanitized = value.map((item) => {
      const result = sanitizeRecordedJson(item, key);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: sanitized, changed };
  }
  if (!isPlainRecord(value)) {
    return { value, changed: false };
  }
  let changed = false;
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => {
      const result = sanitizeRecordedJson(entryValue, credentialKey ? key : entryKey);
      changed = changed || result.changed;
      return [entryKey, result.value];
    }),
  );
  return { value: sanitized, changed };
}

function isCredentialField(key: string | undefined): boolean {
  return key !== undefined && CREDENTIAL_FIELD_NAMES.has(key.toLowerCase());
}

function requestContentType(init: RequestInit): string {
  const headers = init.headers;
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get('content-type') ?? '';
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  }
  return Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
}

function recordedRequestBody(init: RequestInit): string {
  const body = typeof init.body === 'string' ? init.body : '';
  return body ? sanitizeRecordedTextBody(requestContentType(init), body) : '';
}

// A recording keys on the URL and init, so a Request, which carries its own method and body, has no faithful signature.
function recordedUrl(input: string | URL | Request): string {
  if (input instanceof Request) throw new Error('recording fetch takes a URL and init, not a Request');
  return String(input);
}

function recordingSignature(url: string, init: RequestInit): string {
  return requestSignature(url, {
    method: init.method,
    body: recordedRequestBody(init),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBinaryContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('text/')) return false;
  return !(
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('javascript') ||
    normalized.includes('x-www-form-urlencoded')
  );
}

function toResponse(recorded: RecordedResponse): Response {
  const body = recorded.bodyEncoding === 'base64'
    ? Buffer.from(recorded.body, 'base64')
    : recorded.body;
  return new Response(body, {
    status: recorded.status,
    headers: {
      ...(recorded.contentType ? { 'content-type': recorded.contentType } : {}),
      ...(recorded.location ? { location: recorded.location } : {}),
    },
  });
}

export function wrapFetch(opts: RecordingOptions): typeof fetch {
  const realFetch = opts.realFetch ?? fetch;

  if (opts.mode === 'record') {
    mkdirSync(opts.dir, { recursive: true });
    return (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = recordedUrl(input);
      const response = await realFetch(input, init);
      const recordedBody = recordedRequestBody(init);
      const signatureInit = { ...init, body: recordedBody };
      const sig = requestSignature(url, signatureInit);
      const recordingName = opts.naming === 'readable'
        ? readableRecordingNameForRequest(opts.dir, url, signatureInit, sig)
        : readableRecordingName(url, signatureInit);
      const path = opts.naming === 'readable'
        ? join(opts.dir, recordingName)
        : recordingPath(opts.dir, sig);
      const existing = readRecordingTolerant(path);
      const recording: Recording = existing ?? {
        request: {
          method: (init.method ?? 'GET').toUpperCase(),
          url,
          ...(recordedBody ? { body: recordedBody } : {}),
          signatureHash: requestSignatureHash(sig),
        },
        responses: [],
      };
      recording.request.signatureHash = requestSignatureHash(sig);
      delete recording.request.signature;
      if (recordedBody) {
        recording.request.body = recordedBody;
      }
      const recorded = await toRecorded(response.clone());
      recording.responses.push(recorded);
      atomicWrite(path, gzipSync(JSON.stringify(recording)));
      if (opts.manifestPath) {
        appendFileSync(opts.manifestPath, `${recordingName}\n`);
      }
      return response;
    });
  }

  const cursors = new Map<string, number>();
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = recordedUrl(input);
    const sig = recordingSignature(url, init);
    const recording = readRecording(recordingPath(opts.dir, sig))
      ?? readRecordingByRequest(opts.dir, sig);
    // Consume recorded responses in order so 401 → token-exchange → retry chains
    // (same signature, different responses) replay faithfully. Clamp at the last
    // entry; the gate's API-call-shape contract enforces call counts.
    const responses = recording?.responses ?? [];
    const idx = Math.min(cursors.get(sig) ?? 0, responses.length - 1);
    const response = responses[idx];
    if (!response) {
      throw new Error(`recording replay miss: no recorded response for ${sig}`);
    }
    cursors.set(sig, idx + 1);
    return toResponse(response);
  });
}
