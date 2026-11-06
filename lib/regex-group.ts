/** Capture group `index` of `match`; throws when that group took no part in the match. */
export function requiredGroup(match: RegExpMatchArray, index: number): string {
  const group = match[index];
  if (group === undefined) {
    throw new Error(`Regex capture group ${index} did not match ${JSON.stringify(match[0])}`);
  }
  return group;
}
