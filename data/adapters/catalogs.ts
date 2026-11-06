import { EntityApi } from '../../api/entity/index.js';
import { PlotToolApi } from '../../api/plottool/index.js';
import type { PlotToolResolvedAsset } from '../../plottool/index.js';
import { MarqueeError, type Transport } from '../../transport/index.js';
import type { AssetMatch, CatalogFetchFailure, CatalogOutcome } from '../catalog.js';
import type {
  AssetMeasure,
  ClassRefused,
  DataClassMatch,
  CatalogAllowedValues,
  CatalogFunction,
  CatalogParameter,
  FunctionLibrary,
  LibraryFunction,
  QuickstartFolderExample,
  QuickstartFolders,
  QuickstartFailedFolder,
} from '../types.js';
import { ENTITY_CLASSES, entitiesQuery, entityClassRows, viewLimits } from './asset.js';

type Request = Transport['request'];
type Fields = Readonly<Record<string, unknown>>;

/** How many assets an unresolved identifier's explanation names. */
const NEAREST_ASSETS = 5;

/* c8 ignore start -- Recording-unreachable: every recorded catalog decodes; focused malformed-catalog tests pin the typed failure. */
class CatalogDecodeError extends Error {
  constructor(readonly location: string, readonly problem: string) {
    super(`${location}: ${problem}`);
  }
}
/* c8 ignore stop */

/** PlotTool Pro's function library: Functions, then Classes, each with its methods. */
export function fetchFunctionLibrary(request: Request): Promise<CatalogOutcome<FunctionLibrary>> {
  return fetched(async () => {
    const library = fields(await new PlotToolApi({ request }).getFunctions(), 'response');
    return {
      functions: [
        ...items(library.results, 'results').map((entry, index) => libraryFunction(entry, `results[${index}]`, 'function')),
        ...items(library.classes, 'classes').map((entry, index) => libraryFunction(entry, `classes[${index}]`, 'class')),
      ],
    };
  });
}

/**
 * Web's Quickstart folders with their examples, from the same one request. Each top collection
 * holds folders, each folder charts (live 2026-10-23). The top collection `Quickstart` repeats
 * most other collections' folders under the same ids, so a folder held by several collections
 * is kept only under the one holding the fewest folders. A folder answered as `{id, httpStatus}`
 * fails alone (ADR 0030).
 */
export function fetchQuickstartFolders(request: Request): Promise<CatalogOutcome<QuickstartFolders>> {
  return fetched(async () => {
    const body = fields(await new PlotToolApi({ request }).getQuickstartCollections(), 'response');
    const collections = items(body.results, 'results')
      .map((entry, index) => quickstartCollection(entry, `results[${index}]`));
    const home = new Map<string, QuickstartCollection>();
    for (const collection of collections) {
      for (const { folderId } of collection.folders) {
        const current = home.get(folderId);
        if (current === undefined || collection.folders.length < current.folders.length) home.set(folderId, collection);
      }
    }
    return {
      folders: collections.flatMap((collection) => collection.folders
        .filter(({ folderId }) => home.get(folderId) === collection)
        .map(({ folder, examples }) => ({ collection: collection.name, folder, examples }))),
      failedFolders: collections.flatMap(({ failedFolders }) => failedFolders),
    };
  });
}

/**
 * The measures one Entity carries, with their parameters and allowed values: an asset by its
 * Marquee id, any other Entity by its bare id, whose type availability determines itself.
 */
export function fetchEntityMeasures(
  request: Request,
  entityId: string,
): Promise<CatalogOutcome<readonly AssetMeasure[]>> {
  return fetched(async () => (
    items(fields(await new PlotToolApi({ request }).getAvailability(entityId), 'response').measures, 'measures')
      .map((entry, index) => assetMeasure(entry, `measures[${index}]`))
  ));
}

export type EntityMatches = Readonly<{ rows: readonly DataClassMatch[]; entities: readonly DataClassMatch[]; refusals: readonly ClassRefused[] }>;

