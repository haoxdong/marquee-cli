import type { Tagged } from 'type-fest';

// The same tags as the Widget module's identifiers (ADR 0074). The registry sits below
// that module, so it names the tags instead of importing the types.
type WidgetId = Tagged<string, 'WidgetId'>;
type ConfigId = Tagged<string, 'ConfigId'>;

/** The stored name of an Artifact instance, without its `@`: `w1`, `s1.w2`. */
export type Ref = Tagged<string, 'Ref'>;

export type InteractionSessionNamespaceOptions = Readonly<{
  dir?: string;
  session?: number | string | NodeJS.ProcessEnv;
  inactivityMs?: number;
  maxNamespaces?: number;
  now?: () => number;
}>;

export interface InteractionSessionNamespace<T> {
  read(): T | undefined;
  update(updater: (current: T | undefined) => T): T;
}

export type ArtifactRef =
  | Readonly<{ type: 'search'; searchKind: 'market-data' | 'research' }>
  | Readonly<{
      type: 'widget';
      widgetId: WidgetId;
      configurationId?: ConfigId;
      selectedContext?: string;
      dashboardId?: never;
      childId?: never;
    }>
  | {
      readonly type: 'widget';
      readonly widgetId: WidgetId;
      readonly configurationId?: ConfigId;
      readonly selectedContext?: string;
      readonly dashboardId: string;
      readonly childId: string;
    }
  | Readonly<{ type: 'dashboard'; dashboardId: string }>
  | Readonly<{
      type: 'entity-feed';
      entityId: string;
      entityKind: 'asset' | 'country' | 'portfolio';
    }>
  | Readonly<{ type: 'section'; dashboardId: string; sectionId: string }>
  | Readonly<{ type: 'document'; documentId: string; realm: 'markets' | 'research' }>;

export type ArtifactIdentity =
  | { family: 'search'; searchKind: 'market-data' | 'research' }
  | {
      family: 'widget';
      widgetId: string;
      configurationId?: string;
      selectedContext?: string;
    }
  | { family: 'dashboard'; dashboardId: string }
  | {
      family: 'entity-feed';
      entityId: string;
      entityKind: 'asset' | 'country' | 'portfolio';
    }
  | { family: 'section'; dashboardId: string; sectionId: string }
  | { family: 'document'; documentId: string; realm: 'markets' | 'research' };

export interface ArtifactMembership {
  ancestors: string[];
  dashboardId?: string;
  dashboardChildId?: string;
}

export interface StoredArtifact {
  ref: ArtifactRef;
  identity: ArtifactIdentity;
  membership: ArtifactMembership;
}

export interface PaginatedCursor {
  page: number;
  pageSize: number;
  total: number;
}

export interface RegistryArtifactInput {
  namespace: string;
  root: ArtifactRef;
  refs?: Record<string, ArtifactRef>;
  payload: unknown;
}

export interface RegistryArtifact {
  namespace: string;
  root: ArtifactRef;
  refs: Record<string, ArtifactRef>;
  payload: unknown;
}

export interface RegistryArtifactHandle extends RegistryArtifact {
  childRef(name: string): Ref;
}

export type ArtifactResolution =
  | { ok: true; cleanRef: string; ref: ArtifactRef }
  | { ok: false; cleanRef: string; message: string };

export interface ArtifactRegistry {
  claimSearch(): Ref;
  claimWidget(): Ref;
  claimDashboard(): Ref;
  claimContent(): Ref;
  setRefs(namespace: string, refs: Record<string, ArtifactRef>): void;
  updateRefs(
    refNames: readonly string[],
    updater: (refs: Readonly<Record<string, ArtifactRef | undefined>>) => Record<string, ArtifactRef>,
  ): void;
  resolveRef(name: Ref): ArtifactRef | undefined;
  resolveArtifact(name: Ref): StoredArtifact | undefined;
  getAllRefs(): Record<string, ArtifactRef>;
  setPayload(namespace: string, payload: unknown): void;
  updatePayload(namespace: string, updater: (payload: unknown) => unknown): unknown;
  getPayload(namespace: string): unknown;
  storeArtifact(input: RegistryArtifactInput): RegistryArtifactHandle;
  getArtifact(namespace: string): RegistryArtifact | undefined;
  refName(name: string): Ref;
  resolve(name: string): ArtifactResolution;
  formatUnknownRef(
    cleanRef: string,
    options?: { prefix?: 'Error' | 'error' },
  ): string;
  clean(): void;
}
