import { get, post, type ApiRequester } from '../index.js';

const RUNNER = '/v1/plots/runner';

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

  // A saved chart's results, run as it was saved.
  getPlotResults(chartId: string): Promise<unknown> {
    return this.requester.request(get(`${RUNNER}/${encodeURIComponent(chartId)}`));
  }
}
