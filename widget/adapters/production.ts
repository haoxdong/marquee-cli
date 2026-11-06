import assert from 'node:assert/strict';
import {
  type EntityModule,
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
} from '../../plottool/window.js';
import { resolveRelativeDateDefault } from '../../plottool/relative-date.js';
import {
  createProductionPlotTool,
  readPlotToolChart,
  resolvePlotToolWindowDates,
  type PlotToolChartRead,
  type PlotToolDateRangeOverride,
  type PlotToolWindowOverride,
} from '../../plottool/index.js';
import { savedChartAnchors, type WidgetPersistenceAnchors } from './plottool-persistence-anchor.js';
import {
  assertWidgetPayloadShape,
  contextParamDefault,
  controlField,
  configurationParameters,
  mergeWidgetConfigurationValues,
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
import {
  buildFullWidgetProjection,
  type FullWidgetProjection,
  type ProvidedWidgetEntities,
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
  SelectedContext,
  WidgetModule,
  EditableDashboard,
  WidgetError,
  WidgetGetInput,
  RenderedWidget,
  WidgetResult,
  WidgetDates,
  WidgetAccess,
  WidgetResolveInput,
  WidgetParameterOverride,
  WidgetValue,
  WidgetId,
  ConfigId,
} from '../types.js';
import { parseConfigId, parseWidgetId } from '../identifiers.js';
import { widgetParamRefName } from '../param-ref-name.js';
import { editableDashboardsFromResponse } from './editable-dashboards.js';
import { isRecord, record } from '../../lib/json-value.js';
type SemanticWidgetState = Readonly<{
  widget: InternalWidgetValue;
  parameters: readonly WidgetParameterOverride[];
  titleContextOverride?: string | null | undefined;
  relativeDate: PlotToolWindowOverride | null;
  widgetDates?: PlotToolDateRangeOverride;
}>;
type ConfiguredWidgetDates = PlotToolDateRangeOverride & Readonly<{ relativeDate: PlotToolWindowOverride }>;
type InvalidWidgetResponse = Extract<WidgetError, { kind: 'invalid-response' }>;

const EDITABLE_DASHBOARDS_TIMEOUT_MS = 4000;

function surfaceWidgetDates(dates: ConfiguredWidgetDates | undefined): WidgetDates | undefined {
  return dates && { ...dates, relativeDate: plotToolWindowOverrideToken(dates.relativeDate) };
}

// A returned identity matches when it is blank or equal ignoring case.
function sameOrBlank(returned: string, expected: string): boolean {
  return !returned || returned.toUpperCase() === expected.toUpperCase();
}

function configurationRecordFromResponse(value: unknown): Record<string, unknown> | undefined {
  return record(Array.isArray(value) ? value[0] : value);
}

function widgetConfigurationResult(response: unknown, widgetId: string, targetId: string): WidgetResult<Readonly<{ configurationId: ConfigId }>> {
  const record = configurationRecordFromResponse(response);
  const id = typeof record?.id === 'string' ? parseConfigId(record.id) : undefined;
  if (!record || !id) return { ok: false, error: widgetConfigurationMintFailure(widgetId) };
  const returnedWidgetId = cleanRecordText(record.widgetId);
  /* c8 ignore start -- Recording-unreachable by construction for supported Config creation: 134 provider-derived response bodies plus fresh PlotTool Pro and DataViz live probes retained the requested identities; mismatch permutations are pinned at the production-adapter seam. */
  assert(
    sameOrBlank(returnedWidgetId, widgetId) && sameOrBlank(cleanRecordText(record.underlyingChartId), targetId),
    new WidgetSemanticFailure(widgetConfigurationMismatch(widgetId, id, returnedWidgetId || undefined)),
  );
  /* c8 ignore stop */
  return { ok: true, value: { configurationId: id } };
}

function responseIdentifier<T>(value: unknown, parse: (text: string) => T | undefined, source: InvalidWidgetResponse['source']): T | null {
  const text = cleanRecordText(value);
  if (!text) return null;
  const id = parse(text);
  assert(id, new InvalidWidgetResponseError({ source, problem: 'unsupported-payload-shape', detail: `${source} id ${text} is malformed` }));
  return id;
}

function invalidWidget(problem: InvalidWidgetResponse['problem']): InvalidWidgetResponseError {
  return new InvalidWidgetResponseError({ source: 'widget', problem });
}

function mergeWidgetConfigurationDetail(widget: WidgetPayload, configuration: Record<string, unknown>): WidgetPayload {
  const configMetadata = isRecord(configuration.metadata) ? configuration.metadata : {};
  const configTitle = cleanRecordText(configMetadata.title) || cleanRecordText(configuration.title);
  return {
    ...mergeWidgetConfigurationValues(widget, configuration),
    metadata: { ...(isRecord(widget.metadata) ? widget.metadata : {}), ...configMetadata, ...(configTitle ? { title: configTitle } : {}) },
  };
}

async function readConfigurationDetail(request: WidgetPort['request'], configurationId: string, widgetId: string): Promise<Record<string, unknown>> {
  const record = configurationRecordFromResponse(await new WidgetApi({ request }).getConfiguration(configurationId));
  if (!record) {
    throw new WidgetSemanticFailure({
      kind: 'invalid-response', identity: { widgetId, configurationId }, source: 'configuration', problem: 'empty-configuration',
    });
  }
  validateConfigurationDetail(record, { widgetId, configurationId });
  return record;
}

class WidgetDataVizFailure extends Error {
  constructor(readonly error: DataVizError) {
    super(error.kind);
  }
}

function validateWidgetDefinition(widget: WidgetPayload, requestedWidgetId: string, allowMissingTarget = false): string {
  const returnedWidgetId = cleanRecordText(widget.id);
  /* c8 ignore start -- Recording-unreachable by construction for supported reads: the requested Widget endpoint returns that Widget, executable Widgets identify a CH or DV target, and the mismatched, missing-target and unsupported-target responses are pinned at the production-adapter seam. */
  assert(sameOrBlank(returnedWidgetId, requestedWidgetId), new WidgetSemanticFailure({
    kind: 'configuration-mismatch',
    identity: { widgetId: requestedWidgetId, configurationId: cleanRecordText(widget.configurationId) },
    ownerWidgetId: returnedWidgetId,
  }));
  const targetId = cleanRecordText(widget.underlyingChartId);
  if (!targetId && allowMissingTarget) return '';
  assert(targetId, new WidgetSemanticFailure(missingWidgetTarget(requestedWidgetId)));
  assert(/^(?:CH|DV)/.test(targetId), new WidgetSemanticFailure(unsupportedWidgetExecutionTarget(requestedWidgetId, targetId)));
  /* c8 ignore stop */
  return targetId;
}

function validateConfigurationDetail(
  configuration: Record<string, unknown>,
  input: { widgetId: string; configurationId: string; definitionTargetId?: string },
): void {
  /* c8 ignore start -- Recording-unreachable by construction for supported reads: configuration detail retains its requested identities, while mismatch permutations are pinned at the production-adapter seam. */
  assert(
    sameOrBlank(cleanRecordText(configuration.id), input.configurationId)
      && (!input.definitionTargetId || sameOrBlank(cleanRecordText(configuration.underlyingChartId), input.definitionTargetId))
      && sameOrBlank(cleanRecordText(configuration.widgetId), input.widgetId),
    new WidgetSemanticFailure({ kind: 'configuration-mismatch', identity: { widgetId: input.widgetId, configurationId: input.configurationId } }),
  );
  /* c8 ignore stop */
}

async function widgetMetadata(requester: Pick<WidgetPort, 'request'>, widgetId: string, parameters: readonly unknown[]): Promise<unknown> {
  return Reflect.get(Object(await new WidgetApi(requester).getWidgetMetadata(widgetId, parameters)), 'metadata');
}

async function widgetDynamicMetadataTitle(
  request: WidgetPort['request'],
  widgetId: string,
  parameters: readonly unknown[],
): Promise<Readonly<{ title: string }>> {
  return { title: cleanRecordText(Reflect.get(Object(await widgetMetadata({ request }, widgetId, parameters)), 'title')) };
}

function canonicalDefinition(
  definition: Record<string, unknown>,
  field: string,
  value: unknown,
  options: unknown[],
): WidgetValue['parameters'][number] {
  const type = cleanRecordText(definition.type) || cleanRecordText(definition.controlType) || paramTypeFromRecord(definition, value, options);
  return { field, type, value, options };
}

function canonicalWidgetParameter(parameter: Record<string, unknown>, component: Record<string, unknown>): WidgetValue['parameters'][number] | undefined {
  const field = cleanRecordText(parameter.field);
  if (!field) return undefined;
  const payloadOptions = optionalWidgetPayloadArray(parameter.options, 'parameter.options');
  const options = payloadOptions.length === 1 && Array.isArray(payloadOptions[0]) ? payloadOptions[0] : payloadOptions;
  const value = component[field] ?? parameter.value ?? parameter.defaultValue ?? Reflect.get(Object(parameter.values), 'default');
  return canonicalDefinition(parameter, field, value, options);
}

function canonicalWidgetControl(control: Record<string, unknown>): WidgetValue['controls'][number] | undefined {
  const field = controlField(control);
  if (!field) return undefined;
  const options = optionalWidgetPayloadArray(control.values, 'control.values');
  assert(control.value !== undefined && control.value !== null, invalidWidget('render-control-value-missing'));
  return canonicalDefinition(control, field, control.value, options);
}

function selectedContextKinds(field: string, type: string): NonNullable<WidgetValue['contextParameter']>['kinds'] {
  const folded = `${field} ${type}`.toLowerCase();
  if (['thematic', 'basket', 'portfolio'].some((kind) => folded.includes(kind))) return [];
  if (folded.includes('country')) return ['country'];
  assert(!folded.includes('control group') && !folded.includes('control-group'), invalidWidget('context-parameter-control-group'));
  return [];
}

type InternalWidgetValue = WidgetValue & Readonly<{
  authors?: readonly string[];
  access?: WidgetAccess;
  configurationAssignments?: readonly WidgetParameterOverride[];
  widgetDates?: ConfiguredWidgetDates;
  plotToolChart?: PlotToolChartRead;
  savedRenderParams?: SemanticWidgetPayload['renderParams'];
  inputs: ReadonlyMap<string, Readonly<{ field: string; domain: WidgetInputDomain }>>;
}>;

type WidgetRelativeDate = Readonly<{ window: PlotToolWindowOverride; chart: PlotToolChartRead }>;

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
    Array.isArray(value) && value.length > 0 && value.every((author): author is string => typeof author === 'string'),
    'widget.authors is not a non-empty string array',
  );
  return value;
}

