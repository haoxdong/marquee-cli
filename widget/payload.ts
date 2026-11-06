import assert from 'node:assert/strict';
import { isRecord as isWidgetPayloadRecord } from '../lib/json-value.js';
import { resolveRelativeDateDefault } from '../plottool/relative-date.js';
import { unwrapSliderValue } from './slider.js';
import { defaultOrOnlyOption } from './display-value.js';
import { InvalidWidgetResponseError } from './semantic-failure.js';

export function optionalWidgetPayloadArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  assertWidgetPayloadShape(Array.isArray(value), `${label} is not an array`);
  return value;
}

// The single reader for a Widget Payload — the upstream JSON for one Unconfigured
// Widget (`GET /v1/marketview/widgets/<MW_ID>`, the raw widget record). It
// owns "how the native layout is laid out and how to read a value out of it":
// field defaults, param values/pairs, render identity, and payload-shape
// predicates. Pure functions, no wrapper object — every caller imports instead of
// re-deriving. See marquee-cli/GLOSSARY.md ("Widget Definition") and docs/adr.

export type WidgetPayload = Record<string, unknown> & {
  id?: string | null;
  title?: string | null;
  authors?: unknown;
  label?: string | null;
  configurationId?: string | null;
  underlyingChartId?: string | null;
  visualizationType?: string | null;
  description?: unknown;
  tags?: unknown;
  dataAttribution?: unknown;
  renderData?: Record<string, unknown>;
  renderParams?: Record<string, unknown> & {
    component?: Record<string, unknown>;
    controls?: Array<Record<string, unknown> & {
      field?: unknown;
      id?: unknown;
      name?: unknown;
    }>;
  };
  contextParameter?: Record<string, unknown> & {
    field?: string | null;
    value?: unknown;
    values?: Record<string, unknown>;
    options?: unknown[];
  };
  parameters?: Array<Record<string, unknown> & {
    field?: unknown;
    type?: unknown;
    options?: unknown;
    enums?: unknown;
    allowedValues?: unknown;
    value?: unknown;
    defaultValue?: unknown;
    offset?: unknown;
    values?: unknown;
  }>;
  supportedContexts?: unknown[];
  metadata?: Record<string, unknown> & {
    title?: string | null;
    expressionLabels?: unknown[];
    dataSources?: unknown[];
  };
};

export function assertWidgetPayloadShape(supported: unknown, reason: string): asserts supported {
  if (supported) return;
  throw new InvalidWidgetResponseError({ source: 'widget', problem: 'unsupported-payload-shape', detail: reason });
}

// --- render identity ------------------------------------------------------

/** The stable field key for a render control: id, then field, then name. */
export function controlField(control: unknown): string | undefined {
  assertWidgetPayloadShape(isWidgetPayloadRecord(control), 'render control is not a record');
  return [control.controlId, control.id, control.field, control.name]
    .find((field): field is string => typeof field === 'string' && field.length > 0);
}

// --- field defaults -------------------------------------------------------

/**
 * The default a render control contributes for its field. Relative-date-aware:
 * when the component value hides a relative-date object whose rule or concrete
 * value matches the control's raw default, the relative-date object wins so the
 * original relative selection survives normalization.
 */
export function controlParamDefault(
  control: unknown,
  componentValue: unknown,
): unknown {
  assertWidgetPayloadShape(isWidgetPayloadRecord(control), 'render control is not a record');
  assertWidgetPayloadShape(
    Object.prototype.hasOwnProperty.call(control, 'value'),
    'render control has no value',
  );
  const rawDefault = unwrapSliderValue(control.value);
  assertWidgetPayloadShape(rawDefault !== undefined, 'render control has no selected component value');
  return resolveRelativeDateDefault(componentValue, rawDefault);
}

/** The default the matching render control contributes for `field`, if any. */
export function widgetControlDefault(
  widget: WidgetPayload,
  field: string,
): unknown {
  const component = widget.renderParams?.component || {};
  const control = (widget.renderParams?.controls || [])
    .find((candidate) => controlField(candidate) === field);
  if (!control) return undefined;
  return controlParamDefault(control, component[field]);
}

