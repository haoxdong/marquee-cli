import type { DataVizApi } from '../../api/data-viz/index.js';

type DataVizDashboardOverride = Readonly<{
  field: string;
  value: unknown;
}>;

type DataVizWidget = Readonly<{
  parameters?: unknown;
  contextParameter?: unknown;
  renderParams?: unknown;
}>;

type DataVizWidgetInput = Readonly<{
  mode: 'widget';
  targetId: string;
  widget: DataVizWidget;
  activeEntity?: string | null | undefined;
  dashboardOverrides?: readonly DataVizDashboardOverride[] | undefined;
  useSavedRenderParams?: boolean;
  configurationId?: string;
}>;

type DataVizBaseComponentInput = Readonly<{
  mode: 'base-component';
  targetId: string;
  params?: unknown;
}>;

export type DataVizLaneInput =
  | DataVizWidgetInput
  | DataVizBaseComponentInput;

export class DataVizRenderInputError extends Error {
  override readonly name = 'DataVizRenderInputError';
}

export async function renderDataVizLane(
  api: DataVizApi,
  input: DataVizLaneInput,
): Promise<unknown> {
  if (input.mode === 'base-component') {
    await api.getComponent(input.targetId);
    return api.renderComponent(input.targetId, dataVizRenderBody(input));
  }
  await api.getVisualization(input.targetId);
  return api.renderVisualization(input.targetId, dataVizRenderBody(input));
}

function dataVizRenderBody(
  input: DataVizWidgetInput | DataVizBaseComponentInput,
): unknown {
  if (input.mode === 'base-component') {
    return input.params === undefined ? {} : input.params;
  }
  return dataVizWidgetBody(input);
}

function dataVizWidgetBody(input: DataVizWidgetInput): unknown {
  const renderParams = optionalRecord(
    input.widget.renderParams,
    'renderParams',
  );
  const savedComponent = renderParams?.component;
  const useSaved = input.useSavedRenderParams === true
    && savedComponent !== undefined;
  const component = useSaved
    ? requiredRecord(savedComponent, 'renderParams.component')
    : dataVizWidgetComponent(input);
  const visualization = useSaved
    ? requiredRecord(renderParams?.visualization ?? {}, 'renderParams.visualization')
    : {};
  return wireValue({
    component,
    visualization,
    references: {
      ...(input.configurationId !== undefined
        ? { configId: input.configurationId }
        : {}),
      useTableViz: false,
    },
  });
}

function dataVizWidgetComponent(
  input: DataVizWidgetInput,
): Record<string, unknown> {
  const component: Record<string, unknown> = {};
  const activeEntity = usableActiveEntity(input.activeEntity);
  const dashboardOverrides = input.dashboardOverrides ?? [];
  seedDataVizContext(
    component,
    input.widget,
    activeEntity,
    dashboardOverrides,
  );

  const parameters = optionalArray(input.widget.parameters, 'parameters');
  for (const [index, rawParameter] of parameters.entries()) {
    const entry = dataVizParameterEntry(
      rawParameter,
      index,
      activeEntity,
      dashboardOverrides,
    );
    if (entry) component[entry.field] = entry.value;
  }

  for (const override of dashboardOverrides) {
    component[override.field] = override.value;
  }
  return component;
}

function seedDataVizContext(
  component: Record<string, unknown>,
  widget: DataVizWidget,
  activeEntity: string | undefined,
  dashboardOverrides: readonly DataVizDashboardOverride[],
): void {
  const context = optionalRecord(
    widget.contextParameter,
    'contextParameter',
  );
  const contextField = context?.field;
  if (contextField !== undefined && typeof contextField !== 'string') {
    unsupportedDataVizShape('contextParameter.field is not a string');
  }
  if (
    activeEntity !== undefined
    && contextField
    && (
      dashboardOverrides.length === 0
      || dashboardOverrides.some((override) => override.field === contextField)
    )
  ) {
    component[contextField] = activeEntity;
  }
}

function dataVizParameterEntry(
  rawParameter: unknown,
  index: number,
  activeEntity: string | undefined,
  dashboardOverrides: readonly DataVizDashboardOverride[],
): Readonly<{ field: string; value: unknown }> | undefined {
  const parameter = requiredRecord(rawParameter, `parameters[${index}]`);
  const field = parameter.field;
  if (typeof field !== 'string' || field.length === 0) {
    unsupportedDataVizShape(`parameters[${index}].field is not a string`);
  }
  const override = dashboardOverrides.find(
    (candidate) => candidate.field === field,
  );
  if (override) return override;
  if (activeEntity !== undefined && parameter.value !== undefined) {
    return { field, value: parameter.value };
  }
  const values = optionalRecord(
    parameter.values,
    `parameters[${index}].values`,
  );
  const activeValue = activeEntity === undefined
    ? undefined
    : values?.[activeEntity];
  if (activeValue) return { field, value: activeValue };
  return values?.default !== undefined
    ? { field, value: values.default }
    : undefined;
}

function usableActiveEntity(value: string | null | undefined): string | undefined {
  return value && !value.startsWith('MD') ? value : undefined;
}

function optionalArray(value: unknown, label: string): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) unsupportedDataVizShape(`${label} is not an array`);
  return value;
}

function optionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredRecord(value, label);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) unsupportedDataVizShape(`${label} is not a record`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wireValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function unsupportedDataVizShape(reason: string): never {
  throw new DataVizRenderInputError(`Unsupported DataViz render input shape: ${reason}`);
}
