import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { MarqueeError, type Endpoint } from '../../../../transport/index.js';
import type { ContentSearchDiscoveryInput } from '../../module.js';
import { createContentSearchProductionPort } from '../production.js';

const ADVANCED_SEARCH_PATH = '/research/search/reports/advanced-search';
const US_CPI_LINK = 'https://marquee.gs.com/content/research/site/search.html'
  + '?filter=(all%20EQ%20%24%7B(US%20CPI)%7D%24)&sort=time&language=%5B%22en%22%5D';

async function discover(raw: unknown, input: Partial<ContentSearchDiscoveryInput> = {}) {
  const request = vi.fn(async (_endpoint: Endpoint, _init?: unknown) => raw);
  const fail = vi.fn();
  const reserve = vi.fn(() => ({ fail }));
  const result = await createContentSearchProductionPort({ request }, { reserve })
    .discover({ query: 'US CPI', ...input });
  return { result, request, reserve, fail };
}

async function requestBody(input: Partial<ContentSearchDiscoveryInput>) {
  const { request } = await discover(advancedSearchResponse(), input);
  return request.mock.calls[0]?.[1] && (request.mock.calls[0][1] as { body: Record<string, unknown> }).body;
}

function advancedSearchDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-1',
    title: 'Document 1',
    distributionHeadline: 'Document 1',
    publicationDateTime: Date.UTC(2026, 4, 30, 12, 0),
    authors: ['Analyst One'],
    source: 'sec_div',
    sources: ['FICC and Equities'],
    sourceDisplayName: 'FICC and Equities',
    highlight: 'Document <b>snippet</b>',
    synopsis: 'Document synopsis',
    path: '/content/markets/en/doc-1.html',
    downloadPath: null,
    ...overrides,
  };
}

function advancedSearchFacetValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sources',
    guid: 'source-research-guid',
    name: 'Research',
    count: 1200,
    selected: false,
    query: null,
    ...overrides,
  };
}

function advancedSearchFacet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { label: 'Sources', selected: false, values: [advancedSearchFacetValue()], ...overrides };
}

function advancedSearchResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    documents: [],
    totalRecords: 0,
    page: 1,
    facetList: [],
    ...overrides,
  };
}