/**
 * The default for a context field, walking component value → control default →
 * `contextParameter.value` → `contextParameter.values.default`, then collapsing
 * to the sole option when nothing else is present.
 */
export function contextParamDefault(
  widget: WidgetPayload,
  field: string,
  options: unknown[] = [],
): unknown {
  const component = widget.renderParams?.component || {};
  const value = component[field] ??
    widgetControlDefault(widget, field) ??
    widget.contextParameter?.value ??
    widget.contextParameter?.values?.default;
  return defaultOrOnlyOption(value, options);
}

/**
 * Read the widget record from the upstream response. Replay recordings exercise
 * direct widget records; wrapped data envelopes are rejected until a Scenario
 * proves that shape is real.
 */
export function widgetFromEnvelope(
  value: unknown,
  options: { deferRenderParams?: boolean } = {},
): WidgetPayload {
  assertWidgetPayloadShape(value !== undefined && value !== null, 'empty widget response');
  assertWidgetPayloadShape(isWidgetPayloadRecord(value), 'widget response is not a record');
  assertWidgetPayloadShape(
    !Object.prototype.hasOwnProperty.call(value, 'data'),
    'widget response uses a data envelope',
  );
  if (!options.deferRenderParams) {
    assertWidgetPayloadShape(
      value.renderParams === undefined || isWidgetPayloadRecord(value.renderParams),
      'renderParams is not a record',
    );
  }
  if (!options.deferRenderParams && isWidgetPayloadRecord(value.renderParams)) {
    assertWidgetPayloadShape(
      value.renderParams.component === undefined || isWidgetPayloadRecord(value.renderParams.component),
      'renderParams.component is not a record',
    );
    assertWidgetPayloadShape(
      value.renderParams.controls === undefined || Array.isArray(value.renderParams.controls),
      'renderParams.controls is not an array',
    );
    if (Array.isArray(value.renderParams.controls)) {
      assertWidgetPayloadShape(
        value.renderParams.controls.every(isWidgetPayloadRecord),
        'renderParams.controls contains a non-record',
      );
    }
  }
  assertWidgetPayloadShape(
    value.contextParameter === undefined || isWidgetPayloadRecord(value.contextParameter),
    'contextParameter is not a record',
  );
  assertWidgetPayloadShape(
    value.parameters === undefined || Array.isArray(value.parameters),
    'parameters is not an array',
  );
  if (Array.isArray(value.parameters)) {
    assertWidgetPayloadShape(
      value.parameters.every(isWidgetPayloadRecord),
      'parameters contains a non-record',
    );
  }
  assertWidgetPayloadShape(
    value.metadata === undefined || isWidgetPayloadRecord(value.metadata),
    'metadata is not a record',
  );
  if (isWidgetPayloadRecord(value.metadata)) {
    assertWidgetPayloadShape(
      value.metadata.title === undefined
        || value.metadata.title === null
        || typeof value.metadata.title === 'string',
      'metadata.title is not a string',
    );
  }
  for (const field of ['id', 'title', 'configurationId', 'underlyingChartId', 'visualizationType'] as const) {
    assertWidgetPayloadShape(
      value[field] === undefined || value[field] === null || typeof value[field] === 'string',
      `${field} is not a string`,
    );
  }
  if (isWidgetPayloadRecord(value.contextParameter)) {
    assertWidgetPayloadShape(
      value.contextParameter.field === undefined
        || value.contextParameter.field === null
        || typeof value.contextParameter.field === 'string',
      'contextParameter.field is not a string',
    );
  }
  return value;
}

type ConfigurationParameter = Record<string, unknown> & { value: unknown };

export function configurationParameters(configuration: Record<string, unknown>): ConfigurationParameter[] {
  const parameters = configuration.parameters;
  if (!Array.isArray(parameters)) {
    throw new InvalidWidgetResponseError({ source: 'configuration', problem: 'parameters-not-array' });
  }
  return parameters.map((parameter, index) => {
    if (!isWidgetPayloadRecord(parameter)) {
      throw new InvalidWidgetResponseError({ source: 'configuration', problem: 'parameter-not-record', index });
    }
    assert(
      Object.prototype.hasOwnProperty.call(parameter, 'value'),
      new InvalidWidgetResponseError({
        source: 'configuration',
        problem: 'parameter-value-missing',
        index,
      }),
    );
    return parameter as ConfigurationParameter;
  });
}

