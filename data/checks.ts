import { distance } from 'fastest-levenshtein';
import { findFunction } from './catalog.js';
import { dataCommand } from './command-lines.js';
import { DATA_SEARCH_CLASSES } from './search.js';
import { expressionCalls, type ExpressionCall } from './expressions.js';
import { signatureHead, signatureLines } from './signatures.js';
import type {
  CatalogFunction,
  DataExpressionProblem,
  FunctionLibrary,
} from './types.js';

const NEAREST_FUNCTIONS = 3;

// `name=value`, not `==`: a keyword argument the library's positions do not describe.
const NAMED_ARGUMENT = /^[A-Za-z_]\w*\s*=(?!=)/;

/**
 * Each Expression that calls a function the library does not have, or passes more
 * arguments than a function takes. Fewer is left to the runner: the library lists
 * parameters as required that PlotTool Pro's own examples leave out.
 */
export function expressionProblems(
  library: FunctionLibrary,
  expressions: readonly string[],
): DataExpressionProblem[] {
  return expressions.flatMap((expression) => {
    const problem = expressionCalls(expression)
      .map((call) => {
        if (call.receiver === undefined) return callProblem(library, call);
        return call.receiver.kind === 'string' ? quotedReceiverProblem(expression, call.receiver.text) : undefined;
      })
      .find((found) => found !== undefined);
    return problem === undefined ? [] : [{ expression, ...problem }];
  });
}

// `"AAPL UW".spot()` calls `spot` on text; `AAPL UW.spot()` resolves the Entity (live, 2026-10-24).
function quotedReceiverProblem(expression: string, id: string): Omit<DataExpressionProblem, 'expression'> {
  return {
    message: `"${id}" is quoted text, not an Entity`,
    hints: [`Write the Entity id unquoted: ${expression.replace(`"${id}"`, id)}`],
  };
}

/** The library's functions whose names are a small edit away from `name`, nearest first. */
function nearestFunctions(library: FunctionLibrary, name: string): CatalogFunction[] {
  const limit = Math.max(1, Math.floor(name.length / 3));
  return library.functions
    .map((entry) => ({ entry, edits: distance(entry.name.toLowerCase(), name.toLowerCase()) }))
    .filter(({ edits }) => edits <= limit)
    .sort((left, right) => left.edits - right.edits || left.entry.name.localeCompare(right.entry.name))
    .slice(0, NEAREST_FUNCTIONS)
    .map(({ entry }) => entry);
}

/** What to show for a call to `name` the library does not have. */
export function unknownFunctionHints(library: FunctionLibrary, name: string): string[] {
  const nearest = nearestFunctions(library, name);
  return nearest.length === 0
    ? []
    : ['Nearest functions:', ...nearest.map((entry) => `  ${signatureHead(entry)}`)];
}

// A name called like a Class with nothing near it in the library, as agents guessed
// `ECON("LNS14000000")` and `Stock("AAPL UW")`: the Classes `data search` finds
// ids for, and a search of every Class for its words.
function unknownClassHints(argumentList: readonly string[]): string[] {
  const words = argumentList.map((argument) => argument.replace(/^"|"$/g, '')).join(' ');
  return [
    `Classes an Expression constructs: ${DATA_SEARCH_CLASSES.join(', ')}`,
    `Find the id: ${dataCommand('search', words)}`,
  ];
}

function callProblem(
  library: FunctionLibrary,
  call: ExpressionCall,
): Omit<DataExpressionProblem, 'expression'> | undefined {
  const entry = findFunction(library, call.name);
  if (entry === undefined) {
    const nearest = unknownFunctionHints(library, call.name);
    return {
      message: `${call.name} is not a PlotTool Pro function`,
      hints: nearest.length > 0 || call.arguments === undefined || call.arguments.length === 0
        ? nearest
        : unknownClassHints(call.arguments),
    };
  }
  const given = call.arguments;
  const isVariadic = entry.parameters.some((parameter) => parameter.isVariadic);
  if (given === undefined || isVariadic || given.some((argument) => NAMED_ARGUMENT.test(argument))) {
    return undefined;
  }
  const most = entry.parameters.length;
  if (given.length <= most) return undefined;
  return {
    message: `${call.name} takes at most ${most} argument${most === 1 ? '' : 's'}, got ${given.length}`,
    hints: signatureLines(entry),
  };
}
