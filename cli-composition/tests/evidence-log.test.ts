import { describe, expect, it } from 'vitest';
import { createProviderEvidenceLog } from '../evidence.js';

describe('provider evidence log', () => {
  it('keeps logical calls in dispatch order when they complete out of order', () => {
    const evidenceLog = createProviderEvidenceLog();
    const first = evidenceLog.reserve({ owner: 'document-owner', operation: 'resolve facets' });
    const second = evidenceLog.reserve({ owner: 'document-owner', operation: 'search' });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    second?.succeed({ request: 'search' });
    first?.succeed({ request: 'facets' });

    const evidence = evidenceLog.snapshot();
    expect(evidence).toEqual([
      {
        order: 1,
        owner: 'document-owner',
        operation: 'resolve facets',
        outcome: 'succeeded',
        value: { request: 'facets' },
      },
      {
        order: 2,
        owner: 'document-owner',
        operation: 'search',
        outcome: 'succeeded',
        value: { request: 'search' },
      },
    ]);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(evidence.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it('retains dispatched failures and cancellations but omits pre-dispatch cancellation', () => {
    const evidenceLog = createProviderEvidenceLog();
    const aborted = new AbortController();
    aborted.abort();

    expect(evidenceLog.reserve(
      { owner: 'view-owner', operation: 'cancelled before dispatch' },
      aborted.signal,
    )).toBeUndefined();

    evidenceLog.reserve({ owner: 'view-owner', operation: 'failed call' })?.fail({ kind: 'timeout' });
    evidenceLog.reserve({ owner: 'view-owner', operation: 'cancelled call' })?.cancel();

    expect(evidenceLog.snapshot()).toEqual([
      {
        order: 1,
        owner: 'view-owner',
        operation: 'failed call',
        outcome: 'failed',
        value: { kind: 'timeout' },
      },
      {
        order: 2,
        owner: 'view-owner',
        operation: 'cancelled call',
        outcome: 'cancelled',
      },
    ]);
  });

  it('captures an immutable snapshot isolated from later journal entries', () => {
    const evidenceLog = createProviderEvidenceLog();
    evidenceLog.reserve({ owner: 'identity-owner', operation: 'status' })?.succeed();

    const snapshot = evidenceLog.snapshot();
    evidenceLog.reserve({ owner: 'identity-owner', operation: 'later call' })?.succeed();

    expect(snapshot).toEqual([
      {
        order: 1,
        owner: 'identity-owner',
        operation: 'status',
        outcome: 'succeeded',
      },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});
