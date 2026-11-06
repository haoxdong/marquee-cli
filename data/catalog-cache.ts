import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Result } from '../lib/result.js';
import type { Transport } from '../transport/index.js';
import { fetchFunctionLibrary } from './adapters/catalogs.js';
import type { DataCatalogCacheFailure, DataCatalogFailure, FunctionLibrary } from './types.js';

/** How long a cached catalog serves before it is fetched again (ADR 0084). */
const TIME_TO_LIVE_MS = 24 * 60 * 60 * 1000;

// Bumped when a cached catalog's shape changes, so an older file reads as a miss.
const FORMAT_VERSION = 6;

type CatalogCache = Readonly<{
  directory: string;
  now: () => Date;
}>;

type Entry = Readonly<{ version: number; fetchedAt: string; value: unknown }>;

/**
 * A catalog from the disk cache while it is under a day old, otherwise fetched and
 * written back unless it holds a failed part, which the next run asks Marquee for again.
 * Writes go to a temporary file renamed into place, so a concurrent reader sees the old
 * file or the new one, never half of either.
 */
export async function cachedCatalog<T, E>(
  cache: CatalogCache,
  name: string,
  fetch: () => Promise<Result<T, E>>,
  isWhole: (value: T) => boolean = () => true,
): Promise<Result<T, E | DataCatalogCacheFailure>> {
  const path = join(cache.directory, `${name}.json`);
  const now = cache.now();
  const cached = readEntry(path);
  if (cached.kind === 'unreadable') {
    return { ok: false, error: { kind: 'catalog-cache-unreadable', path, problem: cached.problem } };
  }
  if (cached.kind === 'entry' && isFresh(cached.entry, now)) {
    return { ok: true, value: cached.entry.value as T };
  }
  const fetched = await fetch();
  if (!fetched.ok || !isWhole(fetched.value)) return fetched;
  const problem = writeEntry(path, { version: FORMAT_VERSION, fetchedAt: now.toISOString(), value: fetched.value });
  return problem === undefined ? fetched : { ok: false, error: { kind: 'catalog-cache-unwritable', path, problem } };
}

/** PlotTool Pro's function library, cached for a day like every catalog. */
export function cachedFunctionLibrary(
  request: Transport['request'],
  directory: string,
  now: Date,
): Promise<Result<FunctionLibrary, DataCatalogFailure>> {
  return cachedCatalog({ directory, now: () => now }, 'plottool-functions', () => fetchFunctionLibrary(request));
}

type Read =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'entry'; entry: Entry }>
  | Readonly<{ kind: 'unreadable'; problem: string }>;

function readEntry(path: string): Read {
  if (!existsSync(path)) return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { kind: 'unreadable', problem: 'expected JSON' };
  }
  if (!isEntry(parsed)) return { kind: 'unreadable', problem: 'expected version, fetchedAt and value' };
  return parsed.version === FORMAT_VERSION ? { kind: 'entry', entry: parsed } : { kind: 'missing' };
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const { version, fetchedAt } = value as Readonly<Record<string, unknown>>;
  return typeof version === 'number' && typeof fetchedAt === 'string'
    && !Number.isNaN(Date.parse(fetchedAt)) && 'value' in value;
}

function isFresh(entry: Entry, now: Date): boolean {
  const age = now.getTime() - Date.parse(entry.fetchedAt);
  return age >= 0 && age < TIME_TO_LIVE_MS;
}

// The file system's reason the entry could not be written, or undefined once it is.
function writeEntry(path: string, entry: Entry): string | undefined {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, JSON.stringify(entry));
    renameSync(temporary, path);
    return undefined;
  } catch (error) {
    /* c8 ignore next -- Unreachable: node:fs throws only Errors. */
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}
