import type {
  ConfigId,
  EditableDashboard,
  WidgetAccess,
  WidgetParameter,
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
  params: WidgetParameter[];
  description?: string | undefined;
  tags?: string[] | undefined;
  sources?: string[] | undefined;
  dashboards?: readonly EditableDashboard[] | undefined;
}

export type WidgetReferent = Readonly<{
  type: 'widget';
  widgetId: WidgetId;
  configurationId: ConfigId | null;
  selectedContext: string | null;
}>;