async function resolveWidgetAuthors(request: WidgetPort['request'], authorIds: readonly string[]): Promise<readonly string[]> {
  const response = await new UsersApi({ request }).getUserNames(authorIds);
  assertWidgetPayloadShape(isRecord(response) && Array.isArray(response.results), 'users query response has no results array');
  const authorsById = new Map<string, string>();
  for (const value of response.results) {
    assertWidgetPayloadShape(isRecord(value), 'users query result is not a record');
    const { id, name } = value;
    assertWidgetPayloadShape(typeof id === 'string' && id.length > 0, 'users query result has no id');
    assertWidgetPayloadShape(typeof name === 'string' && name.trim().length > 0, 'users query result has no name');
    authorsById.set(id, name);
  }
  return authorIds.map((authorId) => {
    const author = authorsById.get(authorId);
    assertWidgetPayloadShape(author, `users query result omits author ${authorId}`);
    return author;
  });
}
function inputDomainsByFieldAndRefName(widget: WidgetValue): InternalWidgetValue['inputs'] {
  const entityLabels = new Map(widget.entityLabels.map(({ identity, label }) => [identity, label]));
  return new Map([...semanticWidgetDefinitions(widget)].map(([name, { field, type, options }]) => [
    name, { field, domain: widgetInputDomain(type, options, entityLabels) },
  ]));
}

function requestedRelativeDate(input: WidgetGetInput): WidgetResult<PlotToolWindowOverride | null> {
  const requested = input.parameters.filter(({ field }) => field === 'relativeDate').at(-1)?.value;
  if (requested === undefined) return { ok: true, value: null };
  const window = parsePlotToolWindowOverride(requested);
  return window && isPlotToolWindowOverrideProviderAccepted(window) && !(window.start.kind === 'offset' && window.start.unit === 'd')
    ? { ok: true, value: window }
    : { ok: false, error: { kind: 'invalid-input', identity: { widgetId: input.widgetId }, input: 'Relative Date', problem: 'malformed' } };
}

function configPlotToolWindow(config: unknown): PlotToolWindowOverride | undefined {
  const relativeDate = configRelativeDate(config);
  if (relativeDate === undefined) return undefined;
  const window = parsePlotToolWindowOverride(relativeDate);
  assert(window, new InvalidWidgetResponseError({
    source: 'configuration', problem: 'unsupported-payload-shape', detail: `configuration.relativeDate ${relativeDate} is malformed`,
  }));
  return window;
}

function widgetDatesFromConfiguration(widget: WidgetPayload): ConfiguredWidgetDates | undefined {
  const configuration = record(widget.configuration);
  const calculated = record(widget.calculatedDates) ?? record(configuration?.calculatedDates);
  const { startDate, endDate, interval } = calculated ?? {};
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || typeof interval !== 'string') return undefined;
  const relativeDate = configPlotToolWindow(configuration ?? widget);
  assert(relativeDate, new InvalidWidgetResponseError({ source: 'configuration', problem: 'calculated-dates-without-relative-date' }));
  return { startDate, endDate, interval, relativeDate };
}

function canonicalWidgetTarget(widget: WidgetPayload, sourceId: string, targetId: string): WidgetValue['target'] {
  const target = selectWidgetRenderTarget({ sourceId, underlyingChartId: targetId, visualizationType: cleanRecordText(widget.visualizationType) });
  if (target.kind === 'blank') return { family: 'blank' };
  return target.kind === 'plot'
    ? { family: 'plot', targetId: target.targetId }
    : { family: 'data-viz', targetId: target.targetId, route: target.resource };
}

function widgetEntityLabels(widget: WidgetPayload): WidgetValue['entityLabels'] {
  const rawEntities = isRecord(widget.metadata) ? widget.metadata.entityMetadata : undefined;
  if (rawEntities === undefined || rawEntities === null) return [];
  /* c8 ignore start -- Recording-unreachable by construction: a fresh live scan of real Widgets returned only absent or record-shaped, named entity metadata; the malformed provider shapes are pinned at the Widget interface seam. */
  if (!isRecord(rawEntities)) throw new InvalidWidgetResponseError({ source: 'widget', problem: 'entity-metadata-not-record' });
  return Object.entries(rawEntities).map(([identity, value], index) => {
    if (!isRecord(value)) throw new InvalidWidgetResponseError({ source: 'widget', problem: 'entity-metadata-entry-not-record', index });
    const label = cleanRecordText(value.name);
    if (!label) throw new InvalidWidgetResponseError({ source: 'widget', problem: 'entity-metadata-name-missing', index });
    return { identity, label };
  });
  /* c8 ignore stop */
}

function relativeDateRule(value: unknown): string {
  return isRecord(value) && isRecord(value.rdate) ? cleanRecordText(value.rdate.rule) : '';
}

function recordDate(value: unknown): number {
  return isRecord(value) ? Date.parse(cleanRecordText(value.value)) : NaN;
}

// The candidate with `rule` and the latest date, else the first one.
function freshestRelativeDateCandidate(candidates: readonly unknown[], rule: string): unknown {
  return candidates.reduce<unknown>((freshest, candidate) => {
    const candidateDate = recordDate(candidate);
    const freshestDate = recordDate(freshest);
    return rule && relativeDateRule(candidate) === rule && Number.isFinite(candidateDate)
      && (!Number.isFinite(freshestDate) || candidateDate > freshestDate) ? candidate : freshest;
  }, candidates[0]);
}

function refreshedWidgetComponent(widget: WidgetPayload, refreshRelativeDateDefaults: boolean): Record<string, unknown> {
  const component: Record<string, unknown> = isRecord(widget.renderParams?.component) ? { ...widget.renderParams.component } : {};
  const parameters = refreshRelativeDateDefaults ? optionalWidgetPayloadArray(widget.parameters, 'parameters') : [];
  for (const parameter of parameters) {
    if (!isRecord(parameter) || cleanRecordText(parameter.type).toLowerCase() !== 'date') continue;
    const field = cleanRecordText(parameter.field);
    const values = parameter.values;
    assert(field && isRecord(values) && (values.default !== undefined || component[field] === undefined), invalidWidget('date-parameter-default-missing'));
    if (values.default === undefined) continue;
    const current = component[field];
    const currentRule = relativeDateRule(current);
    const fallback = freshestRelativeDateCandidate([values.default, ...optionalWidgetPayloadArray(parameter.options, 'parameter.options')], currentRule);
    const fallbackDate = recordDate(fallback);
    component[field] = currentRule && currentRule === relativeDateRule(fallback) && Number.isFinite(fallbackDate)
      && (!Number.isFinite(recordDate(current)) || fallbackDate > recordDate(current))
      ? fallback
      : resolveRelativeDateDefault(current, fallback);
  }
  return component;
}

function canonicalWidgetContext(widget: WidgetPayload, inferSoleContextOption: boolean) {
  const rawContext = record(widget.contextParameter);
  if (!rawContext) return null;
  const field = cleanRecordText(rawContext.field);
  const options = optionalWidgetPayloadArray(rawContext.options, 'contextParameter.options');
  const value = contextParamDefault(widget, field || 'context', inferSoleContextOption ? options : []);
  return { field, type: paramTypeFromRecord(rawContext, value, options), value, options };
}

