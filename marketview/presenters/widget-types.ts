import type {
  ConfigId,
  EditableDashboard,
  WidgetAccess,
  WidgetParameterOverride,
  WidgetParameter,
  WidgetParameterState,
  WidgetId,
} from '../../widget/index.js';

export interface WidgetPresentation {
  title: string;
  widgetId: string;
  authors?: readonly string[] | undefined;
  access?: WidgetAccess | undefined;
  configurationId?: string | undefined;
  selectedContext?: string | undefined;
  chartId?: string | undefined;
  bindings?: WidgetParameterOverride[];
  params: WidgetParameter[];
  parameterStates?: Array<[string, WidgetParameterState]>;
  labels?: string[];
  description?: string | undefined;
  tags?: string[] | undefined;
  sources?: string[] | undefined;
  warnings?: string[];
  dataPreview?: string;
  dashboards?: readonly EditableDashboard[] | undefined;
}

export type WidgetArtifact = Readonly<{
  type: 'widget';
  widgetId: WidgetId;
  configurationId: ConfigId | null;
  selectedContext: string | null;
}>;
