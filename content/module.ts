import {
  type ArtifactRef,
  type ArtifactRegistry,
} from '../artifact-registry/index.js';
import {
  type Document,
  type DocumentLocator,
  type DocumentModule,
} from '../document/index.js';
import type {
  ContentSearch,
  ContentSearchInput as ContentSearchOperationInput,
  ContentSearchPage,
} from './search/index.js';
import type {
  Content,
  ContentError,
  ContentGetError,
  ContentGetInput,
  ContentGetValue,
  ContentOperationOutcome,
  ContentProviderEvidence,
  ContentResult,
  ContentSearchFailure,
  ContentSearchInput,
  ContentSearchValue,
} from './types.js';

type ContentDependencies = Readonly<{
  document: DocumentModule;
  evidence?: Readonly<{
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
  registry: ArtifactRegistry;
  search: ContentSearch;
}>;

// A stored ref, which may be given without its `@`: `s1`, `c2`, `s1.c3`.
const REF_PATTERN = /^[a-z]+\d+(?:\.[a-z]+\d+)*$/i;

function artifactRoot(document: Document): ArtifactRef {
  return {
    type: 'document',
    documentId: document.identifier.documentId,
    realm: document.identifier.kind === 'gir-research-uuid' ? 'research' : 'markets',
  };
}

function store(
  registry: ArtifactRegistry,
  namespace: string,
  document: Document,
): void {
  registry.storeArtifact({
    namespace,
    root: artifactRoot(document),
    payload: { browserTarget: document.url },
  });
}

function contentSearchArtifact(): Extract<ArtifactRef, { type: 'search' }> {
  return {
    type: 'search',
    searchKind: 'research',
  };
}

function storeSearch(
  registry: ArtifactRegistry,
  namespace: string,
  page: ContentSearchPage,
): string[] {
  const refs: Record<string, ArtifactRef> = {};
  const documentRefs: string[] = [];
  const browserTargets: Record<string, string> = {};
  for (const [index, document] of page.results.entries()) {
    const localName = `c${index + 1}`;
    const refName = `${namespace}.${localName}`;
    documentRefs.push(refName);
    if (document.url) browserTargets[refName] = document.url;
    refs[localName] = {
      type: 'document',
      documentId: document.documentId,
      realm: document.documentSource === 'sec_div' ? 'markets' : 'research',
    };
  }
  registry.storeArtifact({
    namespace,
    root: contentSearchArtifact(),
    refs,
    payload: { browserTarget: page.link, browserTargets },
  });
  return documentRefs;
}

async function getStored(
  dependencies: ContentDependencies,
  target: string,
): Promise<ContentResult<ContentGetValue, ContentGetError>> {
  const refName = dependencies.registry.refName(target);
  const ref = dependencies.registry.resolveRef(refName);
  if (!ref) {
    return {
      ok: false,
      error: {
        kind: 'artifact-not-found',
        ref: refName,
        availableRefs: Object.keys(dependencies.registry.getAllRefs()),
      },
    };
  }
  if (ref.type !== 'document') {
    return { ok: false, error: { kind: 'wrong-artifact-kind', ref: refName, artifact: ref } };
  }
  const result = await dependencies.document.get({ kind: 'document-id', documentId: ref.documentId });
  if (!result.ok) {
    return { ok: false, error: { kind: 'document-retrieval-failed', error: result.error } };
  }
  return { ok: true, value: { document: result.value, namespace: refName } };
}

type ContentOperations = Readonly<{
  get(target: string): Promise<ContentResult<ContentGetValue, ContentGetError>>;
  search(input: ContentSearchOperationInput): Promise<ContentResult<ContentSearchValue, ContentSearchFailure>>;
}>;

function contentSearchOperationInput(input: ContentSearchInput): ContentSearchOperationInput {
  return {
    query: input.query,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.published === undefined ? {} : { published: input.published }),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
    ...(input.facets === undefined ? {} : { facets: input.facets }),
  };
}

async function withEvidence<T, E extends ContentError>(
  dependencies: ContentDependencies,
  operation: () => Promise<ContentResult<T, E>>,
): Promise<ContentOperationOutcome<T, E>> {
  const start = dependencies.evidence?.snapshot().length ?? 0;
  const result = await operation();
  const evidence = dependencies.evidence?.snapshot().slice(start) ?? [];
  return Object.freeze({
    result,
    evidence: Object.freeze([...evidence]),
  });
}

export function createContentModule(dependencies: ContentDependencies): Content {
  const operations: ContentOperations = {
    async get(target) {
      if (target.startsWith('@') || REF_PATTERN.test(target)) {
        return getStored(dependencies, target);
      }
      const locator: DocumentLocator = target.startsWith('/')
        ? { kind: 'marquee-content-path', path: target }
        : /^https?:\/\//i.test(target)
          ? { kind: 'marquee-content-url', url: target }
          : { kind: 'document-id', documentId: target };
      const result = await dependencies.document.get(locator);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error.kind === 'invalid-locator'
            ? { kind: 'invalid-locator', value: target, error: result.error }
            : { kind: 'document-retrieval-failed', error: result.error },
        };
      }
      const claimedNamespace = dependencies.registry.claimContent();
      store(dependencies.registry, claimedNamespace, result.value);
      return { ok: true, value: { document: result.value, namespace: claimedNamespace } };
    },
    async search(input) {
      const result = await dependencies.search.search(input);
      if (!result.ok) return { ok: false, error: { kind: 'search-failed', error: result.error } };
      const value = result.value;
      const namespace = dependencies.registry.claimSearch();
      const documentRefs = storeSearch(dependencies.registry, namespace, value.page);
      return { ok: true, value: { ...value, namespace, documentRefs } };
    },
  };
  return Object.freeze({
    async get(input: ContentGetInput) {
      return withEvidence(dependencies, () => operations.get(input.target));
    },
    async search(input: ContentSearchInput) {
      const operationInput = contentSearchOperationInput(input);
      return withEvidence(dependencies, () => operations.search(operationInput));
    },
  });
}
