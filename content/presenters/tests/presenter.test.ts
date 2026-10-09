import type { DocumentId } from '../../../document/index.js';
import { describe, expect, it } from 'vitest';
import { presentContentGet, presentContentSearch } from '../../presenter.js';
import type { Document, DocumentError } from '../../../document/index.js';
import type {
  ContentGetError,
  ContentProviderEvidence,
  ContentSearchValue,
} from '../../types.js';
import type {
  ContentSearchDocument,
  ContentSearchError as SearchError,
  ContentSearchPage,
} from '../../search/index.js';

type MalformedProblem = Extract<DocumentError, { kind: 'malformed-document' }>['problem'];

function getFailure(error: ContentGetError, evidence: readonly ContentProviderEvidence[] = []) {
  return { result: { ok: false as const, error }, evidence };
}

function documentFailure(error: DocumentError, evidence: readonly ContentProviderEvidence[] = []) {
  return getFailure({ kind: 'document-retrieval-failed', error }, evidence);
}

function searchFailure(error: SearchError, evidence: readonly ContentProviderEvidence[] = []) {
  return { result: { ok: false as const, error: { kind: 'search-failed' as const, error } }, evidence };
}

function failedCall(message: string, details?: Record<string, unknown>): ContentProviderEvidence {
  return {
    order: 1,
    owner: 'content.request',
    operation: 'POST /research/search/reports/advanced-search',
    outcome: 'failed',
    value: { kind: 'provider-failure', message, ...(details ? { details } : {}) },
  };
}

const HINT = 'Run the previous command again or use one of the refs printed above.';

function page(overrides: Partial<ContentSearchPage> = {}): ContentSearchPage {
  return {
    type: 'search-page',
    query: 'US CPI',
    link: 'https://marquee.gs.com/search',
    resultCount: 1,
    limit: 10,
    page: 1,
    sort: 'time',
    appliedFilters: [],
    appliedFacets: [],
    results: [],
    facets: [],
    ...overrides,
  };
}

function searched(
  searchPage: ContentSearchPage,
  value: Partial<ContentSearchValue> = {},
  evidence: readonly ContentProviderEvidence[] = [],
) {
  return {
    result: {
      ok: true as const,
      value: {
        page: searchPage,
        facetMatches: [],
        namespace: 's1',
        documentRefs: searchPage.results.map((_, index) => `s1.c${index + 1}`),
        ...value,
      },
    },
    evidence,
  };
}

function result(title: string, fields: Partial<ContentSearchDocument> = {}): ContentSearchDocument {
  return { documentId: title.toLowerCase(), type: 'document', title, ...fields };
}

