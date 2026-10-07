import { get, post, type ApiRequester } from '../index.js';

const VISUALIZATIONS = '/v1/data/visualizations';
const COMPONENTS = '/v1/data/components';

function resourcePath(collection: string, id: string): string {
  return `${collection}/${encodeURIComponent(id)}`;
}

// Marquee's DataViz endpoints, in gs-quant's client shape (ADR 0072).
export class DataVizApi {
  // Whether a failed request's path is a visualization render.
  static isVisualizationRender(path: string): boolean {
    return path.includes(`${VISUALIZATIONS}/`) && path.endsWith('/render');
  }

  constructor(private readonly requester: ApiRequester) {}

  getVisualization(visualizationId: string): Promise<unknown> {
    return this.requester.request(get(resourcePath(VISUALIZATIONS, visualizationId)));
  }

  renderVisualization(visualizationId: string, render: unknown): Promise<unknown> {
    return this.requester.request(post(`${resourcePath(VISUALIZATIONS, visualizationId)}/render`), { body: render });
  }

  getComponent(componentId: string): Promise<unknown> {
    return this.requester.request(get(resourcePath(COMPONENTS, componentId)));
  }

  renderComponent(componentId: string, render: unknown): Promise<unknown> {
    return this.requester.request(post(`${resourcePath(COMPONENTS, componentId)}/render`), { body: render });
  }
}
