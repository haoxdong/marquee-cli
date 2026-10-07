import { raw as runJq } from 'jq-wasm/inline';
import type { ArtifactRef } from '../artifact-registry/index.js';

export const CLI_EXIT_CODES = {
  success: 0,
  failure: 1,
  cancelled: 2,
  authRequired: 4,
} as const;

export type JsonOutputOptions = Readonly<{
  json?: boolean | string;
  jq?: string;
}>;

export type JsonOutputResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type Writer = (chunk: string) => void;

export function artifactOwnerCommandPath(ref: ArtifactRef): string {
  if (ref.type === 'widget') return 'marquee marketview widget view';
  if (ref.type === 'section') return 'marquee marketview dashboard edit';
  if (ref.type === 'dashboard' || ref.type === 'entity-feed') {
    return 'marquee marketview dashboard view';
  }
  if (ref.type === 'document') return 'marquee content view';
  return ref.searchKind === 'market-data'
    ? 'marquee marketview search'
    : 'marquee content search';
}

export function formatWrongArtifactRefGuidance(ref: ArtifactRef): string {
  return ` — use \`${artifactOwnerCommandPath(ref)} ...\``;
}


const JQ_TRANSLATION_EXAMPLE = 'JavaScript-to-jq example: data.at(-1).value → .data[-1].value';

export function writeLine(write: Writer, line: string): void {
  write(line.endsWith('\n') ? line : `${line}\n`);
}

function requestedFields(json: string): string[] {
  return [...new Set(json.split(',').map((field) => field.trim()).filter(Boolean))];
}

function fieldList(fields: readonly string[]): string {
  return [...fields].sort().map((field) => `  ${field}`).join('\n');
}

/** gh's `--json`/`--jq` usage error for a command with these `--json` fields. */
export function jsonFieldsError(
  options: JsonOutputOptions,
  fields: readonly string[],
): string | undefined {
  if (options.json === undefined) {
    return options.jq === undefined ? undefined : 'cannot use `--jq` without specifying `--json`';
  }
  const requested = typeof options.json === 'string' ? requestedFields(options.json) : [];
  if (requested.length === 0) {
    return `Specify one or more comma-separated fields for \`--json\`:\n${fieldList(fields)}`;
  }
  const unknown = requested.find((field) => !fields.includes(field));
  return unknown === undefined
    ? undefined
    : `Unknown JSON field: ${JSON.stringify(unknown)}\nAvailable fields:\n${fieldList(fields)}`;
}

export type JsonRecord = Readonly<Record<string, unknown>>;

function project(record: JsonRecord, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries([...fields].sort().map((field) => [field, record[field] ?? null]));
}

function jqError(stderr: string): string {
  const detail = stderr.trim().replace(/\s+/g, ' ');
  return `${detail || 'jq evaluation failed'}; ${JQ_TRANSLATION_EXAMPLE}`;
}

/**
 * gh's `--json a,b` output: the named fields of one record, or of each record
 * of a list, keys sorted and compact. `--jq` prints strings bare and other
 * values as compact JSON, one per line.
 */
export async function formatJsonFields(
  value: JsonRecord | readonly JsonRecord[],
  options: JsonOutputOptions,
): Promise<JsonOutputResult> {
  // The --json option hook rejects bare `--json` before any action runs.
  if (typeof options.json !== 'string') throw new Error('formatJsonFields requires --json fields');
  const fields = requestedFields(options.json);
  const projected = isRecordList(value)
    ? value.map((record) => project(record, fields))
    : project(value, fields);
  if (options.jq === undefined) return { ok: true, output: JSON.stringify(projected) };
  try {
    const result = await runJq(projected, options.jq, ['-r', '-c']);
    if (result.exitCode !== 0) return { ok: false, error: jqError(result.stderr) };
    return { ok: true, output: result.stdout.trimEnd() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: jqError(message) };
  }
}

function isRecordList(value: JsonRecord | readonly JsonRecord[]): value is readonly JsonRecord[] {
  return Array.isArray(value);
}
