const PROXY_ENV_NAMES = new Set([
  'AGENT_BROWSER_PROXY',
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
]);

export const NO_PROXY_REMEDIATION = 'NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1"';

type Environment = Record<string, string | undefined>;

function failureText(failure: unknown): string {
  if (!(failure instanceof Error)) {
    return String(failure);
  }

  const details = [failure.name, failure.message];
  const errno = failure as Error & {
    cause?: unknown;
    // Node's system errors (NodeJS.ErrnoException) carry these as strings.
    code?: string;
    hostname?: string;
    syscall?: string;
  };
  details.push(String(errno.code ?? ''), String(errno.hostname ?? ''), String(errno.syscall ?? ''));
  if (errno.cause !== undefined && errno.cause !== failure) {
    details.push(failureText(errno.cause));
  }
  return details.join(' ');
}

function hasConfiguredProxy(env: Environment): boolean {
  return Object.entries(env).some(([name, value]) => (
    Boolean(value?.trim()) && PROXY_ENV_NAMES.has(name.toUpperCase())
  ));
}

function normalizedNoProxyHost(entry: string): string {
  return entry
    .trim()
    .replace(/^\*\./, '')
    .replace(/^\./, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function findMatchingNoProxyEntry(host: string, env: Environment): string | undefined {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  for (const [name, value] of Object.entries(env)) {
    if (name.toLowerCase() !== 'no_proxy' || !value) continue;
    for (const rawEntry of value.split(',')) {
      const entry = rawEntry.trim();
      if (!entry) continue;
      if (entry === '*') return entry;
      const entryHost = normalizedNoProxyHost(entry);
      if (entryHost && (normalizedHost === entryHost || normalizedHost.endsWith(`.${entryHost}`))) {
        return entry;
      }
    }
  }
  return undefined;
}

export function noProxyDnsDiagnostic(
  host: string,
  failure: unknown,
  env: Environment = process.env,
): string | undefined {
  if (!/(?:ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|getaddrinfo)/i.test(failureText(failure))) {
    return undefined;
  }
  if (!hasConfiguredProxy(env)) {
    return undefined;
  }
  const noProxyEntry = findMatchingNoProxyEntry(host, env);
  if (!noProxyEntry) {
    return undefined;
  }

  return `${host} failed to resolve directly, and NO_PROXY (${noProxyEntry}) is routing it around your proxy. Either remove the matching entry from NO_PROXY, or run with: ${NO_PROXY_REMEDIATION}`;
}