/** What the bare-word search finds: each Class's rows in Class order, every Class's but Asset's, and each Class Marquee refused. */
export function fetchEntityMatches(request: Request, query: string): Promise<CatalogOutcome<EntityMatches>> {
  return fetched(async () => {
    const limits = viewLimits(query);
    const body = await new EntityApi({ request }).searchEntities(entitiesQuery(query, limits));
    const refusals: ClassRefused[] = [];
    const rows = ENTITY_CLASSES.filter((each) => each in limits).flatMap((each) => {
      const read = entityClassRows(body, each);
      if (read.ok) return read.rows;
      /* c8 ignore next -- Recording-unreachable: every recorded entity search decodes; focused data view tests pin the typed failure. */
      if (read.error.kind === 'malformed-results') return invalid(read.error.location, read.error.problem);
      refusals.push(read.error);
      return [];
    });
    return { rows, entities: rows.filter((row) => row.class !== 'Asset'), refusals };
  });
}

/** The assets PlotTool Pro's asset search ranks nearest to a query. */
export function fetchNearestAssets(
  request: Request,
  query: string,
): Promise<CatalogOutcome<readonly AssetMatch[]>> {
  return fetched(async () => {
    const body = await new EntityApi({ request }).searchEntities({
      asset: { q: query, limit: NEAREST_ASSETS, fields: ['id', 'bbid', 'name', 'type'] },
    });
    return items(fields(fields(body, 'response').assets, 'assets').results, 'assets.results')
      .map((entry, index) => assetMatch(entry, `assets.results[${index}]`));
  });
}

/**
 * What `/v1/assets/data` found for an identifier: one asset, none, or several sharing it, and
 * whether by Marquee id, Bloomberg ID or name.
 */
export type AssetLookup =
  | Readonly<{ kind: 'found'; by: AssetKey; asset: PlotToolResolvedAsset }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'ambiguous'; by: AssetKey; total: number; assets: readonly PlotToolResolvedAsset[] }>;

type AssetKey = 'id' | 'bbid' | 'name';

const ASSET_FIELDS = ['id', 'bbid', 'name', 'type', 'assetClass'];
// `/v1/assets/data` answers 400 for an `id` outside this pattern, such as `AAPL UW` (live, 2026-10-23).
const MARQUEE_ID = /^[\w.-]{0,256}$/;

/**
 * The asset an Expression's bare id names: by Marquee id, then Bloomberg ID, then name, as
 * PlotTool Web resolves a typed token (memo 0047 §1). The lookups go out at once.
 */
export function fetchAssetByIdentifier(
  request: Request,
  identifier: string,
): Promise<CatalogOutcome<AssetLookup>> {
  return fetched(async (): Promise<AssetLookup> => {
    const api = new EntityApi({ request });
    const keys: readonly AssetKey[] = MARQUEE_ID.test(identifier) ? ['id', 'bbid', 'name'] : ['bbid', 'name'];
    const answers = await Promise.all(keys.map(async (key) => ({
      by: key,
      body: fields(await api.getAssetsBy({ key, identifier, fields: ASSET_FIELDS }), 'response'),
    })));
    const answer = answers.find(({ body }) => items(body.results, 'results').length > 0);
    if (answer === undefined) return { kind: 'none' };
    const { by, body } = answer;
    const assets = items(body.results, 'results').map((entry, index) => resolvedAsset(entry, `results[${index}]`));
    const [only] = assets;
    if (assets.length === 1 && only !== undefined) return { kind: 'found', by, asset: only };
    return { kind: 'ambiguous', by, total: count(body.totalResults, 'totalResults'), assets };
  });
}

/** The measures of the dataset with this id, or undefined when no dataset has it. */
export function fetchDatasetMeasures(
  request: Request,
  datasetId: string,
): Promise<CatalogOutcome<readonly AssetMeasure[] | undefined>> {
  return fetched(async () => {
    let body: unknown;
    try {
      body = await new PlotToolApi({ request }).getAvailability(datasetId, 'dataset');
    } catch (error) {
      // An unknown id answers `404 DataSetEntity not found` (live, 2026-10-23).
      if (error instanceof MarqueeError && error.details?.status === 404) return undefined;
      throw error;
    }
    return items(fields(body, 'response').measures, 'measures')
      .map((entry, index) => assetMeasure(entry, `measures[${index}]`));
  });
}

