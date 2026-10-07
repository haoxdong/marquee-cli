import { Buffer } from 'node:buffer';
import { takeCoverage } from 'node:v8';
import { createProgram } from './index.js';
import { renderTopLevelCliError } from './top-level-error.js';
import type { ProgramDependencies } from './types.js';

interface RunRequest {
  type: 'run';
  id: number;
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdin?: string;
}

interface CloseRequest {
  type: 'close';
}

interface CoverageCheckpointRequest {
  type: 'checkpoint-coverage';
  id: number;
}

interface RunResponse {
  type: 'result';
  id: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CoverageCheckpointResponse {
  type: 'coverage-checkpointed';
  id: number;
  error?: string;
}

const workerEnv = { ...process.env };
let queue = Promise.resolve();

process.on('message', (message: RunRequest | CloseRequest | CoverageCheckpointRequest) => {
  if (message.type === 'close') {
    queue = queue.finally(() => {
      // Keep IPC available for requests from finished commands until existing
      // work drains naturally. An unreferenced channel does not keep us alive.
      process.channel?.unref();
    });
    return;
  }
  if (message.type === 'checkpoint-coverage') {
    queue = queue.then(() => {
      try {
        takeCoverage();
        send({ type: 'coverage-checkpointed', id: message.id });
      } catch (error) {
        send({
          type: 'coverage-checkpointed',
          id: message.id,
          error: error instanceof Error ? error.stack ?? error.message : String(error),
        });
      }
    });
    return;
  }

  queue = queue
    .then(() => runCommand(message))
    .then((response) => send(response))
    .catch((error: unknown) => {
      send({
        type: 'result',
        id: message.id,
        stdout: '',
        stderr: `Replay worker failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
        exitCode: 1,
      });
    });
});

process.on('disconnect', () => {
  process.exitCode = 0;
});

async function runCommand(request: RunRequest): Promise<RunResponse> {
  replaceProcessEnv(request.env);
  const restoreStdin = installStdin(request.stdin);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const previousExitCode = process.exitCode;
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  process.stdout.write = captureWrite((chunk) => {
    stdout += chunk;
  });
  process.stderr.write = captureWrite((chunk) => {
    stderr += chunk;
  });

  try {
    // The worker's `fetch` is the Replay Lane's MSW server (ADR 0073).
    const dependencies: Required<Pick<ProgramDependencies, 'replayFetch'>> = { replayFetch: fetch };
    const runtime = createProgram((chunk) => {
      stdout += chunk;
    }, dependencies);
    try {
      await runtime.program.parseAsync(['node', 'marquee', ...request.argv]);
    } catch (error) {
      const rendered = renderTopLevelCliError(error);
      if (rendered.stderr) stderr += rendered.stderr;
      process.exitCode = rendered.exitCode;
    }
    return {
      type: 'result',
      id: request.id,
      stdout,
      stderr,
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = previousExitCode;
    restoreStdin();
    replaceProcessEnv(workerEnv);
  }
}

function replaceProcessEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

function captureWrite(append: (chunk: string) => void): typeof process.stderr.write {
  return ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
    append(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    const done = typeof encodingOrCallback === 'function'
      ? encodingOrCallback
      : typeof callback === 'function'
        ? callback
        : undefined;
    if (done) process.nextTick(done);
    return true;
  });
}

function installStdin(input: string | undefined): () => void {
  if (input === undefined) return () => {};

  const stream = process.stdin;
  const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const replace = (key: PropertyKey, value: unknown) => {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(stream, key));
    Object.defineProperty(stream, key, {
      configurable: true,
      value,
      writable: true,
    });
  };
  const on = (event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') process.nextTick(() => listener(input));
    if (event === 'end') process.nextTick(() => listener());
    return stream;
  };

  replace('isTTY', false);
  replace('setEncoding', () => stream);
  replace('isPaused', () => true);
  replace('resume', () => stream);
  replace('on', on);
  replace('addListener', on);
  replace('once', on);

  return () => {
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(stream, key, descriptor);
      else delete (stream as unknown as Record<PropertyKey, unknown>)[key];
    }
  };
}

function send(response: RunResponse | CoverageCheckpointResponse): void {
  if (!process.connected) return;
  process.send?.(response);
}
