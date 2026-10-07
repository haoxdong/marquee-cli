import type { Endpoint } from '../transport/index.js';

// The API Client core every client shares (ADR 0072). Each client has its own entry point,
// marquee-cli/api/<domain>/index.ts, which only its owning domain modules may import.

// The parameters a client sends with an Endpoint.
type ApiRequestInit = Readonly<{
  query?: Readonly<Record<string, unknown>>;
  body?: unknown;
  expectedContentType?: string;
}>;

export type ApiRequester = Readonly<{
  request(endpoint: Endpoint, init?: ApiRequestInit): Promise<unknown>;
}>;

export function get(path: string): Endpoint {
  return { method: 'GET', path } as Endpoint;
}

export function post(path: string): Endpoint {
  return { method: 'POST', path } as Endpoint;
}

export function put(path: string): Endpoint {
  return { method: 'PUT', path } as Endpoint;
}

export function del(path: string): Endpoint {
  return { method: 'DELETE', path } as Endpoint;
}
