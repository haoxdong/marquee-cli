import { AsyncLocalStorage } from 'node:async_hooks';
import { MarqueeError, type Endpoint } from '../../transport/index.js';
type WidgetRequestInit = {
  query?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  hedgeDelaysMs?: number[];
};
type WidgetTransport = {
  request(endpoint: Endpoint, init?: WidgetRequestInit): Promise<unknown>;
};
type WidgetCall = {
  name: string;
  request: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
  };
  error?: string;
};

/**
 * The upstream calls of one widget load, kept only to word its error
 * (the failing path, the provider body, the params a change sent).
 */
export type WidgetCallLog = {
  intent: 'read' | 'change' | 'resolve-input';
  calls: WidgetCall[];
  failure?: {
    message: string;
    status?: number;
    path?: string;
    body?: string;
    responseClassification?: string;
  };
};

export interface WidgetEvidenceRecorder {
  port: {
    request(target: Endpoint, init?: WidgetRequestInit): Promise<unknown>;
  };
  record<T>(
    intent: WidgetCallLog['intent'],
    load: () => Promise<T>,
  ): Promise<{ result: T; audit: WidgetCallLog }>;
}

// The transport appends a short provider body to its message; the call log keeps it apart as `body`.
function failureFrom(error: unknown): NonNullable<WidgetCallLog['failure']> {
  if (!(error instanceof MarqueeError)) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  const { status, path, body, responseClassification } = error.details ?? {};
  const bodySuffix = ` — ${body}`;
  return {
    message: error.message.endsWith(bodySuffix)
      ? error.message.slice(0, -bodySuffix.length)
      : error.message,
    ...(status === undefined ? {} : { status }),
    ...(path === undefined ? {} : { path }),
    ...(body === undefined ? {} : { body }),
    ...(responseClassification === undefined ? {} : { responseClassification }),
  };
}

function callName(path: string, method: Endpoint['method']): string {
  if (path.includes('/marketview/widgets/configurations')) {
    return method === 'POST' ? 'configuration.create' : 'configuration.detail';
  }
  if (path.includes('/marketview/widgets/')) return 'widget.metadata';
  if (path.includes('/marketview/dashboards')) return 'dashboard.list';
  if (path.includes('/charts/')) return 'chart.definition';
  if (path.includes('/plots/entities')) return 'entity.resolve';
  if (path.includes('/marketview/constituents')) return 'constituents.resolve';
  if (path.includes('/data/visualizations/')) return 'dv.render';
  if (path.includes('/plots/runner')) return 'ch.runner';
  return 'upstream';
}

function requestRecord(
  { method, path }: Endpoint,
  init?: WidgetRequestInit,
): WidgetCall['request'] {
  return {
    method,
    path,
    ...(init?.query ? { query: init.query } : {}),
    ...(init?.body !== undefined ? { body: init.body } : {}),
  };
}

export function createWidgetEvidenceRecorder(target: WidgetTransport): WidgetEvidenceRecorder {
  const active = new AsyncLocalStorage<WidgetCallLog | undefined>();

  return {
    port: {
      async request(endpoint, init) {
        const log = active.getStore();
        if (!log) return target.request(endpoint, init);

        const { method, path } = endpoint;
        const call: WidgetCall = {
          name: callName(path, method),
          request: requestRecord(endpoint, init),
        };
        log.calls.push(call);
        try {
          return await target.request(endpoint, init);
        } catch (error) {
          const canceledDashboardEnrichment = path.includes('/marketview/dashboards')
            && init?.signal?.aborted === true
            && error instanceof MarqueeError
            && error.details?.isCanceled === true;
          if (!canceledDashboardEnrichment) {
            log.failure ??= failureFrom(error);
            call.error = log.failure.message;
          }
          throw error;
        }
      },
    },
    async record(intent, load) {
      const audit: WidgetCallLog = { intent, calls: [] };
      return { result: await active.run(audit, load), audit };
    },
  };
}