function canonicalWidgetValue(
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
  const component = refreshedWidgetComponent(widget, refreshRelativeDateDefaults);
  const controls = optionalWidgetPayloadArray(widget.renderParams?.controls, 'renderParams.controls')
    .filter(isRecord).map(canonicalWidgetControl).filter((control) => control !== undefined);
  const parameters = optionalWidgetPayloadArray(widget.parameters, 'parameters')
    .filter(isRecord).map((parameter) => canonicalWidgetParameter(parameter, component)).filter((parameter) => parameter !== undefined);
  const context = canonicalWidgetContext(widget, inferSoleContextOption);
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
  const description = cleanRecordText(widget.description);
  const value: WidgetValue & Omit<InternalWidgetValue, 'inputs'> = {
    widgetId,
    configurationId,
    configuration: configurationId
      ? { configurationId, widgetId, ...widgetValueConfigurationTarget(target), relativeDate: configurationRelativeDate }
      : null,
    projection: { kind: 'complete' },
    title: { embedded: embeddedTitle || null, fallback: fallbackTitle, useEntityTitle: widget.useEntityTitle !== false },
    target,
    parameters,
    contextParameter: context && {
      field: context.field, type: context.type, kinds: selectedContextKinds(context.field, context.type), value: context.value, options: context.options,
    },
    controls,
    componentInputs: Object.entries(component).map(([field, value]) => ({ field, value })),
    entityLabels,
    ...(Array.isArray(widget.metadata?.expressionLabels) ? { expressionLabels: [...widget.metadata.expressionLabels] } : {}),
    ...(description ? { description } : {}),
    tags: optionalWidgetPayloadArray(widget.tags, 'tags').map(String),
    sources,
    ...(widgetDates ? { widgetDates } : {}),
  };
  return { ...value, inputs: inputDomainsByFieldAndRefName(value) };
}
function inferredSelectedContext(widget: WidgetValue): string | null {
  const value = widget.contextParameter?.value;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function unconfiguredContextAssignment(widget: WidgetValue): readonly WidgetParameterOverride[] {
  const context = widget.contextParameter;
  return widget.configurationId !== null || !context?.field ? [] : [{ field: context.field, value: context.value }];
}

function canonicalRenderWidgetDefinition(widgetDefinition: unknown, relativeDate: PlotToolWindowOverride | null): InternalWidgetValue {
  if (isRecord(widgetDefinition) && typeof widgetDefinition.widgetId === 'string' && isRecord(widgetDefinition.target)) {
    return widgetDefinition as InternalWidgetValue;
  }
  const raw = widgetFromEnvelope(widgetDefinition);
  const widgetId = responseIdentifier(raw.id, parseWidgetId, 'widget');
  assert(widgetId, new WidgetSemanticFailure({ kind: 'invalid-definition', identity: { widgetId: '' }, problem: 'missing-identity' }));
  const targetId = validateWidgetDefinition(raw, widgetId, true);
  const configurationId = responseIdentifier(raw.configurationId, parseConfigId, 'configuration');
  return {
    ...canonicalWidgetValue(raw, widgetId, configurationId, targetId, relativeDate, widgetEntityLabels(raw), false),
    ...(isRecord(raw.renderParams) && isRecord(raw.renderParams.component)
      ? { savedRenderParams: raw.renderParams as SemanticWidgetPayload['renderParams'] }
      : {}),
  };
}

function semanticRenderInput(
  widget: InternalWidgetValue,
  parameters: readonly WidgetParameterOverride[],
  widgetDates: PlotToolDateRangeOverride | undefined,
  relativeDate: PlotToolWindowOverride | null,
): SemanticWidgetState {
  return { widget, parameters, relativeDate, ...(widgetDates ? { widgetDates } : {}) };
}

type SemanticWidgetDefinition = WidgetValue['parameters'][number];
type SemanticAssignmentFailure = Extract<WidgetInputResolution, { ok: false }>['error'];

function widgetInputDefinitions(widget: WidgetValue): SemanticWidgetDefinition[] {
  return [...(widget.contextParameter ? [widget.contextParameter] : []), ...widget.controls, ...widget.parameters];
}

// Each definition by field and by ref name; the one with more options wins a shared name.
function semanticWidgetDefinitions(widget: WidgetValue): Map<string, SemanticWidgetDefinition> {
  const byField = new Map<string, SemanticWidgetDefinition>();
  for (const definition of widgetInputDefinitions(widget)) {
    for (const name of [definition.field, widgetParamRefName(definition.field)]) {
      const current = byField.get(name);
      if (!current || definition.options.length > current.options.length) byField.set(name, definition);
    }
  }
  return byField;
}

function semanticAssignmentError(widgetId: string, input: string, failure: SemanticAssignmentFailure): WidgetError {
  const identity = { widgetId };
  if (failure.kind === 'unsafe-integer') return { kind: 'unsafe-integer-input', identity, input, requested: failure.requested };
  if (failure.kind === 'invalid') return { kind: 'invalid-input', identity, input, problem: failure.problem };
  const { requested, candidates } = failure;
  return { kind: failure.kind === 'ambiguous' ? 'ambiguous-input' : 'unmatched-input', identity, input, requested, candidates };
}

type WidgetInputDependencies = Readonly<{ entity: WidgetEntityModule; controlGroup: ControlGroupModule }>;

function unknownParamNameError(
  widget: WidgetValue,
  parameters: readonly CliParameterOverride[],
  offersRelativeDate: boolean,
): Readonly<{ ok: false; error: WidgetError }> | undefined {
  const names = [...new Set([
    ...[...widgetInputDefinitions(widget), ...widget.componentInputs].filter(({ field }) => field !== '').map(({ field }) => widgetParamRefName(field)),
    ...(offersRelativeDate ? ['relativeDate'] : []),
  ])];
  const unknown = parameters.find(({ field }) => !names.includes(field));
  return unknown && {
    ok: false, error: { kind: 'unknown-input', identity: { widgetId: widget.widgetId }, input: unknown.field, candidates: names },
  };
}

async function resolveInput(
  widget: InternalWidgetValue,
  input: Readonly<{ field: string; domain: WidgetInputDomain }>,
  value: string,
  dependencies: WidgetInputDependencies,
): Promise<Extract<WidgetInputResolution, { ok: true }> | Readonly<{ ok: false; error: WidgetError }>> {
  const outcome = await resolveWidgetInput(input.domain, value, { widgetId: widget.widgetId, field: input.field, ...dependencies });
  return outcome.ok ? outcome : { ok: false, error: semanticAssignmentError(widget.widgetId, input.field, outcome.error) };
}

// Resolves `-p` values in order, stopping at the first failure without sending the rest.
async function resolveSemanticAssignments(
  widget: InternalWidgetValue,
  parameters: readonly CliParameterOverride[],
  dependencies: WidgetInputDependencies,
): Promise<WidgetResult<Readonly<{ assignments: readonly WidgetParameterOverride[]; echoes: readonly string[] }>>> {
  const assignments: WidgetParameterOverride[] = [];
  const echoes: string[] = [];
  for (const assignment of parameters) {
    const input = widget.inputs.get(assignment.field);
    /* c8 ignore next 4 -- Recording-unreachable: this branch is selected by the in-process assignment name; CLI --param names are rejected as unknown inputs earlier, and focused interface tests pin unknown assignments. */
    if (!input) {
      assignments.push(assignment);
      continue;
    }
    if (input.field === widget.contextParameter?.field && identityKind(assignment.value) === 'control-group') {
      return { ok: false, error: controlGroupContextInputError(widget.widgetId, assignment.field) };
    }
    // eslint-disable-next-line no-await-in-loop -- stops at the first failure without sending the rest
    const outcome = await resolveInput(widget, input, assignment.value, dependencies);
    if (!outcome.ok) return outcome;
    assignments.push({ field: input.field, value: outcome.value, displayValue: outcome.displayValue ?? outcome.label });
    if (outcome.echo) echoes.push(outcome.echo);
  }
  return { ok: true, value: { assignments, echoes } };
}

async function resolveUnoverriddenCountryContext(
  widget: InternalWidgetValue,
  selectedContext: string | null | undefined,
  parameters: readonly CliParameterOverride[],
  dependencies: WidgetInputDependencies,
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
  const outcome = await resolveInput(widget, input, selectedContext, dependencies);
  if (!outcome.ok) return outcome;
  return { ok: true, value: { selectedContext: String(outcome.value), echoes: outcome.echo ? [outcome.echo] : [] } };
}

function controlGroupContextInputError(widgetId: string, input: string): WidgetError {
  return { kind: 'invalid-input', identity: { widgetId }, input, problem: 'control-group' };
}

function semanticSelectedContext(widget: WidgetValue, selectedContext: string | null): WidgetParameterOverride | undefined {
  const field = widget.contextParameter?.field;
  return selectedContext !== null && field ? { field, value: selectedContext } : undefined;
}

function semanticRenderInputError(
  input: SemanticWidgetState,
  selectedContext: string | null,
  inputSource: 'surface' | 'identity',
): WidgetError | undefined {
  const { widgetId } = input.widget;
  /* c8 ignore start -- Recording-unreachable: both arms are selected by the in-process Widget Definition, Selected Context, and assignment arguments; focused interface and adapter tests pin the typed failures. */
  if (inputSource === 'identity' && isQuickPollWidget(input.widget) && input.parameters.some(({ field }) => isQuickPollSurveyDateField(field))) {
    return incompatibleWidgetInput(widgetId, 'surveyDate');
  }
  if (selectedContext !== null && input.widget.contextParameter === null) {
    return { kind: 'invalid-input', identity: { widgetId }, input: 'Selected Context', problem: 'malformed' };
  }
  return undefined;
  /* c8 ignore stop */
}

// The last string assigned to the context field, else the Selected Context.
function effectiveSelectedContext(widget: WidgetValue, assignments: readonly WidgetParameterOverride[], selectedContext: string | null): string | null {
  const contextField = widget.contextParameter?.field;
  if (!contextField) return selectedContext;
  const assigned = [...assignments].reverse().find(({ field, value }) => field === contextField && typeof value === 'string')?.value;
  return typeof assigned === 'string' ? assigned : selectedContext;
}

async function fetchEditableDashboards(request: WidgetPort['request'], signal?: AbortSignal): Promise<EditableDashboard[]> {
  const response = await new DashboardApi({
    request: (endpoint, init) => request(endpoint, { ...init, timeoutMs: EDITABLE_DASHBOARDS_TIMEOUT_MS, signal }),
  }).getEditableDashboards();
  return editableDashboardsFromResponse(response);
}

function upstreamError(e: unknown, widgetId: string, configurationId?: string | null): WidgetError {
  if (e instanceof WidgetSemanticFailure) return e.error;
  const identity = { widgetId };
  if (e instanceof WidgetSnippetDisplayError) return { kind: 'missing-display-evidence', identity, field: e.field, identifier: e.identifier };
  if (e instanceof WidgetPlotToolFailure) return { kind: 'plottool-failure', identity, problem: e.error };
  if (e instanceof WidgetDataVizFailure && configurationId) {
    return { kind: 'data-viz-failure', identity: { widgetId, configurationId }, problem: e.error };
  }
  const marqueeError = e instanceof MarqueeError ? e : undefined;
  if (marqueeError?.details?.status === 403 && widgetId && marqueeError.details.path !== DashboardApi.editableDashboards.path) {
    return { kind: 'widget-access-denied', identity };
  }
  if (e instanceof InvalidWidgetResponseError) return { ...e.error, kind: 'invalid-response', identity };
  assert(marqueeError, e as Error);
  return { kind: 'widget-load-failure', identity, failure: marqueeError.dependencyFailure() };
}

async function withWidgetErrors<T>(
  operation: () => Promise<WidgetResult<T>>,
  context: { widgetId: string; configurationId?: string | null | undefined },
): Promise<WidgetResult<T>> {
  try {
    return await operation();
  } catch (error) {
    return { ok: false, error: upstreamError(error, context.widgetId, context.configurationId) };
  }
}

export function createWidgetConfigurationProjectionPort(adapter: WidgetPort): {
  resolve(configurationId: string): Promise<WidgetResult<WidgetPersistenceAnchors>>;
} {
  const widgetApi = new WidgetApi(adapter);
  return {
    resolve: (configurationId) => withWidgetErrors(async () => {
      const configuration = await widgetApi.getConfiguration(configurationId.trim());
      const parameters = configParameters(configuration);
      const configured = configRelativeDate(configuration);
      if (configured || parameters.length > 0) {
        return { ok: true, value: { parameters, ...(configured ? { relativeDate: configured } : {}) } };
      }
      return savedChartAnchors(widgetApi, configUnderlyingChartId(configuration), configurationId, parameters);
    }, { widgetId: '' }),
  };
}
function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assignmentChangesValues(values: ReadonlyMap<string, unknown>, assignment: WidgetParameterOverride): boolean {
  return !values.has(assignment.field) || !valuesEqual(values.get(assignment.field), assignment.value);
}

function withSemanticConfigurationTitle<T extends WidgetValue>(widget: T, configuredTitle: string | undefined, configurationChanged: boolean): T {
  if (configuredTitle) return { ...widget, title: { ...widget.title, embedded: configuredTitle, fallback: configuredTitle } };
  return configurationChanged ? { ...widget, title: { ...widget.title, embedded: null } } : widget;
}

function invalidateTitleForChangedAssignments<T extends InternalWidgetValue>(widget: T, assignments: readonly WidgetParameterOverride[]): T {
  const current = semanticWidgetCurrentValues({ widget });
  const effective = new Map(assignments.map(({ field, value }) => [field, value]));
  // A `-p` slider is written in Web's key order, so compare its chosen mark, not its serialization.
  return withSemanticConfigurationTitle(widget, undefined, [...effective].some(
    ([field, value]) => !current.has(field) || !valuesEqual(unwrapSliderValue(current.get(field)), unwrapSliderValue(value)),
  ));
}

function withSemanticWidgetAssignments<T extends WidgetValue>(widget: T, assignments: readonly WidgetParameterOverride[]): T {
  const values = new Map(assignments.map(({ field, value }) => [field, value]));
  const context = widget.contextParameter;
  const contextField = context?.field || 'context';
  const applyValue = <D extends Readonly<{ field: string; value: unknown }>>(definition: D): D => (
    values.has(definition.field) ? { ...definition, value: values.get(definition.field) } : definition
  );
  const declared = new Set([
    ...(context ? [contextField] : []),
    ...[...widget.controls, ...widget.parameters, ...widget.componentInputs].map(({ field }) => field),
  ]);
  return {
    ...widget,
    parameters: widget.parameters.map(applyValue),
    contextParameter: context && values.has(contextField) ? { ...context, value: values.get(contextField) } : context,
    controls: widget.controls.map(applyValue),
    componentInputs: [...widget.componentInputs.map(applyValue), ...assignments.filter(({ field }) => !declared.has(field))],
  };
}

type CliParameterOverride = WidgetGetInput['parameters'][number];

type SemanticRender = (
  input: SemanticWidgetState,
  detail: 'snippet' | 'full',
) => Promise<WidgetResult<RenderedWidget>>;

function semanticWidgetSnippetFields(input: SemanticWidgetState): string[] {
  const fields = widgetInputDefinitions(input.widget).map(({ field }) => field);
  if (input.widget.target.family === 'plot') fields.push('Relative Date');
  return [...new Set(fields.filter((field) => field.length > 0))];
}

type NotFoundValue = Readonly<{ field: string; value: string }>;

function semanticWidgetSnippetParameterLines(
  input: SemanticWidgetState,
  entityMap: Readonly<Record<string, string>>,
  notFoundValues: readonly NotFoundValue[],
): string[] {
  const values = semanticParameterValues(input);
  for (const assignment of input.parameters) values.set(assignment.field, assignment.displayValue ?? assignment.value);
  const relativeDate = input.relativeDate ?? input.widget.configuration?.relativeDate;
  return widgetSnippetParams(semanticWidgetSnippetFields(input).map((field) => {
    if (isWidgetSnippetInteraction(field)) return { field, value: relativeDate && plotToolWindowOverrideToken(relativeDate) };
    const value = values.get(field);
    const visible = Array.isArray(value)
      ? value.filter((member) => !notFoundValues.some((missing) => missing.field === field && missing.value === member))
      : value;
    return { field, value: toWidgetParameterDisplayValue(visible, entityMap) };
  }));
}

type ResolvedSemanticWidgetParameters = Readonly<{
  entityMap: Record<string, string>;
  cgMembers: Record<string, string[]>;
  parameterLines: readonly string[];
  notFoundValues: readonly NotFoundValue[];
}>;

type SemanticResolutionUse = Readonly<{ field: string; role: 'required' | 'option' | 'asset-list-member' }>;

type PendingSemanticResolution<I extends WidgetResolveInput = WidgetResolveInput> = Readonly<{
  input: I;
  uses: readonly [SemanticResolutionUse, ...SemanticResolutionUse[]];
}>;
type PendingControlGroupResolution = PendingSemanticResolution<Extract<WidgetResolveInput, { kind: 'control-group' }>>;
type PendingEntityResolution = PendingSemanticResolution<Exclude<WidgetResolveInput, { kind: 'control-group' }>>;

// Resolution shared by snippet and full reads: entity labels, control group members and the values not found.
type ResolutionState = Readonly<{ widgetId: string; entityMap: Record<string, string>; cgMembers: Record<string, string[]>; notFoundValues: NotFoundValue[] }>;

function scalarWidgetValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scalarWidgetValues);
  return typeof value === 'string' ? [value] : [];
}

