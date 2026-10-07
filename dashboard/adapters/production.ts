import { DashboardApi } from '../../api/dashboard/index.js';
import { MarqueeError, type Endpoint } from '../../transport/index.js';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
import type { DependencyFailure } from '../../transport/index.js';
import {
  type WidgetDates,
} from '../../widget/index.js';
import { parseConfigId, parseWidgetId } from '../../widget/identifiers.js';
import type {
  Dashboard,
  DashboardConfiguredWidgetProjection,
  DashboardChild,
  DashboardError,
  DashboardKind,
  DashboardPermissions,
  DashboardResult,
  DashboardSection,
  DashboardSummary,
} from '../types.js';
import type { DashboardPort } from '../module.js';

type DashboardRequestInit = Readonly<{
  query?: Readonly<Record<string, unknown>>;
  body?: unknown;
  hedgeDelaysMs?: readonly number[];
}>;

export interface DashboardTransport {
  request(endpoint: Endpoint, init?: DashboardRequestInit): Promise<unknown>;
}

type DashboardConfiguredWidgetProjectionError =
  Extract<
    Awaited<ReturnType<DashboardConfiguredWidgetProjection['project']>>,
    { ok: false }
  >['error'];

function dependencyFailure(error: unknown): DependencyFailure {
  if (error instanceof MarqueeError) {
    if (error.code === 'auth_expired') {
      return { kind: 'authentication-required', realm: 'marquee' };
    }
    if (error.details?.status === 429) return { kind: 'rate-limited' };
    if (error.code === 'timeout') return { kind: 'timeout' };
    if (error.details?.isCanceled === true) return { kind: 'cancelled' };
  }
  return { kind: 'unavailable' };
}

function readFailure(error: unknown, id: string): DashboardError {
  if (error instanceof MarqueeError) {
    if (error.details?.status === 404) return { kind: 'not-found', dashboardId: id };
    if (error.details?.status === 403) return { kind: 'access-denied', dashboardId: id };
  }
  return {
    kind: 'dependency',
    failure: dependencyFailure(error),
  };
}

function malformed(reason: string): never {
  throw new Error(`Unsupported Dashboard response shape: ${reason}`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  return malformed(`${label} is missing`);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  return malformed(`${label} is not a string`);
}

function optionalNonBlankString(value: unknown, label: string): string | undefined {
  const candidate = optionalString(value, label);
  return candidate && candidate.trim().length > 0 ? candidate : undefined;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  return malformed(`${label} is not a string`);
}

function stringArray(value: unknown, label: string, optional = false): string[] {
  if (optional && (value === undefined || value === null)) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return malformed(`${label} is not a string array`);
  }
  return value;
}

function rank(value: unknown, label: string, fallback?: number): number {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return malformed(`${label} is missing`);
}

function dashboardKind(value: unknown): DashboardKind {
  if (value === 'Personal') return 'personal';
  if (value === 'Custom') return 'custom';
  if (value === 'Thematic') return 'thematic';
  return malformed('type is unsupported');
}

function optionalDashboardKind(value: unknown): DashboardKind | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return dashboardKind(value);
}

function permissions(value: unknown): DashboardPermissions {
  if (!isRecord(value)) return malformed('entitlements is not a record');
  return {
    viewers: stringArray(value.view, 'entitlements.view'),
    editors: stringArray(value.edit, 'entitlements.edit'),
    administrators: stringArray(value.admin, 'entitlements.admin'),
  };
}

function nestedId(value: unknown, label: string): string | undefined {
  const record = optionalRecord(value, label);
  return optionalNonBlankString(record?.id, `${label}.id`);
}

function parameters(value: unknown, label: string): Array<{ field: string; value: unknown }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return malformed(`${label} is not an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.field !== 'string' || !('value' in entry)) {
      return malformed(`${label}[${index}] is malformed`);
    }
    return { field: entry.field, value: entry.value };
  });
}

function parameterDefinitions(
  value: unknown,
  label: string,
): Array<Readonly<Record<string, unknown> & { field: string }>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return malformed(`${label} is not an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.field !== 'string' || entry.field.length === 0) {
      return malformed(`${label}[${index}] is malformed`);
    }
    return { ...entry, field: entry.field };
  });
}

function optionalRecord(value: unknown, label: string): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value)) return value;
  return malformed(`${label} is not a record`);
}

