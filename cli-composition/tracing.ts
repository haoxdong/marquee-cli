import { existsSync, readFileSync } from 'node:fs';

import type { Command } from 'commander';
import type { AttributeValue, DiagLogger, Span as ApiSpan } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace';

import { CLI_EXIT_CODES } from '../presentation/index.js';
import { writePresentation } from './output-mode.js';
import { MarqueeError, createTraceSecretStripper, type TraceSecretStripper } from '../transport/index.js';
import { renderTopLevelCliError } from './top-level-error.js';

interface CommandTracing {
  traceCommand(program: Command, argv: readonly string[], run: () => Promise<unknown>): Promise<void>;
  shutdown(): Promise<void>;
}

const SERVICE = 'marquee';
const FAILED_MODULE = /\(failed: [^)]*\)/;
const ERROR_LINE = /^Error: /;
// OpenTelemetry's SpanStatusCode.ERROR; the enum lives in a package loaded only when tracing is on.
const SPAN_STATUS_ERROR = 2;

// The Command Group and command a run invoked, such as `widget view`.
const commandPath = (command: Command): string[] =>
  command.parent ? [...commandPath(command.parent), command.name()] : [];

function cliVersion(): string {
  for (let dir = new URL('.', import.meta.url); dir.pathname !== '/'; dir = new URL('..', dir)) {
    const manifest = new URL('package.json', dir);
    if (existsSync(manifest)) return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
  }
  throw new Error(`No package.json above ${import.meta.url}`);
}

/**
 * A thrown Marquee error carries its own dependency failure kind. A command that handled its
 * failure is classed by its exit code, then by the last Marquee request that failed:
 * `rejected` for a 4xx, `unavailable` for a 5xx or no response, `failure` with none.
 */
function errorClass(exitStatus: number, thrown: unknown, statuses: readonly (number | undefined)[]): string {
  if (thrown instanceof MarqueeError) return thrown.dependencyFailure().kind;
  const code: unknown = thrown instanceof Error && 'code' in thrown ? thrown.code : undefined;
  if (typeof code === 'string' && (code.startsWith('commander.') || code.startsWith('marquee.'))) return 'usage';
  if (exitStatus === CLI_EXIT_CODES.authRequired) return 'authentication-required';
  if (exitStatus === CLI_EXIT_CODES.cancelled) return 'cancelled';
  if (statuses.length === 0) return 'failure';
  const last = statuses.at(-1);
  if (last === 429) return 'rate-limited';
  return last === undefined || last >= 500 ? 'unavailable' : 'rejected';
}

class SecretStripper implements SpanProcessor {
  /** The response status of each Marquee request that failed, `undefined` when none came back. */
  readonly failedRequests: (number | undefined)[] = [];

  constructor(private readonly secrets: TraceSecretStripper) {}

  onStart(): void {}

  onEnding(span: Span): void {
    const strip = (value: AttributeValue | undefined): AttributeValue | undefined =>
      typeof value === 'string'
        ? this.secrets.text(value)
        : Array.isArray(value) && value.every((item) => typeof item === 'string' || item == null)
          ? value.map((item) => (typeof item === 'string' ? this.secrets.text(item) : item))
          : value;
    for (const [key, value] of Object.entries(span.attributes)) {
      const stripped = strip(value);
      if (stripped !== undefined) span.setAttribute(key, stripped);
    }
    for (const { attributes } of span.events) {
      for (const [key, value] of Object.entries(attributes ?? {})) if (attributes) attributes[key] = strip(value);
    }
    if (span.status.message) span.setStatus({ ...span.status, message: this.secrets.text(span.status.message) });
    span.updateName(this.secrets.text(span.name));
    if (span.parentSpanContext && (span.status.code === SPAN_STATUS_ERROR || span.attributes['error.type'] !== undefined)) {
      const status = span.attributes['http.response.status_code'];
      this.failedRequests.push(typeof status === 'number' ? status : undefined);
    }
  }

