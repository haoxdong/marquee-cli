import type { Transport } from '../transport/index.js';
import { createEntityCache } from './cache.js';
import { createEntityProductionAdapter } from './production-adapter.js';
import { assetFromAttributes as assetFrom } from './asset-attributes.js';
import {
  assembleEntityModule,
  isEntityNotFound as isNotFound,
  resolveEntitySourceLabels as sourceLabels,
} from './resolver.js';
import type {
  Asset,
  EntityNotFound,
  EntityResolveValue,
  EntityModule,
  EntityModuleOptions,
} from './types.js';
export type {
  Entity,
  Asset,
  EntityIdentifier,
  EntityResolveInput,
  EntityNotFound,
  EntityResolveValue,
  EntityError,
  EntityResult,
  EntityMatch,
  EntityModule,
  EntityModuleOptions,
} from './types.js';

/** The Asset that Marquee asset `attributes` describe under `entityId`; undefined without an id or label. */
export function assetFromAttributes(
  attributes: Record<string, unknown>,
  entityId: string | undefined,
): Asset | undefined {
  return assetFrom(attributes, entityId);
}

export function resolveEntitySourceLabels(values: readonly unknown[]): string[] {
  return sourceLabels(values);
}

export function isEntityNotFound(
  value: EntityResolveValue,
): value is EntityNotFound {
  return isNotFound(value);
}

export function createEntityModule(
  transport: Pick<Transport, 'request'>,
  options: EntityModuleOptions = {},
): EntityModule {
  const cache = options.cache === undefined || options.cache === false
    ? undefined
    : createEntityCache(options.cache);
  return assembleEntityModule(createEntityProductionAdapter(transport), cache);
}
