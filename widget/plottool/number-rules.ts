export const PLOT_NUMBER_LOCALE = 'en-US';
export const STANDARD_PLOT_CARD_HEIGHT_PX = 339;
export const PLOT_Y_AXIS_TICK_SPACING_PX = 40;
export const MINIMUM_PLOT_Y_AXIS_TICKS = 3;
export const STANDARD_PLOT_Y_AXIS_TICKS = Math.max(
  Math.trunc(STANDARD_PLOT_CARD_HEIGHT_PX / PLOT_Y_AXIS_TICK_SPACING_PX),
  MINIMUM_PLOT_Y_AXIS_TICKS,
);

export const PLOT_LABEL_FORMATS = [
  'none',
  'bps',
  'percentage',
  'thousand',
  'million',
  'billion',
  'dollar',
  'multiple',
  'auto',
] as const;


type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type PlotToolNumberRuleError = Readonly<{
  kind: 'nan-under-auto-precision';
  source: 'axis-domain' | 'point-value';
  message: string;
}>;

export type PlotToolAxisNumberRule = Readonly<{
  labelFormat: string;
  decimals: number;
  precision: 'auto' | 'explicit';
  precisionDomains: readonly [number, number];
}>;

export type FormattedPlotToolNumber = Readonly<{
  value: number;
  text: string;
  decimals: number;
}>;

export type ResolvePlotToolAxisNumberRuleInput = Readonly<{
  labelFormat?: string;
  decimalPrecision?: number;
  dataDomains: readonly [number, number];
  minimum?: number;
  maximum?: number;
  isHidden?: boolean;
}>;

const formatScale = new Map<string, (value: number) => number>([
  ['bps', (value) => value * 1e4],
  ['percentage', (value) => value * 100],
  ['thousand', (value) => value / 1e3],
  ['million', (value) => value / 1e6],
  ['billion', (value) => value / 1e9],
]);

const formatDecoration = new Map<string, Readonly<{ prefix: string; suffix: string }>>([
  ['bps', { prefix: '', suffix: ' bps' }],
  ['percentage', { prefix: '', suffix: ' %' }],
  ['thousand', { prefix: '', suffix: ' K' }],
  ['million', { prefix: '', suffix: ' M' }],
  ['billion', { prefix: '', suffix: ' B' }],
  ['dollar', { prefix: '$', suffix: '' }],
  ['multiple', { prefix: '', suffix: ' x' }],
]);

export function resolvePlotToolAxisNumberRule(
  input: ResolvePlotToolAxisNumberRuleInput,
): Result<PlotToolAxisNumberRule, PlotToolNumberRuleError> {
  const precision = input.decimalPrecision === undefined ? 'auto' : 'explicit';
  const precisionDomains = resolvePrecisionDomain(input);
  if (
    precision === 'auto'
    && (input.dataDomains.some(Number.isNaN) || precisionDomains.some(Number.isNaN))
  ) {
    return nanError('axis-domain');
  }

  const requestedFormat = input.labelFormat ?? 'auto';
  const labelFormat = precision === 'explicit'
    ? requestedFormat
    : resolveLabelFormat(requestedFormat, input.dataDomains);
  const decimals = input.decimalPrecision
    ?? resolveAutoAxisDecimals(requestedFormat, labelFormat, precisionDomains, input.isHidden === true);

  return {
    ok: true,
    value: {
      labelFormat,
      decimals,
      precision,
      precisionDomains,
    },
  };
}

export function formatPlotToolAxisNumber(
  value: number,
  rule: PlotToolAxisNumberRule,
): Result<FormattedPlotToolNumber, PlotToolNumberRuleError> {
  if (rule.precision === 'auto' && Number.isNaN(value)) {
    return nanError('point-value');
  }
  const scaled = scaleValue(value, rule.labelFormat);
  return {
    ok: true,
    value: {
      value: scaled,
      text: decorate(formatFixed(scaled, rule.decimals), rule.labelFormat),
      decimals: rule.decimals,
    },
  };
}

