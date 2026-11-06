import { distance } from 'fastest-levenshtein';
import type { Transport } from '../transport/index.js';
import type { PlotToolResolvedAsset } from '../plottool/index.js';
import {
  fetchAssetByIdentifier,
  fetchDatasetMeasures,
  fetchEntityMatches,
  fetchEntityMeasures,
} from './adapters/catalogs.js';
import { appliesTo, findFunction, forAsset } from './catalog.js';
import { cachedFunctionLibrary } from './catalog-cache.js';
import { expressionCalls } from './expressions.js';
import type {
  AssetMeasure,
  DataCatalogFailure,
  DataViewEntry,
  DataViewError,
  DataViewInput,
  DataViewOutcome,
  DataViewSubject,
} from './types.js';

/** How many library names an unknown target's error names. */
const NEAREST = 5;

type ViewDependencies = Readonly<{
  request: Transport['request'];
  /** Where catalogs are cached between runs. */
  cacheDirectory: string;
}>;

/** A `Class(args)` cell: the Class's name and each argument as written. */
type ClassCell = Readonly<{ name: string; arguments: readonly string[] }>;

const CELL_START = /^[A-Za-z_]\w*\s*\(/;

/**
 * One target in full (ADR 0084 §3). `Dataset(<id>)` shows the dataset's availability; any other
 * `Class(args)` cell, or a bare name, the library Class or Function from the Function library
 * cached for a day; a bare id no library entry has resolves as an Expression resolves it, to an
 * asset, Country, risk model or other Entity and its availability. Nothing with the target fails
 * with the nearest names.
 */
export async function viewData(
  { request, cacheDirectory }: ViewDependencies,
  now: Date,
  input: DataViewInput,
): Promise<DataViewOutcome> {
  const target = input.target.trim();
  if (target === '') return { ok: false, error: { kind: 'empty-target' } };
  const cell = classCell(target);
  const [datasetId] = cell?.name === 'Dataset' && cell.arguments.length === 1 ? cell.arguments : [];
  if (datasetId !== undefined) return viewDataset(request, datasetId.replace(/^"(.*)"$/, '$1'));
  const library = await cachedFunctionLibrary(request, cacheDirectory, now);
  if (!library.ok) return { ok: false, error: catalogError('library', library.error) };
  const name = cell?.name ?? target;
  const entry = findFunction(library.value, name);
  if (entry !== undefined) {
    return { ok: true, value: { kind: 'library', entry, ...(cell === undefined ? {} : { cell: target }) } };
  }
  const nearestNames = nearest(library.value.functions.map((candidate) => candidate.name), name);
  if (cell !== undefined) {
    return { ok: false, error: { kind: 'not-found', target: name, looked: 'class', nearestNames, nearestEntities: [], refusals: [] } };
  }
  return viewEntity(request, target, nearestNames);
}

function classCell(target: string): ClassCell | undefined {
  if (!CELL_START.test(target)) return undefined;
  const [call] = expressionCalls(target);
  return call === undefined ? undefined : { name: call.name, arguments: call.arguments ?? [] };
}

async function viewDataset(request: Transport['request'], datasetId: string): Promise<DataViewOutcome> {
  const measures = await fetchDatasetMeasures(request, datasetId);
  if (!measures.ok) return { ok: false, error: catalogError('dataset', measures.error) };
  if (measures.value === undefined) return { ok: false, error: { kind: 'dataset-not-found', datasetId } };
  return { ok: true, value: { kind: 'dataset', datasetId, measures: byName(measures.value) } };
}

// The Entity the id names, as the runner resolves a bare id: an asset by Marquee id or
// Bloomberg ID, then another Entity with exactly this id from Web's bare-word search (`US` is the
// Country though an asset is named `US`), then an asset by name. Nothing found names the
// first Entities that search finds, Class by Class, besides the near library names, and each
// Class Marquee refused, which may hold the id.
async function viewEntity(
  request: Transport['request'],
  target: string,
  nearestNames: readonly string[],
): Promise<DataViewOutcome> {
  const found = await fetchAssetByIdentifier(request, target);
  if (!found.ok) return { ok: false, error: catalogError('entity', found.error) };
  const lookup = found.value;
  if (lookup.kind === 'found' && lookup.by !== 'name') return viewAsset(request, lookup.asset);
  if (lookup.kind === 'ambiguous' && lookup.by !== 'name') return ambiguous(target, lookup);
  const matches = await fetchEntityMatches(request, target);
  if (!matches.ok) return { ok: false, error: catalogError('entity', matches.error) };
  const { rows, entities, refusals } = matches.value;
  const other = entities.find(({ classArgs }) => classArgs === target);
  if (other !== undefined) {
    return viewMeasures(request, other.classArgs, { identifier: other.classArgs, name: other.name, type: other.type });
  }
  if (lookup.kind === 'found') return viewAsset(request, lookup.asset);
  if (lookup.kind === 'ambiguous') return ambiguous(target, lookup);
  const nearestEntities = rows.slice(0, NEAREST).map(({ classArgs }) => classArgs);
  return { ok: false, error: { kind: 'not-found', target, looked: 'any', nearestNames, nearestEntities, refusals } };
}

// Each Entity by an id that resolves to it alone: its Bloomberg ID, or its Marquee id when
// another of them shares that Bloomberg ID (`XAU` is both gold and an equity index).
function ambiguous(
  target: string,
  { total, assets }: Readonly<{ total: number; assets: readonly PlotToolResolvedAsset[] }>,
): DataViewOutcome {
  const entities = assets.map((asset) => ({
    id: assets.filter(({ identifier }) => identifier === asset.identifier).length === 1 ? asset.identifier : asset.assetId,
    name: asset.name,
    type: `${asset.assetType}; ${asset.assetClass}`,
  }));
  return { ok: false, error: { kind: 'ambiguous-entity', target, total, entities } };
}

async function viewAsset(request: Transport['request'], asset: PlotToolResolvedAsset): Promise<DataViewOutcome> {
  const { identifier, name, assetType, assetClass } = asset;
  return viewMeasures(request, asset.assetId, { identifier, name, type: assetType, assetClass }, (measures) => (
    measures.filter((measure) => appliesTo(measure, asset)).map((measure) => forAsset(measure, asset))
  ));
}

// An Entity and the Measures of its availability; a Country's, risk model's or other non-asset
// Entity's, by its bare id, holds only its own.
async function viewMeasures(
  request: Transport['request'],
  availabilityId: string,
  entity: Extract<DataViewEntry, { kind: 'entity' }>['entity'],
  select: (measures: readonly AssetMeasure[]) => readonly AssetMeasure[] = (measures) => measures,
): Promise<DataViewOutcome> {
  const measures = await fetchEntityMeasures(request, availabilityId);
  if (!measures.ok) return { ok: false, error: catalogError('entity', measures.error) };
  return { ok: true, value: { kind: 'entity', entity, measures: byName(select(measures.value)) } };
}

function byName(measures: readonly AssetMeasure[]): readonly AssetMeasure[] {
  return [...measures].sort((left, right) => left.name.localeCompare(right.name));
}

function nearest(names: readonly string[], name: string): readonly string[] {
  const wanted = name.toLowerCase();
  const maxEdits = Math.max(2, Math.floor(wanted.length / 3));
  return names
    .map((candidate, order) => {
      const lower = candidate.toLowerCase();
      return { candidate, order, hasName: lower.includes(wanted), edits: distance(lower, wanted) };
    })
    .filter(({ hasName, edits }) => hasName || edits <= maxEdits)
    .sort((left, right) => left.edits - right.edits || left.order - right.order)
    .slice(0, NEAREST)
    .map(({ candidate }) => candidate);
}

function catalogError(subject: DataViewSubject, error: DataCatalogFailure): DataViewError {
  switch (error.kind) {
    case 'catalog-unavailable':
      return {
        kind: 'view-failed',
        subject,
        ...(error.reason === undefined ? {} : { reason: error.reason }),
        failure: error.failure,
      };
    case 'malformed-catalog':
      return { kind: 'malformed-results', subject, location: error.location, problem: error.problem };
    case 'catalog-cache-unreadable':
    case 'catalog-cache-unwritable':
      return error;
  }
}
