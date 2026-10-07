import type {
  Entity,
  EntityResolveValue,
  EntityResolveInput,
  EntityResult,
} from './types.js';

export type EntityAdapterResolution = Readonly<{
  resolutions: readonly EntityResolveValue[];
  discoveredEntities: readonly Entity[];
}>;

export interface EntityAdapter {
  batchKey(input: EntityResolveInput, pending: readonly EntityResolveInput[]): string;
  maxBatchSize(input: EntityResolveInput): number;
  resolve(
    inputs: readonly EntityResolveInput[],
    options?: { purpose?: 'identity' },
  ): Promise<EntityResult<EntityAdapterResolution>>;
  resolveMatches(
    identifiers: readonly string[],
    query: string | undefined,
    limit: number,
  ): Promise<EntityResult<readonly Entity[]>>;
}
