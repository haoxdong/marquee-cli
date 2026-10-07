import type { PlotToolError } from './plottool/index.js';

export class WidgetPlotToolFailure extends Error {
  constructor(readonly error: PlotToolError) {
    super(error.kind);
  }
}
