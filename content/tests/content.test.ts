import type { Ref } from '../../artifact-registry/index.js';
import type { DocumentId } from '../../document/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifactRegistry } from '../../artifact-registry/index.js';
import type { DocumentModule } from '../../document/index.js';
import {
  createContent as createContentFacade,
  type Content,
  type ContentProviderEvidence,
  type ContentSearchInput,
} from '../index.js';
import { createContentModule as createContent } from '../module.js';
import {
  type ContentSearch,
  type ContentSearchPage,
} from '../search/index.js';

const searchPage: ContentSearchPage = {
  type: 'search-page',
  query: 'US CPI',
  link: 'https://marquee.gs.com/content/research/site/search.html',
  resultCount: 1,
  limit: 10,
  page: 1,
  sort: 'time',
  appliedFilters: [],
  appliedFacets: [],
  results: [{
    documentId: 'research-1',
    type: 'document',
    title: 'CPI update',
    documentSource: 'RELAY_DOCUMENT_LEGACY',
    source: 'Research',
    path: '/content/research/en/reports/research-1.html',
    url: 'https://marquee.gs.com/content/research/en/reports/research-1.html',
  }],
  facets: [],
};

function unusedSearch(): ContentSearch {
  return {
    async search() {
      return {
        ok: false,
        error: { kind: 'discovery-failed' },
      };
    },
  };
}

function documentModule(
  get: DocumentModule['get'],
): DocumentModule {
  return { get };
}

function evidenceLog() {
  const entries: ContentProviderEvidence[] = [];
  return {
    reserve(call: Readonly<{ owner: string; operation: string }>) {
      const entry = {
        order: entries.length + 1,
        ...call,
        outcome: 'dispatched' as const,
      };
      entries.push(entry);
      return {
        succeed(value?: unknown) {
          entries[entry.order - 1] = { ...entry, outcome: 'succeeded', ...(value === undefined ? {} : { value }) };
        },
        fail(value?: unknown) {
          entries[entry.order - 1] = { ...entry, outcome: 'failed', ...(value === undefined ? {} : { value }) };
        },
        cancel(value?: unknown) {
          entries[entry.order - 1] = { ...entry, outcome: 'cancelled', ...(value === undefined ? {} : { value }) };
        },
      };
    },
    snapshot: () => entries,
  };
}

type ContentConfig = Parameters<typeof createContentFacade>[0];
type ContentRequest = ReturnType<ContentConfig['requester']>['request'];

function providerRequester(request: ContentRequest): ContentConfig['requester'] {
  return () => ({ request });
}

async function getResult(content: Content, target: string) {
  return (await content.get({ target })).result;
}

async function searchResult(content: Content, input: ContentSearchInput) {
  return (await content.search(input)).result;
}

