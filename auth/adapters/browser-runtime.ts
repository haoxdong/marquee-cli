import type {
  AgentBrowserRuntime,
} from '../../agent-browser-runtime/index.js';
import type { Cookie } from '../../transport/index.js';

const MARQUEE_WEB_ORIGIN = 'https://marquee.gs.com';
const MARQUEE_HOST = 'marquee.gs.com';

export interface AuthBrowserRuntimeOptions {
  getCookies(): readonly Cookie[] | undefined;
  runtime: AgentBrowserRuntime;
}

export interface AuthBrowserRuntime {
  syncBrowserSession(session: string): Promise<void>;
}

export function createAuthBrowserRuntime(
  options: AuthBrowserRuntimeOptions,
): AuthBrowserRuntime {
  /**
   * Signs Browser Session `session` in to Marquee by setting the cookie jar's Marquee cookies. It
   * names no launch option, so Chrome launches as the command's own call does.
   */
  async function syncBrowserSession(session: string): Promise<void> {
    const cookies = options.getCookies();
    if (!cookies) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const cookie of cookies) {
      if (!isUnexpired(cookie, nowSeconds) || !domainMatches(cookie.domain, MARQUEE_HOST)) continue;
      // eslint-disable-next-line no-await-in-loop -- one agent-browser command at a time on the session
      await options.runtime.execute({ session, argv: ['cookies', ...browserCookieSetArgs(cookie)] });
    }
  }

  return { syncBrowserSession };
}

function domainMatches(cookieDomain: string, host: string): boolean {
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return host === normalized || host.endsWith(`.${normalized}`);
}

function isUnexpired(cookie: Cookie, nowSeconds: number): boolean {
  return cookie.expires === undefined || cookie.expires < 0 || cookie.expires > nowSeconds;
}

function browserCookieSetArgs(cookie: Cookie): string[] {
  const args = ['set', cookie.name, cookie.value, '--url', MARQUEE_WEB_ORIGIN];
  if (cookie.domain) args.push('--domain', cookie.domain);
  if (cookie.path) args.push('--path', cookie.path);
  if (cookie.httpOnly) args.push('--httpOnly');
  if (cookie.secure) args.push('--secure');
  if (cookie.sameSite) args.push('--sameSite', cookie.sameSite);
  if (cookie.expires !== undefined) args.push('--expires', String(Math.floor(cookie.expires)));
  return args;
}
