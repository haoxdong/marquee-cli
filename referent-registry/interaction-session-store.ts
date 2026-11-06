import type { InteractionSessionNamespace, InteractionSessionNamespaceOptions } from './types.js';
import {
  resolveRegistryRefsDir,
  resolveRegistrySessionId,
} from './host-session.js';
import { createInteractionSessionNamespaceStateImplementation } from './registry.js';

type InteractionSessionId = number | string;

function sessionId(
  session: InteractionSessionNamespaceOptions['session'],
): InteractionSessionId {
  if (typeof session === 'number' || typeof session === 'string') return session;
  return resolveRegistrySessionId(session);
}

export function createInteractionSessionNamespaceImplementation<T>(
  namespace: string,
  validate: (value: unknown) => value is T,
  options: InteractionSessionNamespaceOptions = {},
): InteractionSessionNamespace<T> {
  if (!namespace.trim()) throw new Error('Interaction Session namespace must be non-empty');
  const inactivityMs = options.inactivityMs ?? 7 * 24 * 60 * 60 * 1_000;
  const maxNamespaces = options.maxNamespaces ?? 50;
  if (!Number.isFinite(inactivityMs) || inactivityMs <= 0) {
    throw new Error('Interaction Session inactivityMs must be a positive finite number');
  }
  if (!Number.isInteger(maxNamespaces) || maxNamespaces <= 0) {
    throw new Error('Interaction Session maxNamespaces must be a positive integer');
  }
  return createInteractionSessionNamespaceStateImplementation(
    options.dir ?? resolveRegistryRefsDir(),
    sessionId(options.session),
    namespace,
    validate,
    options,
  );
}