function renderParameters(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  const record = optionalRecord(value, label);
  if (!record) return undefined;
  let controls: Readonly<Record<string, unknown>>[] | undefined;
  if (record.controls !== undefined && record.controls !== null) {
    if (!Array.isArray(record.controls)) return malformed(`${label}.controls is not an array`);
    controls = record.controls.map((control, index) => {
      if (!isRecord(control)) return malformed(`${label}.controls[${index}] is not a record`);
      return { ...control };
    });
  }
  const component = optionalRecord(record.component, `${label}.component`);
  return {
    ...(controls ? { controls } : {}),
    ...(component ? { component: { ...component } } : {}),
  };
}

function widgetName(data: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const metadata = optionalRecord(data?.metadata, 'children[].data.metadata');
  return optionalString(metadata?.title, 'children[].data.metadata.title')
    ?? optionalString(data?.title, 'children[].data.title');
}

function widgetDates(
  value: Readonly<Record<string, unknown>>,
  index: number,
  relativeDate: string | null,
): WidgetDates | undefined {
  const dates = optionalRecord(
    value.calculatedDates,
    `children[${index}].calculatedDates`,
  );
  if (!dates) return undefined;
  return {
    startDate: requiredString(
      dates.startDate,
      `children[${index}].calculatedDates.startDate`,
    ),
    endDate: requiredString(
      dates.endDate,
      `children[${index}].calculatedDates.endDate`,
    ),
    interval: requiredString(
      dates.interval,
      `children[${index}].calculatedDates.interval`,
    ),
    ...(relativeDate ? { relativeDate } : {}),
  };
}

function requiredIdentifier<T>(
  value: string,
  parse: (text: string) => T | undefined,
  label: string,
): T {
  return parse(value.toUpperCase()) ?? malformed(`${label} is malformed`);
}

function isRelativeDateField(field: string): boolean {
  return /^relative\s*date$/i.test(field);
}

function directWidgetRenderValues(
  value: Readonly<Record<string, unknown>>,
  index: number,
  data: Readonly<Record<string, unknown>>,
  renderTargetId: string | undefined,
  childParameters: readonly Readonly<{ field: string; value: unknown }>[],
  contextField: string | undefined,
) {
  const relativeDate = nullableString(
    value.relativeDate
      ?? [...childParameters].reverse().find(({ field }) => isRelativeDateField(field))
        ?.value,
    `children[${index}].relativeDate`,
  );
  const selectedContextAssignment = contextField
    ? [...childParameters]
        .reverse()
        .find(({ field, value: assigned }) => (
          field === contextField
          && typeof assigned === 'string'
          && assigned.length > 0
        ))
    : undefined;
  const selectedContext = typeof selectedContextAssignment?.value === 'string'
    ? selectedContextAssignment.value
    : undefined;
  const dates = widgetDates(value, index, relativeDate);
  return {
    widgetDefinition: renderTargetId
      ? { ...data, underlyingChartId: renderTargetId }
      : data,
    widgetParameterOverrides: childParameters.filter(
      ({ field }) => !isRelativeDateField(field),
    ),
    ...(selectedContext ? { selectedContext } : {}),
    ...(dates ? { widgetDates: dates } : {}),
  };
}

function widgetChild(
  value: Readonly<Record<string, unknown>>,
  index: number,
  id: string,
  childRank: number,
): DashboardChild {
  const widgetId = requiredIdentifier(
    requiredString(value.entity_id, `children[${index}].entity_id`),
    parseWidgetId,
    `children[${index}].entity_id`,
  );
  const data = optionalRecord(value.data, `children[${index}].data`);
  const rawConfigurationId = optionalNonBlankString(value.configurationId, `children[${index}].configurationId`)
    ?? nestedId(value.configuration, `children[${index}].configuration`)
    ?? optionalNonBlankString(data?.configurationId, `children[${index}].data.configurationId`)
    ?? nestedId(data?.configuration, `children[${index}].data.configuration`);
  const configurationId = rawConfigurationId
    ? requiredIdentifier(rawConfigurationId, parseConfigId, `children[${index}].configurationId`)
    : undefined;
  const childRenderParameters = renderParameters(
    value.renderParams ?? data?.renderParams,
    `children[${index}].renderParams`,
  );
  const contextParameter = optionalRecord(data?.contextParameter, `children[${index}].data.contextParameter`);
  const childParameters = parameters(value.parameters, `children[${index}].parameters`);
  const definitions = parameterDefinitions(data?.parameters, `children[${index}].data.parameters`);
  const contextField = typeof contextParameter?.field === 'string' && contextParameter.field.length > 0
    ? contextParameter.field
    : undefined;
  const configurationParameters = contextField
    ? childParameters.filter((parameter) => parameter.field === contextField)
    : childParameters;
  const name = widgetName(data);
  const renderTargetId = optionalNonBlankString(
    data?.underlyingChartId,
    `children[${index}].data.underlyingChartId`,
  ) ?? optionalNonBlankString(
    data?.chartId,
    `children[${index}].data.chartId`,
  );
  const visualizationKind = optionalString(
    data?.visualizationType,
    `children[${index}].data.visualizationType`,
  );
  const directRenderValues = data && (renderTargetId || name)
    ? directWidgetRenderValues(
        value,
        index,
        data,
        renderTargetId,
        childParameters,
        contextField,
      )
    : {};
  return {
    kind: 'widget',
    childId: id,
    rank: childRank,
    widget: { widgetId, ...(configurationId ? { configurationId } : {}) },
    ...directRenderValues,
    ...(name ? { name } : {}),
    ...(renderTargetId ? { renderTargetId } : {}),
    ...(visualizationKind ? { visualizationKind } : {}),
    ...(configurationParameters.length > 0 ? { configurationParameters } : {}),
    ...(definitions.length > 0 ? { parameterDefinitions: definitions } : {}),
    parameters: childParameters,
    ...(childRenderParameters ? { renderParameters: childRenderParameters } : {}),
    ...(contextParameter ? { contextParameter } : {}),
  };
}

