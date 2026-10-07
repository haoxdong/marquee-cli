import type { WidgetError } from './types.js';

export function missingWidgetTarget(widgetId: string): WidgetError {
  return { kind: 'invalid-definition', identity: { widgetId }, problem: 'missing-target' };
}

export function widgetConfigurationMintFailure(widgetId: string): WidgetError {
  return { kind: 'configuration-mint-failure', identity: { widgetId } };
}

export function widgetConfigurationMismatch(
  widgetId: string,
  configurationId: string,
  ownerWidgetId?: string,
): WidgetError {
  return {
    kind: 'configuration-mismatch',
    identity: { widgetId, configurationId },
    ...(ownerWidgetId ? { ownerWidgetId } : {}),
  };
}

export function unsupportedWidgetExecutionTarget(widgetId: string, targetId: string): WidgetError {
  return { kind: 'unsupported-execution-target', identity: { widgetId }, targetId };
}

export function incompatibleWidgetInput(widgetId: string, input: string): WidgetError {
  return { kind: 'invalid-input', identity: { widgetId }, input, problem: 'incompatible-dependent-input' };
}
