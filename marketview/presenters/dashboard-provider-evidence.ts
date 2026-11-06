import type { MarketViewProviderEvidence } from '../index.js';

// The provider requester records this value for every request that fails or is cancelled.
type ProviderFailure = Readonly<{ kind: 'provider-failure'; message: string }>;

function isProviderFailure(value: unknown): value is ProviderFailure {
  return (value as { kind?: unknown } | undefined)?.kind === 'provider-failure';
}

/** The message of the latest provider failure among the requests `matches` selects. */
export function dashboardProviderDiagnostic(
  evidence: readonly MarketViewProviderEvidence[],
  matches: (entry: MarketViewProviderEvidence) => boolean = () => true,
): string | undefined {
  return evidence
    .filter(matches)
    .map(({ value }) => value)
    .filter(isProviderFailure)
    .at(-1)
    ?.message;
}
