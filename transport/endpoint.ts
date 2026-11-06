import type { Endpoint, HttpRequestInit } from './types.js';

// Transport accepts only an Endpoint, built in the API Client layer (ADR 0072); its own
// method replaces the caller's.
export function requestTarget<Init extends HttpRequestInit>(
  target: Endpoint,
  init: Init | undefined,
): [string, Init | undefined] {
  return [target.path, { ...init, method: target.method } as Init];
}
