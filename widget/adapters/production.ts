import assert from 'node:assert/strict';
import {
  type Entity,
  type EntityModule,
  type EntityResolveValue,
  isEntityNotFound,
  resolveEntitySourceLabels,
} from '../../entity/index.js';
import type {
  ControlGroupExpansion,
  ControlGroupModule,
} from '../../control-group/index.js';
import { DashboardApi } from '../../api/dashboard/index.js';
import { UsersApi } from '../../api/users/index.js';
import { WidgetApi } from '../../api/widget/index.js';
import { MarqueeError } from '../../transport/index.js';
import type { DataVizError, DataVizInputs } from '../data-viz/index.js';
import { toWidgetParameterDisplayValue } from '../display-value.js';
import {
  isDegenerateTitle,
  isWidgetSnippetInteraction,
  requireWidgetSnippetControlGroupExpansion,
  requireWidgetSnippetEntityResolution,
  WidgetSnippetDisplayError,
  widgetSnippetParams,
} from '../snippet.js';
import {
  hasWidgetDisplayEvidence,
  resolvedContextualWidgetTitle,
  resolveWidgetTitle,
  widgetFallbackTitle,
} from '../snippet-title.js';
import { validateWidgetSnippetContext } from '../snippet-context.js';
import { InvalidWidgetResponseError, WidgetSemanticFailure } from '../semantic-failure.js';
import { unwrapSliderValue } from '../slider.js';
import type { WidgetPort } from './port.js';
import {
  cleanText as cleanRecordText,
  contextParamDefault,
  entityResolvedWidgetOptionValues,
  restoreRelativeDateDefaults,
} from '../parameters.js';
import { paramTypeFromRecord } from '../parameter-type.js';
import {
  configParameters,
  configRelativeDate,
  configUnderlyingChartId,
  isRelativeDateField,
} from '../configuration-anchors.js';
import {
  isPlotToolWindowOverrideProviderAccepted,
  parsePlotToolWindowOverride,
  plotToolWindowOverrideProviderToken,
  plotToolWindowOverrideToken,
} from '../plottool/window.js';
import { resolveRelativeDateDefault } from '../plottool/relative-date.js';
import {
  createProductionPlotTool,
  readPlotToolChart,
  type PlotToolChartRead,
  type PlotToolControl,
  type PlotToolDateRangeOverride,
  type PlotToolWindowOverride,
} from '../plottool/index.js';
import {
  widgetPersistenceAnchorResult,
  type PlotToolPersistenceAnchorResolver,
  type WidgetPersistenceAnchorPort,
  type WidgetPersistenceAnchors,
} from '../persistence-anchor.js';
import { createPlotToolPersistenceAnchorResolver } from './plottool-persistence-anchor.js';
import {
  assertWidgetPayloadShape,
  controlField,
  optionalWidgetPayloadArray,
  widgetFromEnvelope,
  type WidgetPayload,
} from '../payload.js';
import { WidgetPlotToolFailure } from '../plottool-failure.js';
import {
  requireWidgetValueTargetId,
  selectWidgetRenderTarget,
  widgetValueTargetId,
  widgetValueConfigurationTarget,
  widgetValueTargetPayload,
} from '../render-pipeline/target.js';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configIdFromResponse(value: unknown): ConfigId | undefined {
  const candidate = [value].flat()[0];
  return isRecord(candidate) && typeof candidate.id === 'string'
    ? parseConfigId(candidate.id)
    : undefined;
}
import {
  buildFullWidgetProjection,
  type FullWidgetProjection,
  type SemanticWidgetPayload,
} from '../view.js';
import {
  isQuickPollWidget,
  isQuickPollSurveyDateField,
} from '../fill-policy.js';
import {
  incompatibleWidgetInput,
  missingWidgetTarget,
  unsupportedWidgetExecutionTarget,
  widgetConfigurationMismatch,
  widgetConfigurationMintFailure,
} from '../errors.js';
import {
  identityKind,
  resolveWidgetInput,
  widgetInputDomain,
  type WidgetEntityModule,
  type WidgetInputDomain,
  type WidgetInputResolution,
} from '../input-resolution.js';
import type {
  WidgetRenderValue,
  WidgetModule,
  EditableDashboard,
  WidgetError,
  WidgetGetInput,
  RenderedWidget,
  WidgetResult,
  WidgetDates,
  WidgetAccess,
  WidgetResolveInput,
  WidgetValue,
  WidgetId,
  ConfigId,
} from '../types.js';
import { parseConfigId, parseWidgetId } from '../identifiers.js';
import { widgetParamRefName } from '../param-ref-name.js';
import { resolveWidgetConfiguration } from '../configuration-resolution.js';
import { editableDashboardsFromResponse } from './editable-dashboards.js';
type SemanticWidgetState = Readonly<{
  widget: InternalWidgetValue;
  parameters: readonly Readonly<{
    field: string;
    value: unknown;
    displayValue?: unknown;
  }>[];
  titleContextOverride?: string | null | undefined;
  relativeDate: PlotToolWindowOverride | null;
  widgetDates?: PlotToolDateRangeOverride;
}>;
/** A Widget Config's calculated dates with its saved Relative Date, parsed once where it enters. */
type ConfiguredWidgetDates = PlotToolDateRangeOverride & Readonly<{
  relativeDate: PlotToolWindowOverride;
}>;
/** Widget Dates as ADR 0057's render seam takes them: Relative Date as its printed token. */
function surfaceWidgetDates(dates: ConfiguredWidgetDates | undefined): WidgetDates | undefined {
  return dates && { ...dates, relativeDate: plotToolWindowOverrideToken(dates.relativeDate) };
}
function widgetConfigurationResult(
  response: unknown,
  widgetId: string,
  targetId: string,
): WidgetResult<Readonly<{ configurationId: ConfigId }>> {
  const record = [response].flat()[0];
  const id = configIdFromResponse(response);
  if (id && isRecord(record)) {
    const returnedWidgetId = cleanRecordText(record.widgetId);
    const returnedTargetId = cleanRecordText(record.underlyingChartId);
    /* c8 ignore start -- data-layer-ignore: widget-config-mint-identity-assert */
    assert(
      ['', widgetId.toUpperCase()].includes(returnedWidgetId.toUpperCase())
      && ['', targetId.toUpperCase()].includes(returnedTargetId.toUpperCase()),
      new WidgetSemanticFailure(
        widgetConfigurationMismatch(widgetId, id, returnedWidgetId || undefined),
      ),
    );
    /* c8 ignore stop */
  }
  return id
    ? { ok: true, value: { configurationId: id } }
    : {
        ok: false,
        error: widgetConfigurationMintFailure(widgetId),
      };
}

// This enrichment GET is a hard dependency of the widget read (fails loud on failure),
// so it must be reliable — not a single-shot 500ms timeout that a slow-but-healthy
// upstream trips. Hedge it like the widget read path ([1000], ADR 0008): a
// fast cacheable metadata GET where a hedged retry races the tail via connection-pool
// diversity (ADR 0016 retains hedging for exactly these, unlike render). The timeout is
// the overall budget across attempts; if all fail within it upstream is genuinely down
// and we still throw. 500ms was an orphaned per-attempt value left behind after
// the surrounding 3× retry loop was removed.
const EDITABLE_DASHBOARDS_TIMEOUT_MS = 4000;
const EDITABLE_DASHBOARDS_HEDGE_DELAYS_MS = [1000];

function configurationRecordFromResponse(value: unknown): Record<string, unknown> | undefined {
  const record = Array.isArray(value) ? value[0] : value;
  return isRecord(record) ? record : undefined;
}

type InvalidWidgetResponse = Extract<WidgetError, { kind: 'invalid-response' }>;

function responseIdentifier<T>(
  value: unknown,
  parse: (text: string) => T | undefined,
  source: InvalidWidgetResponse['source'],
): T | null {
  const text = cleanRecordText(value);
  if (!text) return null;
  const id = parse(text);
  assert(id, new InvalidWidgetResponseError({
    source,
    problem: 'unsupported-payload-shape',
    detail: `${source} id ${text} is malformed`,
  }));
  return id;
}

function unsupportedWidgetModuleShape(
  source: InvalidWidgetResponse['source'],
  problem: InvalidWidgetResponse['problem'],
): never {
  throw new InvalidWidgetResponseError({ source, problem });
}

function unsupportedWidgetModuleEntry(
  source: InvalidWidgetResponse['source'],
  problem: InvalidWidgetResponse['problem'],
  index: number,
): never {
  throw new InvalidWidgetResponseError({ source, problem, index });
}

type ConfigurationParameter = Record<string, unknown> & { value: unknown };

