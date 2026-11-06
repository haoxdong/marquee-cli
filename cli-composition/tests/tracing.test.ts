import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { context, propagation, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReferentRegistry } from '../../referent-registry/index.js';
import { MarqueeError } from '../../transport/index.js';
import { createProgram } from '../index.js';
import { startCommandTracing } from '../tracing.js';

function neverHeld(): void {}

const EVICTING_PAYLOADS = 51;

function evictedDashboard(dir: string): void {
  const registry = createReferentRegistry(dir);
  for (let index = 0; index < EVICTING_PAYLOADS; index += 1) {
    const namespace = registry.claimDashboard();
    registry.storeReferent({ namespace, root: { type: 'dashboard', dashboardId: `MD${index}` }, payload: {} });
  }
}

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1_000;

function expiredWidget(dir: string): void {
  const registry = createReferentRegistry(dir, undefined, { now: () => Date.now() - EIGHT_DAYS_MS });
  const name = registry.claimWidget();
  registry.setRefs(name, { [name]: { type: 'widget', widgetId: 'MW1', configurationId: null, selectedContext: null } });
}

function widgetViewProgram(onAction: () => void): { program: Command; run: () => Promise<unknown> } {
  const program = new Command('marquee');
  program.command('widget').command('view').action(onAction);
  return { program, run: () => program.parseAsync(['node', 'marquee', 'widget', 'view']) };
}

async function runTraced(): Promise<{ ran: boolean; stderr: string }> {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let ran = false;
  const { program, run } = widgetViewProgram(() => {
    ran = true;
  });
  const tracing = await startCommandTracing();
  await tracing.traceCommand(program, [], run);
  await tracing.shutdown();
  return { ran, stderr: stderr.mock.calls.map(([chunk]) => String(chunk)).join('') };
}