describe('Content get presentation', () => {
  const fed: Document = {
    identifier: { kind: 'gir-research-uuid', documentId: 'doc-1' as DocumentId },
    title: 'Fed \n outlook',
    publicationDate: '2026-01-15T14:30:00.000Z',
    authors: ['Ana Author', 'Ben Writer'],
    source: 'Research  |  Economics',
    quote: 'Rates  on hold',
    synopsis: 'Cuts\nlater',
    body: 'First   paragraph.\n\n  \nSecond paragraph.',
    url: 'https://marquee.gs.com/content/1',
  };

  it('prints Document fields and the body with its line breaks, and no synopsis', async () => {
    await expect(presentContentGet({
      result: {
        ok: true,
        value: {
          namespace: 's1.c2',
          document: {
            identifier: { kind: 'gir-research-uuid', documentId: 'doc-1' as DocumentId },
            title: 'Fed outlook',
            url: 'https://marquee.gs.com/content/1',
            publicationDate: '2026-01-15T14:30:00.000Z',
            authors: ['Smith, Jane', 'Lee, Ann'],
            source: 'Research | Macro',
            synopsis: 'First paragraph.',
            body: 'First paragraph.\n\nSecond paragraph.',
          },
        },
      },
      evidence: [],
    }, {})).resolves.toEqual({
      output: [
        'title:\tFed outlook',
        'ref:\t@s1.c2',
        'url:\thttps://marquee.gs.com/content/1',
        'published:\t2026-01-15T14:30:00.000Z',
        'authors:\tSmith, Jane; Lee, Ann',
        'source:\tResearch | Macro',
        '',
        'Body',
        'First paragraph.',
        '',
        'Second paragraph.',
        '',
        'To open it in a browser, try: marquee browser open @s1.c2',
        '',
      ].join('\n'),
    });
  });

  it.each([
    ['no body', {}],
    ['a blank body', { body: ' \n ' }],
  ])('prints missing Document fields empty and omits %s', async (_name, fields) => {
    await expect(presentContentGet({
      result: {
        ok: true,
        value: {
          namespace: 'c1',
          document: {
            identifier: { kind: 'gir-research-uuid', documentId: 'doc-2' as DocumentId },
            title: 'Asia morning note',
            ...fields,
          },
        },
      },
      evidence: [],
    }, {})).resolves.toEqual({
      output: [
        'title:\tAsia morning note',
        'ref:\t@c1',
        'url:\t',
        'published:\t',
        'authors:\t',
        'source:\t',
        '',
        'To open it in a browser, try: marquee browser open @c1',
        '',
      ].join('\n'),
    });
  });

  it('projects the requested --json fields of a Document, keys sorted', async () => {
    await expect(presentContentGet({
      result: {
        ok: true,
        value: {
          namespace: 'c1',
          document: {
            identifier: { kind: 'gir-research-uuid', documentId: 'doc-3' as DocumentId },
            title: 'Note',
            synopsis: 'Short summary.',
            body: 'Body.',
          },
        },
      },
      evidence: [],
    }, { json: 'title,ref,id,url' })).resolves.toEqual({
      output: '{"id":"doc-3","ref":"@c1","title":"Note","url":null}\n',
    });
  });

  it('keeps the empty authors list of a Document with none', async () => {
    const authorless: Document = {
      identifier: { kind: 'content-stream-id', documentId: 'doc-3' as DocumentId },
      title: 'Authorless note',
      authors: [],
    };
    const got = { result: { ok: true as const, value: { document: authorless, namespace: 'c1' } }, evidence: [] };
    await expect(presentContentGet(got, { json: 'authors,title' })).resolves.toEqual({
      output: '{"authors":[],"title":"Authorless note"}\n',
    });
  });

  it('projects every --json field of a Document', async () => {
    await expect(presentContentGet({
      result: { ok: true, value: { document: fed, namespace: 'c1' } },
      evidence: [],
    }, { json: 'authors,body,id,published,ref,source,title,url' })).resolves.toEqual({
      output: '{"authors":["Ana Author","Ben Writer"],"body":"First   paragraph.\\n\\n  \\nSecond paragraph.","id":"doc-1",'
        + '"published":"2026-01-15T14:30:00.000Z","ref":"@c1","source":"Research  |  Economics",'
        + '"title":"Fed \\n outlook","url":"https://marquee.gs.com/content/1"}\n',
    });
  });

  it.each<[string, ReturnType<typeof getFailure>, string, number]>([
    ['session loss', documentFailure({ kind: 'authentication-required', realm: 'research' }),
      'Not authenticated. Run: marquee auth login', 4],
    ['a denied Document', documentFailure({
      kind: 'access-denied',
      locator: { kind: 'document-id', documentId: 'doc-1' },
    }), 'Content document access denied', 1],
    ['a missing Document id', documentFailure({
      kind: 'not-found',
      locator: { kind: 'document-id', documentId: 'missing-1' },
      problem: 'retrieval-miss',
    }), 'no content document matching "missing-1"', 1],
    ['a missing Document URL', documentFailure({
      kind: 'not-found',
      locator: { kind: 'marquee-content-url', url: 'https://marquee.gs.com/content/missing' },
      problem: 'retrieval-miss',
    }), 'no content document matching "document"', 1],
    ['a cancelled Document request', documentFailure({
      kind: 'dependency',
      identity: { kind: 'document-id', documentId: 'doc-1' },
      failure: { kind: 'cancelled' },
    }), 'Content document dependency is unavailable', 2],
    ['an expired dependency session', documentFailure({
      kind: 'dependency',
      identity: { kind: 'document-id', documentId: 'doc-1' },
      failure: { kind: 'authentication-required', realm: 'research' },
    }), 'Content document dependency is unavailable', 4],
    ['a timed-out Document request', documentFailure({
      kind: 'dependency',
      identity: { kind: 'document-id', documentId: 'doc-1' },
      failure: { kind: 'timeout' },
    }), 'Content document dependency is unavailable', 1],
    ['a downloadable Model', documentFailure({
      kind: 'downloadable-model',
      identity: { kind: 'document-id', documentId: '123e4567-e89b-12d3-a456-426614174004' },
      url: 'https://marquee.gs.com/content/research/en/models/2026/08/10/123e4567-e89b-12d3-a456-426614174004.html',
    }), 'This Content is a downloadable Model. Run: marquee browser open https://marquee.gs.com/content/research/en/models/2026/08/10/123e4567-e89b-12d3-a456-426614174004.html', 1],
    ['a Ref of another kind', getFailure({
      kind: 'wrong-artifact-kind',
      ref: 's1',
      artifact: { type: 'search', searchKind: 'research' },
    }), 'ref @s1 is a search — use `marquee content search ...`', 1],
  ])('presents %s', async (_name, outcome, message, exitCode) => {
    await expect(presentContentGet(outcome, {})).resolves.toEqual({ output: `Error: ${message}\n`, exitCode });
  });

  it.each<[MalformedProblem, string]>([
    ['response-not-object', 'response must be an object'],
    ['id-required', 'id is required'],
    ['id-mismatch', 'id must match the requested document'],
    ['title-required', 'distributionHeadline_input_en is required'],
    ['publication-date-required', 'publicationDateTime must be a number'],
    ['publication-date-invalid', 'publicationDateTime is invalid'],
    ['digital-path-invalid', 'digitalPath must name a Markets or Research content path'],
    ['content-required', 'content_input_en is required'],
    ['authors-not-array', 'tags must be an array'],
    ['author-name-required', 'author tags require displayName_input_en'],
    ['source-required', 'sourceDisplayName is required'],
  ])('names the unsupported doc-search field for %s', async (problem, reason) => {
    const presentation = await presentContentGet(documentFailure({
      kind: 'malformed-document',
      identity: { kind: 'document-id', documentId: 'doc-1' },
      source: 'doc-search',
      problem,
    }), {});
    expect(presentation.output).toBe(
      `Error: Unsupported doc-search v3 response shape: ${reason}; record a Scenario before accepting this fallback.\n`,
    );
  });

  it('presents the latest provider diagnostic, truncating its body', async () => {
    const body = `${'x'.repeat(200)}TRUNCATED`;
    await expect(presentContentGet(documentFailure({
      kind: 'dependency',
      identity: { kind: 'document-id', documentId: 'doc-1' },
      failure: { kind: 'unavailable' },
    }, [
      failedCall('Marquee returned 502 for /first'),
      { order: 2, owner: 'document', operation: 'GET /second', outcome: 'succeeded', value: { ok: true } },
      failedCall('Marquee returned 500 for /research/search/reports_2/doc-search/doc-1', { body }),
      { order: 4, owner: 'document', operation: 'GET /fourth', outcome: 'dispatched' },
    ]), {})).resolves.toEqual({
      output: `Error: Marquee returned 500 for /research/search/reports_2/doc-search/doc-1 — ${'x'.repeat(200)}\n`,
      exitCode: 1,
    });
  });

  it('prints a failed view as its text error even with --json', async () => {
    await expect(presentContentGet(
      documentFailure({ kind: 'authentication-required', realm: 'research' }),
      { json: 'title', jq: '.title' },
    )).resolves.toEqual({
      output: 'Error: Not authenticated. Run: marquee auth login\n',
      exitCode: 4,
    });
  });

  it('ranks the current refs nearest the unknown ref first', async () => {
    await expect(presentContentGet(getFailure({
      kind: 'artifact-not-found',
      ref: 's2.c9',
      availableRefs: ['w1', 's1', 'c1', 's2.c1', 's2', 's3', 's2.c2', 'd1'],
    }), {})).resolves.toEqual({
      output: `Error: ref @s2.c9 not found\nHint: current refs include @s2, @s2.c1, @s2.c2, @s1, @s3, @w1, ....\n${HINT}\n`,
      exitCode: 1,
    });
  });

  it('lists every current ref when there are few', async () => {
    await expect(presentContentGet(getFailure({
      kind: 'artifact-not-found',
      ref: 'c7',
      availableRefs: ['s1', 'c1', 'c2'],
    }), {})).resolves.toEqual({
      output: `Error: ref @c7 not found\nHint: current refs include @c1, @c2, @s1.\n${HINT}\n`,
      exitCode: 1,
    });
  });

  it('hints at rerunning when no refs are current', async () => {
    await expect(presentContentGet(getFailure({
      kind: 'artifact-not-found',
      ref: 'c7',
      availableRefs: [],
    }), { json: 'title' })).resolves.toEqual({
      output: 'Error: ref @c7 not found\nHint: run the previous command again or use one of the refs printed above.\n',
      exitCode: 1,
    });
  });
});

