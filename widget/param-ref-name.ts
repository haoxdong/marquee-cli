/** A widget param's `-p` name: its provider field in camelCase (`Relative Date` → `relativeDate`). */
export function widgetParamRefName(field: string): string {
  return field
    .split(/\s/)
    .map((part, index) => {
      const normalized = /^[A-Z0-9]+$/.test(part) ? part.toLowerCase() : part;
      return index === 0
        ? `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`
        : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    })
    .join('');
}