function configurationParameters(configuration: Record<string, unknown>): ConfigurationParameter[] {
  const parameters = configuration.parameters;
  if (!Array.isArray(parameters)) {
    return unsupportedWidgetModuleShape('configuration', 'parameters-not-array');
  }
  return parameters.map((parameter, index) => {
    if (!isRecord(parameter)) {
      return unsupportedWidgetModuleEntry(
        'configuration',
        'parameter-not-record',
        index,
      );
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
  const component = isRecord(renderParams.component) ? renderParams.component : {};
  const fields = new Set(Object.keys(component));
  const addField = (value: unknown): void => {
    if (isRecord(value) && typeof value.field === 'string') fields.add(value.field);
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
  if (!isRecord(renderParams)) {
    return unsupportedWidgetModuleShape('widget', 'render-params-not-record');
  }
  const controls: unknown = renderParams.controls;
  if (controls !== undefined && controls !== null && !Array.isArray(controls)) {
    unsupportedWidgetModuleShape('widget', 'render-controls-not-array');
  }
  return renderParams;
}

function invalidWidget(problem: InvalidWidgetResponse['problem']): InvalidWidgetResponseError {
  return new InvalidWidgetResponseError({ source: 'widget', problem });
}

function withConfigurationParameterValue<T extends Record<string, unknown>>(
  value: T,
  configured: ReadonlyMap<string, unknown>,
): T {
  assert(typeof value.field === 'string', invalidWidget('parameter-field-missing'));
  const configuredValue = configured.get(value.field);
  if (configuredValue === undefined) return value;
  assert(isRecord(value.values), invalidWidget('parameter-values-not-record'));
  return {
    ...value,
    value: configuredValue,
    values: {
      ...value.values,
      default: configuredValue,
    },
  };
}

function mergeWidgetConfigurationValues(
  widget: WidgetPayload,
  configuration: Record<string, unknown>,
): WidgetPayload {
  const renderParams = widgetRenderParams(widget);
  const configured = new Map(
    currentConfigurationParameters(widget, configuration).map((parameter) => (
      [parameter.field, parameter.value]
    )),
  );
  const component = isRecord(renderParams.component)
    ? renderParams.component
    : undefined;
  assert(
    typeof configuration.id === 'string',
    new InvalidWidgetResponseError({ source: 'configuration', problem: 'configuration-id-missing' }),
  );
  assert(Array.isArray(widget.parameters), invalidWidget('parameters-missing'));
  return {
    ...widget,
    configuration,
    configurationId: configuration.id,
    ...(typeof configuration.underlyingChartId === 'string' ? { underlyingChartId: configuration.underlyingChartId } : {}),
    ...(isRecord(widget.contextParameter)
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

function mergeWidgetConfigurationDetail(
  widget: WidgetPayload,
  configuration: Record<string, unknown>,
): WidgetPayload {
  const merged = mergeWidgetConfigurationValues(widget, configuration);
  const configMetadata = isRecord(configuration.metadata) ? configuration.metadata : {};
  const configTitle = cleanRecordText(configMetadata.title) || cleanRecordText(configuration.title);
  return {
    ...merged,
    metadata: {
      ...(isRecord(widget.metadata) ? widget.metadata : {}),
      ...configMetadata,
      ...(configTitle ? { title: configTitle } : {}),
    },
  };
}

async function readConfigurationDetail(
  request: WidgetPort['request'],
  configurationId: string,
  expectedWidgetId: string,
): Promise<Record<string, unknown>> {
  const raw = await new WidgetApi({ request }).getConfiguration(configurationId);
  const record = configurationRecordFromResponse(raw);
  if (!record) {
    throw new WidgetSemanticFailure({
      kind: 'invalid-response',
      identity: {
        widgetId: expectedWidgetId,
        configurationId,
      },
      source: 'configuration',
      problem: 'empty-configuration',
    });
  }
  return record;
}

class WidgetDataVizFailure extends Error {
  constructor(readonly error: DataVizError) {
    super(error.kind);
  }
}

function executionTargetId(widget: WidgetPayload): string {
  return cleanRecordText(widget.underlyingChartId);
}

function validateWidgetDefinition(
  widget: WidgetPayload,
  requestedWidgetId: string,
  allowMissingTarget = false,
): string {
  const returnedWidgetId = cleanRecordText(widget.id);
  /* c8 ignore start -- data-layer-ignore: widget-definition-identity-assert */
  assert(
    ['', requestedWidgetId.toUpperCase()].includes(returnedWidgetId.toUpperCase()),
    new WidgetSemanticFailure({
      kind: 'configuration-mismatch',
      identity: {
        widgetId: requestedWidgetId,
        configurationId: cleanRecordText(widget.configurationId),
      },
      ownerWidgetId: returnedWidgetId,
    }),
  );
  /* c8 ignore stop */
  const targetId = executionTargetId(widget);
  if (!targetId && allowMissingTarget) return '';
  /* c8 ignore start -- data-layer-ignore: widget-definition-missing-target-assert */
  assert(targetId, new WidgetSemanticFailure(missingWidgetTarget(requestedWidgetId)));
  /* c8 ignore stop */
  /* c8 ignore start -- data-layer-ignore: widget-definition-unsupported-target-assert */
  assert(
    /^(?:CH|DV)/.test(targetId),
    new WidgetSemanticFailure(unsupportedWidgetExecutionTarget(requestedWidgetId, targetId)),
  );
  /* c8 ignore stop */
  return targetId;
}

function validateConfigurationDetail(
  configuration: Record<string, unknown>,
  input: {
    widgetId: string;
    configurationId: string;
    definitionTargetId?: string;
  },
): void {
  const returnedConfigurationId = cleanRecordText(configuration.id);
  const returnedTargetId = cleanRecordText(configuration.underlyingChartId);
  const ownerWidgetId = cleanRecordText(configuration.widgetId);
  const mismatch = new WidgetSemanticFailure({
    kind: 'configuration-mismatch',
    identity: {
      widgetId: input.widgetId,
      configurationId: input.configurationId,
    },
  });
  /* c8 ignore start -- data-layer-ignore: widget-configuration-detail-identity-assert */
  assert(
    ['', input.configurationId.toUpperCase()].includes(returnedConfigurationId.toUpperCase()),
    mismatch,
  );
  if (input.definitionTargetId) {
    assert(
      ['', input.definitionTargetId.toUpperCase()].includes(returnedTargetId.toUpperCase()),
      mismatch,
    );
  }
  assert(
    ['', input.widgetId.toUpperCase()].includes(ownerWidgetId.toUpperCase()),
    mismatch,
  );
  /* c8 ignore stop */
}

async function widgetDynamicMetadataTitle(
  request: WidgetPort['request'],
  widgetId: string,
  parameters: readonly { field: string; value: unknown }[],
): Promise<
  | Readonly<{ kind: 'available'; title: string }>
  | Readonly<{ kind: 'unavailable'; title: undefined }>
> {
  const response = await new WidgetApi({ request }).getWidgetMetadata(widgetId, parameters);
  const metadata = Reflect.get(Object(response), 'metadata');
  return {
    kind: 'available',
    title: cleanRecordText(Reflect.get(Object(metadata), 'title')),
  };
}

type ResolvedWidgetTitle = Readonly<{
  title: string;
  isTitleResolved: boolean;
  entityLabels: WidgetValue['entityLabels'];
}>;

function canonicalWidgetParameter(
  parameter: Record<string, unknown>,
  component: Record<string, unknown>,
): WidgetValue['parameters'][number] | undefined {
  const field = cleanRecordText(parameter.field);
  if (!field) return undefined;
  const payloadOptions = optionalWidgetPayloadArray(parameter.options, 'parameter.options');
  const options = payloadOptions.length === 1 && Array.isArray(payloadOptions[0])
    ? payloadOptions[0]
    : payloadOptions;
  const value = component[field]
    ?? parameter.value
    ?? parameter.defaultValue
    ?? Reflect.get(Object(parameter.values), 'default');
  return {
    field,
    type: cleanRecordText(parameter.type)
      || cleanRecordText(parameter.controlType)
      || paramTypeFromRecord(parameter, value, options),
    value,
    options,
  };
}

function canonicalWidgetControl(
  control: Record<string, unknown>,
): WidgetValue['controls'][number] | undefined {
  const field = controlField(control);
  if (!field) return undefined;
  const options = optionalWidgetPayloadArray(control.values, 'control.values');
  const value = control.value;
  assert(value !== undefined && value !== null, invalidWidget('render-control-value-missing'));
  return {
    field,
    type: cleanRecordText(control.type)
      || cleanRecordText(control.controlType)
      || paramTypeFromRecord(control, value, options),
    value,
    options,
  };
}

function selectedContextKinds(
  field: string,
  type: string,
  options: readonly unknown[],
): NonNullable<WidgetValue['contextParameter']>['kinds'] {
  const folded = `${field} ${type}`.toLowerCase();
  if (folded.includes('thematic') || folded.includes('basket')) return [];
  if (folded.includes('portfolio')) return ['portfolio'];
  if (folded.includes('country')) return ['country'];
  assert(
    !folded.includes('control group') && !folded.includes('control-group'),
    invalidWidget('context-parameter-control-group'),
  );
  // Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral,MethodExpression,ArrowFunction,EqualityOperator: only the 'country' kind is read; no Widget output shows the Asset and Control Group kinds
  if (folded.includes('asset') || options.some((value) => identityKind(value) === 'asset')) {
    // Stryker disable next-line ConditionalExpression,MethodExpression,ArrowFunction,EqualityOperator: only the 'country' kind is read; no Widget output shows the Control Group kind
    return options.some((value) => identityKind(value) === 'control-group')
      ? ['asset', 'control-group']
      : ['asset'];
  }
  return [];
}

type InternalWidgetValue = WidgetValue & Readonly<{
  authors?: readonly string[];
  access?: WidgetAccess;
  configurationAssignments?: readonly Readonly<{
    field: string;
    value: unknown;
  }>[];
  widgetDates?: ConfiguredWidgetDates;
  /** The Plot Chart `-p relativeDate` read up front, so the render reads it once. */
  plotToolChart?: PlotToolChartRead;
  savedRenderParams?: SemanticWidgetPayload['renderParams'];
  /** Each input's value domain, keyed by field and by `-p` name. */
  inputs: ReadonlyMap<string, Readonly<{
    field: string;
    domain: WidgetInputDomain;
  }>>;
}>;

const WIDGET_ACCESS_BY_LABEL: Readonly<Record<string, WidgetAccess>> = {
  external: 'Public: Anyone with this link can view this widget',
  internal: 'Firmwide: Anyone in your organization can view this widget',
  restricted: 'Private: Only people invited can view this widget',
  'external-restricted': 'Restricted: This widget is available to a restricted set of users',
};

function widgetAccess(label: unknown): WidgetAccess | undefined {
  if (label === undefined || label === null) return undefined;
  assertWidgetPayloadShape(typeof label === 'string', 'widget.label is not a string');
  const access = WIDGET_ACCESS_BY_LABEL[label];
  assertWidgetPayloadShape(access, `widget.label ${label} is not a supported access label`);
  return access;
}

function widgetAuthorIds(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  assertWidgetPayloadShape(
    Array.isArray(value)
      && value.length > 0
      && value.every((author): author is string => typeof author === 'string'),
    'widget.authors is not a non-empty string array',
  );
  return value;
}

async function resolveWidgetAuthors(
  request: WidgetPort['request'],
  authorIds: readonly string[],
): Promise<readonly string[]> {
  const response = await new UsersApi({ request }).getUserNames(authorIds);
  assertWidgetPayloadShape(
    isRecord(response) && Array.isArray(response.results),
    'users query response has no results array',
  );
  const authorsById = new Map<string, string>();
  for (const value of response.results) {
    assertWidgetPayloadShape(isRecord(value), 'users query result is not a record');
    const { id, name } = value;
    assertWidgetPayloadShape(typeof id === 'string' && id.length > 0, 'users query result has no id');
    assertWidgetPayloadShape(
      typeof name === 'string' && name.trim().length > 0,
      'users query result has no name',
    );
    authorsById.set(id, name);
  }
  return authorIds.map((authorId) => {
    const author = authorsById.get(authorId);
    assertWidgetPayloadShape(author, `users query result omits author ${authorId}`);
    return author;
  });
}

function widgetInputs(widget: WidgetValue): InternalWidgetValue['inputs'] {
  const entityLabels = new Map(widget.entityLabels.map(({ identity, label }) => [identity, label]));
  return new Map([...semanticWidgetDefinitions(widget)].map(([name, definition]) => [
    name,
    {
      field: definition.field,
      domain: widgetInputDomain(definition.type, definition.options, entityLabels),
    },
  ]));
}

/** The last `-p relativeDate=`, parsed once by the Plot window codec's grammar. */
function requestedRelativeDate(input: WidgetGetInput): WidgetResult<PlotToolWindowOverride | null> {
  const requested = input.parameters
    .filter(({ field }) => field === 'relativeDate')
    .at(-1)?.value;
  if (requested === undefined) return { ok: true, value: null };
  const window = parsePlotToolWindowOverride(requested);
  return window && isPlotToolWindowOverrideProviderAccepted(window)
    ? { ok: true, value: window }
    : {
        ok: false,
        error: {
          kind: 'invalid-input',
          identity: { widgetId: input.widgetId },
          input: 'Relative Date',
          problem: 'malformed',
        },
      };
}

/** A Widget Config's saved relativeDate, parsed once where it arrives from Marquee. */
function configPlotToolWindow(config: unknown): PlotToolWindowOverride | undefined {
  const relativeDate = configRelativeDate(config);
  if (relativeDate === undefined) return undefined;
  const window = parsePlotToolWindowOverride(relativeDate);
  assert(window, new InvalidWidgetResponseError({
    source: 'configuration',
    problem: 'unsupported-payload-shape',
    detail: `configuration.relativeDate ${relativeDate} is malformed`,
  }));
  return window;
}

function widgetDatesFromConfiguration(
  widget: WidgetPayload,
): ConfiguredWidgetDates | undefined {
  const configuration = isRecord(widget.configuration)
    ? widget.configuration
    : undefined;
  const calculated = isRecord(widget.calculatedDates)
    ? widget.calculatedDates
    : isRecord(configuration?.calculatedDates)
      ? configuration.calculatedDates
      : undefined;
  if (
    typeof calculated?.startDate !== 'string'
    || typeof calculated.endDate !== 'string'
    || typeof calculated.interval !== 'string'
  ) {
    return undefined;
  }
  const relativeDate = configPlotToolWindow(configuration ?? widget);
  assert(
    relativeDate,
    new InvalidWidgetResponseError({
      source: 'configuration',
      problem: 'calculated-dates-without-relative-date',
    }),
  );
  return {
    startDate: calculated.startDate,
    endDate: calculated.endDate,
    interval: calculated.interval,
    relativeDate,
  };
}

function canonicalWidgetTarget(
  widget: WidgetPayload,
  sourceId: string,
  targetId: string,
): WidgetValue['target'] {
  const target = selectWidgetRenderTarget({
    sourceId,
    underlyingChartId: targetId,
    visualizationType: cleanRecordText(widget.visualizationType),
  });
  if (target.kind === 'blank') return { family: 'blank' };
  return target.kind === 'plot'
    ? { family: 'plot', targetId: target.targetId }
    : {
        family: 'data-viz',
        targetId: target.targetId,
        route: target.resource,
      };
}

function widgetEntityLabels(
  widget: WidgetPayload,
): WidgetValue['entityLabels'] {
  const metadata = isRecord(widget.metadata) ? widget.metadata : undefined;
  const rawEntities = metadata?.entityMetadata;
  if (rawEntities === undefined || rawEntities === null) return [];
  /* c8 ignore start -- data-layer-ignore: widget-snippet-entity-metadata-container-assert */
  if (!isRecord(rawEntities)) {
    return unsupportedWidgetModuleShape('widget', 'entity-metadata-not-record');
  }
  /* c8 ignore stop */
  return Object.entries(rawEntities).map(([identity, value], index) => {
    /* c8 ignore start -- data-layer-ignore: widget-snippet-entity-metadata-entry-assert */
    if (!isRecord(value)) {
      return unsupportedWidgetModuleEntry(
        'widget',
        'entity-metadata-entry-not-record',
        index,
      );
    }
    /* c8 ignore stop */
    const label = cleanRecordText(value.name);
    /* c8 ignore start -- data-layer-ignore: widget-snippet-entity-metadata-name-assert */
    if (!label) {
      return unsupportedWidgetModuleEntry(
        'widget',
        'entity-metadata-name-missing',
        index,
      );
    }
    /* c8 ignore stop */
    return { identity, label };
  });
}

function contextOptionsForDefault(
  options: unknown[],
  inferSoleContextOption: boolean,
): unknown[] {
  return inferSoleContextOption ? options : [];
}

function relativeDateRule(value: unknown): string {
  return isRecord(value) && isRecord(value.rdate)
    ? cleanRecordText(value.rdate.rule)
    : '';
}

function recordDate(value: unknown): number {
  return isRecord(value) ? Date.parse(cleanRecordText(value.value)) : NaN;
}

function freshestRelativeDateCandidate(
  candidates: readonly unknown[],
  rule: string,
): unknown {
  return candidates.reduce<unknown>((freshest, candidate) => {
    const candidateDate = recordDate(candidate);
    const freshestDate = recordDate(freshest);
    return rule
      && relativeDateRule(candidate) === rule
      && Number.isFinite(candidateDate)
      && (!Number.isFinite(freshestDate) || candidateDate > freshestDate)
      ? candidate
      : freshest;
  }, candidates[0]);
}

function refreshedWidgetComponent(
  widget: WidgetPayload,
  refreshRelativeDateDefaults: boolean,
): Record<string, unknown> {
  const component: Record<string, unknown> = isRecord(widget.renderParams?.component)
    ? { ...widget.renderParams.component }
    : {};
  const parameters = refreshRelativeDateDefaults
    ? optionalWidgetPayloadArray(widget.parameters, 'parameters')
    : [];
  for (const parameter of parameters) {
    if (!isRecord(parameter) || cleanRecordText(parameter.type).toLowerCase() !== 'date') continue;
    const field = cleanRecordText(parameter.field);
    const values = parameter.values;
    assert(
      field && isRecord(values) && (values.default !== undefined || component[field] === undefined),
      invalidWidget('date-parameter-default-missing'),
    );
    if (values.default === undefined) continue;
    const current = component[field];
    const currentRule = relativeDateRule(current);
    const fallback = freshestRelativeDateCandidate([
      values.default,
      ...optionalWidgetPayloadArray(parameter.options, 'parameter.options'),
    ], currentRule);
    const fallbackDate = recordDate(fallback);
    component[field] = currentRule
      && currentRule === relativeDateRule(fallback)
      && Number.isFinite(fallbackDate)
      && (!Number.isFinite(recordDate(current)) || fallbackDate > recordDate(current))
      ? fallback
      : resolveRelativeDateDefault(current, fallback);
  }
  return component;
}

function canonicalWidgetContext(
  widget: WidgetPayload,
  inferSoleContextOption: boolean,
): {
  rawContext: Record<string, unknown> | undefined;
  contextField: string;
  contextOptions: unknown[];
  contextValue: unknown;
  contextType: string;
} {
  const rawContext = isRecord(widget.contextParameter)
    ? widget.contextParameter
    : undefined;
  const contextField = cleanRecordText(rawContext?.field);
  const contextOptions = optionalWidgetPayloadArray(
    rawContext?.options,
    'contextParameter.options',
  );
  const contextValue = rawContext
    ? contextParamDefault(
        widget,
        contextField || 'context',
        contextOptionsForDefault(contextOptions, inferSoleContextOption),
      )
    : undefined;
  const contextType = rawContext
    ? paramTypeFromRecord(rawContext, contextValue, contextOptions)
    : '';
  return { rawContext, contextField, contextOptions, contextValue, contextType };
}

function canonicalWidgetValue(
  request: WidgetPort['request'],
  widget: WidgetPayload,
  widgetId: WidgetId,
  configurationId: ConfigId | null,
  targetId: string,
  configurationRelativeDate: PlotToolWindowOverride | null = isRecord(widget.configuration)
    ? configPlotToolWindow(widget.configuration) ?? null
    : null,
  entityLabels: WidgetValue['entityLabels'] = [],
  inferSoleContextOption = true,
  refreshRelativeDateDefaults = false,
): InternalWidgetValue {
  const component = refreshedWidgetComponent(
    widget,
    refreshRelativeDateDefaults,
  );
  const rawControls = optionalWidgetPayloadArray(
    widget.renderParams?.controls,
    'renderParams.controls',
  ).filter(isRecord);
  const controls = rawControls
    .map((control) => canonicalWidgetControl(control))
    .filter((control): control is WidgetValue['controls'][number] => control !== undefined);
  const parameters = optionalWidgetPayloadArray(widget.parameters, 'parameters')
    .filter(isRecord)
    .map((parameter) => canonicalWidgetParameter(parameter, component))
    .filter((parameter): parameter is WidgetValue['parameters'][number] => parameter !== undefined);
  const {
    rawContext,
    contextField,
    contextOptions,
    contextValue,
    contextType,
  } = canonicalWidgetContext(widget, inferSoleContextOption);
  const sources = resolveEntitySourceLabels([
    ...optionalWidgetPayloadArray(widget.metadata?.dataSources, 'metadata.dataSources'),
    ...optionalWidgetPayloadArray(widget.dataAttribution, 'dataAttribution'),
  ]);
  const widgetDates = widgetDatesFromConfiguration(widget);
  const fallbackTitle = widgetFallbackTitle(
    cleanRecordText(widget.title),
    cleanRecordText(widget.name),
  );
  const embeddedTitle = cleanRecordText(widget.metadata?.title);
  const target = canonicalWidgetTarget(widget, widgetId, targetId);
  const value: WidgetValue & Omit<InternalWidgetValue, 'inputs'> = {
    widgetId,
    configurationId,
    configuration: configurationId
      ? {
          configurationId,
          widgetId,
          ...widgetValueConfigurationTarget(target),
          relativeDate: configurationRelativeDate,
        }
      : null,
    projection: { kind: 'complete' },
    title: {
      embedded: embeddedTitle || null,
      fallback: fallbackTitle,
      useEntityTitle: widget.useEntityTitle !== false,
    },
    target,
    parameters,
    contextParameter: rawContext
      ? {
          field: contextField,
          type: contextType,
          kinds: selectedContextKinds(contextField, contextType, contextOptions),
          value: contextValue,
          options: contextOptions,
        }
      : null,
    controls,
    componentInputs: Object.entries(component)
      .map(([field, value]) => ({ field, value })),
    entityLabels,
    ...(Array.isArray(widget.metadata?.expressionLabels)
      ? { expressionLabels: [...widget.metadata.expressionLabels] }
      : {}),
    ...(cleanRecordText(widget.description)
      ? { description: cleanRecordText(widget.description) }
      : {}),
    tags: optionalWidgetPayloadArray(widget.tags, 'tags').map(String),
    sources,
    ...(widgetDates
      ? { widgetDates }
      : {}),
  };
  return { ...value, inputs: widgetInputs(value) };
}

function inferredSelectedContext(widget: WidgetValue): string | null {
  const context = widget.contextParameter;
  if (!context) return null;
  if (typeof context.value === 'string' && context.value.length > 0) {
    return context.value;
  }
  return null;
}

function unconfiguredContextAssignment(
  widget: WidgetValue,
): readonly Readonly<{ field: string; value: unknown }>[] {
  const context = widget.contextParameter;
  if (widget.configurationId !== null || !context?.field) return [];
  return [{ field: context.field, value: context.value }];
}

function canonicalRenderWidgetDefinition(
  adapter: WidgetPort,
  widgetDefinition: unknown,
  relativeDate: PlotToolWindowOverride | null,
): InternalWidgetValue {
  if (
    isRecord(widgetDefinition)
    && typeof widgetDefinition.widgetId === 'string'
    && isRecord(widgetDefinition.target)
  ) {
    return widgetDefinition as InternalWidgetValue;
  }
  const raw = widgetFromEnvelope(widgetDefinition);
  const widgetId = responseIdentifier(raw.id, parseWidgetId, 'widget');
  assert(widgetId, new WidgetSemanticFailure({
    kind: 'invalid-definition',
    identity: { widgetId: '' },
    problem: 'missing-identity',
  }));
  const targetId = validateWidgetDefinition(raw, widgetId, true);
  const canonical = canonicalWidgetValue(
    adapter.request.bind(adapter),
    raw,
    widgetId,
    responseIdentifier(raw.configurationId, parseConfigId, 'configuration'),
    targetId,
    relativeDate,
    widgetEntityLabels(raw),
    false,
  );
  return {
    ...canonical,
    ...(isRecord(raw.renderParams) && isRecord(raw.renderParams.component)
      ? { savedRenderParams: raw.renderParams as SemanticWidgetPayload['renderParams'] }
      : {}),
  };
}

function semanticRenderInput(
  widget: InternalWidgetValue,
  parameters: readonly Readonly<{ field: string; value: unknown }>[],
  widgetDates: PlotToolDateRangeOverride | undefined,
  relativeDate: PlotToolWindowOverride | null,
): SemanticWidgetState {
  return {
    widget,
    parameters,
    relativeDate,
    ...(widgetDates ? { widgetDates } : {}),
  };
}

type SemanticWidgetDefinition = WidgetValue['parameters'][number];
type SemanticAssignmentFailure = Extract<WidgetInputResolution, { ok: false }>['error'];

function semanticWidgetDefinitions(
  widget: WidgetValue,
): Map<string, SemanticWidgetDefinition> {
  const definitions: SemanticWidgetDefinition[] = [
    ...(widget.contextParameter ? [widget.contextParameter] : []),
    ...widget.controls,
    ...widget.parameters,
  ];
  const byField = new Map<string, SemanticWidgetDefinition>();
  const setDefinition = (field: string, definition: SemanticWidgetDefinition): void => {
    const current = byField.get(field);
    if (!current || definition.options.length > current.options.length) {
      byField.set(field, definition);
    }
  };
  for (const definition of definitions) {
    setDefinition(definition.field, definition);
    setDefinition(widgetParamRefName(definition.field), definition);
  }
  return byField;
}

function semanticAssignmentError(
  widgetId: string,
  field: string,
  failure: SemanticAssignmentFailure,
): WidgetError {
  if (failure.kind === 'unsafe-integer') {
    return {
      kind: 'unsafe-integer-input',
      identity: { widgetId },
      input: field,
      requested: failure.requested,
    };
  }
  if (failure.kind === 'invalid') {
    return {
      kind: 'invalid-input',
      identity: { widgetId },
      input: field,
      problem: failure.problem,
    };
  }
  if (failure.kind === 'ambiguous') {
    return {
      kind: 'ambiguous-input',
      identity: { widgetId },
      input: field,
      requested: failure.requested,
      candidates: failure.candidates,
    };
  }
  return {
    kind: 'unmatched-input',
    identity: { widgetId },
    input: field,
    requested: failure.requested,
    candidates: failure.candidates,
  };
}

type SemanticInputAssignment = Readonly<{
  field: string;
  value: unknown;
  displayValue?: unknown;
}>;

type SemanticInputSource = 'surface' | 'identity';

/** `-p` takes each input's ref name only; Plot widgets offering Relative Date also take `relativeDate`. */
function unknownParamNameError(
  widget: WidgetValue,
  parameters: readonly WidgetParameterOverride[],
  offersRelativeDate: boolean,
): WidgetResult<never> | undefined {
  const names = [...new Set([
    ...[
      ...(widget.contextParameter ? [widget.contextParameter] : []),
      ...widget.controls,
      ...widget.parameters,
      ...widget.componentInputs,
    ].filter(({ field }) => field !== '').map(({ field }) => widgetParamRefName(field)),
    ...(offersRelativeDate ? ['relativeDate'] : []),
  ])];
  const unknown = parameters.find(({ field }) => !names.includes(field));
  if (!unknown) return undefined;
  return {
    ok: false,
    error: {
      kind: 'unknown-input',
      identity: { widgetId: widget.widgetId },
      input: unknown.field,
      candidates: names,
    },
  };
}

async function resolveSemanticAssignment(
  widget: InternalWidgetValue,
  assignment: WidgetParameterOverride,
  dependencies: Readonly<{
    entity: WidgetEntityModule;
    controlGroup: ControlGroupModule;
  }>,
): Promise<WidgetResult<Readonly<{
  assignment: SemanticInputAssignment;
  echo?: string;
}>>> {
  const input = widget.inputs.get(assignment.field);
  /* c8 ignore next 3 -- data-layer-ignore: widget-public-render-passthrough-assignment-input */
  if (!input) {
    return { ok: true, value: { assignment } };
  }
  if (
    input.field === widget.contextParameter?.field
    && identityKind(assignment.value) === 'control-group'
  ) {
    return {
      ok: false,
      error: controlGroupContextInputError(widget.widgetId, assignment.field),
    };
  }
  const outcome = await resolveWidgetInput(input.domain, assignment.value, {
    widgetId: widget.widgetId,
    field: input.field,
    ...dependencies,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error: semanticAssignmentError(
        widget.widgetId,
        input.field,
        outcome.error,
      ),
    };
  }
  return {
    ok: true,
    value: {
      assignment: {
        field: input.field,
        value: outcome.value,
        displayValue: outcome.displayValue ?? outcome.label,
      },
      ...(outcome.echo ? { echo: outcome.echo } : {}),
    },
  };
}

async function resolveSemanticAssignments(
  widget: InternalWidgetValue,
  parameters: readonly WidgetParameterOverride[],
  dependencies: Readonly<{
    entity: WidgetEntityModule;
    controlGroup: ControlGroupModule;
  }>,
): Promise<WidgetResult<Readonly<{
  assignments: readonly Readonly<{
    field: string;
    value: unknown;
    displayValue?: unknown;
  }>[];
  echoes: readonly string[];
}>>> {
  const resolved = [];
  const echoes: string[] = [];
  for (const assignment of parameters) {
    // eslint-disable-next-line no-await-in-loop -- stops at the first failure without sending the rest
    const outcome = await resolveSemanticAssignment(
      widget,
      assignment,
      dependencies,
    );
    if (!outcome.ok) return outcome;
    resolved.push(outcome.value.assignment);
    if (outcome.value.echo) echoes.push(outcome.value.echo);
  }
  return { ok: true, value: { assignments: resolved, echoes } };
}

// A Country context takes the names its options advertise, as `-p` does.
// A `-p` on the context field overrides the selected context (ADR 0057), so that value goes unread.
async function resolveCountrySelectedContext(
  widget: InternalWidgetValue,
  selectedContext: string | null | undefined,
  parameters: readonly WidgetParameterOverride[],
  dependencies: Readonly<{
    entity: WidgetEntityModule;
    controlGroup: ControlGroupModule;
  }>,
): Promise<WidgetResult<Readonly<{ selectedContext: string | null | undefined; echoes: readonly string[] }>>> {
  const field = widget.contextParameter?.field;
  const input = [...widget.inputs.values()].find((candidate) => candidate.field === field);
  if (
    typeof selectedContext !== 'string'
    || input?.domain.kind !== 'country'
    || parameters.some((assignment) => widget.inputs.get(assignment.field)?.field === input.field)
  ) {
    return { ok: true, value: { selectedContext, echoes: [] } };
  }
  const outcome = await resolveWidgetInput(input.domain, selectedContext, {
    widgetId: widget.widgetId,
    field: input.field,
    ...dependencies,
  });
  if (!outcome.ok) {
    return { ok: false, error: semanticAssignmentError(widget.widgetId, input.field, outcome.error) };
  }
  return {
    ok: true,
    value: { selectedContext: String(outcome.value), echoes: outcome.echo ? [outcome.echo] : [] },
  };
}

function controlGroupContextInputError(
  widgetId: string,
  input: string,
): WidgetError {
  return {
    kind: 'invalid-input',
    identity: { widgetId },
    input,
    problem: 'control-group',
  };
}

function semanticSelectedContext(
  widget: WidgetValue,
  selectedContext: string | null,
): Readonly<{ field: string; value: unknown }> | undefined {
  const field = widget.contextParameter?.field;
  return selectedContext !== null && field
    ? { field, value: selectedContext }
    : undefined;
}

function semanticRenderInputError(
  input: SemanticWidgetState,
  selectedContext: string | null,
  inputSource: SemanticInputSource,
): WidgetError | undefined {
  /* c8 ignore start -- data-layer-ignore: widget-public-render-context-validation-input */
  if (
    inputSource === 'identity'
    && isQuickPollWidget(input.widget)
    && input.parameters.some(({ field }) => isQuickPollSurveyDateField(field))
  ) {
    return quickPollSurveyDateError(input.widget.widgetId);
  }
  if (selectedContext !== null && input.widget.contextParameter === null) {
    return {
      kind: 'invalid-input',
      identity: { widgetId: input.widget.widgetId },
      input: 'Selected Context',
      problem: 'malformed',
    };
  }
  return undefined;
}
/* c8 ignore stop */

function effectiveSelectedContext(
  widget: WidgetValue,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
  selectedContext: string | null,
): string | null {
  const contextField = widget.contextParameter?.field;
  if (!contextField) return selectedContext;
  const assigned = [...assignments]
    .reverse()
    .find(({ field, value }) => (
      field === contextField && typeof value === 'string'
    ))
    ?.value;
  return typeof assigned === 'string' ? assigned : selectedContext;
}

export function createWidgetPersistenceAnchorPort(
  adapter: WidgetPort,
  plot: PlotToolPersistenceAnchorResolver = createPlotToolPersistenceAnchorResolver(
    new WidgetApi(adapter),
  ),
): WidgetPersistenceAnchorPort {
  return {
    async resolve(configurationId) {
      const configuration = await new WidgetApi(adapter).getConfiguration(configurationId.trim());
      const relativeDate = configRelativeDate(configuration);
      const parameters = configParameters(configuration);
      if (!relativeDate && parameters.length === 0) {
        const chartId = configUnderlyingChartId(configuration);
        return widgetPersistenceAnchorResult(
          parameters,
          await plot.resolveConfiguration(chartId),
        );
      }
      return {
        ok: true,
        value: {
          parameters,
          ...(relativeDate ? { relativeDate } : {}),
        },
      };
    },
  };
}

// Widget reads hedge a slow response once, after a second.
function hedgedWidgets(request: WidgetPort['request']): WidgetApi {
  return new WidgetApi({ request: (endpoint, init) => request(endpoint, { ...init, hedgeDelaysMs: [1000] }) });
}

async function fetchEditableDashboards(request: WidgetPort['request'], signal?: AbortSignal): Promise<EditableDashboard[]> {
  const response = await new DashboardApi({
    request: (endpoint, init) => request(endpoint, {
      ...init,
      timeoutMs: EDITABLE_DASHBOARDS_TIMEOUT_MS,
      hedgeDelaysMs: EDITABLE_DASHBOARDS_HEDGE_DELAYS_MS,
      signal,
    }),
  }).getEditableDashboards();
  return editableDashboardsFromResponse(response);
}

function widgetDependencyFailure(
  error: unknown,
): Extract<WidgetError, { kind: 'widget-load-failure' }>['failure'] {
  // ADR 0030: only a classified transport failure is a dependency failure; anything else propagates.
  assert(error instanceof MarqueeError, error as Error);
  return error.dependencyFailure();
}

function upstreamError(
  e: unknown,
  widgetId: string,
  configurationId?: string | null,
): WidgetError {
  if (e instanceof WidgetSemanticFailure) return e.error;
  if (e instanceof WidgetSnippetDisplayError) {
    return {
      kind: 'missing-display-evidence',
      identity: { widgetId },
      field: e.field,
      identifier: e.identifier,
    };
  }
  if (e instanceof WidgetPlotToolFailure && configurationId) {
    return {
      kind: 'plottool-failure',
      identity: { widgetId, configurationId },
      problem: e.error,
    };
  }
  if (e instanceof WidgetDataVizFailure && configurationId) {
    return {
      kind: 'data-viz-failure',
      identity: { widgetId, configurationId },
      problem: e.error,
    };
  }
  const marqueeError = e instanceof MarqueeError ? e : undefined;
  if (
    marqueeError?.details?.status === 403 &&
    widgetId &&
    marqueeError.details.path !== DashboardApi.editableDashboards.path
  ) {
    return { kind: 'widget-access-denied', identity: { widgetId } };
  }
  if (e instanceof InvalidWidgetResponseError) {
    return {
      ...e.error,
      kind: 'invalid-response',
      identity: { widgetId },
    };
  }
  return {
    kind: 'widget-load-failure',
    identity: { widgetId },
    failure: widgetDependencyFailure(e),
  };
}

async function withWidgetErrors<T>(
  operation: () => Promise<WidgetResult<T>>,
  context: {
    widgetId: string;
    configurationId?: string | undefined;
  },
): Promise<WidgetResult<T>> {
  try {
    return await operation();
  } catch (error) {
    return {
      ok: false,
      error: upstreamError(
        error,
        context.widgetId,
        context.configurationId,
      ),
    };
  }
}

export function createWidgetConfigurationProjectionPort(
  adapter: WidgetPort,
  plot: PlotToolPersistenceAnchorResolver = createPlotToolPersistenceAnchorResolver(
    new WidgetApi(adapter),
  ),
): {
  resolve(configurationId: string): Promise<WidgetResult<WidgetPersistenceAnchors>>;
} {
  return {
    resolve(configurationId) {
      return resolveWidgetConfiguration(
        createWidgetPersistenceAnchorPort(adapter, plot),
        configurationId,
        (error) => upstreamError(error, ''),
      );
    },
  };
}

function dataVizErrorForWidget(error: DataVizError): Error {
  return new WidgetDataVizFailure(error);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type SemanticAssignment = Readonly<{ field: string; value: unknown }>;

function assignmentChangesValues(
  values: ReadonlyMap<string, unknown>,
  assignment: SemanticAssignment,
): boolean {
  return !values.has(assignment.field)
    || !valuesEqual(values.get(assignment.field), assignment.value);
}

function quickPollSurveyDateError(widgetId: string): WidgetError {
  return incompatibleWidgetInput(widgetId, 'surveyDate');
}

type SemanticRender = (
  input: SemanticWidgetState,
  detail: 'snippet' | 'full',
) => Promise<WidgetResult<RenderedWidget>>;

function withSemanticConfigurationTitle<T extends WidgetValue>(
  widget: T,
  configuredTitle: string | undefined,
  configurationChanged: boolean,
): T {
  if (configuredTitle) {
    return {
      ...widget,
      title: {
        ...widget.title,
        embedded: configuredTitle,
        fallback: configuredTitle,
      },
    };
  }
  return configurationChanged
    ? { ...widget, title: { ...widget.title, embedded: null } }
    : widget;
}

/** The fetched title names the fetched values; drops it once the effective assignments change one. */
function withAssignmentTitle<T extends InternalWidgetValue>(
  widget: T,
  assignments: readonly SemanticAssignment[],
): T {
  const current = semanticWidgetCurrentValues({ widget });
  const effective = new Map(assignments.map(({ field, value }) => [field, value]));
  return withSemanticConfigurationTitle(
    widget,
    undefined,
    // A `-p` slider is written in Web's key order, so compare its chosen mark, not its serialization.
    [...effective].some(
      ([field, value]) =>
        !current.has(field) || !valuesEqual(unwrapSliderValue(current.get(field)), unwrapSliderValue(value)),
    ),
  );
}

function withSemanticConfigurationLabels<T extends WidgetValue>(
  widget: T,
  expressionLabels: readonly unknown[] | undefined,
): T {
  return expressionLabels
    ? { ...widget, expressionLabels: [...expressionLabels] }
    : widget;
}

function withSemanticWidgetAssignments<T extends WidgetValue>(
  widget: T,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
): T {
  const values = new Map(assignments.map(({ field, value }) => [field, value]));
  const contextField = widget.contextParameter?.field || 'context';
  const applyValue = <T extends Readonly<{ field: string; value: unknown }>>(
    definition: T,
  ): T => values.has(definition.field)
    ? { ...definition, value: values.get(definition.field) }
    : definition;
  const declared = new Set([
    ...(widget.contextParameter ? [contextField] : []),
    ...widget.controls.map(({ field }) => field),
    ...widget.parameters.map(({ field }) => field),
    ...widget.componentInputs.map(({ field }) => field),
  ]);
  return {
    ...widget,
    parameters: widget.parameters.map(applyValue),
    contextParameter: widget.contextParameter
      ? values.has(contextField)
        ? { ...widget.contextParameter, value: values.get(contextField) }
        : widget.contextParameter
      : null,
    controls: widget.controls.map(applyValue),
    componentInputs: [
      ...widget.componentInputs.map(applyValue),
      ...assignments.filter(({ field }) => !declared.has(field)),
    ],
  };
}

function configurationId(input: WidgetGetInput): ConfigId | undefined {
  return input.configurationId ?? undefined;
}

type WidgetParameterOverride = WidgetGetInput['parameters'][number];
function snippetValue(
  internalSnippet: Readonly<{
    title: string;
    isTitleResolved: boolean;
    parameterLines: readonly string[];
    configurationId: ConfigId | null;
    targetId?: string | undefined;
  }>,
  widgetId: WidgetId,
  selectedContext: string | null,
  parameterFields: readonly string[],
): WidgetResult<RenderedWidget> {
  return {
    ok: true,
    value: {
      detail: 'snippet',
      widget: widgetSnippetValue(
        widgetId,
        internalSnippet.configurationId,
        internalSnippet,
        selectedContext,
        parameterFields,
      ),
      snippet: {
        title: internalSnippet.title,
        isTitleResolved: internalSnippet.isTitleResolved,
        parameterLines: internalSnippet.parameterLines,
      },
    },
  };
}

function widgetSnippetValue(
  widgetId: WidgetId,
  configurationId: ConfigId | null,
  snippet: Readonly<{
    title: string;
    parameterLines: readonly string[];
    targetId?: string | undefined;
  }>,
  selectedContext: string | null,
  parameterFields: readonly string[],
): WidgetRenderValue {
  const targetId = snippet.targetId;
  return {
    widgetId,
    configurationId,
    selectedContext,
    title: snippet.title,
    ...(targetId
      ? {
          chartId: targetId,
          family: targetId.startsWith('DV') ? 'data-viz' as const : 'plot' as const,
        }
      : {}),
    bindings: [],
    parameters: parameterFields.map((field) => ({
      field,
      refKey: widgetParamRefName(field),
      type: 'unknown',
      default: undefined,
      options: [],
    })),
  };
}

function semanticWidgetSnippetFields(input: SemanticWidgetState): string[] {
  const fields = [
    ...(input.widget.contextParameter
      ? [input.widget.contextParameter.field]
      : []),
    ...input.widget.controls.map(({ field }) => field),
    ...input.widget.parameters.map(({ field }) => field),
  ];
  if (input.widget.target.family === 'plot') fields.push('Relative Date');
  return [...new Set(fields.filter((field) => field.length > 0))];
}

function semanticWidgetSnippetParameterLines(
  input: SemanticWidgetState,
  entityMap: Readonly<Record<string, string>>,
): string[] {
  const values = new Map(
    semanticTitleParameters(input).map(({ field, value }) => [field, value]),
  );
  for (const assignment of input.parameters) {
    values.set(
      assignment.field,
      assignment.displayValue ?? assignment.value,
    );
  }
  const relativeDate = input.relativeDate ?? input.widget.configuration?.relativeDate;
  return widgetSnippetParams(semanticWidgetSnippetFields(input).map((field) => {
    if (isWidgetSnippetInteraction(field)) {
      return { field, value: relativeDate && plotToolWindowOverrideToken(relativeDate) };
    }
    return { field, value: toWidgetParameterDisplayValue(values.get(field), entityMap) };
  }));
}

type ResolvedSemanticWidgetParameters = Readonly<{
  entityMap: Record<string, string>;
  cgMembers: Record<string, string[]>;
  parameterLines: readonly string[];
  notFoundOptions: readonly Readonly<{ field: string; value: string }>[];
}>;

type SemanticResolutionUse = Readonly<{
  field: string;
  role: 'required' | 'option';
}>;

type PendingSemanticResolution = Readonly<{
  input: WidgetResolveInput;
  uses: readonly [SemanticResolutionUse, ...SemanticResolutionUse[]];
}>;

type PendingControlGroupResolution = PendingSemanticResolution & Readonly<{
  input: Extract<WidgetResolveInput, { kind: 'control-group' }>;
}>;

type PendingEntityResolution = PendingSemanticResolution & Readonly<{
  input: Exclude<WidgetResolveInput, { kind: 'control-group' }>;
}>;

function semanticResolutionKind(
  input: SemanticWidgetState,
  field: string,
  type: string | undefined,
  value: string,
): WidgetResolveInput['kind'] | undefined {
  const countryContext = [input.widget.contextParameter]
    .filter((context): context is NonNullable<typeof context> => Boolean(context))
    .some((context) => [
      context.field === field,
      context.kinds.includes('country'),
    ].every(Boolean));
  const countryCode = /^[A-Z]{2}$/i.test(value) && [
    type?.toLowerCase().includes('country'),
    countryContext,
  ].some(Boolean);
  if (countryCode) return 'country';
  return identityKind(value);
}

function scalarWidgetValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scalarWidgetValues);
  return typeof value === 'string' ? [value] : [];
}

function addResolvedEntityLabel(
  entityMap: Record<string, string>,
  requested: string,
  resolved: Entity,
): void {
  entityMap[requested] = resolved.label;
  entityMap[resolved.entityId] = resolved.label;
  for (const alias of resolved.aliases) entityMap[alias] = resolved.label;
}

function unresolvedSemanticParameter(
  input: SemanticWidgetState,
  field: string,
  type: string | undefined,
  scalar: string,
  entityMap: Readonly<Record<string, string>>,
  cgMembers: Readonly<Record<string, readonly string[]>>,
  hasDisplayEvidence: boolean,
  role: SemanticResolutionUse['role'],
): PendingSemanticResolution | undefined {
  const kind = semanticResolutionKind(input, field, type, scalar);
  if (!kind) return undefined;
  if (kind === 'control-group' && role === 'required') return undefined;
  const hasEvidence = hasDisplayEvidence
    || (kind === 'control-group'
      ? Boolean(cgMembers[scalar])
      : Boolean(entityMap[scalar]));
  return hasEvidence
    ? undefined
    : { input: { kind, value: scalar }, uses: [{ field, role }] };
}

function applySemanticParameterResolutions(
  pending: readonly PendingEntityResolution[],
  resolvedValues: readonly EntityResolveValue[],
  entityMap: Record<string, string>,
  notFoundOptions: Array<Readonly<{ field: string; value: string }>>,
): void {
  for (const [index, resolution] of pending.entries()) {
    const resolved = resolvedValues[index];
    /* c8 ignore start -- data-layer-ignore: widget-render-entity-result-assert */
    if (!resolved || resolved.kind !== resolution.input.kind) {
      throw new WidgetSnippetDisplayError(resolution.uses[0].field);
    }
    /* c8 ignore stop */
    if (isEntityNotFound(resolved)) {
      applySemanticNotFoundResolution(resolution, notFoundOptions);
      continue;
    }
    addResolvedEntityLabel(entityMap, resolution.input.value, resolved);
  }
}

function applySemanticNotFoundResolution(
  resolution: PendingSemanticResolution,
  notFoundOptions: Array<Readonly<{ field: string; value: string }>>,
): void {
  const required = resolution.uses.find(({ role }) => role === 'required');
  if (required) {
    throw new WidgetSnippetDisplayError(required.field, resolution.input);
  }
  for (const { field } of resolution.uses) {
    const alreadyMissing = notFoundOptions.some((option) => (
      option.field === field && option.value === resolution.input.value
    ));
    if (!alreadyMissing) notFoundOptions.push({ field, value: resolution.input.value });
  }
}

function uniqueSemanticResolutions(
  pending: readonly PendingSemanticResolution[],
): PendingSemanticResolution[] {
  const byIdentity = new Map<string, PendingSemanticResolution>();
  for (const resolution of pending) {
    const key = `${resolution.input.kind}:${resolution.input.value}`;
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, resolution);
      continue;
    }
    byIdentity.set(key, {
      input: current.input,
      uses: [...current.uses, ...resolution.uses],
    });
  }
  return [...byIdentity.values()];
}

async function resolveSemanticEntityInputs(
  entity: WidgetEntityModule,
  widgetId: string,
  pending: readonly [PendingEntityResolution, ...PendingEntityResolution[]],
  entityMap: Record<string, string>,
  notFoundOptions: Array<Readonly<{ field: string; value: string }>>,
): Promise<void> {
  const resolvedValues = requireWidgetSnippetEntityResolution(
    widgetId,
    pending[0].uses[0].field,
    await entity.resolve(pending.map(({ input }) => input)),
  );
  applySemanticParameterResolutions(
    pending,
    resolvedValues,
    entityMap,
    notFoundOptions,
  );
}

function applySemanticControlGroupExpansions(
  pending: readonly PendingControlGroupResolution[],
  expansions: readonly ControlGroupExpansion[],
  entityMap: Record<string, string>,
  cgMembers: Record<string, string[]>,
  notFoundOptions: Array<Readonly<{ field: string; value: string }>>,
): void {
  const byId = new Map(expansions.map((expansion) => (
    [expansion.controlGroupId.trim().toUpperCase(), expansion]
  )));
  for (const resolution of pending) {
    const expansion = byId.get(resolution.input.value.trim().toUpperCase());
    if (!expansion || expansion.members.length === 0) {
      applySemanticNotFoundResolution(resolution, notFoundOptions);
      continue;
    }
    cgMembers[resolution.input.value] = expansion.members.map(({ entityId }) => entityId);
    for (const member of expansion.members) {
      entityMap[member.entityId] ??= member.label;
      for (const alias of member.aliases) entityMap[alias] ??= member.label;
    }
  }
}

async function resolveSemanticControlGroups(
  controlGroup: ControlGroupModule,
  widgetId: string,
  pending: readonly [PendingControlGroupResolution, ...PendingControlGroupResolution[]],
  entityMap: Record<string, string>,
  cgMembers: Record<string, string[]>,
  notFoundOptions: Array<Readonly<{ field: string; value: string }>>,
): Promise<void> {
  const fieldOf = ({ input, uses }: PendingControlGroupResolution) => ({ input, field: uses[0].field });
  const [first, ...rest] = pending;
  const expansions = requireWidgetSnippetControlGroupExpansion(
    widgetId,
    [fieldOf(first), ...rest.map(fieldOf)],
    await controlGroup.expand(pending.map(({ input }) => input.value)),
  );
  applySemanticControlGroupExpansions(
    pending,
    expansions,
    entityMap,
    cgMembers,
    notFoundOptions,
  );
}

type SemanticEntitySeed = Pick<
  ResolvedSemanticWidgetParameters,
  'entityMap' | 'cgMembers'
>;

function semanticEntitySeed(input: SemanticWidgetState): SemanticEntitySeed {
  return {
    entityMap: Object.fromEntries(
      input.widget.entityLabels.map(({ identity, label }) => [identity, label]),
    ),
    cgMembers: {},
  };
}

function semanticParameterResolutionState(
  input: SemanticWidgetState,
  seed: SemanticEntitySeed,
): {
  entityMap: Record<string, string>;
  cgMembers: Record<string, string[]>;
  values: Map<string, unknown>;
  displayEvidence: Set<string>;
} {
  const entityMap = { ...seed.entityMap };
  const cgMembers = { ...seed.cgMembers };
  const values = new Map(
    semanticTitleParameters(input).map(({ field, value }) => [field, value]),
  );
  const displayEvidence = new Set<string>();
  for (const assignment of input.parameters) {
    values.set(assignment.field, assignment.value);
    if (!hasWidgetDisplayEvidence(assignment)) continue;
    const displayValues = scalarWidgetValues(assignment.displayValue);
    for (const [index, scalar] of scalarWidgetValues(assignment.value).entries()) {
      displayEvidence.add(`${assignment.field}\0${scalar}`);
      const displayValue = displayValues[index];
      if (displayValue) entityMap[scalar] = displayValue;
    }
  }
  return { entityMap, cgMembers, values, displayEvidence };
}

function unresolvedSemanticParameters(
  input: SemanticWidgetState,
  includeOptions: boolean,
  values: ReadonlyMap<string, unknown>,
  entityMap: Readonly<Record<string, string>>,
  cgMembers: Readonly<Record<string, readonly string[]>>,
  displayEvidence: ReadonlySet<string>,
): PendingSemanticResolution[] {
  return semanticWidgetSnippetFields(input).flatMap((field) => {
    const definition = semanticWidgetDefinitions(input.widget).get(field);
    const candidates: Array<Readonly<{
      value: unknown;
      role: SemanticResolutionUse['role'];
    }>> = [
      ...(includeOptions
        ? entityResolvedWidgetOptionValues(
            definition?.type ?? '',
            definition?.options ?? [],
          ).map((value) => ({ value, role: 'option' as const }))
        : []),
      { value: values.get(field), role: 'required' },
    ];
    return candidates.flatMap(({ value, role }) => scalarWidgetValues(value).flatMap((scalar) => {
      const resolution = unresolvedSemanticParameter(
        input,
        field,
        definition?.type,
        scalar,
        entityMap,
        cgMembers,
        displayEvidence.has(`${field}\0${scalar}`),
        role,
      );
      return resolution ? [resolution] : [];
    }));
  });
}

async function resolveSemanticWidgetParameters(
  input: SemanticWidgetState,
  entity: WidgetEntityModule | undefined,
  controlGroup: ControlGroupModule,
  seed?: SemanticEntitySeed,
  includeOptions = false,
): Promise<ResolvedSemanticWidgetParameters> {
  const resolvedSeed = seed ?? semanticEntitySeed(input);
  const {
    entityMap,
    cgMembers,
    values,
    displayEvidence,
  } = semanticParameterResolutionState(input, resolvedSeed);
  const notFoundOptions: Array<Readonly<{ field: string; value: string }>> = [];
  const unique = uniqueSemanticResolutions(unresolvedSemanticParameters(
    input,
    includeOptions,
    values,
    entityMap,
    cgMembers,
    displayEvidence,
  ));
  const [firstControlGroupInput, ...otherControlGroupInputs] = unique.filter(
    (resolution): resolution is PendingControlGroupResolution => (
      resolution.input.kind === 'control-group'
    ),
  );
  const [firstEntityInput, ...otherEntityInputs] = unique.filter(
    (resolution): resolution is PendingEntityResolution => (
      resolution.input.kind !== 'control-group'
    ),
  );
  const resolutions: Promise<void>[] = [];
  if (firstEntityInput && entity) {
    resolutions.push(resolveSemanticEntityInputs(
      entity,
      input.widget.widgetId,
      [firstEntityInput, ...otherEntityInputs],
      entityMap,
      notFoundOptions,
    ));
  }
  if (firstControlGroupInput) {
    resolutions.push(resolveSemanticControlGroups(
      controlGroup,
      input.widget.widgetId,
      [firstControlGroupInput, ...otherControlGroupInputs],
      entityMap,
      cgMembers,
      notFoundOptions,
    ));
  }
  await Promise.all(resolutions);
  return {
    entityMap,
    cgMembers,
    parameterLines: semanticWidgetSnippetParameterLines(input, entityMap),
    notFoundOptions,
  };
}

function semanticTitleParameters(input: SemanticWidgetState): Array<{
  field: string;
  value: unknown;
}> {
  const values = new Map<string, unknown>();
  if (input.widget.contextParameter) {
    values.set(
      input.widget.contextParameter.field,
      input.widget.contextParameter.value,
    );
  }
  for (const parameter of input.widget.controls) {
    values.set(parameter.field, parameter.value);
  }
  for (const parameter of [...input.widget.parameters].reverse()) {
    values.set(parameter.field, parameter.value);
  }
  for (const parameter of input.widget.componentInputs) {
    values.set(parameter.field, parameter.value);
  }
  for (const parameter of input.parameters) {
    values.set(parameter.field, parameter.value);
  }
  return [...values]
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => ({ field, value }));
}

async function semanticSnippet(
  input: SemanticWidgetState,
  entity: WidgetEntityModule | undefined,
  controlGroup: ControlGroupModule,
  request: WidgetPort['request'],
  selectedContext: string | null = null,
): Promise<WidgetResult<RenderedWidget>> {
  const titlePromise = resolveSemanticWidgetTitle(input, entity, request);
  const parametersPromise = resolveSemanticWidgetParameters(input, entity, controlGroup);
  const [resolvedTitle, resolvedParameters] = await Promise.all([
    titlePromise,
    parametersPromise,
  ]);
  return snippetValue({
    ...resolvedTitle,
    parameterLines: resolvedParameters.parameterLines,
    configurationId: input.widget.configurationId,
    targetId: widgetValueTargetId(input.widget.target),
  }, input.widget.widgetId, selectedContext, semanticWidgetSnippetFields(input));
}

async function resolveSemanticWidgetTitle(
  input: SemanticWidgetState,
  entity: WidgetEntityModule | undefined,
  request: WidgetPort['request'],
): Promise<ResolvedWidgetTitle> {
  const resolved = await resolveWidgetTitle({
    widgetId: input.widget.widgetId,
    embeddedTitle: input.widget.title.embedded,
    fallbackTitle: input.widget.title.fallback,
    useEntityTitle: input.widget.title.useEntityTitle,
    entityLabels: input.widget.entityLabels,
    contextualFallbackTitle: () => resolvedContextualWidgetTitle(
      entity, input.widget.widgetId, input,
      input.widget.title.fallback, input.titleContextOverride,
    ),
    metadataTitle: async () => (await widgetDynamicMetadataTitle(
      request,
      input.widget.widgetId,
      semanticTitleParameters(input),
    )).title,
  }, entity);
  return {
    title: resolved.title,
    isTitleResolved: !isDegenerateTitle(resolved.title),
    entityLabels: resolved.entityLabels,
  };
}

const DATA_VIZ_VISUALIZATION_TYPES = {
  visualization: 'DataViz',
  component: 'BaseComponent',
} as const satisfies Record<
  Extract<WidgetValue['target'], { family: 'data-viz' }>['route'],
  string
>;

function semanticWidgetPayload(
  input: SemanticWidgetState,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
  notFoundOptions: readonly Readonly<{ field: string; value: string }>[] = [],
): SemanticWidgetPayload {
  const savedRenderParams = (input.widget).savedRenderParams;
  const assignmentByField = new Map(
    assignments.map(({ field, value }) => [field, value]),
  );
  const selectedValue = (field: string, fallback: unknown): unknown => (
    assignmentByField.has(field) ? assignmentByField.get(field) : fallback
  );
  const optionValues = (field: string, values: readonly unknown[]): unknown[] => {
    const missing = new Set(
      notFoundOptions
        .filter((option) => option.field === field)
        .map(({ value }) => value),
    );
    return values.filter((value) => (
      typeof value !== 'string' || !missing.has(value)
    ));
  };
  const component = Object.fromEntries(
    input.widget.componentInputs.map(({ field, value }) => [
      field,
      selectedValue(field, value),
    ]),
  );
  const controls = input.widget.controls.map((control) => ({
    id: control.field,
    type: control.type,
    value: selectedValue(control.field, control.value),
    values: optionValues(control.field, control.options),
  }));
  const componentValues = new Map<string, unknown>([
    ...Object.entries(component),
    ...controls.map(({ id, value }) => [id, value] as const),
  ]);
  const renderComponent = Object.fromEntries(
    [...componentValues].filter(([, value]) => value !== false && value !== ''),
  );

  return {
    id: input.widget.widgetId,
    configurationId: input.widget.configurationId,
    title: input.widget.title.fallback,
    ...widgetValueTargetPayload(input.widget.target),
    ...(input.widget.target.family === 'data-viz'
      ? { visualizationType: DATA_VIZ_VISUALIZATION_TYPES[input.widget.target.route] }
      : {}),
    ...(input.widget.description ? { description: input.widget.description } : {}),
    tags: [...input.widget.tags],
    dataAttribution: [...input.widget.sources],
    metadata: {
      ...(input.widget.title.embedded
        ? { title: input.widget.title.embedded }
        : {}),
      ...(input.widget.expressionLabels
        ? { expressionLabels: [...input.widget.expressionLabels] }
        : {}),
      dataSources: [...input.widget.sources],
    },
    renderParams: savedRenderParams ?? {
      component: renderComponent,
      controls,
    },
    ...(input.widget.contextParameter
      ? {
          contextParameter: {
            field: input.widget.contextParameter.field,
            type: input.widget.contextParameter.type,
            value: selectedValue(
              input.widget.contextParameter.field,
              input.widget.contextParameter.value,
            ),
            values: {
              default: selectedValue(
                input.widget.contextParameter.field,
                input.widget.contextParameter.value,
              ),
            },
            options: optionValues(
              input.widget.contextParameter.field,
              input.widget.contextParameter.options,
            ),
          },
        }
      : {}),
    parameters: input.widget.parameters.map((parameter) => ({
      field: parameter.field,
      type: parameter.type,
      options: optionValues(parameter.field, parameter.options),
      values: {
        default: selectedValue(parameter.field, parameter.value),
      },
    })),
  };
}

function semanticPlotToolControls(
  input: SemanticWidgetState,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
): PlotToolControl[] {
  const assignmentByField = new Map(
    assignments.map(({ field, value }) => [field, value]),
  );
  return input.widget.controls.map((control) => ({
    field: control.field,
    ...(control.type !== 'String' && control.type !== 'EnumList'
      ? { type: control.type }
      : {}),
    value: assignmentByField.has(control.field)
      ? assignmentByField.get(control.field)
      : control.value,
  }));
}

function plotToolNow(): Date {
  /* c8 ignore next -- data-layer-ignore: widget-plot-now-input */
  return process.env.MARQUEE_NOW ? new Date(process.env.MARQUEE_NOW) : new Date();
}

async function semanticFull(
  input: SemanticWidgetState,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
  appliedAssignments: readonly Readonly<{ field: string; value: unknown }>[],
  adapter: WidgetPort,
  entity: EntityModule,
  controlGroup: ControlGroupModule,
): Promise<RenderedWidget> {
  const controller = new AbortController();
  const request: WidgetPort['request'] = (target, init) => adapter.request(target, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([controller.signal, init.signal])
      : controller.signal,
  });
  // Entity work is shared across Widgets. Cancel this consumer's continuations,
  // without cancelling another Widget's pending or in-flight resolution.
  const scopedEntity: EntityModule = {
    ...entity,
    async resolve(inputs) {
      controller.signal.throwIfAborted();
      return entity.resolve(inputs);
    },
  };
  const parametersPromise = resolveSemanticWidgetParameters(
    input,
    scopedEntity,
    {
      ...controlGroup,
      expand: (ids) => controlGroup.expand(ids, controller.signal),
    },
    undefined,
    true,
  );
  const providedEntities = parametersPromise.then((resolved) => ({
    entityMap: resolved.entityMap,
    cgMembers: resolved.cgMembers,
    parameterWidget: semanticWidgetPayload(
      input,
      assignments,
      resolved.notFoundOptions,
    ),
  }));
  const titlePromise = resolveSemanticWidgetTitle(input, scopedEntity, request);
  const viewPromise = semanticFullView(
    input,
    assignments,
    request,
    scopedEntity,
    providedEntities,
    (signal) => fetchEditableDashboards(request, signal),
    appliedAssignments,
  );
  const [view, resolvedTitle, resolvedParameters] = await Promise.all([
    viewPromise,
    titlePromise,
    parametersPromise,
  ]).catch((error: unknown) => {
    controller.abort();
    throw error;
  });
  return {
    detail: 'full',
    widget: {
      ...view.widget,
      title: resolvedTitle.title,
      ...((input.widget).authors?.length
        ? { authors: (input.widget).authors }
        : {}),
      ...((input.widget).access
        ? { access: (input.widget).access }
        : {}),
    },
    snippet: {
      title: resolvedTitle.title,
      isTitleResolved: resolvedTitle.isTitleResolved,
      parameterLines: resolvedParameters.parameterLines,
    },
    execution: view.execution,
  };
}

async function semanticFullView(
  input: SemanticWidgetState,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
  request: WidgetPort['request'],
  entity: EntityModule,
  providedEntities: Promise<{
    entityMap: Record<string, string>;
    cgMembers: Record<string, string[]>;
    parameterWidget: WidgetPayload;
  }>,
  editableDashboardsStart: (signal: AbortSignal) => Promise<EditableDashboard[]>,
  inputAssignments: readonly Readonly<{ field: string; value: unknown }>[] = assignments,
): Promise<FullWidgetProjection> {
  const configurationId = input.widget.configurationId;
  const appliedAssignments = [
    ...inputAssignments,
    ...(input.relativeDate !== null
      ? [{
          field: 'Relative Date',
          value: plotToolWindowOverrideToken(input.relativeDate),
        }]
      : []),
  ];
  return buildFullWidgetProjection(
    request,
    entity,
    createProductionPlotTool(
      { request },
      {
        widgetId: input.widget.widgetId,
        ...(input.widget.plotToolChart ? { chart: input.widget.plotToolChart } : {}),
      },
    ),
    plotToolNow(),
    semanticWidgetPayload(input, assignments),
    semanticPlotToolControls(input, assignments),
    input.widget.widgetId,
    configurationId,
    dataVizErrorForWidget,
    providedEntities,
    editableDashboardsStart,
    appliedAssignments,
    input.widgetDates,
    semanticDataVizExecutionInputs(input.widget, assignments),
  );
}

function semanticDataVizExecutionInputs(
  widget: InternalWidgetValue,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
): Pick<DataVizInputs, 'dashboardOverrides' | 'hasSavedRenderParams'> {
  return JSON.parse(JSON.stringify({
    dashboardOverrides: assignments,
    hasSavedRenderParams: widget.savedRenderParams !== undefined,
  })) as Pick<DataVizInputs, 'dashboardOverrides' | 'hasSavedRenderParams'>;
}

function semanticWidgetCurrentValues(input: Pick<SemanticWidgetState, 'widget'>): Map<string, unknown> {
  const values = new Map<string, unknown>();
  if (input.widget.contextParameter) {
    values.set(
      input.widget.contextParameter.field || 'context',
      input.widget.contextParameter.value,
    );
  }
  for (const definition of [
    ...input.widget.controls,
    ...input.widget.parameters,
    ...input.widget.componentInputs,
  ]) {
    values.set(definition.field, definition.value);
  }
  return values;
}

function semanticConfigurationValue(
  definition: Readonly<{ value: unknown; options: readonly unknown[] }>,
): unknown {
  const rule = relativeDateRule(definition.value);
  return definition.options.find((option) => (
    rule && relativeDateRule(option) === rule
  )) ?? definition.value;
}

function semanticConfigurationCurrentValues(
  input: SemanticWidgetState,
): Map<string, unknown> {
  const values = new Map<string, unknown>();
  if (input.widget.contextParameter) {
    const field = input.widget.contextParameter.field || 'context';
    const value = input.widget.contextParameter.value;
    if (value !== undefined && value !== '') values.set(field, value);
  }
  for (const definition of [
    ...input.widget.controls,
    ...input.widget.parameters,
  ]) {
    const value = semanticConfigurationValue(definition);
    if (value !== undefined) values.set(definition.field, value);
  }
  return values;
}

function needsSemanticConfiguration(
  input: SemanticWidgetState,
  assignments: readonly SemanticAssignment[],
): boolean {
  if (input.widget.target.family === 'blank') return false;
  if (input.widget.configurationId === null) return true;
  const currentValues = semanticWidgetCurrentValues(input);
  const changesConfiguration = assignments.some(
    (assignment) => assignmentChangesValues(currentValues, assignment),
  );
  const changesRelativeDate = input.relativeDate !== null
    && input.relativeDate.start.token !== input.widget.configuration?.relativeDate?.start.token;
  return changesConfiguration || changesRelativeDate;
}

function completeSemanticConfigurationAssignments(
  input: SemanticWidgetState,
  assignments: readonly SemanticAssignment[],
): readonly SemanticAssignment[] {
  const currentValues = semanticWidgetCurrentValues(input);
  const storedConfigurationAssignments = (
    input.widget
  ).configurationAssignments ?? [];
  const values = input.parameters.length > 0
    ? semanticConfigurationCurrentValues(input)
    : input.relativeDate !== null && input.widget.configurationId !== null
      ? new Map(storedConfigurationAssignments.map(({ field, value }) => [field, value]))
      : new Map<string, unknown>();
  const storedOnly = input.parameters.length === 0 && input.widget.configurationId !== null;
  for (const assignment of assignments) {
    const matchesStored = !assignmentChangesValues(values, assignment);
    const matchesCurrent = !assignmentChangesValues(currentValues, assignment);
    assert(
      !storedOnly || !matchesCurrent || matchesStored,
      new InvalidWidgetResponseError({
        source: 'configuration',
        problem: 'configuration-assignment-missing',
      }),
    );
    if (matchesStored) continue;
    values.delete(assignment.field);
    values.set(assignment.field, assignment.value);
  }
  return [...values].map(([field, value]) => ({ field, value }));
}

function assertConfigurationExpressionLabels(
  value: unknown,
  required: boolean,
  widgetId: string,
  configurationId: string,
): readonly unknown[] | undefined {
  const failure = (
    problem: 'expression-labels-missing' | 'expression-labels-not-array',
  ): WidgetSemanticFailure => new WidgetSemanticFailure({
    kind: 'invalid-response',
    identity: { widgetId, configurationId },
    source: 'configuration',
    problem,
  });
  assert(value !== undefined || !required, failure('expression-labels-missing'));
  assert(value === undefined || Array.isArray(value), failure('expression-labels-not-array'));
  return Array.isArray(value) ? value : undefined;
}

function semanticContextChanged(
  input: SemanticWidgetState,
  assignments: readonly SemanticAssignment[],
): boolean {
  const context = input.widget.contextParameter;
  if (!context) return false;
  const assignment = [...assignments]
    .reverse()
    .find(({ field }) => field === context.field);
  return assignment !== undefined && !valuesEqual(assignment.value, context.value);
}

async function mintSemanticConfiguration(
  adapter: WidgetPort,
  input: SemanticWidgetState,
  assignments: readonly SemanticAssignment[],
  relativeDateOverride: PlotToolWindowOverride | null,
): Promise<WidgetResult<Readonly<{
  configurationId: ConfigId;
  configuration: NonNullable<WidgetValue['configuration']>;
  title?: string;
  expressionLabels?: readonly unknown[];
  widgetDates?: ConfiguredWidgetDates;
}>>> {
  try {
    const parameters = assignments.map(
      ({ field, value }) => ({ field, value }),
    );
    const identity = {
      widgetId: input.widget.widgetId,
      underlyingChartId: requireWidgetValueTargetId(input.widget.target),
    };
    const date = relativeDateOverride !== null
      ? { relativeDate: plotToolWindowOverrideProviderToken(relativeDateOverride) }
      : {};
    const body = input.parameters.length > 0 || relativeDateOverride !== null
      ? { parameters, ...identity, ...date }
      : { ...identity, parameters, ...date };
    const response = await new WidgetApi(adapter).createConfiguration(body);
    const configured = widgetConfigurationResult(
      response,
      input.widget.widgetId,
      requireWidgetValueTargetId(input.widget.target),
    );
    if (!configured.ok) return configured;
    const configurationDetail = configurationRecordFromResponse(response) as Record<string, unknown>;
    const widgetDates = widgetDatesFromConfiguration(configurationDetail);
    const labelsRequired = input.widget.target.family === 'plot'
      && input.widget.expressionLabels !== undefined
      && semanticContextChanged(input, assignments);
    // A freshly minted Config carries no metadata; Web reads it from the Widget metadata POST.
    const metadata: unknown = isRecord(configurationDetail.metadata) || !labelsRequired
      ? configurationDetail.metadata
      : Reflect.get(
          Object(await new WidgetApi(adapter).getWidgetMetadata(input.widget.widgetId, parameters)),
          'metadata',
        );
    const title = cleanRecordText(Reflect.get(Object(metadata), 'title'));
    const expressionLabels = assertConfigurationExpressionLabels(
      Reflect.get(Object(metadata), 'expressionLabels'),
      labelsRequired,
      input.widget.widgetId,
      configured.value.configurationId,
    );
    return {
      ok: true,
      value: {
        configurationId: configured.value.configurationId,
        configuration: {
          configurationId: configured.value.configurationId,
          widgetId: input.widget.widgetId,
          targetId: requireWidgetValueTargetId(input.widget.target),
          relativeDate: relativeDateOverride,
        },
        ...(title ? { title } : {}),
        ...(expressionLabels ? { expressionLabels } : {}),
        ...(widgetDates ? { widgetDates } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: upstreamError(error, input.widget.widgetId),
    };
  }
}

export function createWidgetProductionModule(
  adapter: WidgetPort,
  options: { entity: EntityModule; controlGroup: ControlGroupModule },
): WidgetModule {
  const semanticConfigurationAssignments = (
    input: SemanticWidgetState,
    selected: Readonly<{ field: string; value: unknown }> | undefined,
    ignoreUnknownAssignments = false,
  ): WidgetResult<readonly Readonly<{ field: string; value: unknown }>[]> => {
    const definitions = [
      ...(input.widget.contextParameter ? [input.widget.contextParameter] : []),
      ...input.widget.controls,
      ...input.widget.parameters,
      ...input.widget.componentInputs,
    ];
    const byName = new Map<string, typeof definitions[number]>();
    for (const definition of definitions) {
      byName.set(definition.field, definition);
      byName.set(widgetParamRefName(definition.field), definition);
    }
    if (input.widget.contextParameter?.field === '') {
      byName.set('context', {
        ...input.widget.contextParameter,
        field: 'context',
      });
    }
    const requested = [
      ...unconfiguredContextAssignment(input.widget),
      ...(selected ? [selected] : []),
      ...input.parameters,
    ];
    const visibleRequested = ignoreUnknownAssignments
      ? requested.filter((assignment) => byName.has(assignment.field))
      : requested;
    const assignments: Readonly<{ field: string; value: unknown }>[] = [];
    for (const assignment of visibleRequested) {
      const definition = byName.get(assignment.field);
      /* c8 ignore start -- data-layer-ignore: widget-render-unknown-assignment */
      if (!definition) {
        return {
          ok: false,
          error: {
            kind: 'unknown-input',
            identity: { widgetId: input.widget.widgetId },
            input: assignment.field,
            candidates: [...new Set(definitions.map(({ field }) => field))],
          },
        };
      }
      /* c8 ignore stop */
      assignments.push({ field: definition.field, value: assignment.value });
    }
    const lastIndex = new Map(
      assignments.map((assignment, index) => [assignment.field, index]),
    );
    const effective = assignments.filter(
      (assignment, index) => lastIndex.get(assignment.field) === index,
    );
    return { ok: true, value: effective };
  };
  const prepareSemanticRender = async (
    input: SemanticWidgetState,
    selected: Readonly<{ field: string; value: unknown }> | undefined,
    relativeDateOverride: PlotToolWindowOverride | null,
    widgetDates: ConfiguredWidgetDates | undefined,
  ): Promise<WidgetResult<Readonly<{
    input: SemanticWidgetState;
    widgetDates: ConfiguredWidgetDates | undefined;
    assignments: readonly Readonly<{ field: string; value: unknown }>[];
    configurationChanged: boolean;
  }>>> => {
    const assignments = semanticConfigurationAssignments(
      input,
      selected,
    );
    /* c8 ignore next -- data-layer-ignore: widget-render-applied-input */
    if (!assignments.ok) return assignments;
    const configurationChanged = needsSemanticConfiguration(input, assignments.value);
    const effectiveAssignments = configurationChanged
      ? completeSemanticConfigurationAssignments(input, assignments.value)
      : assignments.value;
    const configured: Awaited<ReturnType<typeof mintSemanticConfiguration>> = configurationChanged
      ? await mintSemanticConfiguration(
          adapter,
          input,
          effectiveAssignments,
          relativeDateOverride,
        )
      : {
          ok: true as const,
          value: {
            configurationId: input.widget.configurationId as ConfigId,
            configuration: input.widget.configuration as NonNullable<
              WidgetValue['configuration']
            >,
          },
        };
    if (!configured.ok) return configured;
    return {
      ok: true,
      value: {
        widgetDates: configured.value.widgetDates ?? widgetDates,
        input: {
          ...input,
          widget: withSemanticConfigurationLabels(
            withSemanticConfigurationTitle({
              ...input.widget,
              configurationId: configured.value.configurationId,
              configuration: configured.value.configuration,
            }, configured.value.title, configurationChanged),
            configured.value.expressionLabels,
          ),
        },
        assignments: assignments.value,
        configurationChanged,
      },
    };
  };
  type PreparedRenderValues = Readonly<{
    input: SemanticWidgetState;
    appliedAssignments: readonly Readonly<{
      field: string;
      value: unknown;
    }>[];
    selectedContext: string | null;
  }>;
  const prepareRenderValues = (
    canonical: InternalWidgetValue,
    parameters: readonly SemanticInputAssignment[],
    selectedContext: string | null,
    widgetDates: PlotToolDateRangeOverride | undefined,
    relativeDate: PlotToolWindowOverride | null,
    ignoreUnknownAssignments: boolean,
  ): PreparedRenderValues => {
    const input = semanticRenderInput(canonical, parameters, widgetDates, relativeDate);
    assert(
      semanticRenderInputError(input, selectedContext, 'surface') === undefined,
      invalidWidget('render-input-invalid'),
    );
    const selected = semanticSelectedContext(canonical, selectedContext);
    const assignments = semanticConfigurationAssignments(
      input,
      selected,
      ignoreUnknownAssignments,
    );
    assert(assignments.ok, invalidWidget('render-assignment-invalid'));
    const currentValues = semanticWidgetCurrentValues(input);
    const appliedAssignments = assignments.value.filter(
      (assignment) => assignmentChangesValues(currentValues, assignment),
    );
    const resolvedSelectedContext = effectiveSelectedContext(
      canonical,
      assignments.value,
      selectedContext,
    );
    const effectiveWidget = withSemanticWidgetAssignments(
      canonical,
      assignments.value,
    );
    return {
      input: {
        ...input,
        widget: {
          ...effectiveWidget,
          componentInputs: effectiveWidget.componentInputs.filter(
            ({ value }) => value !== '',
          ),
        },
      },
      appliedAssignments,
      selectedContext: resolvedSelectedContext,
    };
  };
  type DereferencedFullRenderValues = Readonly<{
    widgetDefinition: InternalWidgetValue;
    parameters: readonly SemanticInputAssignment[];
    selectedContext: string | null;
    widgetDates: WidgetDates | undefined;
    inputEchoes: readonly string[];
  }>;
  const dereferenceFullRenderValues = async (
    canonical: InternalWidgetValue,
    parameters: readonly WidgetParameterOverride[],
    selectedContext: string | null,
    widgetDates: ConfiguredWidgetDates | undefined,
    relativeDateOverride: PlotToolWindowOverride | null,
    titleContextOverride: string | null | undefined,
  ): Promise<WidgetResult<DereferencedFullRenderValues>> => {
    let input = semanticRenderInput(
      canonical,
      parameters,
      widgetDates,
      widgetDates?.relativeDate ?? null,
    );
    if (relativeDateOverride !== null) {
      input = { ...input, relativeDate: relativeDateOverride };
    }
    const resolvedParameters = await resolveSemanticAssignments(
      canonical,
      parameters,
      options,
    );
    if (!resolvedParameters.ok) return resolvedParameters;
    input = {
      ...input,
      parameters: resolvedParameters.value.assignments,
      titleContextOverride,
    };
    const inputError = semanticRenderInputError(input, selectedContext, 'identity');
    if (inputError) return { ok: false, error: inputError };
    const selected = semanticSelectedContext(canonical, selectedContext);
    const prepared = await prepareSemanticRender(
      input,
      selected,
      relativeDateOverride,
      widgetDates,
    );
    if (!prepared.ok) return prepared;
    const resolvedSelectedContext = effectiveSelectedContext(
      canonical,
      prepared.value.assignments,
      selectedContext,
    );
    const renderParameters = prepared.value.assignments.map((assignment) => {
      const resolved = [...resolvedParameters.value.assignments]
        .reverse()
        .find((candidate) => (
          candidate.field === assignment.field
          && valuesEqual(candidate.value, assignment.value)
        ));
      return resolved?.displayValue === undefined
        ? assignment
        : { ...assignment, displayValue: resolved.displayValue };
    });
    return {
      ok: true,
      value: {
        widgetDefinition: prepared.value.input.widget,
        parameters: renderParameters,
        selectedContext: resolvedSelectedContext,
        widgetDates: surfaceWidgetDates(prepared.value.widgetDates),
        inputEchoes: resolvedParameters.value.echoes,
      },
    };
  };
  const presentRenderValues = async (
    prepared: PreparedRenderValues,
    detail: Parameters<SemanticRender>[1],
  ): Promise<WidgetResult<RenderedWidget>> => {
    assert(
      detail === 'snippet'
        || identityKind(prepared.input.widget.contextParameter?.value) !== 'control-group',
      invalidWidget('selected-context-control-group'),
    );
    let rendered: RenderedWidget;
    try {
      if (detail === 'snippet') {
        return await semanticSnippet(
          prepared.input,
          options.entity,
          options.controlGroup,
          adapter.request.bind(adapter),
          prepared.selectedContext,
        );
      }
      rendered = await semanticFull(
        prepared.input,
        prepared.appliedAssignments,
        prepared.appliedAssignments,
        adapter,
        options.entity,
        options.controlGroup,
      );
    } catch (error) {
      return {
        ok: false,
        error: upstreamError(
          error,
          prepared.input.widget.widgetId,
          prepared.input.widget.configurationId,
        ),
      };
    }
    return {
      ok: true,
      value: {
        ...rendered,
        widget: {
          ...rendered.widget,
          selectedContext: prepared.selectedContext,
        },
      },
    };
  };
  const render: WidgetModule['render'] = (
    widgetDefinition,
    parameters,
    selectedContext,
    widgetDates,
    detail,
  ) => {
    const identity: { widgetId: string; configurationId?: string | undefined } = { widgetId: '' };
    return withWidgetErrors(async () => {
      // A Dashboard or search entry hands its saved Relative Date in as text: parse it once here.
      const relativeDate = widgetDates?.relativeDate === undefined
        ? undefined
        : parsePlotToolWindowOverride(widgetDates.relativeDate);
      const canonical = canonicalRenderWidgetDefinition(adapter, widgetDefinition, relativeDate ?? null);
      identity.widgetId = canonical.widgetId;
      identity.configurationId = canonical.configurationId ?? undefined;
      assert(
        widgetDates?.relativeDate === undefined || relativeDate,
        invalidWidget('render-input-invalid'),
      );
      return presentRenderValues(prepareRenderValues(
        canonical,
        parameters,
        selectedContext,
        widgetDates,
        relativeDate ?? null,
        detail === 'snippet',
      ), detail);
    }, identity);
  };
  const configuredWidgetState = async (
    request: WidgetPort['request'],
    widgetRaw: WidgetPayload,
    input: WidgetGetInput,
    existingConfigurationId: string | undefined,
  ): Promise<Readonly<{
    configuredWidget: WidgetPayload;
    configurationAssignments: readonly Readonly<{ field: string; value: unknown }>[];
  }>> => {
    if (!existingConfigurationId) {
      return {
        configuredWidget: widgetRaw,
        configurationAssignments: [],
      };
    }
    const detail = await readConfigurationDetail(
      request,
      existingConfigurationId,
      input.widgetId,
    );
    validateConfigurationDetail(detail, {
      widgetId: input.widgetId,
      configurationId: existingConfigurationId,
    });
    return {
      configuredWidget: mergeWidgetConfigurationDetail(widgetRaw, detail),
      configurationAssignments: configurationParameters(detail).flatMap((parameter) => (
        typeof parameter.field === 'string' && !isRelativeDateField(parameter.field)
          ? [{ field: parameter.field, value: parameter.value }]
          : []
      )),
    };
  };
  const createDefaultWidgetConfiguration = async (
    request: WidgetPort['request'],
    widgetRaw: WidgetPayload,
    input: WidgetGetInput,
    targetId: string,
    mergeConfiguration: (
      widget: WidgetPayload,
      configuration: Record<string, unknown>,
    ) => WidgetPayload = mergeWidgetConfigurationDetail,
  ): Promise<WidgetPayload> => {
    const defaultWidget = canonicalWidgetValue(
      request,
      restoreRelativeDateDefaults(widgetRaw),
      input.widgetId,
      null,
      targetId,
      undefined,
      widgetEntityLabels(widgetRaw),
    );
    const selectedContext = input.selectedContext
      ?? inferredSelectedContext(defaultWidget);
    const contextField = defaultWidget.contextParameter?.field;
    const created = await new WidgetApi({ request }).createConfiguration({
      widgetId: input.widgetId,
      underlyingChartId: targetId,
      parameters: selectedContext && contextField
        ? [{ field: contextField, value: selectedContext }]
        : [],
    });
    const detail = configurationRecordFromResponse(created);
    /* c8 ignore start -- data-layer-ignore: widget-default-config-mint-assert */
    const configurationId = detail ? cleanRecordText(detail.id) : '';
    if (!detail || !configurationId) {
      throw new WidgetSemanticFailure(
        widgetConfigurationMintFailure(input.widgetId),
      );
    }
    /* c8 ignore stop */
    validateConfigurationDetail(detail, {
      widgetId: input.widgetId,
      configurationId,
      definitionTargetId: targetId,
    });
    return mergeConfiguration(widgetRaw, detail);
  };
  const readSemanticWidget = async (
    input: WidgetGetInput,
  ): Promise<WidgetResult<InternalWidgetValue>> => {
    const existingConfigurationId = configurationId(input);
    const request = adapter.request.bind(adapter);
    return withWidgetErrors(async () => {
      const widgetRaw = widgetFromEnvelope(
        await hedgedWidgets(request).getWidget(input.widgetId, {
          mergeParams: true,
          ...(existingConfigurationId
            ? { context: existingConfigurationId }
            : {}),
        }),
        { deferRenderParams: existingConfigurationId !== undefined },
      );
      const targetId = validateWidgetDefinition(widgetRaw, input.widgetId, true);
      const configured = await configuredWidgetState(
        request,
        widgetRaw,
        input,
        existingConfigurationId,
      );
      let configuredWidget = configured.configuredWidget;
      let canonicalConfigurationId = existingConfigurationId ?? null;
      if (
        !existingConfigurationId
        && input.parameters.length === 0
        && !input.selectedContext
      ) {
        if (targetId) {
          configuredWidget = await createDefaultWidgetConfiguration(
            request,
            widgetRaw,
            input,
            targetId,
          );
        }
        canonicalConfigurationId = responseIdentifier(
          configuredWidget.configurationId,
          parseConfigId,
          'configuration',
        );
      }
      const canonical = canonicalWidgetValue(
        request,
        restoreRelativeDateDefaults(configuredWidget),
        input.widgetId,
        canonicalConfigurationId,
        targetId,
        undefined,
        widgetEntityLabels(configuredWidget),
        true,
        input.parameters.length > 0,
      );
      const authorIds = widgetAuthorIds(widgetRaw.authors);
      const authors = authorIds === undefined
        ? undefined
        : await resolveWidgetAuthors(request, authorIds);
      const access = widgetAccess(widgetRaw.label);
      restoreRelativeDateDefaults(widgetRaw);
      return {
        ok: true,
        value: {
          ...canonical,
          ...(authors === undefined ? {} : { authors }),
          ...(access === undefined ? {} : { access }),
          ...(configured.configurationAssignments.length > 0
            ? { configurationAssignments: configured.configurationAssignments }
            : {}),
        },
      };
    }, {
      widgetId: input.widgetId,
      configurationId: existingConfigurationId,
    });
  };
  const withGetInputEchoes = (
    result: WidgetResult<RenderedWidget>,
    inputEchoes: readonly string[],
  ): WidgetResult<RenderedWidget> => {
    if (!result.ok || result.value.detail !== 'full' || inputEchoes.length === 0) {
      return result;
    }
    return {
      ok: true,
      value: {
        ...result.value,
        widget: {
          ...result.value.widget,
          inputEchoes,
        },
      },
    };
  };
  const withoutRelativeDate = (
    assignments: readonly WidgetParameterOverride[],
  ): readonly WidgetParameterOverride[] => assignments.filter(
    ({ field }) => field !== 'relativeDate',
  );
  const widgetDatesWithRelativeDate = (
    widgetDates: ConfiguredWidgetDates | undefined,
    relativeDate: PlotToolWindowOverride | null,
  ): ConfiguredWidgetDates | undefined => (
    relativeDate && widgetDates
      ? { ...widgetDates, relativeDate }
      : widgetDates
  );
  const renderReadWidget = async (
    input: WidgetGetInput,
  ): Promise<WidgetResult<RenderedWidget>> => withWidgetErrors(async () => {
    const loaded = await readSemanticWidget(input);
    if (!loaded.ok) return loaded;
    const unknownParam = unknownParamNameError(
      loaded.value,
      input.parameters,
      loaded.value.target.family === 'plot',
    );
    if (unknownParam) return unknownParam;
    let widgetDefinition: InternalWidgetValue = {
      ...loaded.value,
      projection: { kind: 'complete' },
    };
    const requestedDate = requestedRelativeDate(input);
    if (!requestedDate.ok) return requestedDate;
    const relativeDate = requestedDate.value;
    // Web hides Relative Date on a forward-looking chart; a lookback there clips its data.
    if (relativeDate !== null) {
      const plotToolChart = await readPlotToolChart({ request: adapter.request.bind(adapter) }, {
        widgetId: input.widgetId,
        chartId: requireWidgetValueTargetId(loaded.value.target),
      });
      const relativeDateUnoffered = plotToolChart.isForward
        ? unknownParamNameError(loaded.value, input.parameters, false)
        : undefined;
      if (relativeDateUnoffered) return relativeDateUnoffered;
      widgetDefinition = { ...widgetDefinition, plotToolChart };
    }
    const selected = await resolveCountrySelectedContext(
      widgetDefinition,
      input.selectedContext,
      input.parameters,
      options,
    );
    if (!selected.ok) return selected;
    const dereferenced = await dereferenceFullRenderValues(
      widgetDefinition,
      withoutRelativeDate(input.parameters),
      selected.value.selectedContext ?? inferredSelectedContext(widgetDefinition),
      widgetDatesWithRelativeDate(widgetDefinition.widgetDates, relativeDate),
      relativeDate,
      selected.value.selectedContext,
    );
    if (!dereferenced.ok) return dereferenced;
    const rendered = await render(
      dereferenced.value.widgetDefinition,
      dereferenced.value.parameters,
      dereferenced.value.selectedContext,
      dereferenced.value.widgetDates,
      'full',
    );
    return withGetInputEchoes(rendered, [...selected.value.echoes, ...dereferenced.value.inputEchoes]);
  }, {
    widgetId: input.widgetId,
    configurationId: input.configurationId ?? undefined,
  });
  const renderSnippetWidget = async (
    input: WidgetGetInput,
  ): Promise<WidgetResult<RenderedWidget>> => {
    const context = input.configurationId ?? input.selectedContext ?? undefined;
    try {
      const request = adapter.request.bind(adapter);
      let widgetRaw = widgetFromEnvelope(await hedgedWidgets(request).getWidget(
        input.widgetId,
        context === undefined ? undefined : { context },
      ));
      const targetId = validateWidgetDefinition(widgetRaw, input.widgetId);
      if (input.configurationId) {
        validateWidgetSnippetContext(widgetRaw, {
          widgetId: input.widgetId,
          configurationId: input.configurationId,
          definitionTargetId: targetId,
        });
      }
      const inputWidget = canonicalWidgetValue(
        request,
        widgetRaw,
        input.widgetId,
        input.configurationId,
        targetId,
      );
      const unknownParam = unknownParamNameError(
        inputWidget,
        input.parameters,
        inputWidget.target.family === 'plot',
      );
      if (unknownParam) return unknownParam;
      const selected = await resolveCountrySelectedContext(
        inputWidget,
        input.selectedContext,
        input.parameters,
        options,
      );
      if (!selected.ok) return selected;
      const explicitSelectedContext = selected.value.selectedContext ?? null;
      if (
        !input.configurationId
        && explicitSelectedContext !== null
        && explicitSelectedContext !== input.selectedContext
      ) {
        // The definition fetched under the name labels its context "Unknown Value"; refetch it under the code.
        widgetRaw = widgetFromEnvelope(await hedgedWidgets(request).getWidget(
          input.widgetId,
          { context: explicitSelectedContext },
        ));
      }
      const requestedDate = requestedRelativeDate(input);
      if (!requestedDate.ok) return requestedDate;
      const inputError = semanticRenderInputError(
        { widget: inputWidget, parameters: [], relativeDate: requestedDate.value },
        explicitSelectedContext,
        'surface',
      );
      if (inputError) return { ok: false, error: inputError };
      let configuredWidget: WidgetPayload;
      if (input.configurationId) {
        const configuration = await readConfigurationDetail(
          request,
          input.configurationId,
          input.widgetId,
        );
        validateConfigurationDetail(configuration, {
          widgetId: input.widgetId,
          configurationId: input.configurationId,
        });
        configuredWidget = mergeWidgetConfigurationValues(
          widgetRaw,
          configuration,
        );
      } else {
        configuredWidget = await createDefaultWidgetConfiguration(
          request,
          widgetRaw,
          { ...input, selectedContext: explicitSelectedContext },
          targetId,
          mergeWidgetConfigurationValues,
        );
      }
      const merged = canonicalWidgetValue(
        request,
        configuredWidget,
        input.widgetId,
        input.configurationId
          ?? responseIdentifier(configuredWidget.configurationId, parseConfigId, 'configuration'),
        targetId,
        requestedDate.value ?? undefined,
        widgetEntityLabels(widgetRaw),
      );
      const selectedContext = explicitSelectedContext
        ?? inferredSelectedContext(merged);
      const selectedAssignment = explicitSelectedContext
        ? semanticSelectedContext(merged, explicitSelectedContext)
        : undefined;
      const resolvedAssignments = await resolveSemanticAssignments(
        merged,
        withoutRelativeDate(input.parameters),
        options,
      );
      if (!resolvedAssignments.ok) return resolvedAssignments;
      const canonical = withAssignmentTitle(merged, [
        ...(selectedAssignment ? [selectedAssignment] : []),
        ...resolvedAssignments.value.assignments,
      ]);
      return await render(
        canonical,
        [
          ...(selectedAssignment ? [selectedAssignment] : []),
          ...resolvedAssignments.value.assignments,
        ],
        selectedContext,
        surfaceWidgetDates(widgetDatesWithRelativeDate(canonical.widgetDates, requestedDate.value)),
        'snippet',
      );
    } catch (error) {
      return {
        ok: false,
        error: upstreamError(error, input.widgetId, input.configurationId),
      };
    }
  };
  const get = (input: WidgetGetInput): Promise<WidgetResult<RenderedWidget>> => {
    if (identityKind(input.selectedContext) === 'control-group') {
      return Promise.resolve({
        ok: false,
        error: controlGroupContextInputError(input.widgetId, 'Selected Context'),
      });
    }
    return input.detail === 'snippet'
      ? renderSnippetWidget(input)
      : renderReadWidget(input);
  };
  return {
    get,
    render,
  };
}
