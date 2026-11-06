import { distance } from 'fastest-levenshtein';
import type { PlotToolResolvedAsset } from '../plottool/index.js';
import type { Transport } from '../transport/index.js';
import { fetchAssetByIdentifier, fetchEntityMeasures, fetchNearestAssets, type AssetLookup } from './adapters/catalogs.js';
import type { Result } from '../lib/result.js';
import { appliesTo, findFunction, forAsset, type AssetMatch, type CatalogFetchFailure, type CatalogOutcome } from './catalog.js';
import type { AssetMeasure, DataExplanationFailure, FunctionLibrary } from './types.js';
import { unknownFunctionHints } from './checks.js';
import { dataCommand } from './command-lines.js';
import { expressionCalls, type ExpressionCall } from './expressions.js';
import { signatureHead, signatureLines } from './signatures.js';

/** An Expression the runner rejected, with the assets it resolved first. */
export type ExpressionFailure = Readonly<{
  expression: string;
  message: string;
  assets: readonly PlotToolResolvedAsset[];
}>;

/** An Expression whose series has no points, with the assets and other Entities it resolved. */
export type EmptySeries = Readonly<{
  expression: string;
  assets: readonly PlotToolResolvedAsset[];
  entityIds: readonly string[];
}>;

type Explanation = Result<readonly string[], DataExplanationFailure>;

/** Hints for an Expression the runner rejected, and for one whose series has no points. */
export type Explainer = Readonly<{
  rejection(failure: ExpressionFailure): Promise<Explanation>;
  emptySeries(series: EmptySeries): Promise<Explanation>;
}>;

type ExplanationSources = Readonly<{
  library: FunctionLibrary;
  nearestAssets(query: string): Promise<CatalogOutcome<readonly AssetMatch[]>>;
  measures(assetId: string): Promise<CatalogOutcome<readonly AssetMeasure[]>>;
  asset(identifier: string): Promise<CatalogOutcome<AssetLookup>>;
}>;

// The asset a measure was called on: the identifier as written and, once resolved, its id.
type MeasureTarget = Readonly<{ identifier: string; asset: PlotToolResolvedAsset }>;

type Rule = (context: ExplanationSources, failure: ExpressionFailure) => Promise<string[]> | undefined;

