// QuickPoll surveyDate fill policy — single source of truth.
//
// surveyDate depends on question, so refreshing it in isolation from the CLI
// renders mismatched title/data/description. This module owns that rule for
// both paths that need it:
//   - the fill path (widget-module) rejects the unsafe mutation, and
//   - the read path (widget-view) stamps `fillBlocked` on the param so the CLI
//     suggests adjusting it in the UI instead of a `fill ... 0b` that the
//     adapter would just reject.
import type { MutableWidgetParameter } from './parameters.js';
import { QUICKPOLL_SURVEY_DATE_REASON } from './fill-policy-constants.js';
import { optionalWidgetPayloadArray } from './payload.js';

function stringValues(value: unknown, label: string): string[] {
  return optionalWidgetPayloadArray(value, label).map((item) => String(item));
}

function property(value: unknown, key: string): unknown {
  return Reflect.get(Object(value), key);
}

function normalizedFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isQuickPollWidget(widget: unknown): boolean {
  const metadata = property(widget, 'metadata');
  const markers = [
    ...stringValues(property(widget, 'tags'), 'tags'),
    ...stringValues(property(metadata, 'tags'), 'metadata.tags'),
    ...stringValues(property(metadata, 'dataSources'), 'metadata.dataSources'),
    ...stringValues(property(widget, 'dataAttribution'), 'dataAttribution'),
  ].map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''));

  return markers.some((value) => value.includes('quickpoll'));
}

export function isQuickPollSurveyDateField(field: string): boolean {
  return normalizedFieldName(field) === 'surveydate';
}

// Stamp `fillBlocked` on params the CLI must not suggest a `fill ... 0b` refresh
// for. The raw widget (with all QuickPoll markers) is the input; the read path
// only sees a lossy projection, so this detection must run here.
export function annotateFillPolicy(params: MutableWidgetParameter[], widgetRaw: unknown): MutableWidgetParameter[] {
  if (!isQuickPollWidget(widgetRaw)) {
    return params;
  }
  return params.map((param) =>
    isQuickPollSurveyDateField(param.field)
      ? { ...param, fillBlocked: { reason: QUICKPOLL_SURVEY_DATE_REASON } }
      : param,
  );
}
