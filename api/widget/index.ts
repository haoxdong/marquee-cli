import type { Endpoint } from '../../transport/index.js';
import { get, post, type ApiRequester } from '../index.js';

const CHARTS = '/v1/charts';
const WIDGETS = '/v1/marketview/widgets';
const CONFIGURATIONS = `${WIDGETS}/configurations`;

function widgetPath(widgetId: string): string {
  return `${WIDGETS}/${encodeURIComponent(widgetId)}`;
}

// Marquee's Widget endpoints, in gs-quant's client shape (ADR 0072).
export class WidgetApi {
  // The Widget feed of one context, whose path its failures are worded with.
  static readonly widgets: Endpoint = get(WIDGETS);

  // Whether a failed request's path is a Chart read.
  static isChart(path: string | undefined): boolean {
    return path?.startsWith(`${CHARTS}/`) === true;
  }

  constructor(private readonly requester: ApiRequester) {}

  // The PlotTool Pro chart behind a Plot Widget.
  getChart(chartId: string): Promise<unknown> {
    return this.requester.request(get(`${CHARTS}/${encodeURIComponent(chartId)}`));
  }

  // One Widget, merged with a saved Widget Configuration or read in an entity context.
  getWidget(widgetId: string, query?: Readonly<{ mergeParams?: true; context?: string }>): Promise<unknown> {
    return this.requester.request(get(widgetPath(widgetId)), query === undefined ? undefined : { query });
  }

  getWidgets({ context, limit, offset, query }: Readonly<{
    context: string;
    limit?: number | undefined;
    offset?: number | undefined;
    query?: string | undefined;
  }>): Promise<unknown> {
    return this.requester.request(WidgetApi.widgets, {
      query: { context, limit, offset, ...(query !== undefined ? { query } : {}), includeFilters: query !== undefined },
    });
  }

  // A Widget's metadata, such as its title, for a set of parameter values.
  getWidgetMetadata(widgetId: string, parameters: readonly unknown[]): Promise<unknown> {
    return this.requester.request(post(`${widgetPath(widgetId)}/metadata`), { body: { parameters } });
  }

  getConfiguration(configurationId: string): Promise<unknown> {
    return this.requester.request(get(CONFIGURATIONS), { query: { id: configurationId } });
  }

  createConfiguration(configuration: unknown): Promise<unknown> {
    return this.requester.request(post(CONFIGURATIONS), { body: configuration });
  }
}
