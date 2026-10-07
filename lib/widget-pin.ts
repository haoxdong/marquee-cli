import { record, text } from './json-value.js';
import { requiredGroup } from './regex-group.js';

export type WidgetPin = {
  widgetId: string;
  configurationId?: string;
};

/** Upper-cases a Marquee widget (MW…) or widget configuration (WC…) id; other values pass through. */
export function normalizedId(value: string): string {
  return /^(?:MW|WC)[A-Z0-9_]+$/i.test(value) ? value.toUpperCase() : value;
}

/** Decodes a dashboard pin given as `MW…[-:?|WC…]` or as `{ widgetId|id, configurationId|configId }`. */
export function decodeWidgetPin(value: unknown): WidgetPin | undefined {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(MW[A-Z0-9_]+)(?:[-:?|](WC[A-Z0-9_]+))?$/i);
    return match ? {
      widgetId: normalizedId(requiredGroup(match, 1)),
      ...(match[2] ? { configurationId: normalizedId(match[2]) } : {}),
    } : undefined;
  }
  const pin = record(value);
  const widgetId = text(pin?.widgetId) ?? text(pin?.id);
  if (!widgetId) return undefined;
  const configurationId = text(pin?.configurationId) ?? text(pin?.configId);
  return {
    widgetId: normalizedId(widgetId),
    ...(configurationId ? { configurationId: normalizedId(configurationId) } : {}),
  };
}
