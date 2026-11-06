import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { vi } from 'vitest';
import { packageRoot } from '../../lib/tests/package-root.js';
import { MarqueeError, type Endpoint } from '../../transport/index.js';

/** A response: its HTTP status and body text. */
export type Answer = Readonly<{ status: number; body: string }>;

type SavedExchange = Readonly<{ requestBody?: unknown; status: number; body: unknown }>;

/**
 * A synthetic exchange under `data/tests/fixtures`, shaped as Marquee answers and trimmed to
 * the fields the module reads (ADR 0043).
 */
export function fixture(name: string): Answer & Readonly<{ requestBody: unknown }> {
  const exchange = JSON.parse(readFileSync(
    resolve(packageRoot, 'data/tests/fixtures', name),
    'utf8',
  )) as SavedExchange;
  return { status: exchange.status, body: JSON.stringify(exchange.body), requestBody: exchange.requestBody };
}

export type Route = Answer | ((body: unknown, query?: Readonly<Record<string, unknown>>) => Answer);

/**
 * Answers each `METHOD /path` as the transport does: a 2xx resolves with the parsed body,
 * any other status rejects with the classified error carrying the whole body, and a
 * request with no route fails the test.
 */
export function marquee(routes: Readonly<Record<string, Route>>) {
  return vi.fn(async (
    endpoint: Endpoint,
    init?: Readonly<{ body?: unknown; query?: Readonly<Record<string, unknown>> }>,
  ): Promise<unknown> => {
    const key = `${endpoint.method} ${endpoint.path}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Unexpected request: ${key}`);
    const answer = typeof route === 'function' ? route(init?.body, init?.query) : route;
    if (answer.status < 300) return JSON.parse(answer.body);
    throw new MarqueeError('http', `Marquee returned ${answer.status} for ${endpoint.path}`, {
      status: answer.status,
      path: endpoint.path,
      body: answer.body,
      responseClassification: 'http_status',
    });
  });
}

/** Each request sent, as `METHOD /path`. */
export function sentRequests(request: ReturnType<typeof marquee>): string[] {
  return request.mock.calls.map(([endpoint]) => `${endpoint.method} ${endpoint.path}`);
}

/** A function library shaped as `GET /v1/plots/functions` answers. */
export const FUNCTIONS = 'GET /v1/plots/functions';

export function functionLibrary(): Answer {
  return fixture('plots-functions.json');
}

/** The chart every eval that reaches the runner saves its Expressions as. */
export const CHART = 'POST /v1/charts';

/** A chart saved, shaped as `POST /v1/charts` answers. */
export function savedChart(): Answer {
  return fixture('chart-created.json');
}

/** A fresh, empty catalog cache directory. */
export function cacheDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'marquee-data-catalogs-'));
}
