/** The only element of `items`; undefined when `items` is empty or holds more than one. */
export function soleElement<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}
