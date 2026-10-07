import { AuthApi } from '../api/auth/index.js';

// How a browser proves a Marquee login, whatever drives it: the CLI's login evaluates
// these scripts through agent-browser, the Chat Service's Sign-in Sheet over CDP.

export const LOGIN_WAIT_SECONDS = 120;
export const AUTH_POLL_INTERVAL_MS = 250;
// agent-browser answers a command after the window closed on a fresh
// about:blank page, so that page means the person closed the window.
// The page's own fetch probes the current-user endpoint AuthApi defines, with the browser's cookies.
export const LOGIN_STATE_SCRIPT = `(async () => { if (location.href === "about:blank") return "closed"; let authed = false; try { if (location.hostname === "marquee.gs.com") { const r = await fetch(${JSON.stringify(AuthApi.currentUser.path)}, { credentials: "include" }); authed = r.ok; } } catch (e) { authed = false; } if (authed) return "authed"; return document.querySelector('input[name="username"]') ? "form" : "pending"; })()`;

/** The wall clock a login probe's wait ends on, and how it sleeps between looks. */
export type PollClock = Readonly<{ now: () => number; sleep: (ms: number) => Promise<void> }>;

/**
 * Evaluate `script` now and every AUTH_POLL_INTERVAL_MS until `settle` answers for its value,
 * the last time as `waitSeconds` of wall-clock time on `clock` run out, however long each look
 * takes; undefined if it never settles.
 */
export async function pollLoginProbe<Value, Settled>(
  evaluate: (script: string) => Promise<Value>,
  script: string,
  settle: (value: Value) => Settled | undefined,
  { waitSeconds, clock }: Readonly<{ waitSeconds: number; clock: PollClock }>,
): Promise<Settled | undefined> {
  const deadline = clock.now() + waitSeconds * 1_000;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polls the login until it settles or the wait runs out
    const settled = settle(await evaluate(script));
    if (settled !== undefined) return settled;
    const left = deadline - clock.now();
    if (left <= 0) return undefined;
    // eslint-disable-next-line no-await-in-loop -- polls the login until it settles or the wait runs out
    await clock.sleep(Math.min(AUTH_POLL_INTERVAL_MS, left));
  }
}
