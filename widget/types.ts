import type { Tagged } from 'type-fest';
import type { ControlGroupError } from '../control-group/index.js';
import type { DependencyFailure } from '../transport/index.js';
import type { EntityResolveInput } from '../entity/index.js';
import type { DataVizError, DataVizResult } from './data-viz/index.js';
import type { PlotToolError, PlotToolProjection, PlotToolWindowOverride } from '../plottool/index.js';

export type WidgetResolveInput = EntityResolveInput | Readonly<{
  kind: 'control-group';
  value: string;
}>;

export type WidgetId = Tagged<string, 'WidgetId'>;

export type ConfigId = Tagged<string, 'ConfigId'>;

export type WidgetResult<T, E = WidgetError> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type ConfiguredWidgetIdentity = Readonly<{
  widgetId: WidgetId;
  configurationId: ConfigId;
}>;

export type WidgetParameterOverride = Readonly<{
  field: string;
  value: unknown;
  displayValue?: unknown;
}>;

type SelectedContextKind = 'asset' | 'country' | 'portfolio' | 'control-group';

export type SelectedContext = string;

export type WidgetDefinition = Readonly<Record<string, unknown>>;

export type WidgetDates = Readonly<{
  startDate: string;
  endDate: string;
  interval: string;
  relativeDate?: string;
}>;

type WidgetInputDefinition = Readonly<{
  field: string;
  type: string;
  value: unknown;
  options: readonly unknown[];
}>;

export type WidgetValue = Readonly<{
  widgetId: WidgetId;
  configurationId: ConfigId | null;
  configuration: Readonly<{
    configurationId: ConfigId;
    widgetId: WidgetId;
    targetId?: string;
    relativeDate: PlotToolWindowOverride | null;
  }> | null;
  projection: Readonly<{ kind: 'complete' }>;
  title: Readonly<{
    embedded: string | null;
    fallback: string;
    useEntityTitle: boolean;
  }>;
  target:
    | Readonly<{ family: 'blank' }>
    | Readonly<{ family: 'plot'; targetId: string }>
    | Readonly<{
        family: 'data-viz';
        targetId: string;
        route: 'visualization' | 'component';
      }>;
  parameters: readonly WidgetInputDefinition[];
  contextParameter: (WidgetInputDefinition & Readonly<{ kinds: readonly SelectedContextKind[] }>) | null;
  controls: readonly WidgetInputDefinition[];
  componentInputs: readonly WidgetParameterOverride[];
  entityLabels: readonly Readonly<{
    identity: string;
    label: string;
  }>[];
  expressionLabels?: readonly unknown[];
  description?: string;
  tags: readonly string[];
  sources: readonly string[];
}>;

export type WidgetRenderDetail = 'snippet' | 'full';

export type WidgetPlotToolResult = Readonly<{
  projection: PlotToolProjection;
  rows: readonly Readonly<Record<string, unknown>>[];
}>;

export type WidgetAccess =
  | 'Public: Anyone with this link can view this widget'
  | 'Firmwide: Anyone in your organization can view this widget'
  | 'Private: Only people invited can view this widget'
  | 'Restricted: This widget is available to a restricted set of users';

export type WidgetGetInput = Readonly<{
  widgetId: WidgetId;
  configurationId: ConfigId | null;
  selectedContext?: SelectedContext | null;
  /** Values as typed with `-p name=value`. */
  parameters: readonly Readonly<{ field: string; value: string }>[];
  detail: 'snippet' | 'full';
}>;

type WidgetParameterOption = Readonly<{
  label: unknown;
  rawValue: unknown;
}>;

export type WidgetParameter = Readonly<{
  field: string;
  refKey?: string;
  type: string;
  default: unknown;
  rawDefault?: unknown;
  values?: unknown[];
  rawValues?: unknown[];
  options: WidgetParameterOption[];
  display?: unknown[];
  isFilterable?: boolean;
  cgGroupIds?: string[];
  totalOptions?: number;
  allRawOptions?: string[];
  isNotParam?: boolean;
  fillBlocked?: { reason: string };
}>;

export type EditableDashboard = Readonly<{
  dashboardId: string;
  title: string;
  [key: string]: unknown;
}>;

export type WidgetRenderValue = Readonly<{
  widgetId: WidgetId;
  configurationId: ConfigId | null;
  selectedContext?: SelectedContext | null;
  title: string;
  authors?: readonly string[];
  access?: WidgetAccess;
  chartId?: string;
  description?: string;
  tags?: string[];
  sources?: string[];
  parameters: readonly WidgetParameter[];
  dashboards?: readonly EditableDashboard[];
  inputEchoes?: readonly string[];
}>;

type WidgetSnippet = Readonly<{
  title: string;
  isTitleResolved: boolean;
  parameterLines: readonly string[];
}>;

