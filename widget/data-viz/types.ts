type DataVizInputValue =
  | string
  | number
  | boolean
  | null
  | readonly DataVizInputValue[]
  | Readonly<{ [field: string]: DataVizInputValue }>;

export type DataVizInputs = {
  widget: Readonly<{
    parameters?: DataVizInputValue;
    contextParameter?: DataVizInputValue;
    renderParams?: DataVizInputValue;
  }>;
  configurationId?: `WC${string}`;
  activeEntity?: string | null;
  dashboardOverrides?: readonly Readonly<{
    field: string;
    value: DataVizInputValue;
  }>[];
  hasSavedRenderParams?: boolean;
};

type DataVizDependencyFailure =
  | { kind: 'authentication-required'; realm: 'marquee' | 'research' }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'timeout' }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' };

export type DataVizResult =
  | {
      kind: 'empty';
      message: string;
    }
  | {
      kind: 'visualization';
      projection: unknown;
    }
  | {
      kind: 'table';
      projection: unknown;
    };

export type DataVizMalformedProblem =
  | 'missing-render-data'
  | 'invalid-visualization-data'
  | 'invalid-visualization-layout'
  | 'invalid-display-format'
  | 'invalid-table-columns'
  | 'invalid-table-rows';

export type DataVizError =
  | { kind: 'target-not-found'; targetId: string }
  | { kind: 'target-access-denied'; targetId: string }
  | { kind: 'routing-metadata-missing'; targetId: string }
  | { kind: 'routing-metadata-contradictory'; targetId: string }
  | { kind: 'render-failure'; targetId: string; failure: DataVizDependencyFailure }
  | {
      kind: 'malformed-result';
      targetId: string;
      problem: DataVizMalformedProblem;
    };

type DataVizOutcome =
  | { ok: true; value: DataVizResult }
  | { ok: false; error: DataVizError };

export interface DataViz {
  render(input: { targetId: string; inputs: DataVizInputs }): Promise<DataVizOutcome>;
}
