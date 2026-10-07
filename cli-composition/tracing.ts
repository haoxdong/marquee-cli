import type { Command } from 'commander';
import type { tracing } from '@opentelemetry/sdk-node';

import { CLI_EXIT_CODES } from '../presentation/index.js';
import { writePresentation } from './output-mode.js';

interface CommandTracing {
  traceCommand(program: Command, run: () => Promise<unknown>): Promise<void>;
  shutdown(): Promise<void>;
}

const SERVICE = 'marquee';

// The Command Group and command a run invoked, such as `widget view`.
const commandPath = (command: Command): string[] =>
  command.parent ? [...commandPath(command.parent), command.name()] : [];

/**
 * Command tracing (ADR 0073): one root span per command, named by its Command Group and
 * command, with every Marquee request traced beneath it by the automatic fetch (undici)
 * instrumentation. Enabled only by `OTEL_TRACES_EXPORTER=otlp`; otherwise the command runs
 * as is and the OpenTelemetry packages are never loaded. Spans go to the exporter the
 * standard `OTEL_*` variables configure, or to `spanProcessor` when one is given.
 */
export async function startCommandTracing(spanProcessor?: tracing.SpanProcessor): Promise<CommandTracing> {
  if (process.env.OTEL_TRACES_EXPORTER !== 'otlp') {
    return { traceCommand: async (_program, run) => void (await run()), shutdown: async () => {} };
  }
  const [{ trace }, { UndiciInstrumentation }, { NodeSDK }] = await Promise.all([
    import('@opentelemetry/api'),
    import('@opentelemetry/instrumentation-undici'),
    import('@opentelemetry/sdk-node'),
  ]);
  const sdk = new NodeSDK({
    serviceName: SERVICE,
    instrumentations: [new UndiciInstrumentation()],
    ...(spanProcessor ? { spanProcessors: [spanProcessor] } : {}),
    // Traces only: no metric or log export, and no trace headers sent to Marquee.
    metricReaders: [],
    logRecordProcessors: [],
    textMapPropagator: null,
  });
  sdk.start();
  const tracer = trace.getTracer(SERVICE);

  return {
    traceCommand: (program, run) =>
      tracer.startActiveSpan(SERVICE, async (span) => {
        program.hook('preAction', (_thisCommand, actionCommand) => {
          span.updateName(commandPath(actionCommand).join(' '));
        });
        try {
          await run();
        } finally {
          span.end();
        }
      }),
    shutdown: () =>
      sdk.shutdown().catch((err: unknown) => {
        const reason = (err as NodeJS.ErrnoException).code ?? String(err);
        writePresentation(
          { write: process.stdout.write.bind(process.stdout), writeError: process.stderr.write.bind(process.stderr) },
          `Error: OpenTelemetry trace export failed: ${reason}`,
          CLI_EXIT_CODES.failure,
        );
      }),
  };
}
