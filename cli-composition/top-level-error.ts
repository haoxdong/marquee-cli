import {
  MarqueeError,
  type DependencyFailure,
} from '../transport/index.js';
import { CLI_EXIT_CODES } from '../presentation/index.js';

export interface TopLevelCliErrorRender {
  stderr?: string;
  exitCode: number;
  exitImmediately?: number;
}

function topLevelExitCode(failure: DependencyFailure): 1 | 2 | 4 {
  if (failure.kind === 'cancelled') return CLI_EXIT_CODES.cancelled;
  if (failure.kind === 'authentication-required') return CLI_EXIT_CODES.authRequired;
  return CLI_EXIT_CODES.failure;
}

export function renderTopLevelCliError(err: unknown): TopLevelCliErrorRender {
  const code = (err as { code?: string } | null | undefined)?.code;
  if (code === 'commander.helpDisplayed' || code === 'commander.version') {
    return { exitCode: 0, exitImmediately: 0 };
  }
  // Already written to the error writer: reserved and removed paths, usage errors, and commander's own errors.
  if (code?.startsWith('marquee.') || code?.startsWith('commander.')) {
    return { exitCode: 1 };
  }

  let stderr: string | undefined;
  if (err instanceof MarqueeError) {
    const body = err.details?.body;
    const hint = body ? ` — ${body.length > 200 ? body.slice(0, 200) : body}` : '';
    stderr = `${err.message}${hint}\n`;
  } else if (err instanceof Error) {
    stderr = `Error: ${err.message}\n`;
  }

  return {
    ...(stderr ? { stderr } : {}),
    exitCode: cliExitCode(err),
  };
}

export function cliExitCode(err: unknown): number {
  if (err instanceof MarqueeError) return topLevelExitCode(err.dependencyFailure());
  return err instanceof Error && err.name === 'AbortError'
    ? CLI_EXIT_CODES.cancelled
    : CLI_EXIT_CODES.failure;
}
