import type { WidgetApi } from '../../api/widget/index.js';
import { MarqueeError } from '../../transport/index.js';
import type {
  PlotToolPersistenceAnchorResolver,
} from '../persistence-anchor.js';
import { parsePlotToolWindow, plotToolWindowDashboardToken } from '../plottool/window.js';
import { InvalidWidgetResponseError } from '../semantic-failure.js';

export function createPlotToolPersistenceAnchorResolver(
  widgetApi: Pick<WidgetApi, 'getChart'>,
): PlotToolPersistenceAnchorResolver {
  return {
    async resolveConfiguration(chartId) {
      let chart: unknown;
      try {
        chart = await widgetApi.getChart(chartId);
      } catch (error) {
        if (!(error instanceof MarqueeError)) throw error;
        const status = error.details?.status;
        if (status === 404) {
          return {
            ok: false,
            error: { kind: 'chart-not-found', chartId, message: error.message },
          };
        }
        if (status === 403) {
          return {
            ok: false,
            error: { kind: 'chart-access-denied', chartId, message: error.message },
          };
        }
        return {
          ok: false,
          error: {
            kind: 'chart-load-failed',
            chartId,
            failure: error.dependencyFailure(),
            message: error.message,
          },
        };
      }
      const relativeDate = chartRelativeDate(chart);
      return {
        ok: true,
        value: relativeDate === undefined ? {} : { relativeDate },
      };
    },
  };
}

function chartRelativeDate(chart: unknown): string | undefined {
  if (!isRecord(chart)) return invalidChart('chart is not a record');
  const window = parsePlotToolWindow({
    relativeStartDate: optionalText(chart.relativeStartDate),
    relativeEndDate: optionalText(chart.relativeEndDate),
    ...(typeof chart.startDate === 'string' ? { startDate: chart.startDate } : {}),
  });
  if (!window.ok) return invalidChart(`chart ${window.reason}`);
  const token = plotToolWindowDashboardToken(window.value);
  if (!token.ok) return invalidChart(`chart ${token.reason}`);
  return token.value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function invalidChart(detail: string): never {
  throw new InvalidWidgetResponseError({
    source: 'configuration',
    problem: 'unsupported-payload-shape',
    detail,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
