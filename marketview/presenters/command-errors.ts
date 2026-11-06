import type { ReferentRef } from '../../referent-registry/index.js';
import { formatWrongReferentRefGuidance } from '../../presentation/index.js';
import { rejectMarketViewInput } from './failure-semantics.js';
import type { MarketViewPresentationSink } from './types.js';

export function rejectWrongMarketViewRef(
  sink: MarketViewPresentationSink,
  cleanRef: string,
  ref: ReferentRef,
): never {
  const guidance = formatWrongReferentRefGuidance(ref);
  const refKind = ref.type === 'entity-feed' ? 'dashboard' : ref.type;
  return rejectMarketViewInput(sink, `Error: ref @${cleanRef} is a ${refKind}${guidance}`);
}

export function formatUnknownMarketViewRef(
  cleanRef: string,
  availableRefs: readonly string[],
): string {
  // `split` always returns at least one part.
  const [namespace] = cleanRef.split('.') as [string, ...string[]];
  const score = (name: string) => (
    name === namespace
      ? 0
      : name.startsWith(`${namespace}.`)
        ? 1
        : name[0] === cleanRef[0] ? 2 : 3
  );
  // A stable sort keeps the registry's order among refs that score the same.
  const rankedRefs = [...availableRefs].sort((left, right) => score(left) - score(right));
  const visible = rankedRefs.slice(0, 6);
  if (visible.length === 0) {
    return `Error: ref @${cleanRef} not found\nHint: run the previous command again or use one of the refs printed above.`;
  }
  return [
    `Error: ref @${cleanRef} not found`,
    `Hint: current refs include ${visible.map((name) => `@${name}`).join(', ')}${rankedRefs.length > visible.length ? ', ...' : ''}.`,
    'Run the previous command again or use one of the refs printed above.',
  ].join('\n');
}
