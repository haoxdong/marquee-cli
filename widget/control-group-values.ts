function controlGroupMembers(
  value: unknown,
  controlGroups: Readonly<Record<string, readonly string[]>>,
): readonly string[] | undefined {
  return typeof value === 'string' ? controlGroups[value] : undefined;
}

export function expandControlGroupValues(
  values: readonly unknown[],
  controlGroups: Readonly<Record<string, readonly string[]>>,
): unknown[] {
  return values.flatMap((value): readonly unknown[] => (
    controlGroupMembers(value, controlGroups) ?? [value]
  ));
}
