import type {
  SelectedContext,
  WidgetModule,
  WidgetDefinition,
  WidgetDates,
  WidgetGetInput,
  RenderedWidget,
  WidgetParameterOverride,
  WidgetRenderDetail,
  WidgetResult,
} from '../widget/index.js';
import type {
  WidgetCallLog,
  WidgetEvidenceRecorder,
} from './presenters/widget-evidence.js';

export type MarketViewWidgetResult = Readonly<{
  result: WidgetResult<RenderedWidget>;
  audit: WidgetCallLog;
}>;

export interface MarketViewWidget {
  get(input: WidgetGetInput): Promise<MarketViewWidgetResult>;
  render(
    widgetDefinition: WidgetDefinition,
    parameters: readonly WidgetParameterOverride[],
    selectedContext: SelectedContext | null,
    widgetDates: WidgetDates | undefined,
    detail: WidgetRenderDetail,
  ): Promise<MarketViewWidgetResult>;
}

export function createMarketViewWidget(
  widget: WidgetModule,
  evidence: WidgetEvidenceRecorder,
): MarketViewWidget {
  return {
    get(input) {
      return evidence.record(input.parameters.length > 0 ? 'change' : 'read', () => widget.get(input));
    },
    render(...args) {
      return evidence.record('read', () => widget.render(...args));
    },
  };
}
