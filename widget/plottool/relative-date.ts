function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Payload-inspection predicates for the relative-date object a Widget Payload
// hides inside a component value: `{ rdate: { rule }, value }`. Pure and
// bottom-layer — the safe, foundational slice of the relative-date engine. The
// display/reconciliation engine (freshest-concrete-value logic) is not here.

export function isRelativeDateObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isRecord(value.rdate) && typeof value.rdate.rule === 'string';
}

export function relativeDateRule(value: unknown): string | undefined {
  if (!isRelativeDateObject(value) || !isRecord(value.rdate)) {
    return undefined;
  }
  return String(value.rdate.rule);
}

export function relativeDateConcreteValue(value: unknown): unknown {
  return isRelativeDateObject(value) ? value.value : undefined;
}

export function resolveRelativeDateDefault(
  componentValue: unknown,
  rawDefault: unknown,
): unknown {
  const concreteValue = relativeDateConcreteValue(componentValue);
  if (
    String(rawDefault) === relativeDateRule(componentValue)
    || (
      concreteValue !== undefined
      && concreteValue !== null
      && JSON.stringify(rawDefault) === JSON.stringify(concreteValue)
    )
  ) {
    return componentValue;
  }
  return rawDefault;
}
