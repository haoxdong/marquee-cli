import { CommanderError } from 'commander';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { createData, type DataConfig } from '../../../data/index.js';
import { UsageError } from '../../../presentation/index.js';
import type { Endpoint } from '../../../transport/index.js';
import { createProgram } from '../../index.js';

/** A synthetic answer saved under marquee-cli/data/tests/fixtures (ADR 0043). */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    fileURLToPath(new URL(`../../../data/tests/fixtures/${name}`, import.meta.url)),
    'utf8',
  ));
}

type SentRequest = Readonly<{
  method: string;
  path: string;
  query?: Readonly<Record<string, unknown>>;
  body?: unknown;
}>;

type RequestInit = Readonly<{ query?: Readonly<Record<string, unknown>>; body?: unknown }>;

/**
 * PlotTool Pro's function library, trimmed to the Classes search finds; each Class and its
 * Measures as the live library lists them (2026-10-22), their descriptions synthetic.
 */
export const SEARCH_LIBRARY = fixture('search-plots-functions.json');

const NO_ROWS = { totalResults: 0, results: [] };

/**
 * An answer to PlotTool Web's bare-word search: `answer`'s types, and none of the other types'
 * rows, each under the key Marquee answers it with.
 */
export function entityAnswer(answer: Readonly<Record<string, unknown>>): unknown {
  return { countries: NO_ROWS, kpis: NO_ROWS, portfolios: NO_ROWS, riskModel: NO_ROWS, subdivisions: NO_ROWS, ...answer };
}

type Answer = (endpoint: Endpoint, init: RequestInit) => unknown;

/** Answers each request by its `METHOD /path`: a function is called, an Error thrown, anything else returned. */
export function byEndpoint(answers: Readonly<Record<string, unknown>>): Answer {
  return (endpoint, init) => {
    const answer = answers[`${endpoint.method} ${endpoint.path}`];
    if (answer === undefined) throw new Error(`unexpected request: ${endpoint.method} ${endpoint.path}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? (answer as Answer)(endpoint, init) : answer;
  };
}

/** The clock Scenarios pin through `as_of`; the Haver search window counts back a year from it. */
const SEARCH_NOW = new Date('2026-10-17T12:00:00Z');

/** Runs `marquee data search <args>` against `answer`, as an agent would see it. */
export function runDataSearch(
  args: readonly string[],
  answer: (endpoint: Endpoint, init: RequestInit) => unknown,
  config: DataOverrides = {},
) {
  return runData(['search', ...args], answer, config);
}

/** What a test may set besides the transport, clock and cache. */
type DataOverrides = Omit<DataConfig, 'request' | 'now' | 'cacheDirectory'>;

/** Runs `marquee data <args>` against `answer`, as an agent would see it. */
export async function runData(
  args: readonly string[],
  answer: (endpoint: Endpoint, init: RequestInit) => unknown,
  config: DataOverrides = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sent: SentRequest[] = [];
  const request = vi.fn(async (endpoint: Endpoint, init: RequestInit = {}) => {
    sent.push({
      method: endpoint.method,
      path: endpoint.path,
      ...(init.query === undefined ? {} : { query: init.query }),
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    return answer(endpoint, init);
  });
  const { program } = createProgram((chunk) => stdout.push(chunk), {
    // Each run starts with an empty catalog cache, as each Scenario does under Replay.
    data: createData({
      ...config,
      request,
      now: () => SEARCH_NOW,
      cacheDirectory: mkdtempSync(join(tmpdir(), 'marquee-data-search-')),
    }),
    writeError: (chunk) => stderr.push(chunk),
  });
  try {
    await program.parseAsync(['data', ...args], { from: 'user' });
  } catch (error) {
    // Commander and the command reject usage by throwing once they have written.
    if (!(error instanceof CommanderError || error instanceof UsageError)) throw error;
    process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
  }
  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: process.exitCode, sent };
}
