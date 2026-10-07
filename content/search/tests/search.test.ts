import { describe, expect, it, vi } from 'vitest';
import type { ContentSearchPage } from '../index.js';
import {
  createContentSearchModule,
  type ContentSearchPort,
} from '../module.js';

const emptyPage: ContentSearchPage = {
  type: 'search-page',
  query: 'US CPI',
  link: 'https://marquee.gs.com/content/research/site/search.html',
  resultCount: 0,
  limit: 10,
  page: 1,
  sort: 'time',
  appliedFilters: [],
  appliedFacets: [],
  results: [],
  facets: [],
};

const railPage: ContentSearchPage = {
  ...emptyPage,
  query: '',
  resultCount: 900000,
  facets: [{
    field: 'author',
    label: 'Authors',
    isSelected: false,
    values: [
      { guid: 'example-guid', name: 'Alex Example', count: 298, isSelected: false },
      { guid: 'kim-one-guid', name: 'Kim One', count: 40, isSelected: false },
      { guid: 'kim-two-guid', name: 'Kim Two', count: 30, isSelected: false },
    ],
  }],
};

function fakePort(discover: ContentSearchPort['discover']): ContentSearchPort {
  return {
    discover,
    withAppliedFacets: (page, appliedFacets) => ({ ...page, appliedFacets }),
  };
}

