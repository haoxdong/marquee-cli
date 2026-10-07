import type { PollClock } from '../login-probe.js';

/** A clock that moves only as the code under test sleeps, or as a test moves `time` itself. */
export function virtualClock(): PollClock & { time: number } {
  const clock = {
    time: 0,
    now: () => clock.time,
    sleep: async (ms: number) => void (clock.time += ms),
  };
  return clock;
}