function unresolvedSemanticParameter(
  input: SemanticWidgetState,
  field: string,
  type: string | undefined,
  scalar: string,
  hasEvidence: (kind: WidgetResolveInput['kind']) => boolean,
  role: SemanticResolutionUse['role'],
): PendingSemanticResolution | undefined {
  const context = input.widget.contextParameter;
  const countryContext = context?.field === field && context.kinds.includes('country');
  const kind = /^[A-Z]{2}$/i.test(scalar) && (type?.toLowerCase().includes('country') || countryContext) ? 'country' : identityKind(scalar);
  if (!kind) return undefined;
  const useRole = role === 'asset-list-member' && kind !== 'asset' ? 'required' : role;
  if ((kind === 'control-group' && useRole === 'required') || hasEvidence(kind)) return undefined;
  return { input: { kind, value: scalar }, uses: [{ field, role: useRole }] };
}

function applySemanticNotFoundResolution(resolution: PendingSemanticResolution, notFoundValues: NotFoundValue[]): void {
  const required = resolution.uses.find(({ role }) => role === 'required');
  if (required) throw new WidgetSnippetDisplayError(required.field, resolution.input);
  for (const { field } of resolution.uses) {
    if (!notFoundValues.some((option) => option.field === field && option.value === resolution.input.value)) {
      notFoundValues.push({ field, value: resolution.input.value });
    }
  }
}

async function resolveSemanticEntityInputs(
  entity: WidgetEntityModule,
  pending: readonly [PendingEntityResolution, ...PendingEntityResolution[]],
  state: ResolutionState,
): Promise<void> {
  const resolvedValues = requireWidgetSnippetEntityResolution(
    state.widgetId, pending[0].uses[0].field, await entity.resolve(pending.map(({ input }) => input)),
  );
  for (const [index, resolution] of pending.entries()) {
    const resolved = resolvedValues[index];
    /* c8 ignore start -- Recording-unreachable by construction: production Entity.resolve validates and restores the requested order before returning; focused Widget interface tests inject missing and malformed results to pin the closed failure. */
    if (!resolved || resolved.kind !== resolution.input.kind) throw new WidgetSnippetDisplayError(resolution.uses[0].field);
    /* c8 ignore stop */
    if (isEntityNotFound(resolved)) {
      applySemanticNotFoundResolution(resolution, state.notFoundValues);
      continue;
    }
    for (const key of [resolution.input.value, resolved.entityId, ...resolved.aliases]) state.entityMap[key] = resolved.label;
  }
}

function applySemanticControlGroupExpansions(
  pending: readonly PendingControlGroupResolution[],
  expansions: readonly ControlGroupExpansion[],
  state: ResolutionState,
): void {
  const byId = new Map(expansions.map((expansion) => [expansion.controlGroupId.trim().toUpperCase(), expansion]));
  for (const resolution of pending) {
    const expansion = byId.get(resolution.input.value.trim().toUpperCase());
    if (!expansion || expansion.members.length === 0) {
      applySemanticNotFoundResolution(resolution, state.notFoundValues);
      continue;
    }
    state.cgMembers[resolution.input.value] = expansion.members.map(({ entityId }) => entityId);
    for (const member of expansion.members) {
      for (const key of [member.entityId, ...member.aliases]) state.entityMap[key] ??= member.label;
    }
  }
}

// A Portfolio context's options are matched one by one; every other group is expanded in one request.
async function resolveSemanticControlGroups(
  controlGroup: ControlGroupModule,
  pending: readonly PendingControlGroupResolution[],
  state: ResolutionState,
  contextField: string | undefined,
): Promise<void> {
  const fieldOf = ({ input, uses }: PendingControlGroupResolution) => ({ input, field: uses[0].field });
  const contextOptions = pending.filter(({ uses }) => uses.every((use) => use.field === contextField && use.role === 'option'));
  const otherGroups = pending.filter((resolution) => !contextOptions.includes(resolution));
  const [first, ...rest] = otherGroups;
  await Promise.all([
    ...contextOptions.map(async (resolution) => {
      const result = await controlGroup.match([resolution.input.value], undefined, 50);
      const expansions = requireWidgetSnippetControlGroupExpansion(
        state.widgetId,
        [fieldOf(resolution)],
        result.ok ? { ok: true, value: [{ controlGroupId: resolution.input.value, members: result.value }] } : result,
      );
      applySemanticControlGroupExpansions([resolution], expansions, state);
    }),
    first && (async () => applySemanticControlGroupExpansions(otherGroups, requireWidgetSnippetControlGroupExpansion(
      state.widgetId,
      [fieldOf(first), ...rest.map(fieldOf)],
      await controlGroup.expand(otherGroups.map(({ input }) => input.value)),
    ), state))(),
  ]);
}

