export type Entity =
  | Asset
  | Country
  | Portfolio;

type EntityBase = {
  entityId: string;
  label: string;
  aliases: readonly string[];
};

export type Asset = EntityBase & {
  kind: 'asset';
  assetClass?: string;
  assetType?: string;
  ticker?: string;
  bbid?: string;
  exchange?: string;
  currency?: string;
};

export type Country = EntityBase & {
  kind: 'country';
  region?: string;
  subRegion?: string;
};

export type Portfolio = EntityBase & {
  kind: 'portfolio';
  currency?: string;
};

export type EntityIdentifier = {
  kind: Entity['kind'];
  value: string;
};

export type EntityResolveInput = EntityIdentifier;

export type EntityNotFound = EntityResolveInput & {
  status: 'not-found';
};

export type ResolvedEntityValue = Entity;

export type EntityResolveValue = ResolvedEntityValue | EntityNotFound;

type EntityDependencyFailure =
  | { kind: 'authentication-required'; realm: 'marquee' | 'research' }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };

export type EntityError =
  | { kind: 'invalid-identifier'; identifier: EntityResolveInput }
  | { kind: 'not-found'; identifier: EntityResolveInput }
  | { kind: 'malformed-entity'; identifier?: EntityResolveInput | undefined }
  | { kind: 'access-denied'; identifier?: EntityResolveInput | undefined }
  | {
      kind: 'dependency';
      failure: EntityDependencyFailure;
      identifier?: EntityResolveInput;
    };

export type EntityResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EntityError };

export type EntityMatch = {
  entityId: string;
  display: string;
  aliases: readonly string[];
};

export interface EntityModule {
  resolveCanonicalIdentity(value: string): string;
  resolveIsUnresolvedIdentifier(
    value: unknown,
    knownLabels: Readonly<Record<string, string>>,
  ): boolean;
  resolveSourceLabels(values: readonly unknown[]): string[];
  resolveIsAssetCode(value: unknown): boolean;
  resolveIsMarketCode(value: unknown): boolean;
  resolveDisplayKey(value: unknown, entityMap: Readonly<Record<string, string>>): string;
  resolveDeduplicatedValues(
    values: readonly unknown[],
    entityMap: Readonly<Record<string, string>>,
  ): unknown[];
  resolveSelectedValues(
    values: readonly unknown[],
    entityMap: Readonly<Record<string, string>>,
    limit?: number,
  ): unknown[];
  resolveIdentity(identifier: EntityIdentifier): Promise<EntityResult<Entity | null>>;
  resolve(inputs: readonly EntityResolveInput[]): Promise<EntityResult<readonly EntityResolveValue[]>>;
  resolveMatches(
    identifiers: readonly string[],
    query?: string,
    limit?: number,
  ): Promise<EntityResult<readonly EntityMatch[]>>;
}

export type EntityModuleOptions = Readonly<{
  cache?: false | Readonly<{
    dir?: string;
    session?: number | string;
    inactivityMs?: number;
    maxNamespaces?: number;
    now?: () => number;
  }>;
}>;
