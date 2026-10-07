import { DataVizApi } from '../../api/data-viz/index.js';
import { PlotToolApi } from '../../api/plottool/index.js';
import type { WidgetError } from '../../widget/index.js';
import { isObject } from '../is-object.js';
import type { WidgetCallLog } from './widget-evidence.js';

const QUICKPOLL_SURVEY_DATE_FILL_MESSAGE =
  'QuickPoll surveyDate depends on question; changing surveyDate from the CLI can render mismatched title/data/description. Load the QuickPoll result for the desired survey date, or choose a valid question in Marquee UI before reading data';

type PresentedWidgetError = {
  message: string;
  status?: number;
};

function truncateBodyHint(body: string): string {
  return body.slice(0, 200);
}

function extractRecordBodyHint(
  parsed: Record<string, unknown>,
  preserveDetailSpacing: boolean,
): string | undefined {
  const messages = parsed.errorMessages ?? parsed.errors ?? parsed.messages ?? parsed.message;
  if (Array.isArray(messages) && messages.length > 0) return messages.map(String).join('; ');
  if (typeof messages === 'string' && messages.length > 0) return messages;
  if (typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error;
  // The plot runner reports each failed expression as a `results` entry with an `error`.
  const failed = Array.isArray(parsed.results)
    ? parsed.results.filter(isObject).filter((result) => 'error' in result).map((result) => result.message)
    : [];
  if (failed.length > 0) return failed.map(String).join('; ');
  if (preserveDetailSpacing && typeof parsed.detail === 'string' && parsed.detail.length > 0) {
    return `{"detail": ${JSON.stringify(parsed.detail)}}`;
  }
  return undefined;
}

function extractBodyHint(
  body: string | undefined,
  responseClassification: string | undefined,
  preserveDetailSpacing: boolean,
): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'string') return truncateBodyHint(parsed);
    if (isObject(parsed)) {
      const hint = extractRecordBodyHint(parsed, preserveDetailSpacing);
      if (hint) return hint;
    }
    return truncateBodyHint(JSON.stringify(parsed));
  } catch {
    if (responseClassification === 'gateway_html' || responseClassification === 'generic_html') {
      return truncateBodyHint(body);
    }
    return 'Malformed upstream error body';
  }
}

function describeUpstreamPath(path: string): string {
  if (DataVizApi.isVisualizationRender(path)) return `DV render endpoint ${path}`;
  if (PlotToolApi.isRunner(path)) return `CH runner endpoint ${path}`;
  return `upstream path ${path}`;
}

