import { CLI_EXIT_CODES } from '../../presentation/index.js';
import type { DependencyFailure } from '../../transport/index.js';
import type { DataCatalogCacheFailure, DataPresentation } from '../types.js';

/** One stderr line's message and the exit code it carries (ADR 0070); `usage` when it rejects the input. */
export type Failure = Readonly<{ message: string; exitCode: number; usage?: true }>;

const NOT_AUTHENTICATED: Failure = {
  message: 'Not authenticated. Run: marquee auth login',
  exitCode: CLI_EXIT_CODES.authRequired,
};

/** A failure that exits 1. */
export function failure(message: string): Failure {
  return { message, exitCode: CLI_EXIT_CODES.failure };
}

/** Input the command rejects: exits 1, classed `usage` (ADR 0085 decision 4). */
export function usageFailure(message: string): Failure {
  return { message, exitCode: CLI_EXIT_CODES.failure, usage: true };
}

/** A login fixes it, whatever was asked. */
export function notAuthenticated(): Failure {
  return NOT_AUTHENTICATED;
}

/** Nothing on stdout and the failure's one line on stderr. */
export function failed({ message, exitCode, usage }: Failure): DataPresentation {
  return { stdout: '', stderr: `Error: ${message}\n`, exitCode, ...(usage ? { usage } : {}) };
}

/**
 * A request Marquee refused or failed, named by what it was for, such as `Haver search` or
 * `PlotTool Pro evaluation`.
 */
export function requestFailure(
  subject: string,
  dependencyFailure: DependencyFailure,
  reason?: 'access-denied',
): Failure {
  if (reason === 'access-denied') return failure(`Access denied: ${subject}`);
  switch (dependencyFailure.kind) {
    case 'authentication-required':
      return NOT_AUTHENTICATED;
    case 'rate-limited':
      return failure(`${subject}: too many requests`);
    case 'timeout':
      return failure(`${subject} timed out`);
    case 'cancelled':
      return { message: 'Request cancelled', exitCode: CLI_EXIT_CODES.cancelled };
    case 'unavailable':
      return failure(`${subject} is unavailable`);
  }
}

/** An answer that is not the shape the CLI reads. */
export function malformedResults(subject: string, location: string, problem: string): Failure {
  return failure(`${subject} returned malformed results at ${location}: ${problem}`);
}

/** A cached catalog that cannot be read back, or a fetched one that cannot be cached. */
export function cacheFailure({ kind, path, problem }: DataCatalogCacheFailure): Failure {
  return kind === 'catalog-cache-unreadable'
    ? failure(`Catalog cache unreadable at ${path}: ${problem}. Delete it and retry.`)
    : failure(`Catalog cache unwritable at ${path}: ${problem}. Set MARQUEE_CACHE_DIR to a writable directory.`);
}