function unresolvedSemanticParameters(
  input: SemanticWidgetState,
  includeOptions: boolean,
  values: ReadonlyMap<string, unknown>,
  entityMap: Readonly<Record<string, string>>,
  displayEvidence: ReadonlySet<string>,
): PendingSemanticResolution[] {
  const definitions = semanticWidgetDefinitions(input.widget);
  return semanticWidgetSnippetFields(input).flatMap((field) => {
    const definition = definitions.get(field);
    const currentValue = values.get(field);
    const currentRole = definition?.type === 'AssetList' && Array.isArray(currentValue)
      && (includeOptions || currentValue.every((value) => typeof value === 'string')) ? 'asset-list-member' : 'required';
    const candidates = [
      ...(includeOptions
        ? entityResolvedWidgetOptionValues(definition?.type ?? '', definition?.options ?? []).map((value) => ({ value, role: 'option' as const }))
        : []),
      { value: currentValue, role: currentRole } as const,
    ];
    return candidates.flatMap(({ value, role }) => scalarWidgetValues(value).flatMap((scalar) => {
      const hasEvidence = (kind: WidgetResolveInput['kind']) => displayEvidence.has(`${field}\0${scalar}`)
        || (kind !== 'control-group' && Boolean(entityMap[scalar]));
      return unresolvedSemanticParameter(input, field, definition?.type, scalar, hasEvidence, role) ?? [];
    }));
  });
}

// Merges pending resolutions of the same identity into one request with every use.
function uniqueSemanticResolutions(pending: readonly PendingSemanticResolution[]): PendingSemanticResolution[] {
  const byIdentity = new Map<string, PendingSemanticResolution>();
  for (const resolution of pending) {
    const key = `${resolution.input.kind}:${resolution.input.value}`;
    const current = byIdentity.get(key);
    byIdentity.set(key, current ? { input: current.input, uses: [...current.uses, ...resolution.uses] } : resolution);
  }
  return [...byIdentity.values()];
}

async function resolveSemanticWidgetParameters(
  input: SemanticWidgetState,
  entity: WidgetEntityModule | undefined,
  controlGroup: ControlGroupModule,
  includeOptions = false,
): Promise<ResolvedSemanticWidgetParameters> {
  const state: ResolutionState = {
    widgetId: input.widget.widgetId,
    entityMap: Object.fromEntries(input.widget.entityLabels.map(({ identity, label }) => [identity, label])),
    cgMembers: {},
    notFoundValues: [],
  };
  const displayEvidence = new Set<string>();
  for (const assignment of input.parameters) {
    if (!hasWidgetDisplayEvidence(assignment)) continue;
    const displayValues = scalarWidgetValues(assignment.displayValue);
    for (const [index, scalar] of scalarWidgetValues(assignment.value).entries()) {
      displayEvidence.add(`${assignment.field}\0${scalar}`);
      const displayValue = displayValues[index];
      if (displayValue) state.entityMap[scalar] = displayValue;
    }
  }
  const unique = uniqueSemanticResolutions(
    unresolvedSemanticParameters(input, includeOptions, semanticParameterValues(input), state.entityMap, displayEvidence),
  );
  const controlGroups = unique.filter((resolution): resolution is PendingControlGroupResolution => resolution.input.kind === 'control-group');
  const [firstEntity, ...otherEntities] = unique.filter((resolution): resolution is PendingEntityResolution => resolution.input.kind !== 'control-group');
  const context = input.widget.contextParameter;
  await Promise.all([
    firstEntity && entity && resolveSemanticEntityInputs(entity, [firstEntity, ...otherEntities], state),
    controlGroups.length > 0
      && resolveSemanticControlGroups(controlGroup, controlGroups, state, context?.type === 'Portfolio' ? context.field : undefined),
  ]);
  const { entityMap, cgMembers, notFoundValues } = state;
  return { entityMap, cgMembers, parameterLines: semanticWidgetSnippetParameterLines(input, entityMap, notFoundValues), notFoundValues };
}

function semanticParameterValues(input: SemanticWidgetState): Map<string, unknown> {
  const { contextParameter, controls, parameters, componentInputs } = input.widget;
  const entries = [...(contextParameter ? [contextParameter] : []), ...controls, ...[...parameters].reverse(), ...componentInputs, ...input.parameters];
  // A later undefined value removes the field rather than falling back to an earlier one.
  return new Map([...new Map(entries.map(({ field, value }) => [field, value]))].filter(([, value]) => value !== undefined));
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
  const { widgetId, configurationId, target } = input.widget;
  const targetId = widgetValueTargetId(target);
  return {
    ok: true,
    value: {
      detail: 'snippet',
      widget: {
        widgetId,
        configurationId,
        selectedContext,
        title: resolvedTitle.title,
        ...(targetId ? { chartId: targetId } : {}),
        parameters: semanticWidgetSnippetFields(input).map((field) => ({
          field, refKey: widgetParamRefName(field), type: 'unknown', default: undefined, options: [],
        })),
      },
      snippet: { ...resolvedTitle, parameterLines: resolvedParameters.parameterLines },
    },
  };
}
async function resolveSemanticWidgetTitle(
  input: SemanticWidgetState,
  entity: WidgetEntityModule | undefined,
  request: WidgetPort['request'],
): Promise<Readonly<{ title: string; isTitleResolved: boolean }>> {
  const { widgetId, title, entityLabels } = input.widget;
  const resolved = await resolveWidgetTitle({
    widgetId,
    embeddedTitle: title.embedded,
    fallbackTitle: title.fallback,
    useEntityTitle: title.useEntityTitle,
    entityLabels,
    contextualFallbackTitle: () => resolvedContextualWidgetTitle(
      entity,
      input.widget.widgetId,
      input,
      input.widget.title.fallback,
      input.titleContextOverride,
    ),
    metadataTitle: async () => (await widgetDynamicMetadataTitle(
      request,
      input.widget.widgetId,
      [...semanticParameterValues(input)].map(([field, value]) => ({ field, value })),
    )).title,
  }, entity);
  return { title: resolved.title, isTitleResolved: !isDegenerateTitle(resolved.title) };
}

const DATA_VIZ_VISUALIZATION_TYPES = {
  visualization: 'DataViz',
  component: 'BaseComponent',
} as const satisfies Record<Extract<WidgetValue['target'], { family: 'data-viz' }>['route'], string>;

function semanticWidgetPayload(
  input: SemanticWidgetState,
  assignments: readonly WidgetParameterOverride[],
  notFoundValues: readonly NotFoundValue[] = [],
): SemanticWidgetPayload {
  const { widget } = input;
  const context = widget.contextParameter;
  const assignmentByField = new Map(assignments.map(({ field, value }) => [field, value]));
  const selectedValue = (field: string, fallback: unknown): unknown => (assignmentByField.has(field) ? assignmentByField.get(field) : fallback);
  const optionValues = (field: string, values: readonly unknown[]): unknown[] => {
    const missing = new Set(notFoundValues.filter((option) => option.field === field).map(({ value }) => value));
    return values.filter((value) => typeof value !== 'string' || !missing.has(value));
  };
  const component = Object.fromEntries(widget.componentInputs.map(({ field, value }) => [field, selectedValue(field, value)]));
  const controls = widget.controls.map((control) => ({
    id: control.field, type: control.type, value: selectedValue(control.field, control.value), values: optionValues(control.field, control.options),
  }));
  const componentValues = new Map<string, unknown>([...Object.entries(component), ...controls.map(({ id, value }) => [id, value] as const)]);
  const contextValue = context && selectedValue(context.field, context.value);
  return {
    id: widget.widgetId,
    configurationId: widget.configurationId,
    title: widget.title.fallback,
    ...widgetValueTargetPayload(widget.target),
    ...(widget.target.family === 'data-viz' ? { visualizationType: DATA_VIZ_VISUALIZATION_TYPES[widget.target.route] } : {}),
    ...(widget.description ? { description: widget.description } : {}),
    tags: [...widget.tags],
    dataAttribution: [...widget.sources],
    metadata: {
      ...(widget.title.embedded ? { title: widget.title.embedded } : {}),
      ...(widget.expressionLabels ? { expressionLabels: [...widget.expressionLabels] } : {}),
      dataSources: [...widget.sources],
    },
    renderParams: widget.savedRenderParams ?? {
      component: Object.fromEntries([...componentValues].filter(([, value]) => value !== false && value !== '')),
      controls,
    },
    ...(context
      ? {
          contextParameter: {
            field: context.field,
            type: context.type,
            value: contextValue,
            values: { default: contextValue },
            options: optionValues(context.field, context.options),
          },
        }
      : {}),
    parameters: widget.parameters.map((parameter) => ({
      field: parameter.field,
      type: parameter.type,
      options: optionValues(parameter.field, parameter.options),
      values: { default: selectedValue(parameter.field, parameter.value) },
    })),
  };
}

function plotToolNow(): Date {
  /* c8 ignore next -- The branch is process-environment control rather than provider data; contract and interface tests pin deterministic clock use. */
  return process.env.MARQUEE_NOW ? new Date(process.env.MARQUEE_NOW) : new Date();
}

function freshLoadWidgetDates(dates: ConfiguredWidgetDates, chartId: string): ConfiguredWidgetDates {
  const resolved = resolvePlotToolWindowDates({ chartId, window: dates.relativeDate, interval: dates.interval, now: plotToolNow() });
  assert(resolved.ok, new InvalidWidgetResponseError({
    source: 'configuration', problem: 'unsupported-payload-shape', detail: 'Config window cannot be resolved against the local clock',
  }));
  return { ...dates, ...resolved.value };
}

