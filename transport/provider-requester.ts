import { channel } from 'node:diagnostics_channel';
import type { Endpoint, HttpRequestInit } from './types.js';
import { MarqueeError } from './errors.js';

// Each logical request runs in this channel's stores, so all its hedged attempts
// carry one in-process tag, never sent on the wire, that Request Verification
// counts once (ADR 0073).
const logicalRequestChannel = channel('marquee:logical-request');

interface ProviderRequestTransport {
  request(endpoint: Endpoint, init?: HttpRequestInit): Promise<unknown>;
}

type ProviderRequestInit = HttpRequestInit & Readonly<{
  hedgeDelaysMs?: readonly number[];
}>;

type ProviderEvidenceReservation = Readonly<{
  succeed(value?: unknown): void;
  fail(value?: unknown): void;
  cancel(value?: unknown): void;
}>;

export interface ProviderRequestEvidence {
  reserve(
    call: Readonly<{ owner: string; operation: string }>,
    signal?: AbortSignal,
  ): ProviderEvidenceReservation | undefined;
}

export interface ProviderRequester {
  request(target: Endpoint, init?: ProviderRequestInit): Promise<unknown>;
}

function providerFailureEvidence(error: unknown): Record<string, unknown> {
  if (!(error instanceof MarqueeError)) {
    return {
      kind: 'provider-failure',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const body = error.details?.body;
  const suffix = body ? ` — ${body}` : '';
  const message = suffix && error.message.endsWith(suffix)
    ? error.message.slice(0, -suffix.length)
    : error.message;
  return {
    kind: 'provider-failure',
    message,
    code: error.code,
    ...(error.details ? { details: { ...error.details } } : {}),
  };
}

export function createProviderRequester(options: Readonly<{
  owner: string;
  getTransport: () => ProviderRequestTransport;
  evidence?: ProviderRequestEvidence | undefined;
}>): ProviderRequester {
  const requester: ProviderRequester = {
    async request(endpoint, init) {
      const reservation = options.evidence?.reserve({
        owner: options.owner,
        operation: `${endpoint.method} ${endpoint.path}`,
      }, init?.signal);
      const send = (signal: AbortSignal) => {
        const { hedgeDelaysMs: _hedgeDelaysMs, ...requestInit } = init ?? {};
        return options.getTransport().request(endpoint, { ...requestInit, signal });
      };

      try {
        const delays = init?.hedgeDelaysMs ?? [];
        const result = delays.length > 0
          ? await executeHedgedProviderRequest(send, delays, init?.signal)
          : await send(init?.signal ?? new AbortController().signal);
        reservation?.succeed(result);
        return result;
      } catch (error) {
        if (error instanceof MarqueeError && error.details?.isCanceled === true) {
          reservation?.cancel(providerFailureEvidence(error));
        } else {
          reservation?.fail(providerFailureEvidence(error));
        }
        throw error;
      }
    },
  };
  return {
    // A fresh object per call is the logical request's tag.
    request: (target, init) => logicalRequestChannel.runStores({}, () => requester.request(target, init)),
  };
}

function executeHedgedProviderRequest<T>(
  send: (signal: AbortSignal) => Promise<T>,
  hedgeDelaysMs: readonly number[],
  callerSignal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let rejected = 0;
    const errors: unknown[] = [];
    const timers: NodeJS.Timeout[] = [];
    const controllers: AbortController[] = [];
    const attemptCount = hedgeDelaysMs.length + 1;
    let pendingHedgesCanceled = false;
    const onCallerAbort = () => rejectOnce(
      new MarqueeError('network', 'Request canceled after caller aborted', { isCanceled: true }),
    );
    const cleanup = (winner?: AbortController) => {
      for (const timer of timers) clearTimeout(timer);
      for (const active of controllers) {
        // Stryker disable next-line ConditionalExpression: the winner has already returned its value, so aborting it too changes nothing
        if (active !== winner) active.abort();
      }
      callerSignal?.removeEventListener('abort', onCallerAbort);
    };

    const resolveOnce = (value: T, winner: AbortController) => {
      if (settled) return;
      settled = true;
      cleanup(winner);
      resolve(value);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const cancelPendingHedges = () => {
      pendingHedgesCanceled = true;
      for (const timer of timers) clearTimeout(timer);
    };

    const rejectIfExhausted = () => {
      const expectedRejections = pendingHedgesCanceled ? controllers.length : attemptCount;
      if (!settled && rejected >= expectedRejections) {
        rejectOnce(errors[0]);
      }
    };

    if (callerSignal?.aborted) {
      onCallerAbort();
      return;
    }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    const start = () => {
      if (settled) return;
      const attemptIndex = controllers.length;
      const controller = new AbortController();
      controllers.push(controller);
      send(controller.signal).then(
        (value) => resolveOnce(value, controller),
        (error) => {
          errors[attemptIndex] = error;
          rejected += 1;
          if (!settled && isRateLimitError(error)) {
            cancelPendingHedges();
            rejectIfExhausted();
            return;
          }
          if (!settled && isDeterministicClientError(error)) {
            rejectOnce(error);
            return;
          }
          rejectIfExhausted();
        },
      );
    };

    start();
    for (const delayMs of hedgeDelaysMs) {
      timers.push(setTimeout(start, delayMs));
    }
  });
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof MarqueeError && error.details?.status === 429;
}

function isDeterministicClientError(error: unknown): boolean {
  if (!(error instanceof MarqueeError)) return false;
  const status = error.details?.status;
  if (typeof status !== 'number') return false;
  if (status === 500) return true;
  return status >= 400 && status < 500 && status !== 408;
}
