export { RegistryLockError } from './errors.js';
import {
  createReferentRegistryImplementation,
} from './registry.js';
import {
  formatUnknownRefError,
  isReferentRef as isReferentRefImplementation,
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
  ReferentRef,
  ReferentRegistry,
} from './types.js';
export type {
  InteractionSessionNamespaceOptions,
  InteractionSessionNamespace,
  ReferentRef,
  Ref,
  ReferentRegistry,
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

export function isReferentRef(value: unknown): value is ReferentRef {
  return isReferentRefImplementation(value);
}

type RegistrySessionId = number | string;

interface ReferentRegistryOptions {
  inactivityMs?: number;
  now?: () => number;
}

export function createReferentRegistry(
  dir: string = resolveRegistryRefsDir(),
  session: RegistrySessionId | NodeJS.ProcessEnv = resolveRegistrySessionId(),
  options: ReferentRegistryOptions = {},
): ReferentRegistry {
  const sessionId = typeof session === 'object'
    ? resolveRegistrySessionId(session)
    : session;
  const registry = createReferentRegistryImplementation(dir, sessionId, options);
  const publicRegistry: ReferentRegistry = {
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
