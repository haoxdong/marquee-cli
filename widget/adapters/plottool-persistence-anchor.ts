import type { WidgetApi } from '../../api/widget/index.js';
import { MarqueeError } from '../../transport/index.js';
import type { WidgetResult } from '../types.js';
import { parsePlotToolWindow, plotToolWindowDashboardToken } from '../../plottool/window.js';
import { InvalidWidgetResponseError } from '../semantic-failure.js';
import { isRecord } from '../../lib/json-value.js';

export type WidgetPersistenceAnchors = Readonly<{
  parameters: readonly unknown[];
  relativeDate?: string;
}>;

/** A Widget Config's anchors when it holds none itself: its parameters and the saved Chart's relative date. */
export async function savedChartAnchors(
  widgetApi: Pick<WidgetApi, 'getChart'>,
  chartId: string,
  configurationId: string,
  parameters: readonly unknown[],
): Promise<WidgetResult<WidgetPersistenceAnchors>> {
  let chart: unknown;
  try {
    chart = await widgetApi.getChart(chartId);
  } catch (error) {
    const status = error instanceof MarqueeError ? error.details?.status : undefined;
    if (status === 404) {
      return { ok: false, error: { kind: 'configuration-not-found', identity: { widgetId: '', configurationId } } };
    }
    if (status === 403) return { ok: false, error: { kind: 'widget-access-denied', identity: { widgetId: '' } } };
    throw error;
  }
  const relativeDate = chartRelativeDate(chart);
  return { ok: true, value: { parameters, ...(relativeDate ? { relativeDate } : {}) } };
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

