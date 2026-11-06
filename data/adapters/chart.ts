import { DataVizApi } from '../../api/data-viz/index.js';
import { PlotToolApi } from '../../api/plottool/index.js';
import type { Result } from '../../lib/result.js';
import { MarqueeError, type Transport } from '../../transport/index.js';
import type { DataChartFailure, DataChartSubject, DataDate } from '../types.js';
import { chartInterval, relativeDateSpelling, type DataStoredWindow } from '../window.js';

type Request = Transport['request'];

// Web's Share → Copy Link (live, 2026-10-28).
const PLOTTOOL_WEB = 'https://marquee.gs.com/s/plottool';

// Web's y axes, in the order its editor offers them (live, 2026-10-28: `yAxesSettings`).
const AXES = ['Right', 'Right2', 'Right3', 'Left', 'Left2', 'Left3'] as const;

const PNG_DATA_URL = 'data:image/png;base64,';

/** A chart just saved: its id, for its picture, and its Web link. */
type CreatedChart = Readonly<{ id: string; link: string }>;

/**
 * Saves Expressions as a new chart in Scratch, as Web's editor holds them: the editor text,
 * one Expression per line, in `description`, the first Expression as its name and title, and
 * one display setting per Expression (live, 2026-10-28). Several Expressions get an axis each,
 * so a volatility plots beside an index level instead of flat under it. Web also adds a new
 * chart to Drafts; this does not.
 */
export async function createChart(
  request: Request,
  expressions: readonly string[],
  window: DataStoredWindow,
): Promise<Result<CreatedChart, DataChartFailure>> {
  const answer = await answered('save', () => new PlotToolApi({ request }).createChart({
    name: expressions[0],
    title: expressions[0],
    description: expressions.join('\n'),
    folderName: 'Scratch',
    chartType: 'line',
    expressions: expressions.map((_, index) => ({
      axis: expressions.length === 1 ? 'Right' : AXES[index % AXES.length],
      label: '',
      hide: false,
      disable: false,
    })),
    ...dateField('start', window.startDate),
    ...dateField('end', window.endDate),
    interval: chartInterval(window.interval),
    realTime: false,
  }));
  if (!answer.ok) return answer;
  const id: unknown = Reflect.get(Object(answer.value), 'id');
  /* c8 ignore next -- Recording-unreachable: every recorded save answers its id; a focused data eval test pins the failure. */
  if (typeof id !== 'string' || id === '') return malformed('save', 'id', 'expected the chart id');
  return { ok: true, value: { id, link: `${PLOTTOOL_WEB}/${encodeURIComponent(id)}` } };
}

/** A saved chart's PNG, as Marquee renders it for sharing. */
export async function fetchChartPicture(request: Request, chartId: string): Promise<Result<Buffer, DataChartFailure>> {
  const answer = await answered('picture', () => new DataVizApi({ request }).getVisualizationPicture(chartId));
  /* c8 ignore next -- Recording-unreachable: no recorded picture request fails; a focused data eval test pins the failure. */
  if (!answer.ok) return answer;
  const value: unknown = Reflect.get(Object(answer.value), 'value');
  /* c8 ignore next 3 -- Recording-unreachable: every recorded picture is a PNG data URL; a focused data eval test pins the failure. */
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL)) {
    return malformed('picture', 'value', `expected a ${PNG_DATA_URL} URL`);
  }
  return { ok: true, value: Buffer.from(value.slice(PNG_DATA_URL.length), 'base64') };
}

// An absolute date as the date itself; any other as Web's relative spelling.
function dateField(edge: 'start' | 'end', date: DataDate): Readonly<Record<string, string>> {
  if (date.kind === 'date') return { [`${edge}Date`]: date.date };
  return { [edge === 'start' ? 'relativeStartDate' : 'relativeEndDate']: relativeDateSpelling(date) };
}

async function answered(subject: DataChartSubject, send: () => Promise<unknown>): Promise<Result<unknown, DataChartFailure>> {
  try {
    return { ok: true, value: await send() };
  } catch (error) {
    /* c8 ignore next -- Recording-unreachable: replayed failures are all MarqueeErrors; a defect propagates. */
    if (!(error instanceof MarqueeError)) throw error;
    return {
      ok: false,
      error: {
        kind: 'chart-request-failed',
        subject,
        /* c8 ignore next -- Recording-unreachable: no recorded chart request answers 403; a focused data eval test pins access denied. */
        ...(error.details?.status === 403 ? { reason: 'access-denied' as const } : {}),
        failure: error.dependencyFailure(),
      },
    };
  }
}

/* c8 ignore next 3 -- Called only on the Recording-unreachable shapes above. */
function malformed(subject: DataChartSubject, location: string, problem: string): Result<never, DataChartFailure> {
  return { ok: false, error: { kind: 'malformed-chart', subject, location, problem } };
}
