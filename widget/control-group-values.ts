export function expandControlGroupValues(
  values: readonly unknown[],
  controlGroups: Readonly<Record<string, readonly string[]>>,
): unknown[] {
  return values.flatMap((value): readonly unknown[] => (
    (typeof value === 'string' ? controlGroups[value] : undefined) ?? [value]
  ));
}
