import type { Result } from '../lib/result.js';
import type { PlotToolResolvedAsset } from '../plottool/index.js';
import type {
  AssetMeasure,
  DataCatalogCacheFailure,
  DataCatalogFailure,
  FunctionLibrary,
  LibraryFunction,
} from './types.js';

/** An asset an asset search found. */
export type AssetMatch = Readonly<{
  /** The Bloomberg ID, or the Marquee id when the asset has none. */
  identifier: string;
  name: string;
  type?: string;
}>;

/** A catalog request that did not answer, or answered in a shape it does not describe. */
export type CatalogFetchFailure = Exclude<DataCatalogFailure, DataCatalogCacheFailure>;

export type CatalogOutcome<T> = Result<T, CatalogFetchFailure>;

export function findFunction(library: FunctionLibrary, name: string): LibraryFunction | undefined {
  return library.functions.find((entry) => entry.name === name);
}

// The measure with only the allowed values its conditions give this asset.
export function forAsset(measure: AssetMeasure, asset: PlotToolResolvedAsset): AssetMeasure {
  const properties: Readonly<Record<string, string | undefined>> = {
    assetClass: asset.assetClass,
    type: asset.assetType,
    assetId: asset.assetId,
  };
  const known = (name: string): boolean => properties[name] !== undefined;
  return {
    ...measure,
    parameters: measure.parameters.map((parameter) => ({
      ...parameter,
      allowedValues: parameter.allowedValues
        .filter(({ conditions = {} }) => Object.entries(conditions)
          .every(([name, values]) => !known(name) || values.includes(properties[name] ?? '')))
        .map(({ conditions, ...allowed }) => {
          const rest = Object.entries(conditions ?? {}).filter(([name]) => !known(name));
          return rest.length === 0 ? allowed : { ...allowed, conditions: Object.fromEntries(rest) };
        }),
    })),
  };
}

/** Whether the measure's restrictions admit the asset; an unknown class or type admits it. */
export function appliesTo(measure: AssetMeasure, asset: PlotToolResolvedAsset): boolean {
  return includes(measure.assetClasses, asset.assetClass) && includes(measure.assetTypes, asset.assetType);
}

function includes(allowed: readonly string[] | undefined, value: string | undefined): boolean {
  return allowed === undefined || value === undefined || allowed.includes(value);
}
