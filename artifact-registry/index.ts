export { RegistryLockError } from './errors.js';
import {
  createArtifactRegistryImplementation,
} from './registry.js';
import {
  formatUnknownRefError,
  isArtifactRef as isArtifactRefImplementation,
  normalizeRefName,
  resolveRefOrError,
} from './ref-resolution.js';
import {
  resolveHostIdentityDigest as resolveHostIdentityDigestImplementation,
  resolveRegistryRefsDir,
  resolveRegistrySessionId,
} from './host-session.js';
import { createInteractionSessionNamespaceImplementation } from './interaction-session-store.js';
import type {
  InteractionSessionNamespaceOptions,
  InteractionSessionNamespace,
  ArtifactRef,
  ArtifactRegistry,
} from './types.js';
export type {
  InteractionSessionNamespaceOptions,
  InteractionSessionNamespace,
  ArtifactRef,
  PaginatedCursor,
  Ref,
  ArtifactRegistry,
} from './types.js';

export function createInteractionSessionNamespace<T>(
  namespace: string,
  validate: (value: unknown) => value is T,
  options: InteractionSessionNamespaceOptions = {},
): InteractionSessionNamespace<T> {
  return createInteractionSessionNamespaceImplementation(namespace, validate, options);
}

/** The digest of the agent host's identity for this CLI Interaction Session, if an agent host set one. */
export function resolveHostIdentityDigest(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return resolveHostIdentityDigestImplementation(env);
}

export function isArtifactRef(value: unknown): value is ArtifactRef {
  return isArtifactRefImplementation(value);
}

type RegistrySessionId = number | string;

interface ArtifactRegistryOptions {
  inactivityMs?: number;
  now?: () => number;
}

export function createArtifactRegistry(
  dir: string = resolveRegistryRefsDir(),
  session: RegistrySessionId | NodeJS.ProcessEnv = resolveRegistrySessionId(),
  options: ArtifactRegistryOptions = {},
): ArtifactRegistry {
  const sessionId = typeof session === 'object'
    ? resolveRegistrySessionId(session)
    : session;
  const registry = createArtifactRegistryImplementation(dir, sessionId, options);
  const publicRegistry: ArtifactRegistry = {
    ...registry,
    refName: normalizeRefName,
    resolve(name: string) {
      return resolveRefOrError(this, name);
    },
    formatUnknownRef(
      cleanRef: string,
      formatOptions?: { prefix?: 'Error' | 'error' },
    ) {
      return formatUnknownRefError(this, cleanRef, formatOptions);
    },
  };
  return publicRegistry;
}
