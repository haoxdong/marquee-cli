import {
  formatLocale,
  formatSpecifier,
  type FormatSpecifier,
} from 'd3-format';

const EN_US_D3_LOCALE = formatLocale({
  decimal: '.',
  thousands: ',',
  grouping: [3],
  currency: ['$', ''],
});

const D3_FORMAT_TYPES = new Set([
  '',
  '%',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'n',
  'o',
  'p',
  'r',
  's',
  'x',
  'X',
]);

export type DataVizD3FormatProblem =
  | 'malformed-specifier'
  | 'unsupported-directive';

export class DataVizD3FormatError extends Error {
  override readonly name = 'DataVizD3FormatError';

  constructor(
    readonly specifier: string,
    readonly problem: DataVizD3FormatProblem,
    options?: ErrorOptions,
  ) {
    super(
      problem === 'malformed-specifier'
        ? `Invalid d3 format specifier: ${specifier}`
        : `Unsupported d3 format directive: ${specifier}`,
      options,
    );
  }
}

function parseFormatSpecifier(specifier: string): FormatSpecifier {
  try {
    return formatSpecifier(specifier);
  } catch (error) {
    throw new DataVizD3FormatError(specifier, 'malformed-specifier', {
      cause: error,
    });
  }
}

export function createD3NumberFormatter(
  specifier: string,
): (value: number) => string {
  const parsed = parseFormatSpecifier(specifier);
  if (!D3_FORMAT_TYPES.has(parsed.type)) {
    throw new DataVizD3FormatError(specifier, 'unsupported-directive');
  }
  return EN_US_D3_LOCALE.format(specifier);
}

export function projectD3NumberValue(
  specifier: string,
  value: number,
): number {
  const parsed: FormatSpecifier = parseFormatSpecifier(specifier);
  if (!D3_FORMAT_TYPES.has(parsed.type)) {
    throw new DataVizD3FormatError(specifier, 'unsupported-directive');
  }
  return parsed.type === '%' || parsed.type === 'p' ? value * 100 : value;
}
