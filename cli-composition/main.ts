#!/usr/bin/env node
import { installSignalExitCodes } from './signal-exit.js';
import { renderTopLevelCliError } from './top-level-error.js';
import { startCommandTracing } from './tracing.js';

function flush(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}

async function runCli(): Promise<void> {
  let exitImmediately: number | undefined;
  const tracing = await startCommandTracing();
  installSignalExitCodes(process);
  try {
    const { createProgram } = await import('./index.js');
    const runtime = createProgram();
    await tracing.traceCommand(runtime.program, () => runtime.program.parseAsync(process.argv));
  } catch (err) {
    const rendered = renderTopLevelCliError(err);
    if (rendered.exitImmediately !== undefined) {
      exitImmediately = rendered.exitImmediately;
    } else {
      if (rendered.stderr) {
        process.stderr.write(rendered.stderr);
      }
      process.exitCode = rendered.exitCode;
    }
  }

  await tracing.shutdown();
  await flush(process.stdout);
  await flush(process.stderr);
  process.exit(exitImmediately ?? process.exitCode ?? 0);
}

if (process.env.MARQUEE_REPLAY_WORKER === '1') {
  await import('./replay-worker.js');
} else {
  await runCli();
}
