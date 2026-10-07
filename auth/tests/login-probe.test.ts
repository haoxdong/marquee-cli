import { describe, expect, it } from 'vitest';

import {
  AUTH_POLL_INTERVAL_MS,
  LOGIN_STATE_SCRIPT,
  pollLoginProbe,
} from '../login-probe.js';
import { virtualClock } from './virtual-clock.js';

describe('the login probe poll', () => {
  it('evaluates the script every poll interval until it settles, answering what it settled on', async () => {
    const answers = ['pending', 'form', 'authed'];
    const evaluated: string[] = [];
    const slept: number[] = [];
    const clock = virtualClock();

    const settled = await pollLoginProbe(
      async (script: string) => {
        evaluated.push(script);
        return answers.shift();
      },
      LOGIN_STATE_SCRIPT,
      (state) => (state === 'authed' ? 'signed-in' : undefined),
      { waitSeconds: 120, clock: { now: clock.now, sleep: async (ms) => void slept.push(ms) } },
    );

    expect(settled).toBe('signed-in');
    expect(evaluated).toEqual([LOGIN_STATE_SCRIPT, LOGIN_STATE_SCRIPT, LOGIN_STATE_SCRIPT]);
    expect(slept).toEqual([AUTH_POLL_INTERVAL_MS, AUTH_POLL_INTERVAL_MS]);
  });

  it('answers undefined once its wait runs out, having looked one last time as it did', async () => {
    let evaluations = 0;
    const clock = virtualClock();

    const settled = await pollLoginProbe(
      async () => {
        evaluations += 1;
        return 'pending';
      },
      LOGIN_STATE_SCRIPT,
      (state) => (state === 'authed' ? state : undefined),
      { waitSeconds: 1, clock },
    );

    expect(settled).toBeUndefined();
    expect(clock.time).toBe(1_000);
    expect(evaluations).toBe(1_000 / AUTH_POLL_INTERVAL_MS + 1);
  });

  it('looks once even when it has no time to wait', async () => {
    const settled = await pollLoginProbe(
      async () => 'authed',
      LOGIN_STATE_SCRIPT,
      (state) => (state === 'authed' ? state : undefined),
      { waitSeconds: 0, clock: virtualClock() },
    );

    expect(settled).toBe('authed');
  });

  it('ends at its wall-clock deadline however long each look takes', async () => {
    const clock = virtualClock();
    let evaluations = 0;

    const settled = await pollLoginProbe(
      async () => {
        evaluations += 1;
        clock.time += 1_000;
        return 'pending';
      },
      LOGIN_STATE_SCRIPT,
      (state) => (state === 'authed' ? state : undefined),
      { waitSeconds: 15, clock },
    );

    expect(settled).toBeUndefined();
    expect(evaluations).toBe(13);
    expect(clock.time).toBe(16_000);
  });

  it('sleeps only what is left of a wait that is not a whole number of intervals', async () => {
    const clock = virtualClock();
    const slept: number[] = [];
    let evaluations = 0;

    const settled = await pollLoginProbe(
      async () => {
        evaluations += 1;
        return 'pending';
      },
      LOGIN_STATE_SCRIPT,
      (state) => (state === 'authed' ? state : undefined),
      {
        waitSeconds: 0.6,
        clock: {
          now: clock.now,
          sleep: async (ms) => {
            slept.push(ms);
            await clock.sleep(ms);
          },
        },
      },
    );

    expect(settled).toBeUndefined();
    expect(slept).toEqual([AUTH_POLL_INTERVAL_MS, AUTH_POLL_INTERVAL_MS, 100]);
    expect(evaluations).toBe(4);
    expect(clock.time).toBe(600);
  });

  it('probes Marquee’s current user with the page’s own cookies', () => {
    expect(LOGIN_STATE_SCRIPT).toContain('fetch("/v1/users/self", { credentials: "include" })');
  });
});
