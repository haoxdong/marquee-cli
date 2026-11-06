/** A non-null object, arrays included: every caller reads named keys an array lacks, or checks arrays first. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
