import type { Endpoint } from '../../transport/index.js';

// The one Endpoint no client defines: `marquee api` sends any user-supplied method and path,
// as `gh api` does (ADR 0070). Only that command may import it (ADR 0072).
export function rawEndpoint(method: Endpoint['method'], path: string): Endpoint {
  return { method, path } as Endpoint;
}