function child(
  value: unknown,
  index: number,
): DashboardChild {
  if (!isRecord(value)) return malformed(`children[${index}] is not a record`);
  const id = requiredString(value.id, `children[${index}].id`);
  const childRank = rank(value.rank, `children[${index}].rank`, index + 1);
  if (value.type === 'Widget') {
    return widgetChild(value, index, id, childRank);
  }
  if (value.type === 'Text') {
    const data = isRecord(value.data) ? value.data : undefined;
    return {
      kind: 'text',
      childId: id,
      rank: childRank,
      text: requiredString(data?.text, `children[${index}].data.text`),
    };
  }
  return malformed(`children[${index}].type is unsupported`);
}

function section(value: unknown, index: number): DashboardSection {
  if (!isRecord(value)) return malformed(`sections[${index}] is not a record`);
  return {
    sectionId: requiredString(value.id, `sections[${index}].id`),
    name: requiredString(value.title, `sections[${index}].title`),
    rank: rank(value.rank, `sections[${index}].rank`, index + 1),
    childIds: stringArray(value.children, `sections[${index}].children`),
  };
}

function records(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return malformed(`${label} is not an array`);
}

function byRank<T extends { rank: number }>(left: T, right: T): number {
  return left.rank - right.rank;
}

function assertDistinct<T>(values: readonly T[], label: string): void {
  if (new Set(values).size !== values.length) malformed(`${label} must be distinct`);
}

function normalizeDashboardSections(
  children: readonly DashboardChild[],
  sections: readonly DashboardSection[],
): DashboardSection[] {
  assertDistinct(children.map(({ childId }) => childId), 'children ids');
  assertDistinct(sections.map(({ sectionId }) => sectionId), 'sections ids');
  assertDistinct(sections.map(({ rank: sectionRank }) => sectionRank), 'sections ranks');
  const canonicalChildIds = new Set(children.map(({ childId }) => childId));
  const sectionByChildId = new Map<string, string>();
  const normalizedSections: DashboardSection[] = [];
  for (const dashboardSection of sections) {
    assertDistinct(dashboardSection.childIds, `section ${dashboardSection.sectionId} child ids`);
    const childIds: string[] = [];
    for (const childId of dashboardSection.childIds) {
      const previousSectionId = sectionByChildId.get(childId);
      if (previousSectionId) malformed(`child ${childId} belongs to multiple sections`);
      sectionByChildId.set(childId, dashboardSection.sectionId);
      if (canonicalChildIds.has(childId)) childIds.push(childId);
    }
    normalizedSections.push({ ...dashboardSection, childIds });
  }
  return normalizedSections;
}

function decodeDashboard(
  value: unknown,
): Dashboard {
  if (!isRecord(value)) return malformed('expected dashboard record');
  const id = requiredString(value.id, 'id');
  const children = records(value.children, 'children')
    .map((entry, index) => child(entry, index))
    .sort(byRank);
  const sections = normalizeDashboardSections(
    children,
    records(value.sections, 'sections').map(section).sort(byRank),
  );
  const author = optionalString(value.author ?? value.createdBy, 'author');
  const description = optionalString(value.description, 'description');
  return {
    dashboardId: id,
    name: requiredString(value.title, 'title'),
    kind: optionalDashboardKind(value.type) ?? 'thematic',
    ...(author !== undefined ? { author } : {}),
    ...(description !== undefined ? { description } : {}),
    tags: stringArray(value.tags, 'tags', true),
    permissions: permissions(value.entitlements),
    children,
    sections,
    link: `https://marquee.gs.com/s/marketview/dashboards/${id}`,
  };
}

