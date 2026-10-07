import { afterEach, describe, expect, it } from 'vitest';
import { MarqueeError } from '../../transport/index.js';
import { RegistryLockError } from '../../artifact-registry/index.js';
import { renderTopLevelCliError } from '../top-level-error.js';

afterEach(() => {
  process.exitCode = undefined;
});

describe('CLI main entry helpers', () => {
  it.each([
    ['lock-busy', 'Registry is busy with another CLI command. Retry after that command finishes.'],
    ['lock-failed', 'Registry lock failed: fixture permission denied. Check the registry directory and permissions before retrying.'],
  ] as const)('renders the owned %s registry failure with a nonzero exit', (kind, message) => {
    const cause = new Error('fixture permission denied');
    const error = new RegistryLockError(kind, cause);

    expect(error.cause).toBe(cause);
    expect(renderTopLevelCliError(error)).toEqual({
      stderr: `Error: ${message}\n`,
      exitCode: 1,
    });
  });

  it('renders top-level MarqueeError details with a 200-character body hint and failure exit code', () => {
    const body = 'x'.repeat(250);
    const error = Object.assign(
      new MarqueeError('http', 'Marquee returned 500', { body }),
      { exitCode: 7 },
    );

    expect(renderTopLevelCliError(error)).toEqual({
      stderr: `Marquee returned 500 — ${'x'.repeat(200)}\n`,
      exitCode: 1,
    });
  });

  it('maps top-level auth-required and cancelled errors to their public exit codes', () => {
    expect(renderTopLevelCliError(
      new MarqueeError('auth_expired', 'authentication required'),
    ).exitCode).toBe(4);
    expect(renderTopLevelCliError(
      new MarqueeError('network', 'Request cancelled', { isCanceled: true }),
    ).exitCode).toBe(2);
  });

  it('does not render a reserved-verb error twice after the program writes it', () => {
    const error = Object.assign(new Error('reserved verb'), { code: 'marquee.reservedVerb' });

    expect(renderTopLevelCliError(error)).toEqual({ exitCode: 1 });
  });
});
