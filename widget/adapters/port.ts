import type { Endpoint } from '../../transport/index.js';

interface WidgetRequestInit {
  query?: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
  responseType?: 'json' | 'text' | 'arrayBuffer';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  hedgeDelaysMs?: number[];
  isHtmlAccepted?: boolean;
  redirect?: 'manual';
}

export interface WidgetPort {
  request(target: Endpoint, init?: WidgetRequestInit): Promise<unknown>;
}
