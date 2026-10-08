import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifactRegistry } from '../../../artifact-registry/index.js';
import { createControlGroupModule } from '../../../control-group/index.js';
import { createEntityModule } from '../../../entity/index.js';
import { registerMarketviewCommands } from '../marketview.js';
import { createTransport } from '../../../transport/index.js';
import { createMarketView } from '../../../marketview/index.js';
import { emptySearchResponse, keywordResponse } from '../../adapters/tests/search-response-fixture.js';

const keywordTypes = 'widget,thematic-dashboard,asset-dashboard,country-dashboard,portfolio-dashboard';
function unexpected(): never { throw new Error('unexpected dependency'); }

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  process.exitCode = undefined;
});

function harness(response: () => Promise<Response> = async () => keywordResponse()) {
  const directory = mkdtempSync(join(tmpdir(), 'marketview-search-boundary-'));
  directories.push(directory);
  const requests: string[] = [];
  const transport = createTransport({
    execution: 'direct',
    authentication: { cookieJarPath: '/dev/null', jar: { cookies: [{ name: 'MarqueeIdToken', value: 'unit-test-only', domain: 'marquee.gs.com', path: '/', secure: true }], updatedAt: 0 }, persistCookies: false },
    fetchFn: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      return response();
    },
  });
  const registry = createArtifactRegistry(directory, 'search-boundary');
  const marketView = createMarketView({
    registry,
    searchRequester: transport.provider({ owner: 'marketview-search' }),
    dashboardPreferencesRequester: { request: async () => unexpected() },
    controlGroup: createControlGroupModule({ request: async () => unexpected() }),
    entity: createEntityModule({ request: async () => unexpected() }),
    dashboard: { get: async () => unexpected(), edit: async () => unexpected(), create: async () => unexpected() },
    entityFeed: { get: async () => unexpected() },
    readEntityFeedPage: async () => unexpected(),
    widgetTransport: { request: async () => unexpected() },
    widget: { get: async () => unexpected(), render: async () => unexpected() },
  });
  const output: string[] = [];
  const errors: string[] = [];
  const program = new Command();
  registerMarketviewCommands(program, {
    getMarketView: () => marketView,
    write: (text) => { output.push(text); },
    writeError: (text) => { errors.push(text); },
  });
  return { requests, output, errors, registry, run: (args: string[]) => program.parseAsync(['marketview', 'search', 'oil vol', '-L', '10', ...args], { from: 'user' }) };
}

const keywordRequest = 'GET https://marquee.gs.com/v1/marketview/search?query=oil+vol&types=Widget&types=Dashboard&types=Asset&types=Country&types=Portfolio&limit=10&useNewSchema=false&combineSearchResults=false';

describe('production MarketView keyword request boundary', () => {
  it.each([{ args: [] }, { args: ['--type', keywordTypes] }])('returns Dashboard output with one keyword request for $args', async ({ args }) => {
    const subject = harness();
    await subject.run(args);
    expect(subject.errors).toEqual([]);
    expect(subject.output.join('')).toContain('Oil volatility');
    expect(subject.output.join('')).toContain('@s1.d1');
    expect(subject.registry.getPayload('s1')).toMatchObject({ query: 'oil vol' });
    expect(subject.requests).toEqual([keywordRequest]);
  });

  it('never hides a second provider call when a default response takes more than the hedge delay', async () => {
    const subject = harness(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return keywordResponse();
    });
    await subject.run([]);
    expect(subject.output.join('')).toContain('Oil volatility');
    expect(subject.requests).toEqual([keywordRequest]);
  });

  it('refuses failed discovery without producing partial output or an artifact', async () => {
    const subject = harness(async () => Response.json({ message: 'Service unavailable' }, { status: 503 }));
    await subject.run([]);
    expect(subject.errors.join('')).toContain('Error:');
    expect(subject.output).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(subject.registry.getPayload('s1')).toBeUndefined();
    expect(subject.requests).toEqual([keywordRequest]);
  });

  it.each([
    { name: 'transient HTML', response: () => new Response('<html><body>upstream unavailable</body></html>', { headers: { 'content-type': 'text/html' } }), exitCode: 1 },
    { name: 'expired authentication', response: () => Response.json({ message: 'Unauthorized' }, { status: 401 }), exitCode: 4 },
  ])('refuses $name after one actual request', async ({ response, exitCode }) => {
    const subject = harness(async () => response());
    await subject.run([]);
    expect(subject.errors.join('')).toContain('Error:');
    expect(subject.output).toEqual([]);
    expect(process.exitCode).toBe(exitCode);
    expect(subject.registry.getPayload('s1')).toBeUndefined();
    expect(subject.requests).toEqual([keywordRequest]);
  });

  it.each([
    ['widget-semantic', 'Widget+LLM', 'false'],
    ['widget-hybrid', 'Widget&types=Widget+LLM&types=Widget+Ranked', 'true'],
  ])('preserves explicit %s provider mode', async (type, types, schema) => {
    const subject = harness(async () => emptySearchResponse());
    await subject.run(['--type', type]);
    expect(subject.errors.join('')).toBe('no widgets match "oil vol"\n');
    expect(subject.requests).toEqual([`GET https://marquee.gs.com/v1/marketview/search?query=oil+vol&types=${types}&limit=10&useNewSchema=${schema}&combineSearchResults=false`]);
  });

  it('rejects invalid public input before a provider call', async () => {
    const subject = harness();
    await subject.run(['--type', 'Dashboard LLM']);
    expect(subject.errors.join('')).toContain('Unknown marketview search type "Dashboard LLM"');
    expect(subject.requests).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});
