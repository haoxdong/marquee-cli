import type {
  DataViz,
  DataVizError,
  DataVizResult,
} from './types.js';

type DataVizInputs = Parameters<DataViz['render']>[0]['inputs'];
type DataVizRoute = 'visualization' | 'component';

export type DataVizOutcome =
  | { ok: true; value: DataVizResult }
  | { ok: false; error: DataVizError };

export type DataVizRouting = {
  isVisualization: boolean;
  isComponent: boolean;
};

type DataVizRenderRequest = {
  route: DataVizRoute;
  targetId: string;
  inputs: DataVizInputs;
};

export interface DataVizAdapter {
  routing(targetId: string): DataVizRouting;
  render(request: DataVizRenderRequest): Promise<DataVizOutcome>;
}

export function createDataVizFromAdapter(adapter: DataVizAdapter): DataViz {
  return {
    async render(input) {
      const routing = adapter.routing(input.targetId);
      const route = dataVizRoute(routing);
      if (!route) {
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

      return adapter.render({ route, ...input });
    },
  };
}

function dataVizRoute(routing: DataVizRouting): DataVizRoute | undefined {
  if (routing.isVisualization === routing.isComponent) return undefined;
  return routing.isComponent ? 'component' : 'visualization';
}