describe('content/search adapter', () => {
  it('posts a cookie-only advanced-search query and returns its page', async () => {
    const { result, request } = await discover(advancedSearchResponse({ totalRecords: 75500, page: 2 }));

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: ADVANCED_SEARCH_PATH }, {
      headers: {
        Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: {
        filter: '(all EQ ${(US CPI)}$)',
        facets: '()',
        sort: 'time',
        page: 1,
        size: 10,
        language: '["en"]',
        limitTo: '[""]',
        applyHighlighting: true,
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: {
        page: {
          type: 'search-page',
          query: 'US CPI',
          link: US_CPI_LINK,
          resultCount: 75500,
          limit: 10,
          page: 2,
          sort: 'time',
          appliedFilters: [],
          appliedFacets: [],
          results: [],
          facets: [],
        },
      },
    });
  });

  it('posts facet names verbatim and applies the values the response echoes', async () => {
    const { result, request } = await discover(advancedSearchResponse({
      facetList: [
        advancedSearchFacet({
          values: [
            advancedSearchFacetValue({ guid: 'ficc-guid', name: 'FICC and Equities' }),
            advancedSearchFacetValue(),
          ],
        }),
        advancedSearchFacet({ label: 'Authors', values: [advancedSearchFacetValue({ guid: 'example-guid', name: 'Alex Example' })] }),
      ],
    }), {
      query: '',
      facets: [
        { field: 'source', value: 'research' },
        { field: 'author', value: 'Alex Example' },
        { field: 'author', value: 'Kim One' },
      ],
    });

    expect(request.mock.calls[0]?.[1]).toMatchObject({
      body: { facets: '(sources CONTAINS_ALL ["research"] AND authors CONTAINS_ANY ["Alex Example","Kim One"])' },
    });
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty('body.filter');
    expect(result).toMatchObject({
      ok: true,
      value: {
        page: {
          query: '',
          appliedFacets: [
            { field: 'source', guid: 'source-research-guid', name: 'Research' },
            { field: 'author', guid: 'example-guid', name: 'Alex Example' },
          ],
          link: 'https://marquee.gs.com/content/research/site/search.html'
            + `?facets=${encodeURIComponent('(sources CONTAINS_ALL ["source-research-guid"] AND authors CONTAINS_ALL ["example-guid"])')}`
            + '&sort=time&language=%5B%22en%22%5D',
        },
      },
    });
  });

  it('applies a value echoed for two requested spellings once', async () => {
    const { result } = await discover(advancedSearchResponse({ facetList: [advancedSearchFacet()] }), {
      facets: [{ field: 'source', value: 'Research' }, { field: 'source', value: 'RESEARCH' }],
    });

    expect(result.ok && result.value.page.appliedFacets).toEqual([
      { field: 'source', guid: 'source-research-guid', name: 'Research' },
    ]);
  });

  it('escapes backslashes and quotes in a facet name', async () => {
    await expect(requestBody({ facets: [{ field: 'type', value: 'Say "hi" \\ bye' }] })).resolves.toMatchObject({
      facets: '(report_types CONTAINS_ALL ["Say \\"hi\\" \\\\ bye"])',
    });
  });

  it('emits repeated facets as CONTAINS_ANY within a field and AND across fields', async () => {
    await expect(requestBody({
      facets: [
        { field: 'source', value: 'Research' },
        { field: 'source', value: 'FICC and Equities' },
        { field: 'author', value: 'Sample Analyst' },
      ],
    })).resolves.toMatchObject({
      facets: '(sources CONTAINS_ANY ["Research","FICC and Equities"] AND authors CONTAINS_ALL ["Sample Analyst"])',
    });
  });

  it('relinks a page to the facets Content Search applied', async () => {
    const { result } = await discover(advancedSearchResponse(), { from: '2026-06-01', to: '2026-06-02', sort: 'relevance' });
    assert(result.ok);
    const { page } = result.value;
    const appliedFacets = [{ field: 'author', guid: 'author-guid', name: 'Alex Example' }] as const;

    expect(createContentSearchProductionPort({ request: vi.fn() }).withAppliedFacets(page, appliedFacets)).toEqual({
      ...page,
      appliedFacets,
      link: 'https://marquee.gs.com/content/research/site/search.html'
        + `?filter=${encodeURIComponent('(all EQ ${(US CPI)}$ AND publicationDateTime IN [2026-06-01T04:00:00,2026-06-03T04:00:00])')}`
        + `&facets=${encodeURIComponent('(authors CONTAINS_ALL ["author-guid"])')}`
        + '&sort=relevance&language=%5B%22en%22%5D',
    });
  });

  it('requests the page size and sort and trims results to the limit', async () => {
    const { result, request } = await discover(advancedSearchResponse({
      totalRecords: 25,
      documents: Array.from({ length: 6 }, (_, index) => advancedSearchDocument({ id: `doc-${index + 1}` })),
    }), { limit: 5, sort: 'relevance' });

    expect(request.mock.calls[0]?.[1]).toMatchObject({ body: { page: 1, size: 5, sort: 'relevance' } });
    expect(result).toMatchObject({
      ok: true,
      value: { page: { limit: 5, sort: 'relevance', link: expect.stringContaining('&sort=relevance&') } },
    });
    expect(result.ok && result.value.page.results.map(({ documentId }) => documentId))
      .toEqual(['doc-1', 'doc-2', 'doc-3', 'doc-4', 'doc-5']);
  });

  it.each([
    ['a daylight-time day', { from: '2026-06-01', to: '2026-06-01' },
      'publicationDateTime IN [2026-06-01T04:00:00,2026-06-02T04:00:00]'],
    ['a start date', { from: '2026-05-01' }, 'publicationDateTime GEQ 2026-05-01T04:00:00'],
    ['a standard-time end date', { to: '2026-01-15' }, 'publicationDateTime LEQ 2026-01-16T05:00:00'],
  ])('bounds %s by New York midnights', async (_name, range, clause) => {
    const { result, request } = await discover(advancedSearchResponse(), range);

    expect(request.mock.calls[0]?.[1]).toMatchObject({ body: { filter: `(all EQ \${(US CPI)}$ AND ${clause})` } });
    expect(result).toMatchObject({ ok: true, value: { page: range } });
  });

  it('normalizes advanced-search documents for the content listing screen', async () => {
    const { result } = await discover(advancedSearchResponse({
      totalRecords: 3,
      documents: [
        advancedSearchDocument({
          title: 'May 29, 2026',
          distributionHeadline: 'Example Research Summary: May 29, 2026',
          source: 'RELAY_DOCUMENT_LEGACY',
          sourceDisplayName: 'Research | Economics',
          authors: ['Sample Analyst E', 'Sample Analyst F'],
          highlight: 'US <b>CPI</b>\n goods  inflation &amp; services prices.',
          synopsis: 'Synopsis <b>fallback</b>',
          path: '/content/research/en/reports/doc-1.html',
          downloadPath: '/content/research/en/reports/doc-1.pdf',
        }),
        advancedSearchDocument({ id: 'doc-2', authors: [], highlight: null, synopsis: '' }),
        advancedSearchDocument({ id: 'doc-3', highlight: '', synopsis: undefined }),
      ],
    }));

    expect(result.ok && result.value.page.results).toStrictEqual([
      {
        documentId: 'doc-1',
        type: 'document',
        title: 'Example Research Summary: May 29, 2026',
        publicationDate: '2026-05-30T12:00:00.000Z',
        authors: ['Sample Analyst E', 'Sample Analyst F'],
        source: 'Research | Economics',
        documentSource: 'RELAY_DOCUMENT_LEGACY',
        synopsis: 'Synopsis fallback',
        snippet: 'US CPI goods inflation & services prices.',
        path: '/content/research/en/reports/doc-1.html',
        downloadPath: '/content/research/en/reports/doc-1.pdf',
        url: 'https://marquee.gs.com/content/research/en/reports/doc-1.html',
      },
      {
        documentId: 'doc-2',
        type: 'document',
        title: 'Document 1',
        publicationDate: '2026-05-30T12:00:00.000Z',
        authors: [],
        source: 'FICC and Equities',
        documentSource: 'sec_div',
        path: '/content/markets/en/doc-1.html',
        url: 'https://marquee.gs.com/content/markets/en/doc-1.html',
      },
      {
        documentId: 'doc-3',
        type: 'document',
        title: 'Document 1',
        publicationDate: '2026-05-30T12:00:00.000Z',
        authors: ['Analyst One'],
        source: 'FICC and Equities',
        documentSource: 'sec_div',
        path: '/content/markets/en/doc-1.html',
        url: 'https://marquee.gs.com/content/markets/en/doc-1.html',
      },
    ]);
  });

  it('normalizes the facet footer', async () => {
    const { result } = await discover(advancedSearchResponse({
      facetList: [advancedSearchFacet({
        selected: true,
        values: [
          advancedSearchFacetValue(),
          advancedSearchFacetValue({ id: 'sources', guid: 'ficc-guid', name: 'FICC', count: 0, selected: true }),
        ],
      })],
    }));

    expect(result.ok && result.value.page.facets).toStrictEqual([{
      field: 'source',
      label: 'Sources',
      isSelected: true,
      values: [
        { facetValueId: 'sources', guid: 'source-research-guid', name: 'Research', count: 1200, isSelected: false },
        { facetValueId: 'sources', guid: 'ficc-guid', name: 'FICC', count: 0, isSelected: true },
      ],
    }]);
  });

  it.each([
    ['documents is not an array', { documents: undefined }],
    ['totalRecords is not a number', { totalRecords: undefined }],
    ['totalRecords is not a number', { totalRecords: Infinity }],
    ['page is not a number', { page: undefined }],
    ['facetList is not an array', { facetList: undefined }],
    ['documents[].id is required', { documents: [advancedSearchDocument({ id: undefined })] }],
    ['documents[].id is required', { documents: [advancedSearchDocument({ id: ' ' })] }],
    ['documents[].distributionHeadline is required',
      { documents: [advancedSearchDocument({ distributionHeadline: undefined })] }],
    ['documents[].publicationDateTime is not a number',
      { documents: [advancedSearchDocument({ publicationDateTime: '2026-01-12T00:30:00Z' })] }],
    ['documents[].authors is not an array', { documents: [advancedSearchDocument({ authors: undefined })] }],
    ['documents[].authors[] is required', { documents: [advancedSearchDocument({ authors: [1] })] }],
    ['documents[].sourceDisplayName is required',
      { documents: [advancedSearchDocument({ sourceDisplayName: undefined })] }],
    ['documents[].source is required', { documents: [advancedSearchDocument({ source: undefined })] }],
    ['documents[].synopsis is not a string', { documents: [advancedSearchDocument({ synopsis: 5 })] }],
    ['documents[].highlight is not a string', { documents: [advancedSearchDocument({ highlight: 5 })] }],
    ['documents[].path is required', { documents: [advancedSearchDocument({ path: undefined })] }],
    ['documents[].downloadPath is required', { documents: [advancedSearchDocument({ downloadPath: undefined })] }],
    ['facetList[].label is required', { facetList: [advancedSearchFacet({ label: undefined })] }],
    ['facetList[].values is not an array', { facetList: [advancedSearchFacet({ values: undefined })] }],
    ['facetList[].values is empty', { facetList: [advancedSearchFacet({ values: [] })] }],
    ['facetList[].selected is not a boolean', { facetList: [advancedSearchFacet({ selected: undefined })] }],
    ['facetList[].values[].id is required',
      { facetList: [advancedSearchFacet({ values: [advancedSearchFacetValue({ id: undefined })] })] }],
    ['facetList[].values[].guid is required',
      { facetList: [advancedSearchFacet({ values: [advancedSearchFacetValue({ guid: undefined })] })] }],
    ['facetList[].values[].name is required',
      { facetList: [advancedSearchFacet({ values: [advancedSearchFacetValue({ name: undefined })] })] }],
    ['facetList[].values[].count is not a number',
      { facetList: [advancedSearchFacet({ values: [advancedSearchFacetValue({ count: undefined })] })] }],
    ['facetList[].values[].selected is not a boolean',
      { facetList: [advancedSearchFacet({ values: [advancedSearchFacetValue({ selected: undefined })] })] }],
  ])('fails loud when %s', async (reason, overrides) => {
    const { result, reserve, fail } = await discover(advancedSearchResponse(overrides));

    expect(result).toEqual({ ok: false, error: { kind: 'discovery-failed' } });
    expect(reserve).toHaveBeenCalledWith({
      owner: 'content.search',
      operation: 'decode POST /research/search/reports/advanced-search',
    });
    expect(fail).toHaveBeenCalledWith({
      kind: 'adapter-failure',
      message: `Unsupported content search response shape: ${reason}; record a Scenario before accepting this fallback.`,
    });
  });

  it.each([
    ['an expired session', new MarqueeError('auth_expired', 'Unauthorized'),
      { kind: 'authentication-required', realm: 'research' }],
    ['a timeout', new MarqueeError('timeout', 'timed out'), { kind: 'timeout' }],
    ['a cancellation', new MarqueeError('network', 'aborted', { isCanceled: true }), { kind: 'cancelled' }],
    ['a rate limit', new MarqueeError('http', 'too many', { status: 429 }), { kind: 'rate-limited' }],
    ['an outage', new MarqueeError('http', 'bad gateway', { status: 502 }), { kind: 'unavailable' }],
  ] as const)('maps %s to a dependency failure', async (_name, error, failure) => {
    const request = async () => {
      throw error;
    };
    const port = createContentSearchProductionPort({ request });

    await expect(port.discover({ query: 'US CPI' }))
      .resolves.toEqual({ ok: false, error: { kind: 'dependency', failure } });
  });

});