async function semanticFull(
  input: SemanticWidgetState,
  assignments: readonly WidgetParameterOverride[],
  adapter: WidgetPort,
  entity: EntityModule,
  controlGroup: ControlGroupModule,
  selectedContext: SelectedContext | null,
): Promise<RenderedWidget> {
  // One failed sibling read aborts the others.
  const renderAbort = new AbortController();
  const request: WidgetPort['request'] = (target, init) => adapter.request(target, {
    ...init,
    signal: init?.signal ? AbortSignal.any([renderAbort.signal, init.signal]) : renderAbort.signal,
  });
  const abortCheckedSharedEntity: EntityModule = {
    ...entity,
    async resolve(inputs) {
      renderAbort.signal.throwIfAborted();
      return entity.resolve(inputs);
    },
  };
  const parametersPromise = resolveSemanticWidgetParameters(
    input,
    abortCheckedSharedEntity,
    {
      ...controlGroup,
      expand: (ids) => controlGroup.expand(ids, renderAbort.signal),
    },
    true,
  );
  const providedEntities = parametersPromise.then((resolved) => ({
    entityMap: resolved.entityMap,
    cgMembers: resolved.cgMembers,
    notFoundValues: resolved.notFoundValues,
    parameterWidget: semanticWidgetPayload(
      input,
      assignments,
      resolved.notFoundValues,
    ),
  }));
  const titlePromise = resolveSemanticWidgetTitle(input, abortCheckedSharedEntity, request);
  const viewPromise = semanticFullView(input, assignments, request, abortCheckedSharedEntity, providedEntities);
  const [view, resolvedTitle, resolvedParameters] = await Promise.all([
    viewPromise,
    titlePromise,
    parametersPromise,
  ]).catch((error: unknown) => {
    renderAbort.abort();
    throw error;
  });
  const definition = input.widget;
  const widget = {
    ...view.widget,
    selectedContext,
    title: resolvedTitle.title,
    ...(definition.authors?.length ? { authors: definition.authors } : {}),
    ...(definition.access ? { access: definition.access } : {}),
  };
  if (view.execution.family === 'data-restricted') {
    throw new WidgetSemanticFailure({ kind: 'data-restricted', identity: { widgetId: definition.widgetId }, widget });
  }
  return {
    detail: 'full',
    widget,
    snippet: { title: resolvedTitle.title, isTitleResolved: resolvedTitle.isTitleResolved, parameterLines: resolvedParameters.parameterLines },
    execution: view.execution,
  };
}

// Async so that a throw while building the view rejects and aborts the sibling reads.
async function semanticFullView(
  input: SemanticWidgetState,
  assignments: readonly WidgetParameterOverride[],
  request: WidgetPort['request'],
  entity: EntityModule,
  providedEntities: Promise<ProvidedWidgetEntities>,
): Promise<FullWidgetProjection> {
  const { widget: definition, widgetDates, relativeDate } = input;
  const assigned = new Map(assignments.map(({ field, value }) => [field, value]));
  return buildFullWidgetProjection(
    request,
    entity,
    { module: createProductionPlotTool({ request }), ...(definition.plotToolChart ? { chart: definition.plotToolChart } : {}) },
    plotToolNow(),
    semanticWidgetPayload(input, assignments),
    definition.controls.map((control) => ({
      field: control.field,
      ...(control.type !== 'String' && control.type !== 'EnumList' ? { type: control.type } : {}),
      value: assigned.has(control.field) ? assigned.get(control.field) : control.value,
    })),
    definition.widgetId,
    definition.configurationId,
    (error) => new WidgetDataVizFailure(error),
    providedEntities,
    (signal) => fetchEditableDashboards(request, signal),
    [
      ...assignments,
      ...(relativeDate !== null ? [{ field: 'Relative Date', value: plotToolWindowOverrideToken(relativeDate) }] : []),
    ],
    widgetDates,
    JSON.parse(JSON.stringify({ dashboardOverrides: assignments, hasSavedRenderParams: definition.savedRenderParams !== undefined })) as
      Pick<DataVizInputs, 'dashboardOverrides' | 'hasSavedRenderParams'>,
  );
}

function semanticWidgetCurrentValues(input: Pick<SemanticWidgetState, 'widget'>): Map<string, unknown> {
  const { contextParameter: context, controls, parameters, componentInputs } = input.widget;
  return new Map<string, unknown>([
    ...(context ? [[context.field || 'context', context.value] as const] : []),
    ...[...controls, ...parameters, ...componentInputs].map(({ field, value }) => [field, value] as const),
  ]);
}

// A relative-date value is stored as the option with its rule.
function semanticConfigurationCurrentValues(input: SemanticWidgetState): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const context = input.widget.contextParameter;
  if (context && context.value !== undefined && context.value !== '') values.set(context.field || 'context', context.value);
  for (const definition of [...input.widget.controls, ...input.widget.parameters]) {
    const rule = relativeDateRule(definition.value);
    const value = definition.options.find((option) => rule && relativeDateRule(option) === rule) ?? definition.value;
    if (value !== undefined) values.set(definition.field, value);
  }
  return values;
}

function needsSemanticConfiguration(input: SemanticWidgetState, assignments: readonly WidgetParameterOverride[]): boolean {
  if (input.widget.target.family === 'blank') return false;
  if (input.widget.configurationId === null) return true;
  const currentValues = semanticWidgetCurrentValues(input);
  return assignments.some((assignment) => assignmentChangesValues(currentValues, assignment))
    || (input.relativeDate !== null && input.relativeDate.start.token !== input.widget.configuration?.relativeDate?.start.token);
}

function configurationAssignmentMissing(): InvalidWidgetResponseError {
  return new InvalidWidgetResponseError({ source: 'configuration', problem: 'configuration-assignment-missing' });
}

function completeSemanticConfigurationAssignments(
  input: SemanticWidgetState,
  assignments: readonly WidgetParameterOverride[],
): readonly WidgetParameterOverride[] {
  const { widget } = input;
  const stored = widget.configurationAssignments ?? [];
  if (widget.parameters.some(({ field, type }) => type === 'DateList' && assignments.some((assignment) => assignment.field === field))) {
    // A Relative Date List keeps the stored values and moves the context to the end.
    const values = new Map([...stored, ...assignments].map(({ field, value }) => [field, value]));
    if (widget.contextParameter) {
      const value = values.get(widget.contextParameter.field);
      assert(value != null, configurationAssignmentMissing());
      values.delete(widget.contextParameter.field);
      values.set(widget.contextParameter.field, value);
    }
    return [...values].map(([field, value]) => ({ field, value }));
  }
  const currentValues = semanticWidgetCurrentValues(input);
  const storedOnly = input.parameters.length === 0 && widget.configurationId !== null;
  const values = input.parameters.length > 0
    ? semanticConfigurationCurrentValues(input)
    : new Map<string, unknown>(input.relativeDate !== null && storedOnly ? stored.map(({ field, value }) => [field, value]) : []);
  for (const assignment of assignments) {
    const matchesStored = !assignmentChangesValues(values, assignment);
    assert(!storedOnly || assignmentChangesValues(currentValues, assignment) || matchesStored, configurationAssignmentMissing());
    if (matchesStored) continue;
    values.delete(assignment.field);
    values.set(assignment.field, assignment.value);
  }
  return [...values].map(([field, value]) => ({ field, value }));
}

function semanticContextChanged(input: SemanticWidgetState, assignments: readonly WidgetParameterOverride[]): boolean {
  const context = input.widget.contextParameter;
  if (!context) return false;
  const assignment = [...assignments].reverse().find(({ field }) => field === context.field);
  return assignment !== undefined && !valuesEqual(assignment.value, context.value);
}