function decodeDashboardSummaries(value: unknown, title: string): DashboardSummary[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return malformed('Dashboard title lookup is missing results');
  }
  const target = title.trim().toLowerCase();
  return value.results.map((entry, index): DashboardSummary => {
    if (!isRecord(entry)) return malformed(`Dashboard title lookup results[${index}] is not a record`);
    const kind = optionalDashboardKind(entry.type);
    return {
      dashboardId: requiredString(entry.id, `Dashboard title lookup results[${index}].id`),
      name: requiredString(entry.title, `Dashboard title lookup results[${index}].title`),
      ...(kind ? { kind } : {}),
    };
  }).filter((dashboard) => dashboard.name.trim().toLowerCase() === target);
}

function slugifyDashboardName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'dashboard';
}

async function createBody(
  projection: DashboardConfiguredWidgetProjection,
  input: Parameters<DashboardPort['create']>[0],
): Promise<DashboardResult<Record<string, unknown>>> {
  const widgets = [];
  for (const [index, widget] of input.widgets.entries()) {
    if (!widget.configurationId) {
      return { ok: false, error: { kind: 'invalid-widget', widget } };
    }
    // eslint-disable-next-line no-await-in-loop -- stops at the first failure without sending the rest
    const projected = await projection.project({
      widget: { widgetId: widget.widgetId, configurationId: widget.configurationId },
      purpose: 'create',
    });
    if (!projected.ok) {
      return widgetProjectionFailure(projected.error, widget.configurationId);
    }
    widgets.push({
      entity_id: projected.value.widget.widgetId,
      type: 'Widget',
      parameters: [...projected.value.bindings],
      configurationId: projected.value.widget.configurationId,
      rank: index + 1,
      ...(projected.value.dateRangeOverride
        ? { relativeDate: projected.value.dateRangeOverride }
        : {}),
    });
  }
  return {
    ok: true,
    value: {
      title: input.name,
      description: '',
      tags: [],
      relatedLinks: [],
      alias: slugifyDashboardName(input.name),
      addTagsFromChildren: true,
      isRequestable: false,
      children: widgets,
    },
  };
}

function writeFailure(error: unknown): DashboardResult<never> {
  if (error instanceof MarqueeError && error.details?.status === 403) {
    return { ok: false, error: { kind: 'access-denied' } };
  }
  if (
    error instanceof MarqueeError &&
    typeof error.details?.status === 'number' &&
    error.details.status >= 400 &&
    error.details.status < 500
  ) {
    return {
      ok: false,
      error: {
        kind: 'write-failed',
        failure: dependencyFailure(error),
        isAmbiguous: false,
      },
    };
  }
  return {
    ok: false,
    error: {
      kind: 'dependency',
      failure: dependencyFailure(error),
    },
  };
}

async function mutationWrite(write: () => Promise<unknown>): Promise<DashboardResult<void>> {
  try {
    await write();
    return { ok: true, value: undefined };
  } catch (error) {
    return writeFailure(error);
  }
}

function widgetProjectionFailure(
  error: DashboardConfiguredWidgetProjectionError,
  configurationId: string,
): DashboardResult<never> {
  if (error.kind === 'access-denied') {
    return { ok: false, error: { kind: 'access-denied' } };
  }
  if (error.kind === 'not-found') {
    return {
      ok: false,
      error: {
        kind: 'invalid-widget-placement',
        configurationId,
        problem: 'configuration-not-found',
      },
    };
  }
  if (error.kind === 'dependency') {
    return {
      ok: false,
      error: {
        kind: 'dependency',
        failure: error.failure,
      },
    };
  }
  return {
    ok: false,
    error: {
      kind: 'invalid-widget-placement',
      configurationId,
      problem: error.problem,
    },
  };
}