  onEnd(_span: ReadableSpan): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** The OTLP exporter the SDK would pick from `OTEL_EXPORTER_OTLP_(TRACES_)PROTOCOL`, placed behind the stripper. */
async function otlpTraceExporter(diag: DiagLogger): Promise<SpanExporter> {
  const protocol = process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf';
  if (protocol === 'grpc') return new (await import('@opentelemetry/exporter-trace-otlp-grpc')).OTLPTraceExporter();
  if (protocol === 'http/json') return new (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter();
  if (protocol !== 'http/protobuf') diag.warn(`Unsupported OTLP traces protocol: ${protocol}. Using http/protobuf.`);
  return new (await import('@opentelemetry/exporter-trace-otlp-proto')).OTLPTraceExporter();
}

async function tapLines<T>(stream: NodeJS.WriteStream, lines: string[], run: () => Promise<T>): Promise<T> {
  const write = stream.write;
  let partial = '';
  stream.write = function tapped(this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    const parts = (partial + (typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString())).split('\n');
    partial = parts.pop() ?? '';
    lines.push(...parts);
    return (write as (...args: unknown[]) => boolean).call(this, chunk, ...rest);
  };
  try {
    return await run();
  } finally {
    stream.write = write;
    if (partial) lines.push(partial);
  }
}

interface CommandOutcome {
  exitStatus: number;
  thrown?: unknown;
  /** The `Error:` lines the command wrote, or the error it threw as `main` renders it. */
  errorLines: string[];
  stdout: string[];
  failedRequests: readonly (number | undefined)[];
}

function recordOutcome(span: ApiSpan, outcome: CommandOutcome): void {
  const failedModules = outcome.stdout.filter((line) => FAILED_MODULE.test(line));
  span.setAttribute('marquee.exit_status', outcome.exitStatus);
  if (failedModules.length > 0) span.setAttribute('marquee.failed_modules', failedModules);
  if (outcome.exitStatus === CLI_EXIT_CODES.success) return;
  span.setAttribute('marquee.error_class', errorClass(outcome.exitStatus, outcome.thrown, outcome.failedRequests));
  if (outcome.errorLines.length > 0) span.setAttribute('marquee.errors', outcome.errorLines);
  span.setStatus({ code: SPAN_STATUS_ERROR, message: outcome.errorLines[0] ?? `exit ${outcome.exitStatus}` });
}

/**
 * Command tracing (ADR 0073): one root span per command, named by its Command Group and
 * command, with every Marquee request traced beneath it by the automatic fetch (undici)
 * instrumentation, and under the span `TRACEPARENT` names when it is set. The root span records how the command ended (ADR 0085 decision 2): its
 * arguments, exit status, error class, failed modules and `Error:` lines, and the CLI
 * version. Secrets are stripped from every span before export. Enabled only by
 * `OTEL_TRACES_EXPORTER=otlp`; otherwise the command runs as is and the OpenTelemetry
 * packages are never loaded. Spans go to the OTLP exporter the standard `OTEL_*` variables
 * configure, or to `spanProcessor` when one is given. The span's resource carries what
 * `OTEL_RESOURCE_ATTRIBUTES` names, such as the account and traffic marker the error grouper reads.
 */
export async function startCommandTracing(spanProcessor?: SpanProcessor): Promise<CommandTracing> {
  if (process.env.OTEL_TRACES_EXPORTER !== 'otlp') {
    return { traceCommand: async (_program, _argv, run) => void (await run()), shutdown: async () => {} };
  }
  const [
    { ROOT_CONTEXT, defaultTextMapGetter, diag, trace },
    { W3CTraceContextPropagator },
    { UndiciInstrumentation },
    { NodeSDK },
    { BatchSpanProcessor },
    { envDetector },
  ] = await Promise.all([
    import('@opentelemetry/api'),
    import('@opentelemetry/core'),
    import('@opentelemetry/instrumentation-undici'),
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/sdk-trace'),
    import('@opentelemetry/resources'),
  ]);
  const secrets = createTraceSecretStripper();
  const stripper = new SecretStripper(secrets);
  const sdk = new NodeSDK({
    serviceName: SERVICE,
    instrumentations: [new UndiciInstrumentation()],
    // Only OTEL_RESOURCE_ATTRIBUTES: the process detector exports the raw command line, secrets and all.
    resourceDetectors: [envDetector],
    spanProcessors: [stripper, spanProcessor ?? new BatchSpanProcessor({ exporter: await otlpTraceExporter(diag) })],
    // Traces only: no metric or log export, and no trace headers sent to Marquee.
    metricReaders: [],
    logRecordProcessors: [],
    textMapPropagator: null,
  });
  sdk.start();
  const tracer = trace.getTracer(SERVICE);
  const parent = new W3CTraceContextPropagator().extract(
    ROOT_CONTEXT,
    { traceparent: process.env.TRACEPARENT },
    defaultTextMapGetter,
  );

  return {
    traceCommand: (program, argv, run) =>
      tracer.startActiveSpan(SERVICE, {}, parent, async (span) => {
        span.setAttributes({
          'marquee.command.argv': secrets.commandArguments(argv),
          'marquee.cli.version': cliVersion(),
        });
        program.hook('preAction', (_thisCommand, actionCommand) => {
          span.updateName(commandPath(actionCommand).join(' '));
        });
        const stdout: string[] = [];
        const stderr: string[] = [];
        const errorLines = () => stderr.filter((line) => ERROR_LINE.test(line));
        const { failedRequests } = stripper;
        try {
          await tapLines(process.stdout, stdout, () => tapLines(process.stderr, stderr, run));
          recordOutcome(span, { exitStatus: Number(process.exitCode ?? 0), errorLines: errorLines(), stdout, failedRequests });
        } catch (err) {
          const { exitCode, stderr: rendered } = renderTopLevelCliError(err);
          const thrownLines = rendered ? rendered.split('\n').filter(Boolean) : errorLines();
          recordOutcome(span, { exitStatus: exitCode, thrown: err, errorLines: thrownLines, stdout, failedRequests });
          throw err;
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