describe('Content search presentation', () => {
  it('reports an empty Content Search on stderr', async () => {
    await expect(presentContentSearch(searched(page({
      query: 'zxqwvk',
      resultCount: 0,
      facets: [{ field: 'source', label: 'Source', isSelected: false, values: [{ name: 'Research', count: 0, isSelected: false }] }],
    })), {})).resolves.toEqual({ output: 'no results match "zxqwvk"\n', channel: 'stderr' });
  });

  it('prints one row per Document, a Filters table, the sort sentence and hints', async () => {
    const facetValues = ['Research', 'FICC and Equities', 'Wealth Management', 'Asset Management', 'GS.com', 'Other', 'News']
      .map((name, index) => ({ name, count: 1200 - index, isSelected: false }));
    await expect(presentContentSearch(searched(page({
      resultCount: 12345,
      limit: 2,
      results: [
        result('Example Weekly Note:\nJune 15', {
          publicationDate: '2026-06-14T12:00:00.000Z',
          source: 'Research | Economics',
          authors: ['Taylor Example', 'Alex Example, CFA'],
          synopsis: 'Synopsis is not a match.',
          snippet: 'Example matching passage',
        }),
        result('No match passage', {
          publicationDate: '2026-06-14T11:00:00.000Z',
          source: 'FICC and Equities',
          authors: [],
          synopsis: 'Synopsis only.',
        }),
      ],
      facets: [
        { field: 'source', label: 'Source', isSelected: false, values: facetValues },
        { field: 'focus', label: 'Focus', isSelected: false, values: [{ name: 'Country', count: 345, isSelected: false }] },
      ],
    })), {})).resolves.toEqual({
      output: [
        'Results (2 of 12345 results)',
        'ref\ttitle\tpublished\tsource\tauthors\tsnippet',
        '@s1.c1\tExample Weekly Note: June 15\t2026-06-14T12:00:00.000Z\tResearch | Economics\tTaylor Example; Alex Example, CFA\tExample matching passage',
        '@s1.c2\tNo match passage\t2026-06-14T11:00:00.000Z\tFICC and Equities\t\t',
        '',
        'Filters',
        'flag\ttop 1\ttop 2\ttop 3\ttop 4\ttop 5\tmore',
        '--source\tResearch (1200)\tFICC and Equities (1199)\tWealth Management (1198)\tAsset Management (1197)\tGS.com (1196)\t2',
        '--focus\tCountry (345)\t\t\t\t\t',
        '',
        'Sorted by time.',
        'To sort by relevance, try: marquee content search "US CPI" --sort relevance',
        'To narrow results, try: marquee content search "US CPI" --source Research',
        '',
      ].join('\n'),
    });
  });

  it('carries the query, applied facets and range into its hints, narrowing by the first unselected value', async () => {
    const presentation = await presentContentSearch(searched(page({
      query: 'rates',
      sort: 'relevance',
      from: '2026-06-01',
      to: '2026-06-15',
      appliedFacets: [{ field: 'source', guid: 'g-1', name: 'FICC and Equities' }],
      results: [result('Note')],
      facets: [
        { field: 'source', label: 'Sources', isSelected: true, values: [{ name: 'FICC and Equities', count: 3, isSelected: true }] },
        { field: 'Language', label: 'Language', isSelected: false, values: [{ name: 'English', count: 3, isSelected: false }] },
      ],
    })), {});
    expect(presentation.output.split('\n').slice(-7)).toEqual([
      '--source\tFICC and Equities (3)\t\t\t\t\t',
      'Language\tEnglish (3)\t\t\t\t\t',
      '',
      'Sorted by relevance.',
      'To sort by time, try: marquee content search rates --source "FICC and Equities" --published 2026-06-01..2026-06-15 --sort time',
      'To narrow results, try: marquee content search rates --source "FICC and Equities" --published 2026-06-01..2026-06-15 Language English',
      '',
    ]);
  });

  it.each([
    [{ from: '2026-06-01' }, '--published ">=2026-06-01"'],
    [{ to: '2026-06-15' }, '--published "<=2026-06-15"'],
  ])('carries a one-sided range %o into its hints', async (range, published) => {
    const presentation = await presentContentSearch(searched(page({
      query: 'cpi',
      results: [result('Note')],
      facets: [{ field: 'source', label: 'Source', isSelected: false, values: [{ name: 'Research', count: 1, isSelected: false }] }],
      ...range,
    })), {});
    expect(presentation.output.split('\n').slice(-3)).toEqual([
      `To sort by relevance, try: marquee content search cpi ${published} --sort relevance`,
      `To narrow results, try: marquee content search cpi ${published} --source Research`,
      '',
    ]);
  });

  it('prints no Filters table or narrowing hint without facets, and no query for a facet-only search', async () => {
    await expect(presentContentSearch(searched(page({
      query: '',
      resultCount: 1,
      results: [result('Note')],
    })), {})).resolves.toEqual({
      output: [
        'Results',
        'ref\ttitle\tpublished\tsource\tauthors\tsnippet',
        '@s1.c1\tNote\t\t\t\t',
        '',
        'Sorted by time.',
        'To sort by relevance, try: marquee content search --sort relevance',
        '',
      ].join('\n'),
    });
  });

  it('projects every --json field of each search result', async () => {
    await expect(presentContentSearch(searched(page({
      results: [
        result('Note', {
          publicationDate: '2026-06-15T02:49:00.000Z',
          source: 'Research',
          authors: ['A', 'B'],
          snippet: 'CPI rose',
          url: 'https://marquee.gs.com/content/note',
        }),
        result('Bare'),
      ],
    })), { json: 'authors,id,published,ref,snippet,source,title,url' })).resolves.toEqual({
      output: '[{"authors":["A","B"],"id":"note","published":"2026-06-15T02:49:00.000Z","ref":"@s1.c1",'
        + '"snippet":"CPI rose","source":"Research","title":"Note","url":"https://marquee.gs.com/content/note"},'
        + '{"authors":null,"id":"bare","published":null,"ref":"@s1.c2","snippet":null,"source":null,'
        + '"title":"Bare","url":null}]\n',
    });
  });

  it('filters the projected search results through --jq', async () => {
    await expect(presentContentSearch(searched(page({ results: [result('US CPI note')] })), {
      json: 'title,ref',
      jq: '.[0].title',
    })).resolves.toEqual({ output: 'US CPI note\n' });
  });

  it.each<[string, SearchError, readonly ContentProviderEvidence[], string, number]>([
    ['a limit above the maximum', { kind: 'invalid-limit', problem: 'above-maximum' }, [], '--limit max is 50', 1],
    ['a non-positive limit', { kind: 'invalid-limit', problem: 'not-positive' }, [], '--limit must be a positive integer', 1],
    ['an inverted range', { kind: 'invalid-date-range', problem: 'inverted' }, [],
      '--published range start must not be later than its end', 1],
    ['a malformed range', { kind: 'invalid-date-range', problem: 'invalid-range', value: '>2026-06-01' }, [],
      'invalid --published ">2026-06-01"; expected ">=YYYY-MM-DD", "<=YYYY-MM-DD" or YYYY-MM-DD..YYYY-MM-DD', 1],
    ['an invalid date', { kind: 'invalid-date-range', problem: 'invalid-date', value: '2026-02-30' }, [],
      'invalid date "2026-02-30"; expected YYYY-MM-DD', 1],
    ['an unknown sort', { kind: 'invalid-sort' }, [], '--sort must be time or relevance', 1],
    ['an empty facet value', { kind: 'invalid-facet', field: 'author', problem: 'value-required' }, [], '--author value is required', 1],
    ['a failed facet lookup', { kind: 'facet-resolution-failed', input: { field: 'author', value: 'x' } }, [],
      'content facet resolution failed', 1],
    ['a failed discovery', { kind: 'discovery-failed' }, [], 'Content search discovery failed', 1],
    ['an expired session', { kind: 'dependency', failure: { kind: 'authentication-required', realm: 'research' } },
      [failedCall('Marquee returned 401')], 'Research session expired or missing. Run: marquee auth login', 4],
    ['a Goldman link to renew', { kind: 'dependency', failure: { kind: 'authentication-required', realm: 'research' } },
      [failedCall('Goldman link expired. Re-link your Goldman account to continue.', { credentialServiceCode: 'relink_required' })],
      'Goldman link expired. Re-link your Goldman account to continue.', 4],
    ['a timeout', { kind: 'dependency', failure: { kind: 'timeout' } }, [], 'Content search timed out', 1],
    ['a cancellation', { kind: 'dependency', failure: { kind: 'cancelled' } }, [], 'Content search cancelled', 2],
    ['a rate limit', { kind: 'dependency', failure: { kind: 'rate-limited' } }, [], 'Content search rate limited', 1],
    ['an outage', { kind: 'dependency', failure: { kind: 'unavailable' } }, [], 'Content search dependency failed', 1],
  ])('presents %s', async (_name, error, evidence, message, exitCode) => {
    await expect(presentContentSearch(searchFailure(error, evidence), {}))
      .resolves.toEqual({ output: `Error: ${message}\n`, exitCode });
  });

  it('prints each aggregated facet rejection as its own error', async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({ name: `Cohen ${index + 1}`, guid: `g-${index + 1}` }));
    const presentation = await presentContentSearch(searchFailure({
      kind: 'facet-resolution-rejected',
      rejections: [
        { status: 'ambiguous', field: 'author', input: 'cohen', candidates },
        { status: 'not-found', field: 'source', input: 'missing', candidates: [] },
      ],
    }), {});
    expect(presentation).toEqual({
      output: [
        'Error: ambiguous author "cohen" — candidates:',
        '  Cohen 1',
        '  Cohen 2',
        '  Cohen 3',
        '  Cohen 4',
        '  Cohen 5',
        '  Cohen 6',
        '  Cohen 7',
        '  Cohen 8',
        '  Cohen 9',
        '  Cohen 10',
        '  …and 2 more — narrow the value',
        'Error: no source matching "missing" — known sources:',
        '',
      ].join('\n'),
      exitCode: 1,
    });
  });

  it('lists at most ten known values in rail order without counts for an unknown author', async () => {
    const candidates = [
      { name: 'Zoe', guid: 'z', count: 1 },
      { name: 'Amy', guid: 'a', count: 999 },
      { name: 'Lee', guid: 'l', count: 42 },
      { name: 'Sam', guid: 's' },
      { name: 'Pat', guid: 'p' },
      { name: 'Kim', guid: 'k' },
      { name: 'Alex', guid: 'x' },
      { name: 'Jo', guid: 'j' },
      { name: 'Max', guid: 'm' },
      { name: 'Dee', guid: 'd' },
      { name: 'Ray', guid: 'r' },
      { name: 'Bea', guid: 'b' },
    ];
    await expect(presentContentSearch(searchFailure({
      kind: 'facet-resolution-rejected',
      rejections: [{ status: 'not-found', field: 'author', input: 'typo', candidates }],
    }), {})).resolves.toEqual({
      output: 'Error: no author matching "typo" — known authors:\n  Zoe\n  Amy\n  Lee\n  Sam\n  Pat\n  Kim\n  Alex\n  Jo\n  Max\n  Dee\n  …and 2 more — copy an exact value\n',
      exitCode: 1,
    });
  });

  it('lists every known value without an elision when fewer than ten exist', async () => {
    await expect(presentContentSearch(searchFailure({
      kind: 'facet-resolution-rejected',
      rejections: [{
        status: 'not-found', field: 'source', input: 'missing',
        candidates: [{ name: 'Research', guid: 'r' }, { name: 'FICC and Equities', guid: 'f' }],
      }],
    }), {})).resolves.toEqual({
      output: 'Error: no source matching "missing" — known sources:\n  Research\n  FICC and Equities\n',
      exitCode: 1,
    });
  });

  it('prints a failed search as its text error even with --json', async () => {
    await expect(presentContentSearch(
      searchFailure({ kind: 'dependency', failure: { kind: 'cancelled' } }),
      { json: 'title', jq: '.[0].title' },
    )).resolves.toEqual({
      output: 'Error: Content search cancelled\n',
      exitCode: 2,
    });
  });
});