describe('Content', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) rmSync(refsDir, { recursive: true, force: true });
    refsDir = undefined;
  });

  function registry() {
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-content-'));
    return createArtifactRegistry(refsDir, 'content-test');
  }

  it('claims and stores a direct Markets document', async () => {
    const store = registry();
    const get = vi.fn<DocumentModule['get']>(async () => ({
      ok: true,
      value: {
        identifier: { kind: 'content-stream-id', documentId: '123e4567-e89b-12d3-a456-426614174000' as DocumentId },
        title: 'Markets note',
        body: 'Evidence.',
        url: 'https://marquee.gs.com/content/markets/en/markets-note-1.html',
      },
    }));
    const facade = createContentFacade({
      registry: store,
      document: documentModule(get),
      evidence: evidenceLog(),
      requester: providerRequester(async () => {
        throw new Error('unexpected Content Search request');
      }),
    });

    const result = await getResult(
      facade,
      'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
    );

    expect(result).toMatchObject({ ok: true, value: { namespace: 'c1' } });
    expect(store.resolveRef('c1' as Ref)).toMatchObject({
      type: 'document',
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      realm: 'markets',
    });
    expect(store.getPayload('c1')).toEqual({
      browserTarget: 'https://marquee.gs.com/content/markets/en/markets-note-1.html',
    });

    await expect(getResult(facade, '@c1')).resolves.toMatchObject({
      ok: true,
      value: { namespace: 'c1' },
    });
    expect(get).toHaveBeenNthCalledWith(2, { kind: 'document-id', documentId: '123e4567-e89b-12d3-a456-426614174000' });
  });

  it('passes search flags to Content Search without storing machine-readable results', async () => {
    const store = registry();
    const search = vi.fn<ContentSearch['search']>(async () => ({
      ok: true,
      value: {
        page: searchPage,
        facetMatches: [],
      },
    }));
    const facade = createContent({
      registry: store,
      search: {
        search,
      },
      document: documentModule(async () => {
        throw new Error('unexpected Document retrieval');
      }),
    });

    const result = await searchResult(facade, {
      query: 'US CPI',
      limit: '10',
      published: '2026-05-01..2026-05-31',
      facets: [
        { field: 'source', value: 'Research' },
        { field: 'source', value: ' research ' },
        { field: 'source', value: 'FICC' },
        { field: 'author', value: 'Sample Analyst' },
      ],
    });

    expect(search).toHaveBeenCalledWith({
      query: 'US CPI',
      limit: '10',
      published: '2026-05-01..2026-05-31',
      facets: [
        { field: 'source', value: 'Research' },
        { field: 'source', value: ' research ' },
        { field: 'source', value: 'FICC' },
        { field: 'author', value: 'Sample Analyst' },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        page: searchPage,
      },
    });
  });

  it('passes Content Search only the flags the caller set', async () => {
    const search = vi.fn<ContentSearch['search']>(async () => ({
      ok: true,
      value: { page: searchPage, facetMatches: [] },
    }));
    const facade = createContent({
      registry: registry(),
      search: { search },
      document: documentModule(async () => {
        throw new Error('unexpected Document retrieval');
      }),
    });

    await searchResult(facade, { query: 'US CPI' });
    await searchResult(facade, { query: 'US CPI', sort: 'time' });

    expect(search.mock.calls.map(([input]) => input)).toStrictEqual([
      { query: 'US CPI' },
      { query: 'US CPI', sort: 'time' },
    ]);
  });

  it('does not consume a direct Content ref when retrieval fails', async () => {
    const store = registry();
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const get = vi.fn<DocumentModule['get']>()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'dependency',
          identity: { kind: 'document-id', documentId: id },
          failure: { kind: 'unavailable' },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          identifier: { kind: 'content-stream-id', documentId: 'stream-2' as DocumentId },
          title: 'Second attempt',
        },
      });
    const facade = createContent({
      registry: store,
      search: unusedSearch(),
      document: documentModule(get),
    });
    const target = 'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html';

    await expect(getResult(facade, target)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'document-retrieval-failed' },
    });
    await expect(getResult(facade, target)).resolves.toMatchObject({
      ok: true,
      value: { namespace: 'c1' },
    });
    expect(store.resolveRef('c1' as Ref)).toMatchObject({ documentId: 'stream-2' });
  });

  it('does not consume a source ref for an invalid locator', async () => {
    const store = registry();
    const facade = createContent({
      registry: store,
      search: unusedSearch(),
      document: documentModule(async (locator) => (
        locator.kind === 'marquee-content-url' && locator.url.startsWith('https://example.com/')
          ? {
              ok: false,
              error: {
                kind: 'invalid-locator',
                locator: locator.url,
                problem: 'foreign-host',
              },
            }
          : {
              ok: true,
              value: {
                identifier: { kind: 'content-stream-id', documentId: 'stream-1' as DocumentId },
                title: 'Valid document',
              },
            }
      )),
    });

    await expect(getResult(facade, 'https://example.com/content/markets/bad.html')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-locator' },
    });
    await expect(getResult(
      facade,
      'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
    )).resolves.toMatchObject({ ok: true, value: { namespace: 'c1' } });
  });

  it('reads a target by its form: a URL in any scheme case, a stored ref with or without @, else a document ID', async () => {
    const store = registry();
    store.storeArtifact({
      namespace: 's1',
      root: { type: 'search', searchKind: 'research' },
      refs: { c1: { type: 'document', documentId: 'research-1', realm: 'research' } },
      payload: {},
    });
    const get = vi.fn<DocumentModule['get']>(async () => ({
      ok: true,
      value: { identifier: { kind: 'content-stream-id', documentId: 'stream-1' as DocumentId }, title: 'Found' },
    }));
    const facade = createContent({ registry: store, search: unusedSearch(), document: documentModule(get) });

    for (const url of ['HTTPS://marquee.gs.com/content/a.html', 'http://marquee.gs.com/content/b.html']) {
      // eslint-disable-next-line no-await-in-loop -- cases share one mock and assert its last call
      await getResult(facade, url);
      expect(get).toHaveBeenLastCalledWith({ kind: 'marquee-content-url', url });
    }
    await expect(getResult(facade, 's1.c1')).resolves.toMatchObject({ ok: true, value: { namespace: 's1.c1' } });
    expect(get).toHaveBeenLastCalledWith({ kind: 'document-id', documentId: 'research-1' });
    for (const ref of ['ab12', 'S12.CD34.e5']) {
      // eslint-disable-next-line no-await-in-loop -- test cases run one at a time
      await expect(getResult(facade, ref)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'artifact-not-found', ref },
      });
    }
    get.mockClear();
    for (const documentId of [
      '123e4567-e89b-12d3-a456-426614174000',
      '00000000-0000-4000-8000-0000000a0001',
      's1.c1x',
      'id-https://marquee.gs.com/content/a.html',
    ]) {
      // eslint-disable-next-line no-await-in-loop -- cases share one mock and assert its last call
      await getResult(facade, documentId);
      expect(get).toHaveBeenLastCalledWith({ kind: 'document-id', documentId });
    }
  });

  it('claims and stores a Content Search artifact with Document children', async () => {
    const store = registry();
    const mixedSearchPage: ContentSearchPage = {
      ...searchPage,
      resultCount: 2,
      results: [
        ...searchPage.results,
        {
          documentId: 'markets-1',
          type: 'document',
          title: 'Markets update',
          documentSource: 'sec_div',
          source: 'FICC and Equities',
          path: '/content/markets/en/markets-1.html',
          url: 'https://marquee.gs.com/content/markets/en/markets-1.html',
        },
      ],
    };
    const search: ContentSearch = {
      async search() {
        return {
          ok: true,
          value: { page: mixedSearchPage, facetMatches: [] },
        };
      },
    };
    const facade = createContent({
      registry: store,
      search,
      document: documentModule(async () => ({
        ok: false,
        error: {
          kind: 'dependency',
          identity: { kind: 'document-id', documentId: 'content-1' },
          failure: { kind: 'unavailable' },
        },
      })),
    });

    await expect(searchResult(facade, { query: 'US CPI' })).resolves.toMatchObject({
      ok: true,
      value: {
        namespace: 's1',
        page: mixedSearchPage,
        documentRefs: ['s1.c1', 's1.c2'],
      },
    });
    expect(store.resolveRef('s1' as Ref)).toEqual({
      type: 'search',
      searchKind: 'research',
    });
    expect(store.resolveRef('s1.c1' as Ref)).toEqual({
      type: 'document',
      documentId: 'research-1',
      realm: 'research',
    });
    expect(store.resolveRef('s1.c2' as Ref)).toEqual({
      type: 'document',
      documentId: 'markets-1',
      realm: 'markets',
    });
    expect(store.getPayload('s1')).toEqual({
      browserTarget: mixedSearchPage.link,
      browserTargets: {
        's1.c1': 'https://marquee.gs.com/content/research/en/reports/research-1.html',
        's1.c2': 'https://marquee.gs.com/content/markets/en/markets-1.html',
      },
    });
  });

});