export type RenderedWidget =
  | Readonly<{
      detail: 'snippet';
      widget: WidgetRenderValue;
      snippet: WidgetSnippet;
    }>
  | Readonly<{
      detail: 'full';
      widget: WidgetRenderValue;
      snippet: WidgetSnippet;
      execution:
        | Readonly<{ family: 'blank' }>
        | Readonly<{ family: 'plot'; value: WidgetPlotToolResult }>
        | Readonly<{ family: 'data-viz'; value: DataVizResult }>;
    }>;

export type WidgetError =
  | Readonly<{ kind: 'data-restricted'; identity: { widgetId: string }; widget: WidgetRenderValue }>
  | Readonly<{ kind: 'widget-not-found'; identity: { widgetId: string } }>
  | Readonly<{ kind: 'widget-access-denied'; identity: { widgetId: string } }>
  | Readonly<{
      kind: 'widget-load-failure';
      identity: { widgetId: string };
      failure: DependencyFailure;
    }>
  | Readonly<{
      kind: 'control-group-resolution-failure';
      identity: { widgetId: string };
      failure: ControlGroupError;
    }>
  | Readonly<{
      kind: 'invalid-definition';
      identity: { widgetId: string };
      problem: 'missing-identity' | 'missing-target' | 'malformed';
    }>
  | Readonly<{
      kind: 'invalid-response';
      identity: { widgetId: string; configurationId?: string };
      source: 'configuration' | 'widget';
      problem:
        | 'empty-configuration'
        | 'parameters-not-array'
        | 'parameter-not-record'
        | 'parameter-value-missing'
        | 'configuration-id-missing'
        | 'calculated-dates-without-relative-date'
        | 'render-params-not-record'
        | 'render-controls-not-array'
        | 'unsupported-payload-shape'
        | 'parameters-missing'
        | 'parameter-field-missing'
        | 'parameter-values-not-record'
        | 'render-control-value-missing'
        | 'context-parameter-control-group'
        | 'date-parameter-default-missing'
        | 'render-input-invalid'
        | 'render-assignment-invalid'
        | 'configuration-assignment-missing'
        | 'selected-context-control-group'
        | 'data-viz-configuration-missing'
        | 'expression-labels-not-array'
        | 'expression-labels-missing'
        | 'entity-metadata-not-record'
        | 'entity-metadata-entry-not-record'
        | 'entity-metadata-name-missing';
      index?: number;
      detail?: string;
    }>
  | Readonly<{ kind: 'configuration-not-found'; identity: { widgetId: string; configurationId: string } }>
  | Readonly<{
      kind: 'configuration-mismatch';
      identity: { widgetId: string; configurationId: string };
      ownerWidgetId?: string;
    }>
  | Readonly<{ kind: 'configuration-mint-failure'; identity: { widgetId: string } }>
  | Readonly<{
      kind: 'missing-display-evidence';
      identity: { widgetId: string };
      field: string;
      identifier?: WidgetResolveInput | undefined;
    }>
  | Readonly<{
      kind: 'unknown-input';
      identity: { widgetId: string };
      input: string;
      candidates: readonly string[];
    }>
  | Readonly<{
      kind: 'unmatched-input';
      identity: { widgetId: string };
      input: string;
      requested: string;
      candidates: readonly string[];
    }>
  | Readonly<{
      kind: 'ambiguous-input';
      identity: { widgetId: string };
      input: string;
      requested: string;
      candidates: readonly string[];
    }>
  | Readonly<{
      kind: 'invalid-input';
      identity: { widgetId: string };
      input: string;
      problem:
        | 'empty'
        | 'boolean-required'
        | 'date-required'
        | 'integer-required'
        | 'malformed'
        | 'control-group'
        | 'incompatible-dependent-input';
    }>
  | Readonly<{
      kind: 'unsafe-integer-input';
      identity: { widgetId: string };
      input: string;
      requested: string;
    }>
  | Readonly<{ kind: 'required-input'; identity: { widgetId: string }; input: string }>
  | Readonly<{
      kind: 'unsupported-execution-target';
      identity: { widgetId: string };
      targetId: string;
    }>
  | Readonly<{
      kind: 'plottool-failure';
      identity: { widgetId: string };
      problem: PlotToolError;
    }>
  | Readonly<{
      kind: 'data-viz-failure';
      identity: { widgetId: string; configurationId: string };
      problem: DataVizError;
    }>;

export interface WidgetModule {
  get(input: WidgetGetInput): Promise<WidgetResult<RenderedWidget>>;
  render(
    widgetDefinition: WidgetDefinition,
    parameters: readonly WidgetParameterOverride[],
    selectedContext: SelectedContext | null,
    widgetDates: WidgetDates | undefined,
    detail: WidgetRenderDetail,
  ): Promise<WidgetResult<RenderedWidget>>;
}
