import assert from 'node:assert/strict';
import { cleanText } from './parameters.js';
import type { WidgetPayload } from './payload.js';
import { WidgetSemanticFailure } from './semantic-failure.js';
import { record } from '../lib/json-value.js';

export function validateWidgetSnippetContext(
  widget: WidgetPayload,
  input: {
    widgetId: string;
    configurationId: string;
    definitionTargetId: string;
  },
): void {
  const contextualConfiguration = record(widget.configuration);
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
