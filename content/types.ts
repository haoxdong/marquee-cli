import type { ArtifactRef, ArtifactRegistry } from '../artifact-registry/index.js';
import type {
  Document,
  DocumentError,
  DocumentModule,
} from '../document/index.js';
import type {
  CONTENT_FACETS as CONTENT_SEARCH_FACETS,
  createContentSearch,
  ContentSearch,
  ContentSearchPage,
} from './search/index.js';

type ContentSearchError = Extract<
  Awaited<ReturnType<ContentSearch['search']>>,
  { ok: false }
>['error'];

interface ContentInvalidLocatorError {
  readonly kind: 'invalid-locator';
  readonly value: string;
  readonly error: DocumentError;
}

interface ContentArtifactNotFoundError {
  readonly kind: 'artifact-not-found';
  readonly ref: string;
  readonly availableRefs: readonly string[];
}

interface ContentWrongArtifactKindError {
  readonly kind: 'wrong-artifact-kind';
  readonly ref: string;
  readonly artifact: ArtifactRef;
}

interface ContentDocumentRetrievalError {
  readonly kind: 'document-retrieval-failed';
  readonly error: DocumentError;
}

export interface ContentSearchFailure {
  readonly kind: 'search-failed';
  readonly error: ContentSearchError;
}

export type ContentError =
  | ContentInvalidLocatorError
  | ContentArtifactNotFoundError
  | ContentWrongArtifactKindError
  | ContentDocumentRetrievalError
  | ContentSearchFailure;

export type ContentGetError = Exclude<ContentError, ContentSearchFailure>;

export type ContentResult<T, E extends ContentError = ContentError> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

export type ContentProviderEvidence = Readonly<{
  order: number;
  owner: string;
  operation: string;
  outcome: 'dispatched' | 'succeeded' | 'failed' | 'cancelled';
  value?: unknown;
}>;

export type ContentOperationOutcome<T, E extends ContentError = ContentError> = Readonly<{
  result: ContentResult<T, E>;
  evidence: readonly ContentProviderEvidence[];
}>;

export type ContentPresentationOptions = Readonly<{
  json?: boolean | string;
  jq?: string;
}>;

export type ContentPresentation = Readonly<{
  output: string;
  exitCode?: 1 | 2 | 4;
}>;

export interface ContentGetValue {
  readonly document: Document;
  readonly namespace: string;
}

export interface ContentGetInput {
  readonly target: string;
}

export type ContentFacetSelection = Readonly<{
  field: (typeof CONTENT_SEARCH_FACETS)[number]['field'];
  value: string;
}>;

export interface ContentSearchInput {
  readonly query: string;
  readonly limit?: string | number;
  readonly published?: string;
  readonly sort?: string;
  readonly facets?: readonly ContentFacetSelection[];
}

export interface ContentSearchValue {
  readonly page: ContentSearchPage;
  readonly facetMatches: readonly Readonly<{ field: string; input: string; name: string }>[];
  readonly namespace?: string;
  readonly documentRefs: readonly string[];
}

export interface Content {
  get(input: ContentGetInput): Promise<ContentOperationOutcome<ContentGetValue, ContentGetError>>;
  search(input: ContentSearchInput): Promise<ContentOperationOutcome<ContentSearchValue, ContentSearchFailure>>;
}

export interface ContentConfig {
  document: DocumentModule;
  registry: ArtifactRegistry;
  requester(
    evidence: ContentConfig['evidence'],
  ): Parameters<typeof createContentSearch>[0];
  evidence: Readonly<{
    reserve(
      call: Readonly<{ owner: string; operation: string }>,
      signal?: AbortSignal,
    ): Readonly<{
      succeed(value?: unknown): void;
      fail(value?: unknown): void;
      cancel(value?: unknown): void;
    }> | undefined;
    snapshot(): readonly ContentProviderEvidence[];
  }>;
}
