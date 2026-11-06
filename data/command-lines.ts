import { expressionCalls } from './expressions.js';
import type { DataEvalWindow } from './types.js';

const BARE_WORD = /^[\w./:-]+$/;
const DOUBLE_QUOTE_SPECIAL = /["$`\\]/;

/**
 * A paste-ready `marquee data …` command line: a word the shell would split is double-quoted,
 * or single-quoted when it holds what double quotes would not keep, such as `Subdivision("US-UM")`.
 */
export function dataCommand(...words: readonly string[]): string {
  return ['marquee data', ...words.map(shellWord)].join(' ');
}

function shellWord(word: string): string {
  if (BARE_WORD.test(word)) return word;
  return DOUBLE_QUOTE_SPECIAL.test(word) ? `'${word}'` : `"${word}"`;
}

/** A paste-ready `marquee data eval` of these Expressions over this window, each single-quoted as typed. */
export function evalCommand(expressions: readonly string[], { startDate, endDate, interval }: DataEvalWindow): string {
  const quoted = expressions.map((expression) => `'${expression.replaceAll('\'', '\'\\\'\'')}'`);
  return ['marquee data eval', ...quoted, '--start-date', startDate, '--end-date', endDate, '--interval', interval].join(' ');
}

/**
 * Where to check an Expression's arguments: the view of the Entity its outermost measure is called
 * on, or of the Function or Class it calls first; undefined when it calls nothing.
 */
export function signatureView(expression: string): string | undefined {
  const [outermost] = expressionCalls(expression);
  const target = outermost?.receiver?.kind === 'identifier' ? outermost.receiver.text : outermost?.name;
  return target === undefined ? undefined : dataCommand('view', target);
}

/** `Check its arguments: <view>`, the next step for an Expression no catalog explains. */
export function signatureHint(expression: string): string | undefined {
  const view = signatureView(expression);
  return view === undefined ? undefined : `Check its arguments: ${view}`;
}
