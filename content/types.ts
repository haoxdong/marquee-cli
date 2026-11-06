import type { ReferentRef, ReferentRegistry } from '../referent-registry/index.js';
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

interface ContentReferentNotFoundError {
  readonly kind: 'referent-not-found';
  readonly ref: string;
  readonly availableRefs: readonly string[];
}

interface ContentWrongReferentKindError {
  readonly kind: 'wrong-referent-kind';
  readonly ref: string;
  readonly referent: ReferentRef;
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
  | ContentReferentNotFoundError
  | ContentWrongReferentKindError
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
  channel?: 'stderr';
  exitCode?: 1 | 2 | 4;
  /** The failure rejects the command's input (ADR 0085 decision 4). */
  usage?: true;
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
  registry: ReferentRegistry;
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
