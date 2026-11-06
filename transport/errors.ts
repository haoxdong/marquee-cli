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
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  toJSON(): { code: MarqueeErrorCode; message: string; details?: MarqueeErrorDetails } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }

  /** Marquee's own refusal: the status it answered and its message as it sent it; absent for any other failure. */
  marqueeAnswer(): Readonly<{ status: number; message: string }> | undefined {
    const status = this.details?.status;
    if (this.code !== 'http' || status === undefined || status < 400) return undefined;
    return { status, message: MarqueeError.marqueeMessage(this.details?.body ?? '') };
  }

  /**
   * The message in an error body as Marquee writes it: its `errorMessages`, `errors`, `messages`
   * (joined by `; `), `message` or `error`, the runner's failed `results` messages, or else the body itself.
   */
  static marqueeMessage(body: string): string {
    return MarqueeError.messageIn(body).replace(/\s*\n\s*/g, ' ');
  }

  private static messageIn(body: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return body;
    }
    if (typeof parsed !== 'object' || parsed === null) return body;
    const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(parsed));
    const failedResults = Array.isArray(fields.results)
      ? fields.results.flatMap((result: unknown) => (typeof result === 'object' && result !== null && 'error' in result && 'message' in result && typeof result.message === 'string' ? [result.message] : []))
      : [];
    const listed = fields.errorMessages ?? fields.errors ?? fields.messages ?? fields.message ?? fields.error ?? (failedResults.length > 0 ? failedResults : undefined);
    if (typeof listed === 'string' && listed !== '') return listed;
    if (Array.isArray(listed) && listed.length > 0 && listed.every((each) => typeof each === 'string')) return listed.join('; ');
    return body;
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
    const answer = this.marqueeAnswer();
    return answer === undefined ? { kind: 'unavailable' } : { kind: 'unavailable', ...answer };
  }
}
