import assert from 'node:assert/strict';
import { cleanText } from './parameters.js';
import type { WidgetPayload } from './payload.js';
import { WidgetSemanticFailure } from './semantic-failure.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateWidgetSnippetContext(
  widget: WidgetPayload,
  input: {
    widgetId: string;
    configurationId: string;
    definitionTargetId: string;
  },
): void {
  const contextualConfiguration = isRecord(widget.configuration)
    ? widget.configuration
    : undefined;
  const returnedTargetId = cleanText(
    contextualConfiguration?.underlyingChartId
      ?? contextualConfiguration?.chartId,
  );
  assert(
    ['', input.definitionTargetId.toUpperCase()].includes(returnedTargetId.toUpperCase()),
    new WidgetSemanticFailure({
      kind: 'configuration-mismatch',
      identity: {
        widgetId: input.widgetId,
        configurationId: input.configurationId,
      },
    }),
  );
}