export function formatPlotToolPointNumber(
  value: number,
  rule: PlotToolAxisNumberRule,
): Result<FormattedPlotToolNumber, PlotToolNumberRuleError> {
  if (rule.precision === 'auto' && Number.isNaN(value)) {
    return nanError('point-value');
  }

  const labelFormat = rule.labelFormat === 'auto'
    ? resolveLabelFormat('auto', [value, value])
    : rule.labelFormat;
  const scaled = scaleValue(value, labelFormat);
  const minimumDecimals = pointMinimumDecimals(scaled, labelFormat);
  const decimals = rule.precision === 'auto'
    ? Math.max(minimumDecimals, rule.decimals)
    : rule.decimals;
  const fixed = formatFixed(scaled, decimals);
  const text = rule.precision === 'auto' ? stripFractionZeros(fixed) : fixed;

  return {
    ok: true,
    value: {
      value: scaled,
      text: decorate(text, labelFormat),
      decimals,
    },
  };
}

function resolvePrecisionDomain(
  input: ResolvePlotToolAxisNumberRuleInput,
): readonly [number, number] {
  return [
    input.minimum ?? input.dataDomains[0],
    input.maximum ?? input.dataDomains[1],
  ];
}

function resolveLabelFormat(
  requestedFormat: string,
  domain: readonly [number, number],
): string {
  if (requestedFormat !== 'auto') return requestedFormat;
  const maximumMagnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  if (maximumMagnitude >= 1e9) return 'billion';
  if (maximumMagnitude >= 1e6) return 'million';
  return 'none';
}

function resolveAutoAxisDecimals(
  requestedFormat: string,
  resolvedFormat: string,
  domain: readonly [number, number],
  hidden: boolean,
): number {
  if (hidden) return 2;
  const initialDecimals = calculateAxisDecimals(domain, STANDARD_PLOT_Y_AXIS_TICKS);
  if (requestedFormat !== 'auto' || resolvedFormat === requestedFormat) {
    return initialDecimals;
  }
  return calculateAxisDecimals(
    [scaleValue(domain[0], resolvedFormat), scaleValue(domain[1], resolvedFormat)],
    STANDARD_PLOT_Y_AXIS_TICKS,
  );
}

function calculateAxisDecimals(
  domain: readonly [number, number],
  tickCount: number,
): number {
  const range = Math.abs(domain[1] - domain[0]);
  const decimals = range === 0
    ? Math.ceil(Math.log10(1 / Math.abs(domain[0])))
    : Math.ceil(Math.log10(1 / (range / (Math.max(2, tickCount) - 1))));
  return Math.min(Math.max(0, decimals), 15);
}

function pointMinimumDecimals(value: number, labelFormat: string): number {
  if (labelFormat === 'dollar') return 2;
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude >= 1_000) return 0;
  if (magnitude >= 100) return 1;
  if (magnitude >= 10) return 2;
  if (magnitude >= 1) return 4;
  return Math.max(4, Math.floor(-Math.log10(magnitude)) + 3);
}

function scaleValue(value: number, labelFormat: string): number {
  return formatScale.get(labelFormat)?.(value) ?? value;
}

// Building a NumberFormat costs far more than formatting with one; a table reuses one per precision.
const fixedFormats = new Map<number, Intl.NumberFormat>();

function formatFixed(value: number, decimals: number): string {
  let format = fixedFormats.get(decimals);
  if (format === undefined) {
    format = new Intl.NumberFormat(PLOT_NUMBER_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    fixedFormats.set(decimals, format);
  }
  return format.format(value);
}

function stripFractionZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function decorate(value: string, labelFormat: string): string {
  const decoration = formatDecoration.get(labelFormat);
  return decoration ? `${decoration.prefix}${value}${decoration.suffix}` : value;
}

function nanError(source: PlotToolNumberRuleError['source']): Result<never, PlotToolNumberRuleError> {
  return {
    ok: false,
    error: {
      kind: 'nan-under-auto-precision',
      source,
      message: 'PlotTool Pro auto precision cannot format NaN',
    },
  };
}
