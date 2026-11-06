type ProviderEvidenceOutcome =
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type ProviderEvidence = Readonly<{
  order: number;
  owner: string;
  operation: string;
  outcome: ProviderEvidenceOutcome;
  value?: unknown;
}>;

type ProviderEvidenceCall = Readonly<{
  owner: string;
  operation: string;
}>;

interface ProviderEvidenceReservation {
  succeed(value?: unknown): void;
  fail(value?: unknown): void;
  cancel(value?: unknown): void;
}

export interface ProviderEvidenceLog {
  reserve(
    call: ProviderEvidenceCall,
    signal?: AbortSignal,
  ): ProviderEvidenceReservation | undefined;
  snapshot(): readonly ProviderEvidence[];
}

type EvidenceEntry = {
  order: number;
  owner: string;
  operation: string;
  outcome: ProviderEvidenceOutcome;
  value?: unknown;
};

export function createProviderEvidenceLog(): ProviderEvidenceLog {
  const entries: EvidenceEntry[] = [];

  return {
    reserve(call, signal) {
      if (signal?.aborted) return undefined;

      const entry: EvidenceEntry = {
        order: entries.length + 1,
        owner: call.owner,
        operation: call.operation,
        outcome: 'dispatched',
      };
      entries.push(entry);
      let isComplete = false;

      const finish = (outcome: ProviderEvidenceOutcome, value?: unknown): void => {
        if (isComplete) {
          throw new Error(`provider evidence call ${entry.order} is already complete`);
        }
        isComplete = true;
        entry.outcome = outcome;
        if (value !== undefined) entry.value = value;
      };

      return Object.freeze({
        succeed: (value?: unknown) => finish('succeeded', value),
        fail: (value?: unknown) => finish('failed', value),
        cancel: (value?: unknown) => finish('cancelled', value),
      });
    },
    snapshot() {
      return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
    },
  };
}