// An asset as an Expression names it: by Bloomberg ID, or by its Marquee id when it has none.
function resolvedAsset(entry: unknown, path: string): PlotToolResolvedAsset {
  const asset = fields(entry, path);
  const assetId = text(asset.id, `${path}.id`);
  return {
    /* c8 ignore next -- Recording-unreachable: every recorded asset has a Bloomberg ID. */
    identifier: asset.bbid === undefined ? assetId : text(asset.bbid, `${path}.bbid`),
    assetId,
    name: text(asset.name, `${path}.name`),
    assetClass: text(asset.assetClass, `${path}.assetClass`),
    assetType: text(asset.type, `${path}.type`),
  };
}

async function fetched<T>(fetch: () => Promise<T>): Promise<CatalogOutcome<T>> {
  try {
    return { ok: true, value: await fetch() };
  } catch (error) {
    if (error instanceof MarqueeError) return { ok: false, error: fetchFailure(error) };
    /* c8 ignore start -- Recording-unreachable: every recorded catalog decodes; focused data search, list and view tests pin the typed failure and that a defect propagates. */
    if (error instanceof CatalogDecodeError) {
      return { ok: false, error: { kind: 'malformed-catalog', location: error.location, problem: error.problem } };
    }
    throw error;
  }
  /* c8 ignore stop */
}

function fetchFailure(error: MarqueeError): CatalogFetchFailure {
  return {
    kind: 'catalog-unavailable',
    /* c8 ignore next -- Recording-unreachable: no recorded catalog answers 403; focused data search, list and view tests pin access denied. */
    ...(error.details?.status === 403 ? { reason: 'access-denied' as const } : {}),
    failure: error.dependencyFailure(),
  };
}

function libraryFunction(entry: unknown, path: string, kind: LibraryFunction['kind']): LibraryFunction {
  return { ...catalogFunction(entry, path), kind, group: text(fields(entry, path).group, `${path}.group`) };
}

type QuickstartCollection = Readonly<{
  name: string;
  folders: readonly Readonly<{ folderId: string; folder: string; examples: readonly QuickstartFolderExample[] }>[];
  failedFolders: readonly QuickstartFailedFolder[];
}>;

function quickstartCollection(entry: unknown, path: string): QuickstartCollection {
  const collection = fields(entry, path);
  const name = text(collection.name, `${path}.name`);
  const folders: QuickstartCollection['folders'][number][] = [];
  const failedFolders: QuickstartFailedFolder[] = [];
  items(collection.entities, `${path}.entities`).forEach((child, index) => {
    const folderPath = `${path}.entities[${index}]`;
    const folder = fields(child, folderPath);
    const folderId = text(folder.id, `${folderPath}.id`);
    if (folder.httpStatus !== undefined) {
      failedFolders.push({ collection: name, folderId, status: count(folder.httpStatus, `${folderPath}.httpStatus`) });
      return;
    }
    folders.push({
      folderId,
      folder: text(folder.name, `${folderPath}.name`),
      examples: items(folder.entities, `${folderPath}.entities`).flatMap((chart, chartIndex) => {
        const example = chartExample(chart, `${folderPath}.entities[${chartIndex}]`);
        return example === undefined ? [] : [example.example];
      }),
    });
  });
  return { name, folders, failedFolders };
}

// A chart without Expressions has nothing to show (two `Untitled` charts, live 2026-10-16).
// The runner rejects a `#` comment (`No terminal matches '#'`, live 2026-10-16), so each line
// keeps only what precedes its first `#`, as Widget's runner request does.
function chartExample(
  entry: unknown,
  path: string,
): Readonly<{ id: string; example: QuickstartFolderExample }> | undefined {
  const chart = fields(entry, path);
  const description = chart.description === undefined ? '' : text(chart.description, `${path}.description`);
  const expressions = description.split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line !== '');
  if (expressions.length === 0) return undefined;
  return {
    id: text(chart.id, `${path}.id`),
    example: { title: text(chart.name, `${path}.name`).trim(), expressions },
  };
}

