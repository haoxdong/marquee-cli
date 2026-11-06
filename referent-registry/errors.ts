export class RegistryLockError extends Error {
  override readonly name = 'RegistryLockError';

  constructor(readonly kind: 'lock-busy' | 'lock-failed', cause: unknown) {
    const message = kind === 'lock-busy'
      ? 'Registry is busy with another CLI command. Retry after that command finishes.'
      : `Registry lock failed: ${cause instanceof Error ? cause.message : String(cause)}. Check the registry directory and permissions before retrying.`;
    super(message, { cause });
  }
}
