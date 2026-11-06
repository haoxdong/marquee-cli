import type { Asset } from '../entity/index.js';
import type { ControlGroupExpansion, ControlGroupResult } from './types.js';

export interface ControlGroupAdapter {
  expand(
    controlGroupIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<ControlGroupResult<readonly ControlGroupExpansion[]>>;
  match(
    controlGroupIds: readonly string[],
    query: string | undefined,
    limit: number,
  ): Promise<ControlGroupResult<readonly Asset[]>>;
}