describe('Content Search', () => {
  it('returns a semantic page through its owner interface', async () => {
    const discover = vi.fn<ContentSearchPort['discover']>(async () => ({
      ok: true,
      value: { page: emptyPage },
    }));
    const search = createContentSearchModule(fakePort(discover));

    await expect(search.search({
      query: 'US CPI',
      limit: '50',
      published: '2026-05-01..2026-05-01',
      sort: 'relevance',
    })).resolves.toEqual({
      ok: true,
      value: { page: emptyPage, facetMatches: [] },
    });
    expect(discover).toHaveBeenCalledWith({
      query: 'US CPI',
      limit: 50,
      from: '2026-05-01',
      to: '2026-05-01',
      sort: 'relevance',
      facets: [],
    });
  });

  it('accepts the smallest limit', async () => {
    const discover = vi.fn<ContentSearchPort['discover']>(async () => ({ ok: true, value: { page: emptyPage } }));
    const search = createContentSearchModule(fakePort(discover));

    await expect(search.search({ query: 'US CPI', limit: 1 })).resolves.toMatchObject({ ok: true });
    expect(discover).toHaveBeenCalledWith({ query: 'US CPI', limit: 1, facets: [] });
  });

  it.each([
    ['>=2026-06-01', { from: '2026-06-01' }],
    ['<=2026-06-30', { to: '2026-06-30' }],
    ['2026-06-01..2026-06-30', { from: '2026-06-01', to: '2026-06-30' }],
    ['2026-06-01..2026-06-01', { from: '2026-06-01', to: '2026-06-01' }],
  ] as const)('bounds publication dates with the --published range %s', async (published, bounds) => {
    const discover = vi.fn<ContentSearchPort['discover']>(async () => ({
      ok: true,
      value: { page: emptyPage },
    }));
    const search = createContentSearchModule(fakePort(discover));

    await search.search({ query: 'US CPI', published });

    expect(discover).toHaveBeenCalledWith({ query: 'US CPI', ...bounds, facets: [] });
  });

  it('confirms a punctuated value from the response echo in one call', async () => {
    const blogs = { field: 'type', guid: 'blogs-guid', name: 'Blogs / Commentary' } as const;
    const discover = vi.fn<ContentSearchPort['discover']>(async () => ({
      ok: true,
      value: { page: { ...emptyPage, appliedFacets: [blogs] } },
    }));
    const search = createContentSearchModule(fakePort(discover));

    await expect(search.search({
      query: 'US CPI',
      facets: [{ field: 'type', value: 'Blogs / Commentary' }],
    })).resolves.toMatchObject({ ok: true, value: { page: { appliedFacets: [blogs] }, facetMatches: [] } });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith({
      query: 'US CPI',
      facets: [{ field: 'type', value: 'Blogs / Commentary' }],
    });
  });

  it('posts each retained facet value once, keeping its first literal', async () => {
    const discover = vi.fn<ContentSearchPort['discover']>(async () => ({ ok: true, value: { page: emptyPage } }));

    await createContentSearchModule(fakePort(discover)).search({
      query: '',
      facets: [
        { field: 'source', value: ' Research ' },
        { field: 'source', value: 'research' },
        { field: 'author', value: 'Straße' },
        { field: 'author', value: 'STRASSE' },
      ],
    });
    expect(discover).toHaveBeenNthCalledWith(1, {
      query: '',
      facets: [
        { field: 'source', value: ' Research ' },
        { field: 'author', value: 'Straße' },
        { field: 'author', value: 'STRASSE' },
      ],
    });
  });

  it('re-posts a unique fuzzy rail match with its full name and echoes it', async () => {
    const example = { field: 'author', guid: 'example-guid', name: 'Alex Example' } as const;
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: {
        page: input.query === ''
          ? railPage
          : { ...emptyPage, appliedFacets: input.facets?.[0]?.value === 'Alex Example' ? [example] : [] },
      },
    }));
    const search = createContentSearchModule(fakePort(discover));

    await expect(search.search({
      query: 'US CPI',
      facets: [{ field: 'author', value: 'exam' }],
    })).resolves.toMatchObject({
      ok: true,
      value: {
        page: { appliedFacets: [example] },
        facetMatches: [{ field: 'author', input: 'exam', name: 'Alex Example' }],
      },
    });
    expect(discover.mock.calls.map(([input]) => input)).toEqual([
      { query: 'US CPI', facets: [{ field: 'author', value: 'exam' }] },
      { query: '', limit: 1 },
      { query: 'US CPI', facets: [{ field: 'author', value: 'Alex Example' }] },
    ]);
  });

  it('applies an exact name the rail omits when its facet-only probe has records', async () => {
    const blogs = { field: 'type', guid: 'blogs-guid', name: 'Blogs / Commentary' } as const;
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: {
        page: input.facets?.length && input.query === ''
          ? { ...emptyPage, resultCount: 2370, appliedFacets: [blogs] }
          : input.query === '' ? railPage : emptyPage,
      },
    }));
    const search = createContentSearchModule(fakePort(discover));

    await expect(search.search({
      query: 'US CPI',
      facets: [{ field: 'type', value: 'Blogs / Commentary' }],
    })).resolves.toMatchObject({ ok: true, value: { page: { appliedFacets: [blogs] }, facetMatches: [] } });
    expect(discover).toHaveBeenLastCalledWith({
      query: '',
      limit: 1,
      facets: [{ field: 'type', value: 'Blogs / Commentary' }],
    });
  });

  it('fails loud for a typo beside a confirmed sibling and for ambiguous values', async () => {
    const example = { field: 'author', guid: 'example-guid', name: 'Alex Example' } as const;
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: {
        page: input.query === 'US CPI'
          ? { ...emptyPage, resultCount: 5, appliedFacets: [example] }
          : input.facets?.length ? emptyPage : railPage,
      },
    }));
    const search = createContentSearchModule(fakePort(discover));

    await expect(search.search({
      query: 'US CPI',
      facets: [
        { field: 'author', value: 'Alex Example' },
        { field: 'author', value: 'exampel' },
        { field: 'author', value: 'kim' },
      ],
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'facet-resolution-rejected',
        rejections: [
          {
            status: 'not-found',
            field: 'author',
            input: 'exampel',
            candidates: [
              { name: 'Alex Example', guid: 'example-guid' },
              { name: 'Kim One', guid: 'kim-one-guid' },
              { name: 'Kim Two', guid: 'kim-two-guid' },
            ],
          },
          {
            status: 'ambiguous',
            field: 'author',
            input: 'kim',
            candidates: [
              { name: 'Kim One', guid: 'kim-one-guid' },
              { name: 'Kim Two', guid: 'kim-two-guid' },
            ],
          },
        ],
      },
    });
  });

  it('resolves a rail name exactly in any case beside a value confirmed in its own field', async () => {
    const example = { field: 'author', guid: 'example-guid', name: 'Alex Example' } as const;
    const sameNameSource = { field: 'source', guid: 'source-guid', name: 'KIM ONE' } as const;
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: { page: input.query === '' ? railPage : { ...emptyPage, appliedFacets: [sameNameSource, example] } },
    }));

    await expect(createContentSearchModule(fakePort(discover)).search({
      query: 'US CPI',
      facets: [{ field: 'author', value: 'Alex Example' }, { field: 'author', value: 'KIM ONE' }],
    })).resolves.toEqual({
      ok: true,
      value: {
        page: {
          ...emptyPage,
          appliedFacets: [sameNameSource, example, { field: 'author', guid: 'kim-one-guid', name: 'Kim One' }],
        },
        facetMatches: [],
      },
    });
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('re-posts only fuzzy matches by their full name, keeping exact literals', async () => {
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: { page: input.query === '' ? railPage : emptyPage },
    }));

    await createContentSearchModule(fakePort(discover)).search({
      query: 'US CPI',
      facets: [{ field: 'author', value: 'exam' }, { field: 'author', value: 'kim one' }],
    });
    expect(discover).toHaveBeenLastCalledWith({
      query: 'US CPI',
      facets: [{ field: 'author', value: 'Alex Example' }, { field: 'author', value: 'kim one' }],
    });
  });

  it('rejects a value only some of whose words start a rail name', async () => {
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: { page: input.query === '' && !input.facets ? railPage : emptyPage },
    }));

    await expect(createContentSearchModule(fakePort(discover)).search({
      query: 'US CPI',
      facets: [{ field: 'author', value: 'alex zzz' }],
    })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'facet-resolution-rejected', rejections: [{ status: 'not-found', input: 'alex zzz' }] },
    });
  });

  it('fails loud when a facet-only probe fails or has records without applying the value', async () => {
    const probeFailure = { ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } } as const;
    const failing = vi.fn<ContentSearchPort['discover']>(async (input) => (
      input.query === '' && input.facets ? probeFailure : { ok: true, value: { page: input.query === '' ? railPage : emptyPage } }
    ));
    const facets = [{ field: 'type', value: 'Blogs' }] as const;
    await expect(createContentSearchModule(fakePort(failing)).search({ query: 'US CPI', facets })).resolves.toEqual(probeFailure);

    const unapplied = vi.fn<ContentSearchPort['discover']>(async (input) => ({
      ok: true,
      value: { page: input.query === '' && input.facets ? { ...emptyPage, resultCount: 7 } : input.query === '' ? railPage : emptyPage },
    }));
    await expect(createContentSearchModule(fakePort(unapplied)).search({ query: 'US CPI', facets })).resolves.toEqual({
      ok: false,
      error: { kind: 'facet-resolution-failed', input: { field: 'type', value: 'Blogs' } },
    });
  });

  it('reports the first failed facet while a sibling probe remains pending', async () => {
    const failure = { ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } } as const;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const discover = vi.fn<ContentSearchPort['discover']>(async (input) => {
      if (input.query !== '' || !input.facets?.length) return { ok: true, value: { page: emptyPage } };
      if (input.facets[0]?.field === 'type') return failure;
      await held;
      return { ok: true, value: { page: emptyPage } };
    });
    const result = createContentSearchModule(fakePort(discover)).search({
      query: 'US CPI',
      facets: [{ field: 'type', value: 'Blogs' }, { field: 'source', value: 'Research' }],
    });
    try {
      const first = await Promise.race([result, new Promise<'still pending'>((resolve) => {
        setImmediate(() => resolve('still pending'));
      })]);
      expect(first).toEqual(failure);
    } finally {
      release();
      await result;
    }
  });

  it.each([
    [{ query: 'US CPI', limit: 'nope' }, { kind: 'invalid-limit', problem: 'not-positive' }],
    [{ query: 'US CPI', limit: '0' }, { kind: 'invalid-limit', problem: 'not-positive' }],
    [{ query: 'US CPI', limit: '1x' }, { kind: 'invalid-limit', problem: 'not-positive' }],
    [{ query: 'US CPI', limit: 'x1' }, { kind: 'invalid-limit', problem: 'not-positive' }],
    [{ query: 'US CPI', limit: '51' }, { kind: 'invalid-limit', problem: 'above-maximum' }],
    [{ query: 'US CPI', published: '>=2026-02-30' }, { kind: 'invalid-date-range', problem: 'invalid-date', value: '2026-02-30' }],
    [{ query: 'US CPI', published: '2026-06-02..2026-06-01' }, { kind: 'invalid-date-range', problem: 'inverted' }],
    [{ query: 'US CPI', published: '2026-06-01' }, { kind: 'invalid-date-range', problem: 'invalid-range', value: '2026-06-01' }],
    [{ query: 'US CPI', published: '>2026-06-01' }, { kind: 'invalid-date-range', problem: 'invalid-range', value: '>2026-06-01' }],
    [{ query: 'US CPI', published: '2026-06-01..' }, { kind: 'invalid-date-range', problem: 'invalid-range', value: '2026-06-01..' }],
    [{ query: 'US CPI', sort: 'newest' }, { kind: 'invalid-sort' }],
    [{ query: 'US CPI', facets: [{ field: 'source', value: '   ' }] }, { kind: 'invalid-facet', field: 'source', problem: 'value-required' }],
  ] as const)('rejects invalid search input before provider work: %#', async (input, error) => {
    const port = fakePort(vi.fn());
    const search = createContentSearchModule(port);

    await expect(search.search(input)).resolves.toEqual({
      ok: false,
      error,
    });
    expect(port.discover).not.toHaveBeenCalled();
  });
});
