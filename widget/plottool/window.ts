/**
 * The Plot window codec: the one place that reads a Chart's provider window
 * tokens (`-3m`, `-ytd`, `ytd`, `-max`, `0d`, `+1m`; ends `0d`, `-0d`, `+5y`,
 * `30y`) and prints the `-p relativeDate`, Params and Dashboard spellings.
 */
import { requiredGroup } from '../../lib/regex-group.js';
import type {
  PlotToolWindow,
  PlotToolWindowEnd,
  PlotToolWindowOverride,
  PlotToolWindowStart,
  PlotToolWindowUnit,
} from './types.js';

type PlotToolWindowFields = Readonly<{
  relativeStartDate?: string | undefined;
  relativeEndDate?: string | undefined;
  startDate?: string;
}>;

type PlotToolWindowResult =
  | Readonly<{ ok: true; value: PlotToolWindow }>
  | Readonly<{ ok: false; reason: string }>;

const NAMED_STARTS: ReadonlyMap<string, 'max' | 'year-start' | 'prior-year-end' | 'today'> = new Map([
  ['-max', 'max'],
  ['-ytd', 'year-start'],
  // Marquee Web starts the unsigned spelling at the prior year end.
  ['ytd', 'prior-year-end'],
  ['0d', 'today'],
]);

const RELATIVE_DATE_OPTIONS = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y'];

export function parsePlotToolWindow(chart: PlotToolWindowFields): PlotToolWindowResult {
  const start = chart.relativeStartDate === undefined
    ? undefined
    : parseStart(chart.relativeStartDate);
  const end = chart.relativeEndDate === undefined
    ? undefined
    : parseEnd(chart.relativeEndDate);
  /* c8 ignore next -- data-layer-ignore: plot-window-token-assert */
  if (start === null || end === null) return { ok: false, reason: `unsupported relative ${start === null ? `start ${chart.relativeStartDate}` : `end ${chart.relativeEndDate}`}` };
  return {
    ok: true,
    value: {
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(chart.startDate !== undefined ? { startDate: chart.startDate } : {}),
      isForward: end?.kind === 'offset' && end.amount > 0,
    },
  };
}

function parseStart(token: string): PlotToolWindowStart | null {
  const named = NAMED_STARTS.get(token);
  if (named) return { token, kind: named };
  const match = /^(?:-(\d+)|\+([1-9]\d*))([dmy])$/.exec(token);
  if (!match) return null;
  return {
    token,
    kind: 'offset',
    direction: match[1] === undefined ? 'forward' : 'back',
    amount: Number(match[1] ?? requiredGroup(match, 2)),
    unit: requiredGroup(match, 3) as PlotToolWindowUnit,
  };
}

function parseEnd(token: string): PlotToolWindowEnd | null {
  if (token === '0d') return { kind: 'today' };
  const match = /^(?:-(?=0d)|\+)?(\d+)([dmy])$/.exec(token);
  return match && {
    kind: 'offset',
    amount: Number(requiredGroup(match, 1)),
    unit: requiredGroup(match, 2) as PlotToolWindowUnit,
  };
}

/** The Relative Date Web offers on a Chart, or undefined where Web hides it. */
export function plotToolWindowRelativeDate(window: PlotToolWindow): Readonly<{
  display?: string;
  raw: string;
  options: readonly string[];
}> | undefined {
  if (window.isForward) return undefined;
  const raw = window.start?.token ?? window.startDate;
  if (!raw) return undefined;
  const display = window.start ? plotToolWindowStartDisplay(window.start) : undefined;
  // Web's control offers these seven even when the Chart draws another window, such as 15Y.
  return {
    ...(display !== undefined ? { display } : {}),
    raw,
    options: RELATIVE_DATE_OPTIONS,
  };
}

function plotToolWindowStartDisplay(start: PlotToolWindowStart): string | undefined {
  // Charts spell year-to-date `ytd` or `-ytd`; Web's control shows YTD.
  if (start.kind === 'year-start' || start.kind === 'prior-year-end') return 'YTD';
  // Web's control selects no option on a `-max` or `0d` Chart.
  return start.kind === 'offset' && start.direction === 'back'
    ? `${start.amount}${start.unit.toUpperCase()}`
    : undefined;
}

/** The Dashboard override a saved Chart window implies, or undefined when it keeps its own window. */
export function plotToolWindowDashboardToken(window: PlotToolWindow): Readonly<
  { ok: true; value: string | undefined } | { ok: false; reason: string }
> {
  if (window.isForward || window.startDate) return { ok: true, value: undefined };
  const start = window.start;
  /* c8 ignore next -- data-layer-ignore: plot-window-dashboard-start-assert */
  if (!start || (start.kind === 'offset' && start.direction === 'forward')) return { ok: false, reason: `${start ? 'unsupported' : 'missing'} relativeStartDate` };
  if (start.kind === 'offset') return { ok: true, value: `${start.amount}${start.unit}` };
  // Web's Add To Dashboard sends no relativeDate for `ytd`, `-max` or `0d` Charts.
  const token = ({
    today: undefined,
    'year-start': 'YTD',
    'prior-year-end': undefined,
    max: undefined,
  } as const)[start.kind];
  return { ok: true, value: token };
}

/** The one grammar for a `-p relativeDate` or Dashboard override: `3M`, `YTD`, `MAX`. */
export function parsePlotToolWindowOverride(value: string): PlotToolWindowOverride | undefined {
  const start = parseStart(`-${value.toLowerCase()}`);
  return start ? { start, end: { kind: 'today' }, isForward: false } : undefined;
}

/** The spelling the CLI prints for an override, which parses back: `3M`, `YTD`, `MAX`. */
export function plotToolWindowOverrideToken(window: PlotToolWindowOverride): string {
  return window.start.token.slice(1).toUpperCase();
}

/** The `relativeDate` values the Widget Config endpoint's schema accepts. */
const PROVIDER_RELATIVE_DATES = new Set(['1d', '5d', '1m', '3m', '6m', 'YTD', '1y', '2y', '5y', '10y', 'MAX']);

/** Whether the Widget Config endpoint accepts an override's `relativeDate`. */
export function isPlotToolWindowOverrideProviderAccepted(window: PlotToolWindowOverride): boolean {
  return PROVIDER_RELATIVE_DATES.has(plotToolWindowOverrideProviderToken(window));
}

/** The Widget Config `relativeDate` spelling of an override: `YTD`, `MAX`, `3m`. */
export function plotToolWindowOverrideProviderToken(window: PlotToolWindowOverride): string {
  const { start } = window;
  return start.kind === 'offset'
    ? `${start.amount}${start.unit}`
    : plotToolWindowOverrideToken(window);
}
