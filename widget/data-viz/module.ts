import type { DataViz, DataVizInputs, DataVizOutcome } from './types.js';

type DataVizRouting = {
  isVisualization: boolean;
  isComponent: boolean;
};

export interface DataVizAdapter {
  routing(targetId: string): DataVizRouting;
  render(request: {
    route: 'visualization' | 'component';
    targetId: string;
    inputs: DataVizInputs;
  }): Promise<DataVizOutcome>;
}

export function createDataVizFromAdapter(adapter: DataVizAdapter): DataViz {
  return {
    async render(input) {
      const routing = adapter.routing(input.targetId);
      if (routing.isVisualization === routing.isComponent) {
        return {
          ok: false,
          error: {
            kind: routing.isVisualization || routing.isComponent
              ? 'routing-metadata-contradictory'
              : 'routing-metadata-missing',
            targetId: input.targetId,
          },
        };
      }

      const route = routing.isComponent ? 'component' : 'visualization';
      return adapter.render({ route, ...input });
    },
  };
}
