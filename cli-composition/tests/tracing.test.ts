import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { context, propagation, trace } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startCommandTracing } from '../tracing.js';

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
  await tracing.traceCommand(program, run);
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
    const exporter = new tracing.InMemorySpanExporter();
    const { program, run } = widgetViewProgram(async () => {
      await Promise.all(['/a', '/b'].map(async (path) => (await fetch(origin + path)).text()));
    });

    const processor = new tracing.SimpleSpanProcessor(exporter);
    const commandTracing = await startCommandTracing(processor);
    await commandTracing.traceCommand(program, run);
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
