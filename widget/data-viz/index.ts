import type { Transport } from '../../transport/index.js';
import { createMarqueeDataVizAdapter } from './adapters/marquee.js';
import { createDataVizFromAdapter } from './module.js';
import type { DataViz } from './types.js';
export type {
  DataVizInputs,
  DataVizResult,
  DataVizError,
  DataViz,
} from './types.js';

export function createDataViz(options: {
  request: Pick<Transport, 'request'>['request'];
  target: unknown;
  onVisualizationFailureEvidence?: (cause: unknown) => void;
}): DataViz {
  return createDataVizFromAdapter(createMarqueeDataVizAdapter(options));
}
