/** `value` as a plain JSON object, or undefined for arrays, null and primitives. */
export function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** `value` trimmed when it is a non-blank string, otherwise undefined. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
