/** What a method call is made on. */
type CallReceiver =
  | Readonly<{ kind: 'call'; name: string }>
  | Readonly<{ kind: 'identifier'; text: string }>
  /** A double-quoted string, which PlotTool Pro reads as text, not an Entity: `"AAPL UW".spot()`. */
  | Readonly<{ kind: 'string'; text: string }>;

/** One call an Expression makes: a function, a constructor or a method. */
export type ExpressionCall = Readonly<{
  name: string;
  /** Absent for a function or constructor call. */
  receiver?: CallReceiver;
  /** Each top-level argument as written; absent when the parentheses never close. */
  arguments?: readonly string[];
}>;

const IDENTIFIER = /[A-Za-z_]\w*/y;
const WORD = /\w/;

/**
 * The calls an Expression makes, read as PlotTool Pro writes them: double-quoted strings,
 * `# comments` and `@modifier`s (`EURUSD.spot@WM()`) are not calls. Anything the reader
 * does not understand is left for the runner to reject.
 */
export function expressionCalls(expression: string): ExpressionCall[] {
  const calls: ExpressionCall[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index] ?? '';
    if (character === '#') {
      index = lineEnd(expression, index);
    } else if (character === '"') {
      index = stringEnd(expression, index);
    } else if (character === '@' || WORD.test(character)) {
      index = readWord(expression, index, calls);
    } else {
      index += 1;
    }
  }
  return calls;
}

// Reads one word at `start`; an identifier followed by `(` is a call.
function readWord(expression: string, start: number, calls: ExpressionCall[]): number {
  const isModifier = expression[start] === '@';
  IDENTIFIER.lastIndex = isModifier ? start + 1 : start;
  const match = IDENTIFIER.exec(expression);
  const isWordStart = start === 0 || !WORD.test(expression[start - 1] ?? '');
  if (match === null || !isWordStart) return wordEnd(expression, start + 1);
  const end = IDENTIFIER.lastIndex;
  const open = skipSpaces(expression, end);
  if (isModifier || expression[open] !== '(') return end;
  const receiver = callReceiver(expression, start);
  const argumentList = callArguments(expression, open);
  calls.push({
    name: match[0],
    ...(receiver === undefined ? {} : { receiver }),
    ...(argumentList === undefined ? {} : { arguments: argumentList }),
  });
  return end;
}

// A method's receiver: the call or identifier before the `.` that precedes the name.
function callReceiver(expression: string, nameStart: number): CallReceiver | undefined {
  const dot = skipSpacesBack(expression, nameStart - 1);
  if (expression[dot] !== '.') return undefined;
  const before = skipSpacesBack(expression, dot - 1);
  if (expression[before] === ')') {
    const open = matchingOpen(expression, before);
    const nameEnd = skipSpacesBack(expression, open - 1) + 1;
    let start = nameEnd;
    while (start > 0 && WORD.test(expression[start - 1] ?? '')) start -= 1;
    return start < nameEnd ? { kind: 'call', name: expression.slice(start, nameEnd) } : undefined;
  }
  if (expression[before] === '"') {
    const open = expression.lastIndexOf('"', before - 1);
    return open === -1 ? undefined : { kind: 'string', text: expression.slice(open + 1, before) };
  }
  // An identifier may hold spaces, as Bloomberg IDs do: `AAPL UW.spot()`.
  let start = before + 1;
  while (start > 0 && /[\w ]/.test(expression[start - 1] ?? '')) start -= 1;
  const text = expression.slice(start, before + 1).trim();
  return text === '' ? undefined : { kind: 'identifier', text };
}

function callArguments(expression: string, open: number): string[] | undefined {
  const commas: number[] = [];
  let depth = 0;
  let index = open + 1;
  while (index < expression.length) {
    const character = expression[index] ?? '';
    if (character === '"') {
      index = stringEnd(expression, index);
      continue;
    }
    if (depth === 0 && character === ')') return splitAt(expression, open, commas, index);
    if (depth === 0 && character === ',') commas.push(index);
    depth += DEPTH_CHANGE[character] ?? 0;
    index += 1;
  }
  return undefined;
}

const DEPTH_CHANGE: Readonly<Record<string, number>> = { '(': 1, '[': 1, ')': -1, ']': -1 };

// The trimmed text between `open`, each top-level comma and `close`; `()` has no arguments.
function splitAt(expression: string, open: number, commas: readonly number[], close: number): string[] {
  const bounds = [open, ...commas, close];
  const argumentList = bounds.slice(1).map((end, index) => expression.slice((bounds[index] ?? open) + 1, end).trim());
  return argumentList.length === 1 && argumentList[0] === '' ? [] : argumentList;
}

function matchingOpen(expression: string, close: number): number {
  let depth = 0;
  for (let index = close; index >= 0; index -= 1) {
    if (expression[index] === ')') depth += 1;
    if (expression[index] === '(') depth -= 1;
    if (depth === 0) return index;
  }
  return 0;
}

function stringEnd(expression: string, open: number): number {
  const close = expression.indexOf('"', open + 1);
  return close === -1 ? expression.length : close + 1;
}

function lineEnd(expression: string, start: number): number {
  const end = expression.indexOf('\n', start);
  return end === -1 ? expression.length : end + 1;
}

function wordEnd(expression: string, start: number): number {
  let index = start;
  while (index < expression.length && WORD.test(expression[index] ?? '')) index += 1;
  return index;
}

function skipSpaces(expression: string, start: number): number {
  let index = start;
  while (expression[index] === ' ') index += 1;
  return index;
}

function skipSpacesBack(expression: string, start: number): number {
  let index = start;
  while (index >= 0 && expression[index] === ' ') index -= 1;
  return index;
}
