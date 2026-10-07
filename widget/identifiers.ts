import type { ConfigId, WidgetId } from './types.js';

export function parseWidgetId(value: string): WidgetId | undefined {
  return /^MW[A-Z0-9_]+$/i.test(value) ? value as WidgetId : undefined;
}

export function parseConfigId(value: string): ConfigId | undefined {
  return /^WC[A-Z0-9_]+$/i.test(value) ? value as ConfigId : undefined;
}
