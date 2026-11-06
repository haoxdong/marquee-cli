import { channel } from 'node:diagnostics_channel';
import type { Endpoint, HttpRequestInit } from './types.js';
import { MarqueeError } from './errors.js';

// Each logical request runs in this channel's stores, so it carries one
// in-process tag, never sent on the wire, that Request Verification counts
// once (ADR 0073).
const logicalRequestChannel = channel('marquee:logical-request');

interface ProviderRequestTransport {
  request(endpoint: Endpoint, init?: HttpRequestInit): Promise<unknown>;
}

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
  request(target: Endpoint, init?: HttpRequestInit): Promise<unknown>;
}

function providerFailureEvidence(error: MarqueeError): Record<string, unknown> {
  return {
    kind: 'provider-failure',
    message: error.message,
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
      try {
        const result = await options.getTransport().request(endpoint, init);
        reservation?.succeed(result);
        return result;
      } catch (error) {
        if (error instanceof MarqueeError && error.details?.isCanceled === true) {
          reservation?.cancel(providerFailureEvidence(error));
        } else {
          reservation?.fail(providerFailureEvidence(error as MarqueeError));
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
