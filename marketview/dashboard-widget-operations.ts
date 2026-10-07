import type {
  ConfigId,
  WidgetModule,
  WidgetDefinition,
  WidgetDates,
  WidgetError,
  WidgetParameterOverride,
} from '../widget/index.js';

type WidgetSnippet = Readonly<{
  title: string;
  isTitleResolved: boolean;
  parameterLines: readonly string[];
}>;

export interface MarketViewWidgetOperations {
  renderDashboardWidget(
    widgetDefinition: WidgetDefinition,
    parameters: readonly WidgetParameterOverride[],
    selectedContext: string | null,
    widgetDates: WidgetDates | undefined,
  ): Promise<
    | {
        ok: true;
        value: {
          snippet: WidgetSnippet;
          configurationId: ConfigId | null;
        };
      }
    | {
        ok: false;
        error: WidgetError;
        presentation?: { message: string };
      }
  >;
}

export function createMarketViewWidgetOperations(
  widget: Pick<WidgetModule, 'render'>,
): MarketViewWidgetOperations {
  function snippetResult(
    result: Awaited<ReturnType<WidgetModule['render']>>,
  ): Awaited<ReturnType<MarketViewWidgetOperations['renderDashboardWidget']>> {
    if (!result.ok) return { ok: false, error: result.error };
    if (result.value.detail !== 'snippet') {
      throw new Error('Widget render returned a non-snippet result');
    }
    return {
      ok: true,
      value: {
        snippet: result.value.snippet,
        configurationId: result.value.widget.configurationId,
      },
    };
  }

  return {
    async renderDashboardWidget(
      widgetDefinition,
      parameters,
      selectedContext,
      widgetDates,
    ) {
      return snippetResult(await widget.render(
        widgetDefinition,
        parameters,
        selectedContext,
        widgetDates,
        'snippet',
      ));
    },
  };
}
