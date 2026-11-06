import { get, post, type ApiRequester } from '../index.js';

const RUNNER = '/v1/plots/runner';
const CHARTS = '/v1/charts';

// Marquee's PlotTool Pro runner endpoints, in gs-quant's client shape (ADR 0072).
export class PlotToolApi {
  // Whether a failed request's path is a runner request.
  static isRunner(path: string): boolean {
    return path.includes(RUNNER);
  }

  constructor(private readonly requester: ApiRequester) {}

  // A chart's expressions run with the given controls and dates.
  runPlot(plot: unknown): Promise<unknown> {
    return this.requester.request(post(RUNNER), { body: plot });
  }

  // The function library: every function and constructor with its parameters and methods.
  getFunctions(): Promise<unknown> {
    return this.requester.request(get('/v1/plots/functions'));
  }

  // PlotTool Pro's Quickstart collections, expanded down to each chart and its Expressions.
  getQuickstartCollections(): Promise<unknown> {
    return this.requester.request(get('/v1/collections'), {
      query: { expand: true, limit: 100, subType: 'quickstart' },
    });
  }

  // The measures one asset carries, with their parameters and allowed values; with `dataset`,
  // the measures of the dataset with that id, as PlotTool Web asks inside `Dataset(`.
  getAvailability(assetOrDatasetId: string, type?: 'dataset'): Promise<unknown> {
    const endpoint = get(`/v1/plots/availability/${encodeURIComponent(assetOrDatasetId)}`);
    return type === undefined
      ? this.requester.request(endpoint)
      : this.requester.request(endpoint, { query: { type } });
  }

  // A new PlotTool Pro chart; answers it with its `id`.
  createChart(chart: unknown): Promise<unknown> {
    return this.requester.request(post(CHARTS), { body: chart });
  }

  // A saved chart's results, run as it was saved.
  getPlotResults(chartId: string): Promise<unknown> {
    return this.requester.request(get(`${RUNNER}/${encodeURIComponent(chartId)}`));
  }
}