// A description's first sentence, before its reStructuredText sections (`**Usage**`). A sentence
// ends at a full stop after a parenthesis or a word of three or more letters, so `St. Louis` and
// `e.g.` do not end one.
function summary(description: string): string {
  const lead = description.replace(/ \*\*[\s\S]*/, '');
  const end = /(?<=[a-z]{3}|\))\.\s+(?=[A-Z0-9])/.exec(lead);
  return (end === null ? lead : lead.slice(0, end.index)).trim().replace(/\.$/, '');
}

function count(value: unknown, path: string): number {
  /* c8 ignore next -- Recording-unreachable: every recorded count (an asset total, a Quickstart folder's HTTP status) is a whole number; a focused data search test pins the typed failure. */
  if (typeof value !== 'number' || !Number.isInteger(value)) invalid(path, 'expected a whole number');
  return value;
}

// Every recorded function, constructor, measure and method has a description and a `returns`
// object (2026-10-16); a method's `returns` lists its own methods when it has any.
function catalogFunction(entry: unknown, path: string): CatalogFunction & Readonly<{ summary: string }> {
  const { name, parameters, returns, description } = fields(entry, path);
  const { methods } = fields(returns, `${path}.returns`);
  return {
    name: text(name, `${path}.name`),
    parameters: items(parameters, `${path}.parameters`)
      .map((parameter, index) => catalogParameter(parameter, `${path}.parameters[${index}]`, [])),
    methods: methods === undefined
      ? []
      : items(methods, `${path}.returns.methods`)
        .map((method, index) => catalogFunction(method, `${path}.returns.methods[${index}]`)),
    summary: summary(text(description, `${path}.description`)),
  };
}

// A parameter's own `values`, or else the values its measure's autocomplete offers.
function catalogParameter(
  entry: unknown,
  path: string,
  suggestions: readonly CatalogParameter[],
): CatalogParameter {
  const parameter = fields(entry, path);
  const name = text(parameter.name, `${path}.name`);
  const suggested = suggestions.find((suggestion) => suggestion.name === name);
  const allowed = parameter.values === undefined
    ? suggested?.allowedValues ?? []
    : allowedValues(parameter.values, `${path}.values`);
  const defaultValue = valueText(parameter.default) ?? suggested?.default;
  return {
    name,
    isVariadic: parameter.variadic === true,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    allowedValues: allowed,
    ...(typeof parameter.description === 'string' ? { description: parameter.description } : {}),
  };
}

function assetMeasure(entry: unknown, path: string): AssetMeasure {
  const measure = fields(entry, path);
  const suggestions = measure.autocomplete === undefined
    ? []
    : items(measure.autocomplete, `${path}.autocomplete`)
      .map((suggestion, index) => catalogParameter(suggestion, `${path}.autocomplete[${index}]`, []));
  const parameters = measure.parameters === undefined
    ? suggestions
    : items(measure.parameters, `${path}.parameters`)
      .map((parameter, index) => catalogParameter(parameter, `${path}.parameters[${index}]`, suggestions));
  // Every recorded asset measure restricts its asset classes, has a description and names its
  // datasets (2026-10-16); some name no asset types. A dataset's measures restrict nothing (2026-10-23),
  // and some name no vendor (live: `Dataset(US_ELECTIONS_2024_ALPHAROC)`, 2026-10-28).
  const restrictions: Fields = measure.restrictions === undefined ? {} : fields(measure.restrictions, `${path}.restrictions`);
  const vendors = items(measure.datasets, `${path}.datasets`).flatMap((dataset, index) => {
    const { vendor } = fields(dataset, `${path}.datasets[${index}]`);
    return vendor === undefined ? [] : [text(vendor, `${path}.datasets[${index}].vendor`)];
  });
  return {
    name: text(measure.name, `${path}.name`),
    parameters,
    methods: [],
    summary: summary(text(measure.description, `${path}.description`)),
    ...(restrictions.asset_class === undefined
      ? {}
      : { assetClasses: textList(restrictions.asset_class, `${path}.restrictions.asset_class`) }),
    ...(restrictions.asset_type === undefined
      ? {}
      : { assetTypes: textList(restrictions.asset_type, `${path}.restrictions.asset_type`) }),
    vendors: [...new Set(vendors)],
    ...(measure.frequency === undefined ? {} : { frequency: text(measure.frequency, `${path}.frequency`) }),
  };
}