async function widgetChildBody(
  projection: DashboardConfiguredWidgetProjection,
  input: Parameters<DashboardPort['addWidget']>[0],
): Promise<DashboardResult<Record<string, unknown>>> {
  if (!input.widget.configurationId) {
    return { ok: false, error: { kind: 'invalid-widget', widget: input.widget } };
  }
  const result = await projection.project({
    widget: {
      widgetId: input.widget.widgetId,
      configurationId: input.widget.configurationId,
    },
    purpose: 'add',
  });
  if (!result.ok) {
    return widgetProjectionFailure(result.error, input.widget.configurationId);
  }
  return {
    ok: true,
    value: {
      entity_id: result.value.widget.widgetId,
      type: 'Widget',
      parameters: [...result.value.bindings],
      configurationId: result.value.widget.configurationId,
      ...(input.rank !== undefined ? { rank: input.rank } : {}),
      ...(result.value.dateRangeOverride ? { relativeDate: result.value.dateRangeOverride } : {}),
    },
  };
}

export function createDashboardProductionPort(
  transport: DashboardTransport,
  projection: DashboardConfiguredWidgetProjection,
): DashboardPort {
  const dashboards = new DashboardApi(transport);
  return {
    async read(id): Promise<DashboardResult<Dashboard>> {
      try {
        const raw = await new DashboardApi({
          request: (endpoint, init) => transport.request(endpoint, { ...init, hedgeDelaysMs: [1000, 2000] }),
        }).getDashboard(id);
        return { ok: true, value: decodeDashboard(raw) };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unsupported Dashboard response shape:')) {
          return { ok: false, error: { kind: 'invalid-dashboard', reason: error.message } };
        }
        return { ok: false, error: readFailure(error, id) };
      }
    },
    async findByTitle(name) {
      try {
        const raw = await dashboards.getEditableDashboards();
        return { ok: true, value: decodeDashboardSummaries(raw, name) };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unsupported Dashboard response shape:')) {
          return { ok: false, error: { kind: 'invalid-dashboard', reason: error.message } };
        }
        return {
          ok: false,
          error: {
            kind: 'dependency',
            failure: dependencyFailure(error),
          },
        };
      }
    },
    async create(input) {
      try {
        const body = await createBody(projection, input);
        if (!body.ok) return body;
        const raw = await dashboards.createDashboard(body.value);
        if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) {
          return { ok: false, error: { kind: 'missing-created-id', name: input.name } };
        }
        return {
          ok: true,
          value: {
            dashboardId: raw.id,
            name: input.name,
            link: `https://marquee.gs.com/s/marketview/dashboards/${raw.id}`,
          },
        };
      } catch (error) {
        if (error instanceof MarqueeError && error.details?.status === 403) {
          return { ok: false, error: { kind: 'access-denied' } };
        }
        const failure = dependencyFailure(error);
        if (failure.kind === 'timeout') {
          return {
            ok: false,
            error: {
              kind: 'ambiguous-creation',
              name: input.name,
            },
          };
        }
        return {
          ok: false,
          error: {
            kind: 'create-failed',
            name: input.name,
            failure,
          },
        };
      }
    },
    async removeChild({ dashboardId, childId }) {
      return mutationWrite(() => dashboards.deleteChild(dashboardId, childId));
    },
    async addWidget(input) {
      try {
        const body = await widgetChildBody(projection, input);
        if (!body.ok) return body;
        await dashboards.addChildren(input.dashboardId, [body.value]);
        return { ok: true, value: undefined };
      } catch (error) {
        return writeFailure(error);
      }
    },
    async createSection({ dashboardId, name, childIds }) {
      try {
        const raw = await dashboards.createSection(dashboardId, { title: name, children: [...childIds] });
        if (!isRecord(raw)) {
          return { ok: false, error: { kind: 'invalid-dashboard', reason: 'Section creation returned no record' } };
        }
        const sectionId = [raw.id, raw.uuid, raw.sectionId].find((value) => (
          typeof value === 'string' && value.length > 0 && value !== dashboardId
        ));
        return {
          ok: true,
          value: { ...(typeof sectionId === 'string' ? { sectionId } : {}) },
        };
      } catch (error) {
        return writeFailure(error);
      }
    },
    async deleteSection({ dashboardId, sectionId }) {
      return mutationWrite(() => dashboards.deleteSection(dashboardId, sectionId));
    },
    async setSectionChildren({ dashboardId, sectionId, childIds }) {
      return mutationWrite(() => dashboards.updateSection(dashboardId, sectionId, { children: [...childIds] }));
    },
    async setSectionRank({ dashboardId, sectionId, rank: sectionRank }) {
      return mutationWrite(() => dashboards.updateSection(dashboardId, sectionId, { rank: sectionRank }));
    },
  };
}
