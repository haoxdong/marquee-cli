import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../../../transport/index.js';
import type { WidgetError, WidgetId, WidgetModule } from '../../../widget/index.js';
import { createMarketViewWidget } from '../../widget.js';
import { observeDashboardWidgetOperations } from '../dashboard-widget-evidence.js';
import { createWidgetEvidenceRecorder, type WidgetCallLog } from '../widget-evidence.js';

const get = (path: string) => ({ method: 'GET', path }) as Endpoint;

function snippet(widgetId: string) {
  return {
    ok: true as const,
    value: {
      detail: 'snippet' as const,
      widget: {
        widgetId: widgetId as WidgetId,
        configurationId: null,
        title: widgetId,
        bindings: [],
        parameters: [],
      },
      snippet: { title: widgetId, isTitleResolved: true, parameterLines: [] },
    },
  };
}

function loadFailure(widgetId: string, error: unknown) {
  return {
    ok: false as const,
    error: {
      kind: 'widget-load-failure',
      identity: { widgetId },
      failure: { message: String(error) },
    } as unknown as WidgetError,
  };
}

const load = fc.record({
  via: fc.constantFrom('widget-get', 'dashboard-render'),
  fails: fc.boolean(),
});

// The recorder holds each load's call log across the loader's awaits; Dashboard
// enrichment runs loads concurrently, so every completion order must keep each
// log to its own load.
describe('Widget evidence under concurrent loads', () => {
  it('keeps each load\'s calls and failure isolated under every completion order', async () => {
    await fc.assert(fc.asyncProperty(
      fc.scheduler(),
      fc.array(load, { minLength: 2, maxLength: 4 }),
      async (s, loads) => {
        const failing = new Set(
          loads.flatMap((spec, index) => (spec.fails ? [`MW_${index}`] : [])),
        );
        const recorder = createWidgetEvidenceRecorder({
          async request({ path }) {
            await s.schedule(Promise.resolve(path), path);
            const id = path.split('CH_')[1];
            if (id && failing.has(id)) throw new Error(`chart CH_${id} failed`);
            return { path };
          },
        });
        async function fetchWidget(widgetId: string) {
          try {
            await recorder.port.request(get(`/v1/marketview/widgets/${widgetId}`));
            await recorder.port.request(get(`/v1/charts/CH_${widgetId}`));
            return snippet(widgetId);
          } catch (error) {
            return loadFailure(widgetId, error);
          }
        }
        const widget: Pick<WidgetModule, 'get' | 'render'> = {
          get: (input) => fetchWidget(input.widgetId),
          render: (widgetDefinition) => fetchWidget(String(widgetDefinition.id)),
        };
        const marketViewWidget = createMarketViewWidget(widget, recorder);
        const dashboard = observeDashboardWidgetOperations(widget, recorder);

        const audits = await s.waitFor(Promise.all(loads.map(async (spec, index) => {
          const widgetId = `MW_${index}` as WidgetId;
          if (spec.via === 'widget-get') {
            const output = await marketViewWidget.get({
              widgetId,
              configurationId: null,
              parameters: [],
              detail: 'snippet',
            });
            return output.audit;
          }
          const result = await dashboard.operations.renderDashboardWidget(
            { id: widgetId },
            [],
            null,
            undefined,
          );
          return result.ok ? undefined : dashboard.evidence.auditFor(result.error);
        })));

        loads.forEach((spec, index) => {
          const widgetId = `MW_${index}`;
          const audit: WidgetCallLog | undefined = audits[index];
          if (spec.via === 'dashboard-render' && !spec.fails) {
            expect(audit).toBeUndefined();
            return;
          }
          expect(audit?.calls.map((call) => call.request.path)).toEqual([
            `/v1/marketview/widgets/${widgetId}`,
            `/v1/charts/CH_${widgetId}`,
          ]);
          expect(audit?.failure).toEqual(
            spec.fails ? { message: `chart CH_${widgetId} failed` } : undefined,
          );
        });
      },
    ), { numRuns: 200 });
  });
});
