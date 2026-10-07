import type { DependencyFailure, MarqueeErrorCode } from './types.js';

interface MarqueeErrorDetails {
  status?: number;
  retryAfterMs?: number;
  path?: string;
  contentType?: string;
  body?: string;
  credentialServiceCode?: string;
  adapter?: string;
  isCanceled?: boolean;
  jarPath?: string;
  responseClassification?:
    | 'ordinary'
    | 'accepted_html'
    | 'generic_html'
    | 'gateway_html'
    | 'http_401'
    | 'login_html'
    | 'entity_401'
    | 'entitlement_401'
    | 'http_status'
    | 'non_json';
}

export class MarqueeError extends Error {
  override readonly name = 'MarqueeError';

  constructor(
    readonly code: MarqueeErrorCode,
    message: string,
    readonly details?: MarqueeErrorDetails,
  ) {
    super(message);
  }

  toJSON(): { code: MarqueeErrorCode; message: string; details?: MarqueeErrorDetails } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }

  dependencyFailure(): DependencyFailure {
    if (this.details?.isCanceled === true) return { kind: 'cancelled' };
    if (this.code === 'auth_expired') {
      return { kind: 'authentication-required', realm: 'marquee' };
    }
    if (this.details?.status === 429) {
      return {
        kind: 'rate-limited',
        ...(this.details.retryAfterMs !== undefined
          ? { retryAfterMs: this.details.retryAfterMs }
          : {}),
      };
    }
    if (this.code === 'timeout') return { kind: 'timeout' };
    return { kind: 'unavailable' };
  }
}