async function mintSemanticConfiguration(
  adapter: WidgetPort,
  input: SemanticWidgetState,
  assignments: readonly WidgetParameterOverride[],
  relativeDateOverride: PlotToolWindowOverride | null,
): Promise<WidgetResult<Readonly<{
  configurationId: ConfigId;
  configuration: NonNullable<WidgetValue['configuration']>;
  title?: string;
  expressionLabels?: readonly unknown[];
  widgetDates?: ConfiguredWidgetDates;
}>>> {
  const { widgetId } = input.widget;
  return withWidgetErrors(async () => {
    const parameters = assignments.map(({ field, value }) => ({ field, value }));
    const targetId = requireWidgetValueTargetId(input.widget.target);
    const identity = { widgetId, underlyingChartId: targetId };
    const date = relativeDateOverride !== null ? { relativeDate: plotToolWindowOverrideProviderToken(relativeDateOverride) } : {};
    // Web's key order differs between a changed and a default Config.
    const body = input.parameters.length > 0 || relativeDateOverride !== null
      ? { parameters, ...identity, ...date }
      : { ...identity, parameters, ...date };
    const response = await new WidgetApi(adapter).createConfiguration(body);
    const configured = widgetConfigurationResult(response, widgetId, targetId);
    if (!configured.ok) return configured;
    const { configurationId } = configured.value;
    const detail = configurationRecordFromResponse(response) as Record<string, unknown>;
    const widgetDates = widgetDatesFromConfiguration(detail);
    const labelsRequired = input.widget.target.family === 'plot' && input.widget.expressionLabels !== undefined
      && semanticContextChanged(input, assignments);
    // A freshly minted Config carries no metadata; Web reads it from the Widget metadata POST.
    const metadata: unknown = isRecord(detail.metadata) || !labelsRequired ? detail.metadata : await widgetMetadata(adapter, widgetId, parameters);
    const title = cleanRecordText(Reflect.get(Object(metadata), 'title'));
    const labels: unknown = Reflect.get(Object(metadata), 'expressionLabels');
    const labelsFailure = (problem: 'expression-labels-missing' | 'expression-labels-not-array') => new WidgetSemanticFailure({
      kind: 'invalid-response', identity: { widgetId, configurationId }, source: 'configuration', problem,
    });
    assert(labels !== undefined || !labelsRequired, labelsFailure('expression-labels-missing'));
    assert(labels === undefined || Array.isArray(labels), labelsFailure('expression-labels-not-array'));
    return {
      ok: true,
      value: {
        configurationId,
        configuration: { configurationId, widgetId, targetId, relativeDate: relativeDateOverride },
        ...(title ? { title } : {}),
        ...(Array.isArray(labels) ? { expressionLabels: labels } : {}),
        ...(widgetDates ? { widgetDates } : {}),
      },
    };
  }, { widgetId });
}
export function createWidgetProductionModule(
  adapter: WidgetPort,
  options: { entity: EntityModule; controlGroup: ControlGroupModule },
): WidgetModule {
  const widgets = new WidgetApi(adapter);
  // The requested assignments keyed by declared field, accepting a field or its ref name; later ones win.
  const semanticConfigurationAssignments = (
    input: SemanticWidgetState,
    selected: WidgetParameterOverride | undefined,
    ignoreUnknownAssignments = false,
  ): WidgetResult<readonly WidgetParameterOverride[]> => {
    const definitions = [...widgetInputDefinitions(input.widget), ...input.widget.componentInputs];
    const byName = new Map<string, typeof definitions[number]>();
    for (const definition of definitions) {
      byName.set(definition.field, definition);
      byName.set(widgetParamRefName(definition.field), definition);
    }
    if (input.widget.contextParameter?.field === '') byName.set('context', { ...input.widget.contextParameter, field: 'context' });
    const requested = [...unconfiguredContextAssignment(input.widget), ...(selected ? [selected] : []), ...input.parameters];
    const assignments = new Map<string, WidgetParameterOverride>();
    for (const assignment of ignoreUnknownAssignments ? requested.filter(({ field }) => byName.has(field)) : requested) {
      const definition = byName.get(assignment.field);
      /* c8 ignore start -- Recording-unreachable in this expansion: standalone Widget.get resolves CLI fields before render, while focused interface tests pin the closed direct-render failure. */
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
      assignments.delete(definition.field);
      assignments.set(definition.field, { field: definition.field, value: assignment.value });
    }
    return { ok: true, value: [...assignments.values()] };
  };
  // Mints a Config when the assignments or Relative Date change the saved one.
  const prepareSemanticRender = async (
    input: SemanticWidgetState,
    selected: WidgetParameterOverride | undefined,
    relativeDateOverride: PlotToolWindowOverride | null,
    widgetDates: ConfiguredWidgetDates | undefined,
  ) => {
    const assignments = semanticConfigurationAssignments(input, selected);
    /* c8 ignore next -- Recording-unreachable: the branch is selected by an invocation-local --param field or value rejected before any request; the production-adapter test pins an unknown full-read parameter. */
    if (!assignments.ok) return assignments;
    const configurationChanged = needsSemanticConfiguration(input, assignments.value);
    const configured: Awaited<ReturnType<typeof mintSemanticConfiguration>> = configurationChanged
      ? await mintSemanticConfiguration(adapter, input, completeSemanticConfigurationAssignments(input, assignments.value), relativeDateOverride)
      : {
          ok: true as const,
          value: {
            configurationId: input.widget.configurationId as ConfigId,
            configuration: input.widget.configuration as NonNullable<WidgetValue['configuration']>,
          },
        };
    if (!configured.ok) return configured;
    const { configurationId, configuration, expressionLabels, title, widgetDates: mintedDates } = configured.value;
    const widget = withSemanticConfigurationTitle({
      ...input.widget,
      configurationId,
      configuration,
      ...(expressionLabels ? { expressionLabels: [...expressionLabels] } : {}),
    }, title, configurationChanged);
    return {
      ok: true as const,
      value: {
        widgetDates: mintedDates ?? widgetDates,
        input: { ...input, widget },
        assignments: assignments.value,
        configurationChanged,
      },
    };
  };
  const prepareRenderValues = (
    canonical: InternalWidgetValue,
    parameters: readonly WidgetParameterOverride[],
    selectedContext: string | null,
    widgetDates: PlotToolDateRangeOverride | undefined,
    relativeDate: PlotToolWindowOverride | null,
    ignoreUnknownAssignments: boolean,
  ) => {
    const input = semanticRenderInput(canonical, parameters, widgetDates, relativeDate);
    assert(semanticRenderInputError(input, selectedContext, 'surface') === undefined, invalidWidget('render-input-invalid'));
    const assignments = semanticConfigurationAssignments(input, semanticSelectedContext(canonical, selectedContext), ignoreUnknownAssignments);
    assert(assignments.ok, invalidWidget('render-assignment-invalid'));
    const currentValues = semanticWidgetCurrentValues(input);
    const effectiveWidget = withSemanticWidgetAssignments(canonical, assignments.value);
    return {
      input: { ...input, widget: { ...effectiveWidget, componentInputs: effectiveWidget.componentInputs.filter(({ value }) => value !== '') } },
      appliedAssignments: assignments.value.filter((assignment) => assignmentChangesValues(currentValues, assignment)),
      selectedContext: effectiveSelectedContext(canonical, assignments.value, selectedContext),
    };
  };
  // Resolves `-p` values, mints the Config they need, and returns what `render` takes.
  const dereferenceFullRenderValues = async (
    canonical: InternalWidgetValue,
    parameters: readonly CliParameterOverride[],
    selectedContext: string | null,
    widgetDates: ConfiguredWidgetDates | undefined,
    relativeDateOverride: PlotToolWindowOverride | null,
    titleContextOverride: string | null | undefined,
  ): Promise<WidgetResult<Readonly<{
    widgetDefinition: InternalWidgetValue;
    parameters: readonly WidgetParameterOverride[];
    selectedContext: string | null;
    widgetDates: WidgetDates | undefined;
    inputEchoes: readonly string[];
  }>>> => {
    const resolved = await resolveSemanticAssignments(canonical, parameters, options);
    if (!resolved.ok) return resolved;
    const { assignments, echoes } = resolved.value;
    const input = {
      ...semanticRenderInput(canonical, assignments, widgetDates, relativeDateOverride ?? widgetDates?.relativeDate ?? null),
      titleContextOverride,
    };
    const inputError = semanticRenderInputError(input, selectedContext, 'identity');
    if (inputError) return { ok: false, error: inputError };
    const prepared = await prepareSemanticRender(input, semanticSelectedContext(canonical, selectedContext), relativeDateOverride, widgetDates);
    if (!prepared.ok) return prepared;
    const dates = prepared.value.widgetDates;
    // Web recomputes a saved Config's window on load, but uses Config dates after a reselect.
    const renderDates = dates && canonical.target.family === 'plot' && relativeDateOverride === null && !prepared.value.configurationChanged
      ? freshLoadWidgetDates(dates, canonical.target.targetId)
      : dates;
    return {
      ok: true,
      value: {
        widgetDefinition: prepared.value.input.widget,
        parameters: prepared.value.assignments.map((assignment) => {
          const match = [...assignments].reverse().find((candidate) => (
            candidate.field === assignment.field && valuesEqual(candidate.value, assignment.value)
          ));
          return match?.displayValue === undefined ? assignment : { ...assignment, displayValue: match.displayValue };
        }),
        selectedContext: effectiveSelectedContext(canonical, prepared.value.assignments, selectedContext),
        widgetDates: surfaceWidgetDates(renderDates),
        inputEchoes: echoes,
      },
    };
  };
  const render: WidgetModule['render'] = (widgetDefinition, parameters, selectedContext, widgetDates, detail) => {
    const identity: { widgetId: string; configurationId?: string | undefined } = { widgetId: '' };
    return withWidgetErrors(async () => {
      const relativeDate = widgetDates?.relativeDate === undefined ? undefined : parsePlotToolWindowOverride(widgetDates.relativeDate);
      const canonical = canonicalRenderWidgetDefinition(widgetDefinition, relativeDate ?? null);
      identity.widgetId = canonical.widgetId;
      identity.configurationId = canonical.configurationId ?? undefined;
      assert(widgetDates?.relativeDate === undefined || relativeDate, invalidWidget('render-input-invalid'));
      return presentRenderValues(
        prepareRenderValues(canonical, parameters, selectedContext, widgetDates, relativeDate ?? null, detail === 'snippet'),
        detail,
      );
    }, identity);
  };
  const presentRenderValues = async (
    prepared: ReturnType<typeof prepareRenderValues>,
    detail: Parameters<SemanticRender>[1],
  ): Promise<WidgetResult<RenderedWidget>> => {
    if (detail === 'snippet') {
      return semanticSnippet(prepared.input, options.entity, options.controlGroup, adapter.request.bind(adapter), prepared.selectedContext);
    }
    assert(identityKind(prepared.input.widget.contextParameter?.value) !== 'control-group', invalidWidget('selected-context-control-group'));
    return {
      ok: true,
      value: await semanticFull(
        prepared.input, prepared.appliedAssignments, adapter, options.entity, options.controlGroup, prepared.selectedContext,
      ),
    };
  };
  const createDefaultWidgetConfiguration = async (
    request: WidgetPort['request'],
    widgetRaw: WidgetPayload,
    input: WidgetGetInput,
    targetId: string,
    mergeConfiguration: (widget: WidgetPayload, configuration: Record<string, unknown>) => WidgetPayload = mergeWidgetConfigurationDetail,
  ): Promise<WidgetPayload> => {
    const defaultWidget = canonicalWidgetValue(
      restoreRelativeDateDefaults(widgetRaw), input.widgetId, null, targetId, undefined, widgetEntityLabels(widgetRaw),
    );
    const selectedContext = input.selectedContext ?? inferredSelectedContext(defaultWidget);
    const contextField = defaultWidget.contextParameter?.field;
    const detail = configurationRecordFromResponse(await new WidgetApi({ request }).createConfiguration({
      widgetId: input.widgetId,
      underlyingChartId: targetId,
      parameters: selectedContext && contextField ? [{ field: contextField, value: selectedContext }] : [],
    }));
    /* c8 ignore start -- Recording-unreachable by construction for supported default resolution: successful Config creation returns an identity, while the malformed response is pinned at the production-adapter seam. */
    const configurationId = detail ? cleanRecordText(detail.id) : '';
    if (!detail || !configurationId) throw new WidgetSemanticFailure(widgetConfigurationMintFailure(input.widgetId));
    /* c8 ignore stop */
    validateConfigurationDetail(detail, { widgetId: input.widgetId, configurationId, definitionTargetId: targetId });
    return mergeConfiguration(widgetRaw, detail);
  };
  const configuredReadWidget = async (
    request: WidgetPort['request'],
    widgetRaw: WidgetPayload,
    input: WidgetGetInput,
    existingConfigurationId: ConfigId | undefined,
    targetId: string,
    requestedDate: WidgetResult<PlotToolWindowOverride | null>,
  ): Promise<InternalWidgetValue> => {
    // Awaited even without a Config: the yield lets the sibling author and chart reads start before the default Config POST.
    const detail = await (existingConfigurationId ? readConfigurationDetail(request, existingConfigurationId, input.widgetId) : undefined);
    let configuredWidget = detail ? mergeWidgetConfigurationDetail(widgetRaw, detail) : widgetRaw;
    const configurationAssignments = detail
      ? configurationParameters(detail).flatMap(({ field, value }) => (
          typeof field === 'string' && !isRelativeDateField(field) ? [{ field, value }] : []
        ))
      : [];
    let configurationId = existingConfigurationId ?? null;
    if (!existingConfigurationId && input.parameters.length === 0 && !input.selectedContext) {
      if (targetId) configuredWidget = await createDefaultWidgetConfiguration(request, widgetRaw, input, targetId);
      configurationId = responseIdentifier(configuredWidget.configurationId, parseConfigId, 'configuration');
    }
    const canonical = canonicalWidgetValue(
      restoreRelativeDateDefaults(configuredWidget), input.widgetId, configurationId, targetId, undefined,
      widgetEntityLabels(configuredWidget), true, input.parameters.length > 0,
    );
    const access = widgetAccess(widgetRaw.label);
    restoreRelativeDateDefaults(widgetRaw);
    const widget: InternalWidgetValue = {
      ...canonical,
      ...(access === undefined ? {} : { access }),
      ...(configurationAssignments.length > 0 ? { configurationAssignments } : {}),
    };
    const unknownParam = unknownParamNameError(widget, input.parameters, widget.target.family === 'plot');
    if (unknownParam) throw new WidgetSemanticFailure(unknownParam.error);
    if (!requestedDate.ok) throw new WidgetSemanticFailure(requestedDate.error);
    return widget;
  };
  // Reads the Widget, its Config, authors and PlotTool chart; one failed sibling read aborts the others.
  const readSemanticWidget = async (input: WidgetGetInput) => {
    const existingConfigurationId = input.configurationId ?? undefined;
    const widgetRaw = widgetFromEnvelope(
      await widgets.getWidget(input.widgetId, { mergeParams: true, ...(existingConfigurationId ? { context: existingConfigurationId } : {}) }),
      { deferRenderParams: existingConfigurationId !== undefined },
    );
    const targetId = validateWidgetDefinition(widgetRaw, input.widgetId, true);
    const authorIds = widgetAuthorIds(widgetRaw.authors);
    const requestedDate = requestedRelativeDate(input);
    const readSiblingAbort = new AbortController();
    const siblingRequest: WidgetPort['request'] = (target, init) => adapter.request(target, { ...init, signal: readSiblingAbort.signal });
    const [widget, authors, plot] = await Promise.all([
      configuredReadWidget(siblingRequest, widgetRaw, input, existingConfigurationId, targetId, requestedDate),
      authorIds === undefined ? undefined : resolveWidgetAuthors(siblingRequest, authorIds),
      targetId.startsWith('CH') && requestedDate.ok
        ? readPlotToolChart({ request: siblingRequest }, { widgetId: input.widgetId, chartId: targetId }).then((read) => {
            if (!read.ok) throw new WidgetPlotToolFailure(read.error);
            return { chart: read.value, window: requestedDate.value };
          })
        : undefined,
    ]).catch((error: unknown) => {
      readSiblingAbort.abort();
      throw error;
    });
    return {
      widget: { ...widget, ...(authors === undefined ? {} : { authors }), ...(plot === undefined ? {} : { plotToolChart: plot.chart }) },
      relativeDate: plot?.window ? { window: plot.window, chart: plot.chart } satisfies WidgetRelativeDate : null,
    };
  };
  const withGetInputEchoes = (result: WidgetResult<RenderedWidget>, inputEchoes: readonly string[]): WidgetResult<RenderedWidget> => {
    if (!result.ok || result.value.detail !== 'full' || inputEchoes.length === 0) return result;
    return { ok: true, value: { ...result.value, widget: { ...result.value.widget, inputEchoes } } };
  };
  const withoutRelativeDate = (assignments: readonly CliParameterOverride[]) => assignments.filter(({ field }) => field !== 'relativeDate');
  const widgetDatesWithRelativeDate = (widgetDates: ConfiguredWidgetDates | undefined, relativeDate: PlotToolWindowOverride | null) => (
    relativeDate && widgetDates ? { ...widgetDates, relativeDate } : widgetDates
  );
  const renderReadWidget = async (input: WidgetGetInput): Promise<WidgetResult<RenderedWidget>> => withWidgetErrors(async () => {
    const loaded = await readSemanticWidget(input);
    const widgetDefinition: InternalWidgetValue = { ...loaded.widget, projection: { kind: 'complete' } };
    // Web hides Relative Date on a forward-looking chart; a lookback there clips its data.
    const relativeDateUnoffered = loaded.relativeDate?.chart.isForward ? unknownParamNameError(widgetDefinition, input.parameters, false) : undefined;
    if (relativeDateUnoffered) return relativeDateUnoffered;
    const relativeDate = loaded.relativeDate?.window ?? null;
    const selected = await resolveUnoverriddenCountryContext(widgetDefinition, input.selectedContext, input.parameters, options);
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
  }, { widgetId: input.widgetId, configurationId: input.configurationId });
  const renderSnippetWidget = async (input: WidgetGetInput): Promise<WidgetResult<RenderedWidget>> => withWidgetErrors(async () => {
    const context = input.configurationId ?? input.selectedContext ?? undefined;
    const request = adapter.request.bind(adapter);
    let widgetRaw = widgetFromEnvelope(await widgets.getWidget(input.widgetId, context === undefined ? undefined : { context }));
    const targetId = validateWidgetDefinition(widgetRaw, input.widgetId);
    if (input.configurationId) {
      validateWidgetSnippetContext(widgetRaw, { widgetId: input.widgetId, configurationId: input.configurationId, definitionTargetId: targetId });
    }
    const inputWidget = canonicalWidgetValue(widgetRaw, input.widgetId, input.configurationId, targetId);
    const unknownParam = unknownParamNameError(inputWidget, input.parameters, inputWidget.target.family === 'plot');
    if (unknownParam) return unknownParam;
    const selected = await resolveUnoverriddenCountryContext(inputWidget, input.selectedContext, input.parameters, options);
    if (!selected.ok) return selected;
    const explicitSelectedContext = selected.value.selectedContext ?? null;
    if (!input.configurationId && explicitSelectedContext !== null && explicitSelectedContext !== input.selectedContext) {
      // The definition fetched under the name labels its context "Unknown Value"; refetch it under the code.
      widgetRaw = widgetFromEnvelope(await widgets.getWidget(input.widgetId, { context: explicitSelectedContext }));
    }
    const requestedDate = requestedRelativeDate(input);
    if (!requestedDate.ok) return requestedDate;
    const inputError = semanticRenderInputError(
      { widget: inputWidget, parameters: [], relativeDate: requestedDate.value }, explicitSelectedContext, 'surface',
    );
    if (inputError) return { ok: false, error: inputError };
    const configuredWidget = input.configurationId
      ? mergeWidgetConfigurationValues(widgetRaw, await readConfigurationDetail(request, input.configurationId, input.widgetId))
      : await createDefaultWidgetConfiguration(
          request, widgetRaw, { ...input, selectedContext: explicitSelectedContext }, targetId, mergeWidgetConfigurationValues,
        );
    const merged = canonicalWidgetValue(
      configuredWidget,
      input.widgetId,
      input.configurationId ?? responseIdentifier(configuredWidget.configurationId, parseConfigId, 'configuration'),
      targetId,
      requestedDate.value ?? undefined,
      widgetEntityLabels(widgetRaw),
    );
    const selectedAssignment = explicitSelectedContext ? semanticSelectedContext(merged, explicitSelectedContext) : undefined;
    const resolved = await resolveSemanticAssignments(merged, withoutRelativeDate(input.parameters), options);
    if (!resolved.ok) return resolved;
    const canonical = invalidateTitleForChangedAssignments(merged, [
      ...(selectedAssignment ? [selectedAssignment] : []),
      ...resolved.value.assignments,
    ]);
    return await render(
      canonical,
      [...(selectedAssignment ? [selectedAssignment] : []), ...resolved.value.assignments],
      explicitSelectedContext ?? inferredSelectedContext(merged),
      surfaceWidgetDates(widgetDatesWithRelativeDate(canonical.widgetDates, requestedDate.value)),
      'snippet',
    );
  }, { widgetId: input.widgetId, configurationId: input.configurationId });
  const get = (input: WidgetGetInput): Promise<WidgetResult<RenderedWidget>> => {
    if (identityKind(input.selectedContext) === 'control-group') {
      return Promise.resolve({ ok: false, error: controlGroupContextInputError(input.widgetId, 'Selected Context') });
    }
    return input.detail === 'snippet' ? renderSnippetWidget(input) : renderReadWidget(input);
  };
  return { get, render };
}