const SINGLE_QUOTE = /No terminal matches '''/;
const UNRESOLVED = /did not find any entities for ([^)]+)\)/;
// The runner relays an unresolved asset as the resolution host's request, its id URL-escaped or
// with its space as typed (memo 0047 §6; live: `ITRAXX XOVER.spread()`, 2026-10-27).
const UNRESOLVED_ASSET = /\/v1\/assets\/(.+?) status: \d+,/;
const NO_DATASET = /DataSet not found for entity with id: \S+ ,([^)]+)\)/;
// A coordinate Marquee holds no data for (live, 2026-11-05: `USDBRL.implied_volatility(27m,
// delta_put, 10)` and `(27m, delta_put, 25)` answer so, while 12m and 2y answer).
const COORDINATE_WITHOUT_DATASET = /measure service request \S+ failed: \['DataSet not found for entity with id: /;
/** How many of an asset's measures a hint names before pointing to its view. */
const LISTED_MEASURES = 10;
/** How many measures named like a missing one a hint names, nearest by spelling first. */
const NEAREST_MEASURES = 5;
const NO_ATTRIBUTE = /object does not have attribute: (\w+)/;
const NOT_VALID = /\(([^()]+?) is not valid; allowed values are/;
const NO_MATCHING_ASSET = /Specified arguments did not match any asset/;
const NOT_AVAILABLE = /\(([A-Z][\w ]*?) is not available for None /;
const MISSING_ARGUMENT = /(\w+)\(\) missing \d+ required/;
const TOO_MANY_ARGUMENTS = /(\w+) expects <=\d+ arguments/;
const NOT_CALLABLE = /(\w+) is not a callable/;
const BAD_CASING = /invalid function name (\w+): bad casing\?/;
const AMBIGUOUS_ARGUMENTS = /Specified arguments match multiple assets/;

/**
 * Explains each runner rejection from the catalogs: the double-quote rule, the assets
 * nearest an identifier that did not resolve, an asset's measures, or a function's
 * signature; and a Measure with no points by its allowed values. Each asset's measures are
 * read once per batch. A catalog that cannot be read fails the explanation, named by what it
 * was read for (ADR 0030).
 */
export function createExplainer(request: Transport['request'], library: FunctionLibrary): Explainer {
  const measures = new Map<string, Promise<CatalogOutcome<readonly AssetMeasure[]>>>();
  const context: ExplanationSources = {
    library,
    nearestAssets: (query) => fetchNearestAssets(request, query),
    measures: (assetId) => {
      const known = measures.get(assetId) ?? fetchEntityMeasures(request, assetId);
      measures.set(assetId, known);
      return known;
    },
    asset: (identifier) => fetchAssetByIdentifier(request, identifier),
  };
  return {
    rejection: (failure) => explained(() => firstExplanation(context, failure)),
    emptySeries: (series) => explained(() => emptySeriesExplanation(context, series)),
  };
}

async function explained(explain: () => Promise<string[]>): Promise<Explanation> {
  try {
    return { ok: true, value: await explain() };
  } catch (error) {
    /* c8 ignore next -- Recording-unreachable: only a defect throws anything else, and it propagates. */
    if (!(error instanceof ExplanationFetchError)) throw error;
    return { ok: false, error: { kind: 'explanation-failed', subject: error.subject, failure: error.failure } };
  }
}

// The first rule that explains the failure, or none.
function firstExplanation(context: ExplanationSources, failure: ExpressionFailure): Promise<string[]> {
  for (const rule of RULES) {
    const explained = rule(context, failure);
    if (explained !== undefined) return explained;
  }
  return Promise.resolve([]);
}

// Carries a catalog's failure out of the rule that read it, to the explainer's boundary.
class ExplanationFetchError extends Error {
  constructor(readonly subject: string, readonly failure: CatalogFetchFailure) {
    super(`${subject} failed`);
  }
}

function fetchedValue<T>(subject: string, outcome: CatalogOutcome<T>): T {
  if (!outcome.ok) throw new ExplanationFetchError(subject, outcome.error);
  return outcome.value;
}

// `Asset(id)` takes a Marquee asset id: given a ticker, the runner resolves no asset and answers
// a bare Bad Request (live: `Asset("AAPL UW").close_price()`, 2026-10-24), where the ticker
// itself resolves (`AAPL UW.close_price()`).
function tickerAsset({ expression, assets }: ExpressionFailure): Promise<string[]> | undefined {
  const calls = expressionCalls(expression);
  const measured = calls.some(({ receiver }) => receiver?.kind === 'call' && receiver.name === 'Asset');
  const [id] = calls.find(({ name, receiver }) => name === 'Asset' && receiver === undefined)?.arguments ?? [];
  if (!measured || id === undefined || assets.length > 0) return undefined;
  const unquoted = id.replace(/^"|"$/g, '');
  return Promise.resolve([
    `Asset takes a Marquee asset id (MA…); call the Measure on the Entity id itself: ${
      expression.replace(`Asset(${id})`, unquoted)
    }`,
  ]);
}

const RULES: readonly Rule[] = [
  (_context, failure) => tickerAsset(failure),
  (_context, { expression, message }) => (SINGLE_QUOTE.test(message)
    ? Promise.resolve([`Strings take double quotes: ${expression.replaceAll('\'', '"')}`])
    : undefined),
  (context, { message }) => matched(UNRESOLVED, message, (identifier) => nearestAssets(context, identifier)),
  (context, { message }) => matched(UNRESOLVED_ASSET, message, (escaped) => nearestAssets(context, decodeURIComponent(escaped))),
  (context, failure) => matched(NO_DATASET, failure.message, (identifier) => {
    const asset = failure.assets.find((candidate) => candidate.identifier === identifier);
    const call = expressionCalls(failure.expression)
      .find((candidate) => candidate.receiver?.kind === 'identifier' && candidate.receiver.text === identifier);
    return call === undefined || asset === undefined
      ? undefined
      : measureExplanation(context, { identifier, asset }, call.name);
  }),
  (_context, { expression, message }) => (COORDINATE_WITHOUT_DATASET.test(message)
      && expressionCalls(expression).some((call) => call.receiver !== undefined && (call.arguments?.length ?? 0) > 0)
    ? Promise.resolve(['Marquee holds no data at these arguments: try a standard tenor, such as 1y or 2y, or a strike nearer the money'])
    : undefined),
  (context, failure) => matched(NO_ATTRIBUTE, failure.message, (name) => {
    const call = expressionCalls(failure.expression).find((candidate) => candidate.name === name);
    if (call?.receiver?.kind === 'call') return Promise.resolve(constructorMethods(context.library, call.receiver.name));
    const target = call === undefined ? undefined : measureTarget(failure, call);
    return target === undefined ? undefined : measureExplanation(context, target, name);
  }),
  (context, failure) => matched(NOT_VALID, failure.message, (value) => {
    // The runner names the value unquoted, however the Expression writes it.
    const call = expressionCalls(failure.expression)
      .find((candidate) => candidate.arguments?.some((argument) => argument.replace(/^"|"$/g, '') === value) === true);
    return call === undefined ? undefined : callExplanation(context, failure, call);
  }),
  (context, failure) => {
    // The runner names neither the measure nor its arguments (live: `USD.swap_rate(10y)`, 2026-10-27).
    if (!AMBIGUOUS_ARGUMENTS.test(failure.message)) return undefined;
    const call = expressionCalls(failure.expression).find(({ receiver }) => receiver?.kind === 'identifier');
    return call === undefined ? undefined : callExplanation(context, failure, call);
  },
  (context, { message }) => matched(MISSING_ARGUMENT, message, (name) => functionSignature(context.library, name)),
  (context, { message }) => matched(TOO_MANY_ARGUMENTS, message, (name) => functionSignature(context.library, name)),
  (context, { message }) => matched(NOT_CALLABLE, message, (name) => (
    Promise.resolve(unknownFunctionHints(context.library, name))
  )),
  (context, { expression, message }) => matched(BAD_CASING, message, (name) => {
    const receiver = expressionCalls(expression).find((candidate) => candidate.name === name)?.receiver;
    return receiver?.kind === 'identifier' ? casingExplanation(context, receiver.text, name) : undefined;
  }),
  (context, failure) => {
    // The runner names neither the Measure nor the argument off its grid (live: `USD.swaption_vol(7w, 10y)`, 2026-10-28).
    if (!NO_MATCHING_ASSET.test(failure.message)) return undefined;
    const call = expressionCalls(failure.expression).find(({ receiver }) => receiver?.kind === 'identifier');
    return call === undefined ? undefined : callExplanation(context, failure, call);
  },
  (context, failure) => matched(NOT_AVAILABLE, failure.message, (title) => {
    // The runner names a measure the asset lacks in Title Case (live: `EURUSD.forward_points(3m)`, 2026-10-28).
    const call = expressionCalls(failure.expression)
      .find((candidate) => candidate.name.replaceAll('_', ' ').toLowerCase() === title.toLowerCase());
    const target = call === undefined ? undefined : measureTarget(failure, call);
    return call === undefined || target === undefined ? undefined : measureExplanation(context, target, call.name);
  }),
];

function matched(
  pattern: RegExp,
  message: string,
  explain: (captured: string) => Promise<string[]> | undefined,
): Promise<string[]> | undefined {
  const found = pattern.exec(message);
  return found?.[1] === undefined ? undefined : explain(found[1]);
}

// The signature of the function, method or measure a rejected argument was passed to.
function callExplanation(
  context: ExplanationSources,
  failure: ExpressionFailure,
  call: ExpressionCall,
): Promise<string[]> | undefined {
  const { receiver } = call;
  if (receiver === undefined) return functionSignature(context.library, call.name);
  if (receiver.kind === 'call') {
    const owner = findFunction(context.library, receiver.name);
    const method = owner?.methods.find((candidate) => candidate.name === call.name);
    return owner === undefined || method === undefined
      ? undefined
      : Promise.resolve(signatureLines(method, `${signatureHead(owner)}.`));
  }
  const target = measureTarget(failure, call);
  return target === undefined ? undefined : measureExplanation(context, target, call.name);
}

function functionSignature(library: FunctionLibrary, name: string): Promise<string[]> | undefined {
  const entry = findFunction(library, name);
  return entry === undefined ? undefined : Promise.resolve(signatureLines(entry));
}

function constructorMethods(library: FunctionLibrary, name: string): string[] {
  const owner = findFunction(library, name);
  return owner === undefined || owner.methods.length === 0
    ? []
    : [`${name} methods:`, ...owner.methods.map((method) => `  ${signatureHead(method)}`)];
}

// The resolved asset a method was called on: the one named as written, or the only one.
function measureTarget(
  { assets }: Pick<ExpressionFailure, 'assets'>,
  call: ExpressionCall,
): MeasureTarget | undefined {
  if (call.receiver?.kind !== 'identifier') return undefined;
  const identifier = call.receiver.text;
  const asset = assets.find((candidate) => candidate.identifier === identifier)
    ?? (assets.length === 1 ? assets[0] : undefined);
  return asset === undefined ? undefined : { identifier, asset };
}

// A Measure called with an argument off its grid answers an empty series, as one with no data in
// the window does (live, 2026-10-28: `SPX.implied_volatility(13w, forward, 100)`, `US.cai(FOO)`),
// so its signature shows where it lists the values to check the arguments against.
async function emptySeriesExplanation(context: ExplanationSources, series: EmptySeries): Promise<string[]> {
  const [call] = expressionCalls(series.expression);
  if (call?.receiver?.kind !== 'identifier' || (call.arguments ?? []).length === 0) return [];
  const identifier = call.receiver.text;
  const named = (await resolvedMeasures(context, series, call, identifier)).filter((measure) => measure.name === call.name);
  const gridded = named.some((measure) => measure.parameters.some((parameter) => parameter.allowedValues.length > 0));
  return gridded ? signatures(named, identifier) : [];
}

// The Measures of the Entity a method was called on, as `data view` lists them: a Country's or
// other Entity's own, by the id as written, or those that apply to an asset.
async function resolvedMeasures(
  context: ExplanationSources,
  series: EmptySeries,
  call: ExpressionCall,
  identifier: string,
): Promise<readonly AssetMeasure[]> {
  if (series.entityIds.includes(identifier)) {
    return fetchedValue(`PlotTool Pro measure lookup for ${identifier}`, await context.measures(identifier));
  }
  const target = measureTarget(series, call);
  return target === undefined ? [] : assetMeasures(context, target);
}

async function assetMeasures(context: ExplanationSources, { identifier, asset }: MeasureTarget): Promise<readonly AssetMeasure[]> {
  const found = fetchedValue(`PlotTool Pro measure lookup for ${identifier}`, await context.measures(asset.assetId));
  return found.filter((measure) => appliesTo(measure, asset)).map((measure) => forAsset(measure, asset));
}

// Each distinct signature once, written on the identifier.
function signatures(measures: readonly AssetMeasure[], identifier: string): string[] {
  return [...new Set(measures.map((measure) => signatureLines(measure, `${identifier}.`).join('\n')))]
    .flatMap((lines) => lines.split('\n'));
}

async function nearestAssets(context: ExplanationSources, identifier: string): Promise<string[]> {
  const found = fetchedValue(`PlotTool Pro asset search for ${identifier}`, await context.nearestAssets(identifier));
  if (found.length === 0) return [`No assets match ${identifier}`];
  return [
    `Nearest assets to ${identifier}:`,
    ...found.map((asset) => `  ${asset.identifier} (${[asset.name, asset.type].filter(Boolean).join(', ')})`),
  ];
}

// The runner resolves no Entity when it rejects a name's casing (live, 2026-10-25), so the
// asset is looked up by its id, as `data view` looks it up.
async function casingExplanation(context: ExplanationSources, identifier: string, name: string): Promise<string[]> {
  const lookup = fetchedValue(`Marquee asset lookup for ${identifier}`, await context.asset(identifier));
  return lookup.kind === 'found' ? measureExplanation(context, { identifier, asset: lookup.asset }, name) : [];
}

async function measureExplanation(context: ExplanationSources, target: MeasureTarget, name: string): Promise<string[]> {
  const { identifier } = target;
  const applicable = await assetMeasures(context, target);
  if (applicable.length === 0) return [`${identifier} has no PlotTool Pro measures`];
  const named = signatures(applicable.filter((measure) => measure.name === name), identifier);
  if (named.length > 0) return named;
  const snakeCase = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const words = snakeCase.split('_');
  const names = [...new Set(applicable.map((measure) => measure.name))].sort();
  if (snakeCase !== name && names.includes(snakeCase)) return [`${identifier} has no measure ${name}; did you mean ${snakeCase}?`];
  const similar = names
    .filter((measure) => measure.split('_').some((word) => words.includes(word)))
    .sort((left, right) => distance(left, snakeCase) - distance(right, snakeCase));
  if (similar.length > 0) {
    return [`${identifier} has no measure ${name}; measures named like it: ${listed(similar, NEAREST_MEASURES, identifier)}`];
  }
  return [`${identifier} has no measure ${name}; its measures: ${listed(names, LISTED_MEASURES, identifier)}`];
}

// The first `count` names, then how many more the Entity's view lists.
function listed(names: readonly string[], count: number, identifier: string): string {
  const rest = names.length - count;
  return `${names.slice(0, count).join(', ')}${rest > 0 ? ` and ${rest} more: ${dataCommand('view', identifier)}` : ''}`;
}
