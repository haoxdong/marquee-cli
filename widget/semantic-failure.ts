import type { WidgetError } from './types.js';

export class WidgetSemanticFailure extends Error {
  constructor(readonly error: WidgetError) {
    super(error.kind);
  }
}

type InvalidWidgetResponse = Extract<WidgetError, { kind: 'invalid-response' }>;

/** An unsupported upstream response shape; the Widget adapter adds the identity. */
export class InvalidWidgetResponseError extends Error {
  constructor(readonly error: Omit<InvalidWidgetResponse, 'identity' | 'kind'>) {
    super(error.detail ?? error.problem);
  }
}