function currentConfigurationParameters(
  widget: WidgetPayload,
  configuration: Record<string, unknown>,
): (ConfigurationParameter & { field: string })[] {
  const renderParams = { ...widget.renderParams };
  const component = isWidgetPayloadRecord(renderParams.component) ? renderParams.component : {};
  const fields = new Set(Object.keys(component));
  const addField = (value: unknown): void => {
    if (isWidgetPayloadRecord(value) && typeof value.field === 'string') fields.add(value.field);
  };
  addField(widget.contextParameter);
  if (Array.isArray(widget.parameters)) widget.parameters.forEach(addField);
  if (Array.isArray(renderParams.controls)) {
    for (const control of renderParams.controls) {
      const field = controlField(control);
      if (field) fields.add(field);
    }
  }
  return configurationParameters(configuration).filter((
    parameter,
  ): parameter is ConfigurationParameter & { field: string } => (
    typeof parameter.field === 'string' && fields.has(parameter.field)
  ));
}

function widgetRenderParams(widget: WidgetPayload): NonNullable<WidgetPayload['renderParams']> {
  const renderParams = widget.renderParams;
  if (!isWidgetPayloadRecord(renderParams)) {
    throw new InvalidWidgetResponseError({ source: 'widget', problem: 'render-params-not-record' });
  }
  const controls: unknown = renderParams.controls;
  if (controls !== undefined && controls !== null && !Array.isArray(controls)) {
    throw new InvalidWidgetResponseError({ source: 'widget', problem: 'render-controls-not-array' });
  }
  return renderParams;
}

function withConfigurationParameterValue<T extends Record<string, unknown>>(
  value: T,
  configured: ReadonlyMap<string, unknown>,
): T {
  assert(typeof value.field === 'string', new InvalidWidgetResponseError({ source: 'widget', problem: 'parameter-field-missing' }));
  const configuredValue = configured.get(value.field);
  if (configuredValue === undefined) return value;
  assert(isWidgetPayloadRecord(value.values), new InvalidWidgetResponseError({ source: 'widget', problem: 'parameter-values-not-record' }));
  return {
    ...value,
    value: configuredValue,
    values: {
      ...value.values,
      default: configuredValue,
    },
  };
}

export function mergeWidgetConfigurationValues(
  widget: WidgetPayload,
  configuration: Record<string, unknown>,
): WidgetPayload {
  const renderParams = widgetRenderParams(widget);
  const configured = new Map(
    currentConfigurationParameters(widget, configuration).map((parameter) => (
      [parameter.field, parameter.value]
    )),
  );
  const component = isWidgetPayloadRecord(renderParams.component)
    ? renderParams.component
    : undefined;
  assert(
    typeof configuration.id === 'string',
    new InvalidWidgetResponseError({ source: 'configuration', problem: 'configuration-id-missing' }),
  );
  assert(Array.isArray(widget.parameters), new InvalidWidgetResponseError({ source: 'widget', problem: 'parameters-missing' }));
  return {
    ...widget,
    configuration,
    configurationId: configuration.id,
    ...(typeof configuration.underlyingChartId === 'string' ? { underlyingChartId: configuration.underlyingChartId } : {}),
    ...(isWidgetPayloadRecord(widget.contextParameter)
      ? {
          contextParameter: withConfigurationParameterValue(
            widget.contextParameter,
            configured,
          ),
        }
      : {}),
    parameters: widget.parameters.map((parameter) => (
      withConfigurationParameterValue(parameter, configured)
    )),
    renderParams: {
      ...renderParams,
      ...(component
        ? { component: { ...component, ...Object.fromEntries(configured) } }
        : {}),
      ...(Array.isArray(renderParams.controls)
        ? {
            controls: renderParams.controls.map((control) => {
              const field = controlField(control);
              const value = field ? configured.get(field) : undefined;
              return value === undefined ? control : { ...control, value };
            }),
          }
        : {}),
    },
  };
}