function summarizeParamValue(value: unknown): string {
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map(summarizeParamValue);
    return `[${preview.join(', ')}${value.length > 3 ? `, +${value.length - 3} more` : ''}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    const preview = entries.slice(0, 2).map(([key, nested]) => `${key}:${summarizeParamValue(nested)}`);
    return `{${preview.join(', ')}${entries.length > 2 ? ', ...' : ''}}`;
  }
  const text = String(value);
  return text.length > 20 || /^[A-Z0-9]{15,}$/.test(text) ? '...' : text;
}

// The failed call the message names reports the params it sent; one whose body names none (e.g. a render)
// reports the latest configuration create's.
function changedParamSummary(audit: WidgetCallLog): string | undefined {
  const failed = audit.calls.find((call) => call.error && call.request.path === audit.failure?.path);
  return paramSummary(failed?.request.body)
    ?? paramSummary([...audit.calls].reverse().find((call) => call.name === 'configuration.create')?.request.body);
}

function paramSummary(body: unknown): string | undefined {
  if (!isObject(body)) return undefined;
  const summary = [
    ...(typeof body.relativeDate === 'string' ? [`Relative Date=${body.relativeDate.toUpperCase()}`] : []),
    ...(Array.isArray(body.parameters)
      ? body.parameters.flatMap((parameter) => (
          isObject(parameter) && typeof parameter.field === 'string'
            ? [`${parameter.field}=${summarizeParamValue(parameter.value)}`]
            : []
        ))
      : []),
  ].join(', ');
  return summary || undefined;
}

function auditMessage(
  audit: WidgetCallLog | undefined,
  preserveDetailSpacing = false,
): string | undefined {
  if (!audit) return undefined;
  const { failure } = audit;
  if (!failure) return [...audit.calls].reverse().find((call) => call.error)?.error;
  const pathMessage = failure.path && !failure.message.includes(failure.path)
    ? `${failure.message} at ${describeUpstreamPath(failure.path)}`
    : failure.message;
  const bodyHint = extractBodyHint(
    failure.body,
    failure.responseClassification,
    preserveDetailSpacing,
  );
  return withChangeContext(bodyHint ? `${pathMessage} — ${bodyHint}` : pathMessage, audit);
}

function withChangeContext(message: string, audit?: WidgetCallLog): string {
  const paramSummary = audit?.intent === 'change' ? changedParamSummary(audit) : undefined;
  return paramSummary ? `Widget param change failed (${paramSummary}) — ${message}` : message;
}

function presentWidgetLoadError(
  error: Extract<WidgetError, { kind: 'widget-load-failure' }>,
  audit?: WidgetCallLog,
): PresentedWidgetError {
  const message = auditMessage(audit, error.failure.kind === 'rate-limited')
    ?? `Widget ${error.identity.widgetId} could not be loaded`;
  const status = audit?.failure?.status;
  return {
    message,
    ...(status !== undefined ? { status } : {}),
  };
}

function presentControlGroupError(
  error: Extract<WidgetError, { kind: 'control-group-resolution-failure' }>['failure'],
  audit?: WidgetCallLog,
): string {
  if (error.kind === 'malformed-member') {
    return error.problem === 'incomplete-expansion'
      ? 'Control Group response reached its limit without completeness evidence'
      : 'Entity resolution failed: malformed-entity';
  }
  const evidenceMessage = auditMessage(
    audit,
    error.kind === 'dependency' && error.failure.kind === 'rate-limited',
  );
  if (evidenceMessage) return evidenceMessage;
  if (error.kind === 'access-denied') return 'Entity resolution failed: access-denied';
  switch (error.failure.kind) {
    case 'authentication-required':
      return 'Not authenticated. Run: marquee auth login';
    case 'rate-limited':
      return 'Too many requests';
    case 'timeout':
      return 'Request timed out after 30s';
    case 'cancelled':
      return 'Request canceled after faster hedge completed';
    case 'unavailable':
      return 'Entity resolution failed: dependency';
  }
}

export function presentWidgetError(
  error: WidgetError,
  audit?: WidgetCallLog,
): PresentedWidgetError {
  const widgetId = error.identity.widgetId;
  switch (error.kind) {
    case 'widget-not-found':
      return { message: `Widget ${widgetId} was not found`, status: 404 };
    case 'widget-access-denied':
      return { message: withChangeContext(`Access denied: widget ${widgetId}`, audit), status: 403 };
    case 'widget-load-failure':
      return presentWidgetLoadError(error, audit);
    case 'control-group-resolution-failure': {
      const status = audit?.failure?.status;
      return {
        message: presentControlGroupError(error.failure, audit),
        ...(status !== undefined ? { status } : {}),
      };
    }
    case 'invalid-definition':
      return { message: `Widget ${widgetId || '(missing)'} has an invalid definition: ${error.problem}` };
    case 'invalid-response':
      return { message: invalidWidgetResponseMessage(error) };
    case 'configuration-not-found':
      return { message: `Widget configuration ${error.identity.configurationId} was not found`, status: 404 };
    case 'configuration-mismatch':
      return {
        message: error.ownerWidgetId
          ? `Configuration ${error.identity.configurationId} belongs to widget ${error.ownerWidgetId}, not ${widgetId}`
          : `Widget configuration ${error.identity.configurationId} does not belong to ${widgetId}`,
      };
    case 'configuration-mint-failure':
      return { message: 'Widget configuration creation did not return id' };
    case 'missing-display-evidence':
      return {
        message: error.field === 'title'
          ? `Widget ${widgetId} has no display evidence for snippet title`
          : `Widget ${widgetId} has no display evidence for snippet parameter ${error.field}`,
      };
    case 'unknown-input':
      return { message: `Widget ${widgetId} has no input named ${error.input}. Available: ${error.candidates.join(', ')}` };
    case 'ambiguous-input':
      return {
        message: `ambiguous ${error.input} "${error.requested}" — candidates:\n${error.candidates
          .map((candidate) => `  ${candidate}`)
          .join('\n')}`,
      };
    case 'unmatched-input':
      return { message: unmatchedInputMessage(error) };
    case 'invalid-input':
      return { message: invalidInputMessage(error) };
    case 'required-input':
      return { message: `Widget input ${error.input} is required` };
    case 'unsupported-execution-target':
      return { message: `Widget ${widgetId} has unsupported execution target ${error.targetId || '(missing)'}` };
    case 'plottool-failure':
      return {
        message: auditMessage(audit)
          ?? `Widget ${widgetId} render failed: ${error.problem.kind}`,
      };
    case 'data-viz-failure': {
      const { problem } = error;
      // The malformed problem names the response field that broke the render.
      const detail = problem.kind === 'malformed-result' ? ` (${problem.problem})` : '';
      return {
        message: auditMessage(audit)
          ?? `Widget ${widgetId} render failed: ${problem.kind}${detail}`,
      };
    }
  }
}

const MAX_INPUT_CANDIDATES = 10;

function unmatchedInputMessage(
  error: Extract<WidgetError, { kind: 'unmatched-input' }>,
): string {
  const message = `no ${error.input} option matches "${error.requested}"`;
  if (error.candidates.length === 0) return message;
  const visible = error.candidates.slice(0, MAX_INPUT_CANDIDATES);
  const more = error.candidates.length - visible.length;
  return [
    `${message} — candidates:`,
    ...visible.map((candidate) => `  ${candidate}`),
    ...(more > 0 ? [`  …and ${more} more`] : []),
  ].join('\n');
}

function invalidWidgetResponseMessage(
  error: Extract<WidgetError, { kind: 'invalid-response' }>,
): string {
  if (error.problem === 'empty-configuration') {
    return `Config detail returned empty response for ${error.identity.configurationId ?? ''}`;
  }
  if (error.problem === 'render-input-invalid') {
    return `Widget ${error.identity.widgetId} data contradicts its own definition: its Relative Date or Selected Context is not one the widget accepts.`;
  }
  if (error.problem === 'selected-context-control-group') {
    return `Widget ${error.identity.widgetId} has a Control Group as its Selected Context; Marquee Web cannot load that either ("Sorry, we are experiencing an issue loading this widget").`;
  }
  if (error.problem === 'render-assignment-invalid') {
    return `Widget ${error.identity.widgetId} data contradicts its own definition: a parameter override names an input or option the widget does not define.`;
  }
  const reasons: Record<typeof error.problem, string> = {
    'parameters-not-array': 'configuration.parameters is not an array',
    'parameter-not-record': `configuration.parameters[${error.index ?? 0}] is not a record`,
    'parameter-value-missing': `configuration.parameters[${error.index ?? 0}] has no value`,
    'configuration-id-missing': 'configuration.id is missing',
    'calculated-dates-without-relative-date': 'configuration.calculatedDates has no relative date',
    'render-params-not-record': 'widget.renderParams is not a record',
    'render-controls-not-array': 'widget.renderParams.controls is not an array',
    'unsupported-payload-shape': error.detail ?? 'unsupported Widget Payload shape',
    'parameters-missing': 'widget.parameters is missing',
    'parameter-field-missing': 'widget parameter has no field',
    'parameter-values-not-record': 'widget parameter values is not a record',
    'render-control-value-missing': 'widget render control has no value',
    'context-parameter-control-group': 'widget context parameter names a Control Group',
    'date-parameter-default-missing': 'widget Date parameter has no default',
    'configuration-assignment-missing': 'configuration.parameters omits a current widget value it would re-save',
    'data-viz-configuration-missing': 'Data Viz Widget has no configuration id',
    'expression-labels-not-array': 'configuration.metadata.expressionLabels is not an array',
    'expression-labels-missing': 'configuration.metadata.expressionLabels is missing',
    'entity-metadata-not-record': 'Widget entity metadata is not a record',
    'entity-metadata-entry-not-record': `Widget entity metadata entry ${error.index ?? 0} is not a record`,
    'entity-metadata-name-missing': `Widget entity metadata entry ${error.index ?? 0} has no name`,
  };
  return `Unsupported widget module response shape: ${reasons[error.problem]}; record a Scenario before accepting this fallback.`;
}

function invalidInputMessage(
  error: Extract<WidgetError, { kind: 'invalid-input' }>,
): string {
  if (error.input === 'surveyDate' && error.problem === 'incompatible-dependent-input') {
    return QUICKPOLL_SURVEY_DATE_FILL_MESSAGE;
  }
  const messages: Partial<Record<typeof error.problem, string>> = {
    'boolean-required': `${error.input} must be true or false`,
    'date-required': `${error.input} must be YYYY-MM-DD or a relative date like 0b or -1b`,
    'integer-required': `${error.input} must be an integer`,
    empty: `${error.input} must not be empty`,
    'control-group': `${error.input} cannot be a Control Group; Marquee Web accepts only one of its members as a widget's Selected Context`,
  };
  return messages[error.problem]
    ?? `Widget input ${error.input} is invalid: ${error.problem}`;
}
