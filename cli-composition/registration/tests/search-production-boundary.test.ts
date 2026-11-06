import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { createReferentRegistry } from '../../../referent-registry/index.js';
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

function harness(
  response: () => Promise<Response> = async () => keywordResponse(),
  membership: () => Promise<Response> = async () => Response.json({ children: [{ type: 'Widget' }, { type: 'Text' }] }),
) {
  const directory = mkdtempSync(join(tmpdir(), 'marketview-search-boundary-'));
  directories.push(directory);
  const requests: string[] = [];
  const transport = createTransport({
    execution: 'direct',
    authentication: { cookieJarPath: '/dev/null', jar: { cookies: [{ name: 'MarqueeIdToken', value: 'unit-test-only', domain: 'marquee.gs.com', path: '/', secure: true }], updatedAt: 0 }, persistCookies: false },
    fetchFn: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      const path = new URL(url).pathname;
      if (path === '/v1/marketview/search') return response();
      if (path === '/v1/marketview/dashboards/MD_OIL') return membership();
      if (path === '/tokenExchange') return Response.json({ message: 'Unauthorized' }, { status: 401 });
      return unexpected();
    },
  });
  const registry = createReferentRegistry(directory, 'search-boundary');
  const marketView = createMarketView({
    registry,
    searchRequester: transport.provider({ owner: 'marketview-search' }),
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

const dashboardRequest = 'GET https://marquee.gs.com/v1/marketview/dashboards/MD_OIL?expand=true';

describe('production MarketView keyword request boundary', () => {
  it.each([{ args: [] }, { args: ['--type', keywordTypes] }])('returns Dashboard output with one keyword request for $args', async ({ args }) => {
    const subject = harness();
    await subject.run(args);
    expect(subject.errors).toEqual([]);
    expect(subject.output.join('')).toContain('Oil volatility');
    expect(subject.output.join('')).toContain('@s1.d1');
    expect(subject.registry.getPayload('s1')).toMatchObject({ query: 'oil vol' });
    expect(subject.requests).toEqual([keywordRequest, dashboardRequest]);
    expect(subject.output.join('')).toContain('1 widgets');
  });

  it.each([
    { name: 'unavailable discovery', response: () => Response.json({ message: 'Service unavailable' }, { status: 503 }), exitCode: 1 },
    { name: 'transient HTML', response: () => new Response('<html><body>upstream unavailable</body></html>', { headers: { 'content-type': 'text/html' } }), exitCode: 1 },
    { name: 'expired authentication', response: () => Response.json({ message: 'Unauthorized' }, { status: 401 }), exitCode: 4 },
  ])('refuses $name without partial output or an referent', async ({ response, exitCode }) => {
    const subject = harness(async () => response());
    await subject.run([]);
    expect(subject.errors.join('')).toContain('Error:');
    expect(subject.output).toEqual([]);
    expect(process.exitCode).toBe(exitCode);
    expect(subject.registry.getPayload('s1')).toBeUndefined();
  });

  it.each([
    { name: 'unavailable membership', response: () => Response.json({ message: 'Service unavailable' }, { status: 503 }), exitCode: 1, exchange: false },
    { name: 'malformed membership', response: () => Response.json({ children: null }), exitCode: 1, exchange: false },
    { name: 'expired membership authentication', response: () => Response.json({ message: 'Unauthorized' }, { status: 401 }), exitCode: 4, exchange: true },
  ])('refuses $name without partial output or an referent', async ({ response, exitCode, exchange }) => {
    const subject = harness(async () => keywordResponse(), async () => response());
    await subject.run([]);
    expect(subject.errors.join('')).toContain('Error:');
    expect(subject.output).toEqual([]);
    expect(process.exitCode).toBe(exitCode);
    expect(subject.registry.getPayload('s1')).toBeUndefined();
    expect(subject.requests).toEqual([keywordRequest, dashboardRequest, ...(exchange ? ['POST https://marquee.gs.com/tokenExchange'] : [])]);
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

  it('rejects invalid public input as usage before a provider call', async () => {
    const subject = harness();
    await expect(subject.run(['--type', 'Dashboard LLM'])).rejects.toMatchObject({ code: 'marquee.usage' });
    expect(subject.errors.join('')).toContain('Unknown marketview search type "Dashboard LLM"');
    expect(subject.requests).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});
