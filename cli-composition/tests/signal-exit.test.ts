import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { installSignalExitCodes } from '../signal-exit.js';

describe('CLI signal exit codes', () => {
  it('exits 2 on SIGINT', () => {
    const exit = vi.fn<(code?: number) => never>();
    const target = Object.assign(new EventEmitter(), { exit });
    installSignalExitCodes(target as unknown as NodeJS.Process);

    target.emit('SIGINT');

    expect(exit.mock.calls).toEqual([[2]]);
  });

  it('exits 143 on SIGTERM', () => {
    const exit = vi.fn<(code?: number) => never>();
    const target = Object.assign(new EventEmitter(), { exit });
    installSignalExitCodes(target as unknown as NodeJS.Process);

    target.emit('SIGTERM');

    expect(exit.mock.calls).toEqual([[143]]);
  });
});