afterEach(() => {
  // Each enabled run registers the OpenTelemetry globals; reset them for the next one.
  trace.disable();
  context.disable();
  propagation.disable();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe('command tracing', () => {
  beforeEach(() => vi.stubEnv('TRACEPARENT', undefined));

  // Port 9 (discard) refuses connections, so any attempted export fails.
  const unreachableCollector = () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:9');
    vi.stubEnv('OTEL_EXPORTER_OTLP_TIMEOUT', '1000');
  };

  it('runs the command without exporting when OTEL_TRACES_EXPORTER is unset', async () => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', undefined);

    await expect(runTraced()).resolves.toEqual({ ran: true, stderr: '' });
    expect(process.exitCode).toBeUndefined();
  });

  // The one span test ADR 0073 allows: the root span's name and service, with request spans as its children.
  it('traces a command as one root span named by its Command Group and command, over its request spans', async () => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const exporter = new InMemorySpanExporter();
    const { program, run } = widgetViewProgram(async () => {
      await Promise.all(['/a', '/b'].map(async (path) => (await fetch(origin + path)).text()));
    });

    const processor = new SimpleSpanProcessor({ exporter });
    const commandTracing = await startCommandTracing(processor);
    await commandTracing.traceCommand(program, ['widget', 'view'], run);
    // Export waits for resource detection; shutdown would clear the in-memory exporter.
    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    await commandTracing.shutdown();
    server.close();

    const root = spans.find((span) => span.parentSpanContext === undefined);
    expect({
      name: root?.name,
      service: root?.resource.attributes['service.name'],
      children: spans
        .filter((span) => span !== root)
        .map((span) => ({ name: span.name, parent: span.parentSpanContext?.spanId })),
    }).toEqual({
      name: 'widget view',
      service: 'marquee',
      children: [
        { name: 'GET', parent: root?.spanContext().spanId },
        { name: 'GET', parent: root?.spanContext().spanId },
      ],
    });
  });

  // A fake Marquee: `/widgets/ok` answers, `/widgets/broken` fails with 500, `/session` refuses with 401.
  async function fakeMarquee(): Promise<{ origin: string; close: () => void }> {
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/session')) {
        response.writeHead(401, { 'set-cookie': `MARQUEE_SESSION=${SESSION_COOKIE}; HttpOnly` });
        response.end('{"error":"session expired"}');
        return;
      }
      response.writeHead(request.url?.startsWith('/widgets/broken') ? 500 : 200);
      response.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
  }

  const SESSION_COOKIE = 'c00kie-session-value-1234';
  const AUTH_TOKEN = 'env-auth-token-abcdef123456';
  const FLAG_TOKEN = 'flag-token-value-987654';
  const JWT = 'eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiJ1c2VyLTEyMzQ1Njc4In0.c2lnbmF0dXJlLXZhbHVlLWFiYw';
  const SIGNATURE = 'a1b2c3d4e5f6signature';

  /** Runs `marquee widget view <argv>` with `action` as its body, and returns the exported spans. */
  async function traceWidgetView(argv: string[], action: () => Promise<void>) {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    vi.stubEnv('MARQUEE_AUTH_TOKEN', AUTH_TOKEN);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const program = new Command('marquee').exitOverride();
    program
      .command('widget')
      .command('view')
      .argument('<id>')
      .option('--token <token>')
      .option('--range <range>')
      .exitOverride()
      .action(action);
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor({ exporter });
    // As the real CLI runs: the command line is the process's own.
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'marquee', 'widget', 'view', ...argv]);
    const commandTracing = await startCommandTracing(processor);
    const failure = await commandTracing
      .traceCommand(program, ['widget', 'view', ...argv], () => program.parseAsync(['node', 'marquee', 'widget', 'view', ...argv]))
      .then(() => undefined, (err: unknown) => err);
    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    await commandTracing.shutdown();
    const root = spans.find((span) => span.parentSpanContext === undefined);
    return { spans, root, failure };
  }

  it('records how a command with one failed module ended, with its arguments and no secrets', async () => {
    const marquee = await fakeMarquee();
    const { root, spans } = await traceWidgetView(['w-123', '--range', '1y', '--token', FLAG_TOKEN], async () => {
      await (await fetch(`${marquee.origin}/widgets/ok?X-Amz-Signature=${SIGNATURE}&X-Amz-Expires=60`, {
        headers: { authorization: `Bearer ${JWT}`, cookie: `MARQUEE_SESSION=${SESSION_COOKIE}` },
      })).text();
      await (await fetch(`${marquee.origin}/widgets/broken?access_token=${AUTH_TOKEN}`)).text();
      process.stdout.write('Widget w-ok  Revenue\nWidget w-broken (failed: HTTP 500)\n');
      process.stderr.write(`Error: Widget w-broken has HTTP 500 — token=${FLAG_TOKEN}\n`);
      process.exitCode = 1;
    });
    marquee.close();

    expect({
      name: root?.name,
      status: root?.status,
      attributes: root?.attributes,
    }).toEqual({
      name: 'widget view',
      status: { code: 2, message: 'Error: Widget w-broken has HTTP 500 — token=[redacted]' },
      attributes: {
        'marquee.command.argv': ['widget', 'view', 'w-123', '--range', '1y', '--token', '[redacted]'],
        'marquee.cli.version': expect.stringMatching(/^\d+\.\d+\.\d+/),
        'marquee.exit_status': 1,
        'marquee.error_class': 'unavailable',
        'marquee.failed_modules': ['Widget w-broken (failed: HTTP 500)'],
        'marquee.errors': ['Error: Widget w-broken has HTTP 500 — token=[redacted]'],
      },
    });
    const exported = JSON.stringify(
      spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, resource: span.resource.attributes })),
    );
    for (const secret of [SESSION_COOKIE, AUTH_TOKEN, FLAG_TOKEN, JWT, SIGNATURE]) expect(exported).not.toContain(secret);
    expect(exported).toContain('/widgets/broken');
  });

  it('classes a command Marquee refused with 401 as authentication-required', async () => {
    const marquee = await fakeMarquee();
    const { root, failure } = await traceWidgetView(['w-123'], async () => {
      const response = await fetch(`${marquee.origin}/session`);
      throw new MarqueeError('auth_expired', 'Marquee session expired; run `marquee auth login`', {
        status: response.status,
        body: await response.text(),
      });
    });
    marquee.close();

    expect(failure).toBeInstanceOf(MarqueeError);
    expect({
      status: root?.status,
      exit: root?.attributes['marquee.exit_status'],
      class: root?.attributes['marquee.error_class'],
    }).toEqual({
      status: { code: 2, message: 'Marquee session expired; run `marquee auth login` — {"error":"session expired"}' },
      exit: 4,
      class: 'authentication-required',
    });
  });

  it('classes a command line the CLI rejected as usage', async () => {
    const { root, failure } = await traceWidgetView(['w-123', '--colour', 'red'], async () => {});

    expect(failure).toMatchObject({ code: 'commander.unknownOption' });
    expect({
      exit: root?.attributes['marquee.exit_status'],
      class: root?.attributes['marquee.error_class'],
      argv: root?.attributes['marquee.command.argv'],
    }).toEqual({ exit: 1, class: 'usage', argv: ['widget', 'view', 'w-123', '--colour', 'red'] });
  });

  // ADR 0085 decision 4: input the CLI rejects is agent misuse, whether commander or a command rejects it.
  it.each([
    [['marketview', 'search', ''], 'marketview search', 'Error: marketview search query must not be empty\n'],
    [['data', 'search', ''], 'data search', 'Error: data search query must not be empty\n'],
    [['data', 'view', ' '], 'data view', 'Error: data view target must not be empty\n'],
    [['marketview', 'dashboard', 'create', ' '], 'marketview dashboard create', 'Error: dashboard name must not be empty\n'],
    [['marketview', 'search', 'carry', '--type', ' , '], 'marketview search', 'Error: marketview search requires at least one --type value\n'],
    [['marketview', 'search', 'carry', '--type', 'bogus'], 'marketview search', 'Error: Unknown marketview search type "bogus". Supported types: widget, widget-semantic, widget-hybrid, thematic-dashboard, asset-dashboard, country-dashboard, portfolio-dashboard\n'],
    [['marketview', 'search', 'carry', '--limit', '0'], 'marketview search', 'Error: --limit must be a positive integer\n'],
    [['marketview', 'widget', 'view', 'xyz'], 'marketview widget view', 'Error: marketview widget expects a widget ID like MW..., got "xyz". Use `marquee marketview search "xyz"` to find widgets by query.\n'],
    [['marketview', 'dashboard', 'view', 'fx-carry', '-L', '0'], 'marketview dashboard view', 'Error: -L must be a positive integer\n'],
    [['marketview', 'dashboard', 'view', 'fx-carry', '-S', 'vol'], 'marketview dashboard view', 'Error: -S requires a dashboard ref such as @d1\n'],
    [['marketview', 'dashboard', 'view', '@d9', '-S', ''], 'marketview dashboard view', 'Error: -S requires a non-empty query\n'],
    [['marketview', 'dashboard', 'edit', '@d1', '--order', ''], 'marketview dashboard edit', 'Error: --order requires a comma-separated list of refs\n'],
    [['marketview', 'dashboard', 'edit', 'fx carry dashboard', '--add-section', 'x'], 'marketview dashboard edit', 'Error: dashboard edit does not accept free-text title "fx carry dashboard"; use a Dashboard ID, alias, or ref\n'],
    [['marketview', 'dashboard', 'edit', 'MD1'], 'marketview dashboard edit', 'Error: dashboard edit requires at least one --add-widget, --remove-widget, --add-section, --remove-section, or --order mutation\n'],
    [['data', 'search', 'carry', '--limit', '5'], 'data search', 'Error: --limit needs --class; a search of every Class shows 5 rows from each\n'],
    [['data', 'search', 'carry', '--class', 'FRED', '--limit', '0'], 'data search', 'Error: --limit must be a whole number from 1 to 1000 for --class FRED\n'],
    [['data', 'list'], 'data list', 'Error: a list is required: functions, classes, examples\n'],
    [['data', 'list', 'bogus'], 'data list', 'Error: unknown list "bogus"; choose one of: functions, classes, examples\n'],
    [['data', 'list', 'functions', 'x'], 'data list', 'Error: data list functions takes no folder; only examples does\n'],
    [['content', 'search', 'cpi', '--limit', '0'], 'content search', 'Error: --limit must be a positive integer\n'],
    [['content', 'search', 'cpi', '--limit', '51'], 'content search', 'Error: --limit max is 50\n'],
    [['content', 'search', 'cpi', '--sort', 'newest'], 'content search', 'Error: --sort must be time or relevance\n'],
    [['content', 'search', 'cpi', '--published', 'yesterday'], 'content search', 'Error: invalid --published "yesterday"; expected ">=YYYY-MM-DD", "<=YYYY-MM-DD" or YYYY-MM-DD..YYYY-MM-DD\n'],
    [['content', 'view', 'https://example.com/x'], 'content view', 'Error: "https://example.com/x" is not a Marquee content URL — expected a marquee.gs.com /content/ or /s/content/ path, a document UUID, or a stored ref\n'],
    [['api', '/v1/x', '-F', 'a=1', '-F', 'a=2'], 'api', 'Error: unexpected override existing field under "a"\n'],
    [['api', '/v1/x', '-X', 'GET', '--input', 'body.json'], 'api', 'Error: GET requests cannot have a body; remove --input\n'],
    [['browser', '--session', '', 'snapshot'], 'browser snapshot', 'Error: --session needs a Browser Session name\n'],
    [['browser', 'cookies'], 'browser', 'Error: marquee browser does not forward agent-browser cookies\n'],
  ])('classes %j, input the command rejected, as usage with its Error: line and exit 1', async (argv, name, error) => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    const stderr: string[] = [];
    const { program } = createProgram(() => {}, {
      writeError: (chunk) => void stderr.push(chunk),
      refStoreDir: mkdtempSync(join(tmpdir(), 'marquee-tracing-')),
    });
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor({ exporter });
    const commandTracing = await startCommandTracing(processor);
    await commandTracing.traceCommand(program, argv, () => program.parseAsync(argv, { from: 'user' })).catch(() => {});
    await processor.forceFlush();
    const [root] = exporter.getFinishedSpans();
    await commandTracing.shutdown();

    expect({
      stderr: stderr.join(''),
      name: root?.name,
      exit: root?.attributes['marquee.exit_status'],
      class: root?.attributes['marquee.error_class'],
    }).toEqual({ stderr: error, name, exit: 1, class: 'usage' });
  });

  // The registry cannot yet tell a ref it never held from one that expired or was
  // evicted, and a lost ref must stay `failure` so short ref lifetimes surface.
  it.each([
    ['never held', ['marketview', 'widget', 'view', '@w9'], 'marketview widget view', '@w9', neverHeld],
    ['never held', ['marketview', 'dashboard', 'view', '@d9'], 'marketview dashboard view', '@d9', neverHeld],
    ['never held', ['marketview', 'dashboard', 'edit', '@d9', '--add-section', 'x'], 'marketview dashboard edit', '@d9', neverHeld],
    ['never held', ['marketview', 'dashboard', 'create', 'New', '--add', '@w9'], 'marketview dashboard create', '@w9', neverHeld],
    ['never held', ['content', 'view', '@c9'], 'content view', '@c9', neverHeld],
    ['never held', ['browser', 'open', '@w9'], 'browser open', '@w9', neverHeld],
    ['evicted', ['marketview', 'dashboard', 'view', '@d1'], 'marketview dashboard view', '@d1', evictedDashboard],
    ['expired', ['marketview', 'widget', 'view', '@w1'], 'marketview widget view', '@w1', expiredWidget],
  ])('classes an @ref that was %s, %j, as failure with its Error: line and exit 1', async (_case, argv, name, ref, seed) => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    const refStoreDir = mkdtempSync(join(tmpdir(), 'marquee-tracing-'));
    const stderr: string[] = [];
    seed(refStoreDir);
    const { program } = createProgram(() => {}, { writeError: (chunk) => void stderr.push(chunk), refStoreDir });
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor({ exporter });
    const commandTracing = await startCommandTracing(processor);
    await commandTracing.traceCommand(program, argv, () => program.parseAsync(argv, { from: 'user' })).catch(() => {});
    await processor.forceFlush();
    const [root] = exporter.getFinishedSpans();
    await commandTracing.shutdown();

    expect({
      stderr: stderr.join('').split('\n')[0],
      name: root?.name,
      exit: root?.attributes['marquee.exit_status'],
      class: root?.attributes['marquee.error_class'],
    }).toEqual({ stderr: `Error: ref ${ref} not found`, name, exit: 1, class: 'failure' });
  });

  it('records a successful command with exit status 0 and no error', async () => {
    const { root } = await traceWidgetView(['w-123'], async () => {});

    expect({ status: root?.status.code, attributes: root?.attributes }).toEqual({
      status: 0,
      attributes: {
        'marquee.command.argv': ['widget', 'view', 'w-123'],
        'marquee.cli.version': expect.any(String),
        'marquee.exit_status': 0,
      },
    });
  });

  it.each([
    ['http/json', 'application/json'],
    ['http/protobuf', 'application/x-protobuf'],
  ])('exports over the OTLP protocol %s that OTEL_EXPORTER_OTLP_PROTOCOL selects', async (protocol, contentType) => {
    const received: { type: string | undefined; body: string }[] = [];
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ type: request.headers['content-type'], body: Buffer.concat(chunks).toString('latin1') });
        response.end();
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', protocol);
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', `http://127.0.0.1:${(collector.address() as AddressInfo).port}`);

    const outcome = await runTraced();
    collector.close();

    expect(outcome).toEqual({ ran: true, stderr: '' });
    expect(received.map(({ type, body }) => ({ type, named: body.includes('widget view') }))).toEqual([
      { type: contentType, named: true },
    ]);
  });

  it('runs a command whose OTLP protocol is grpc', async () => {
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', 'grpc');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:9');
    vi.stubEnv('OTEL_EXPORTER_OTLP_TIMEOUT', '1000');

    await expect(runTraced()).resolves.toMatchObject({ ran: true });
  });

  it('starts the command span as a child of the trace context TRACEPARENT gives', async () => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    vi.stubEnv('TRACEPARENT', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor({ exporter });
    const { program, run } = widgetViewProgram(() => {});

    const commandTracing = await startCommandTracing(processor);
    await commandTracing.traceCommand(program, ['widget', 'view'], run);
    await processor.forceFlush();
    const [span] = exporter.getFinishedSpans();
    await commandTracing.shutdown();

    expect({
      name: span?.name,
      traceId: span?.spanContext().traceId,
      parent: span?.parentSpanContext?.spanId,
    }).toEqual({ name: 'widget view', traceId: '0af7651916cd43dd8448eb211c80319c', parent: 'b7ad6b7169203331' });
  });

  it('puts the account and traffic marker OTEL_RESOURCE_ATTRIBUTES gives on the command span, and no process details', async () => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'enduser.id=user%40example.com,marqueebot.traffic=test');
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor({ exporter });
    const { program, run } = widgetViewProgram(() => {});

    const commandTracing = await startCommandTracing(processor);
    await commandTracing.traceCommand(program, ['widget', 'view'], run);
    await processor.forceFlush();
    const [span] = exporter.getFinishedSpans();
    await commandTracing.shutdown();

    expect(span?.resource.attributes).toEqual({
      'service.name': 'marquee',
      'telemetry.sdk.language': 'nodejs',
      'telemetry.sdk.name': 'opentelemetry',
      'telemetry.sdk.version': expect.any(String),
      'enduser.id': 'user@example.com',
      'marqueebot.traffic': 'test',
    });
  });

  it('reports a failed trace export as a command error when OTEL_TRACES_EXPORTER=otlp', async () => {
    unreachableCollector();
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');

    await expect(runTraced()).resolves.toEqual({
      ran: true,
      stderr: 'Error: OpenTelemetry trace export failed: ECONNREFUSED\n',
    });
    expect(process.exitCode).toBe(1);
  });
});