// Every recorded nearest asset has a type (2026-10-16).
function assetMatch(entry: unknown, path: string): AssetMatch {
  const asset = fields(entry, path);
  /* c8 ignore next -- Recording-unreachable: every recorded nearest asset has a Bloomberg ID; a focused data view test pins the Marquee id fallback. */
  const identifier = typeof asset.bbid === 'string' ? asset.bbid : text(asset.id, `${path}.id`);
  return { identifier, name: text(asset.name, `${path}.name`), type: text(asset.type, `${path}.type`) };
}

// Plain values form one set; conditional ones (`{conditions, default, allowed}`) one set each.
// JSON's other values (text, numbers, true and false) are each a plain value.
function allowedValues(value: unknown, path: string): readonly CatalogAllowedValues[] {
  const entries = items(value, path, true);
  const values = entries.map(valueText).filter((entry) => entry !== undefined);
  const conditional = entries.flatMap((entry, index) => (
    typeof entry === 'object' ? [conditionalValues(entry, `${path}[${index}]`)] : []
  ));
  return [...(values.length === 0 ? [] : [{ values }]), ...conditional];
}

// A condition holds one value or any of several; `allowed` is absent when only a default is known.
// A set without `conditions` always holds (EUR's `swaption_vol_term` clearing house, live 2026-10-16).
function conditionalValues(entry: unknown, path: string): CatalogAllowedValues {
  const { conditions, allowed } = fields(entry, path);
  const defaultValue = valueText(fields(entry, path).default);
  return {
    ...(conditions === undefined ? {} : {
      conditions: Object.fromEntries(Object.entries(fields(conditions, `${path}.conditions`))
        .map(([name, value]) => [name, conditionValues(value, `${path}.conditions.${name}`)])),
    }),
    values: allowed === undefined ? [] : valueTexts(allowed, `${path}.allowed`),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  };
}

function conditionValues(value: unknown, path: string): readonly string[] {
  const single = valueText(value);
  if (single !== undefined) return [single];
  return valueTexts(value, path);
}

function valueTexts(value: unknown, path: string): readonly string[] {
  return items(value, path, true).map((entry, index) => (
    /* c8 ignore next -- Recording-unreachable: every recorded allowed value is plain; a focused data view test pins the typed failure. */
    valueText(entry) ?? invalid(`${path}[${index}]`, 'expected a value')
  ));
}

// A default or allowed value as an Expression writes it; JSON's `false` is PlotTool's `false`.
function valueText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

// One text or a list of them, as a measure's restrictions give either.
function textList(value: unknown, path: string): readonly string[] {
  if (typeof value === 'string') return [value];
  return items(value, path, true).map((entry, index) => text(entry, `${path}[${index}]`));
}

function fields(value: unknown, path: string): Fields {
  /* c8 ignore next -- Recording-unreachable: every recorded catalog decodes; a focused malformed-catalog test pins the typed failure. */
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path, 'expected an object');
  return value as Fields;
}

function items(value: unknown, path: string, isAnyItem = false): readonly unknown[] {
  /* c8 ignore next -- Recording-unreachable: every recorded catalog decodes; a focused malformed-catalog test pins the typed failure. */
  if (!Array.isArray(value)) invalid(path, 'expected an array');
  const list = value as readonly unknown[];
  return isAnyItem ? list : list.map((entry, index) => fields(entry, `${path}[${index}]`));
}

function text(value: unknown, path: string): string {
  /* c8 ignore next -- Recording-unreachable: every recorded catalog decodes; a focused malformed-catalog test pins the typed failure. */
  if (typeof value !== 'string') invalid(path, 'expected text');
  return value;
}

/* c8 ignore start -- Recording-unreachable: every recorded catalog decodes; focused malformed-catalog tests pin the typed failure. */
function invalid(location: string, problem: string): never {
  throw new CatalogDecodeError(location, problem);
}
/* c8 ignore stop */
