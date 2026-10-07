import type { Asset } from '../entity/index.js';
import type { InteractionSessionNamespaceOptions } from '../artifact-registry/index.js';

type ControlGroupDependencyFailure =
  | { kind: 'authentication-required'; realm: 'marquee' }
  | { kind: 'rate-limited' }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };

export type ControlGroupError =
  | {
      kind: 'malformed-member';
      controlGroupIds: readonly string[];
      problem: 'invalid-response' | 'incomplete-expansion';
    }
  | {
      kind: 'access-denied';
      controlGroupIds: readonly string[];
    }
  | {
      kind: 'dependency';
      controlGroupIds: readonly string[];
      failure: ControlGroupDependencyFailure;
    };

export type ControlGroupResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ControlGroupError };

export type ControlGroupExpansion = Readonly<{
  controlGroupId: string;
  members: readonly Asset[];
}>;

export interface ControlGroupModule {
  expand(
    controlGroupIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<ControlGroupResult<readonly ControlGroupExpansion[]>>;
  match(
    controlGroupIds: readonly string[],
    query?: string,
    limit?: number,
  ): Promise<ControlGroupResult<readonly Asset[]>>;
}

export type ControlGroupModuleOptions = Readonly<{
  cache?: false | InteractionSessionNamespaceOptions;
}>;
