import assert from 'node:assert/strict';
import { ContentApi } from '../../../api/content/index.js';
import { MarqueeError } from '../../../transport/index.js';
import type { DependencyFailure, Endpoint, HttpRequestInit } from '../../../transport/index.js';
import type {
  ContentFacetField,
  ContentFacetInput,
  ContentSearchAppliedFacet,
  ContentSearchDocument,
  ContentSearchFacet,
  ContentSearchFacetValue,
  ContentSearchPage,
  ContentSearchResult,
  ContentSearchSort,
} from '../types.js';
import type {
  ContentSearchDiscoveryInput,
  ContentSearchPort,
} from '../module.js';

type ContentSearchArgs = ContentSearchDiscoveryInput;

type ContentSearchEvidence = Readonly<{
  reserve(call: Readonly<{ owner: string; operation: string }>): Readonly<{
    fail(value?: unknown): void;
  }> | undefined;
}>;

type ContentSearchTransport = Readonly<{
  request(endpoint: Endpoint, init?: HttpRequestInit): Promise<unknown>;
}>;

type AdvancedSearchRaw = {
  documents?: Array<{
    id?: string;
    distributionHeadline?: string;
    title?: string;
    publicationDateTime?: string | number;
    authors?: string[];
    source?: string;
    sources?: string[];
    sourceDisplayName?: string;
    highlight?: string;
    synopsis?: string;
    path?: string;
    downloadPath?: string | null;
  }>;
  facetList?: Array<{
    label?: string;
    cssClass?: string;
    selected?: boolean;
    values?: Array<{
      id?: string;
      guid?: string;
      name?: string;
      count?: number;
      selected?: boolean;
      query?: string;
    }>;
  }>;
  totalRecords?: number;
  page?: number;
};
type AdvancedSearchDocumentRaw = NonNullable<AdvancedSearchRaw['documents']>[number];
type AdvancedSearchFacetRaw = NonNullable<AdvancedSearchRaw['facetList']>[number];
type AdvancedSearchFacetValueRaw = NonNullable<NonNullable<AdvancedSearchFacetRaw['values']>>[number];

const DEFAULT_PAGE_SIZE = 10;
const FACET_API_FIELDS = {
  author: 'authors',
  source: 'sources',
  type: 'report_types',
  region: 'regions_and_countries',
  subject: 'subjects_and_notability',
  company: 'companies',
  industry: 'industries',
  publication: 'publications',
  subsource: 'disciplines_and_assets',
  action: 'actions',
  focus: 'focus',
} satisfies Record<ContentFacetField, string>;
const FACET_LABEL_FIELDS: Readonly<Record<string, ContentFacetField>> = {
  sources: 'source',
  'sub-sources/assets': 'subsource',
  'report types': 'type',
  publications: 'publication',
  authors: 'author',
  'regions/countries': 'region',
  subjects: 'subject',
  companies: 'company',
  industries: 'industry',
  actions: 'action',
  focus: 'focus',
};

function assertContentSearchShape(condition: unknown, reason: string): asserts condition {
  assert(condition, `Unsupported content search response shape: ${reason}; record a Scenario before accepting this fallback.`);
}

function requiredString(value: unknown, label: string): string {
  assertContentSearchShape(typeof value === 'string' && value.trim().length > 0, `${label} is required`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  assertContentSearchShape(typeof value === 'number' && Number.isFinite(value), `${label} is not a number`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  assertContentSearchShape(typeof value === 'boolean', `${label} is not a boolean`);
  return value;
}

function advancedSearchDocuments(raw: AdvancedSearchRaw): NonNullable<AdvancedSearchRaw['documents']> {
  assertContentSearchShape(Array.isArray(raw.documents), 'documents is not an array');
  return raw.documents;
}

function advancedSearchFacets(raw: AdvancedSearchRaw): NonNullable<AdvancedSearchRaw['facetList']> {
  assertContentSearchShape(Array.isArray(raw.facetList), 'facetList is not an array');
  return raw.facetList;
}

function buildBareFilterClause(query: string): string {
  return `all EQ \${(${query})}$`;
}

function normalizeSort(sort: ContentSearchSort | undefined): ContentSearchSort {
  return sort === 'relevance' ? 'relevance' : 'time';
}

// The UTC instant of midnight in the research time zone that starts the given day (YYYY-MM-DD,
// validated by Content Search) plus daysToAdd. New York midnight is 04:00Z in daylight time and
// 05:00Z in standard time.
function researchDateBoundaryIso(value: string, daysToAdd = 0): string {
  const [year, month, day] = value.split('-');
  const daylightMidnight = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + daysToAdd, 4));
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(daylightMidnight);
  const midnight = hour === '00' ? daylightMidnight : new Date(daylightMidnight.getTime() + 3_600_000);
  return midnight.toISOString().slice(0, 19);
}

function buildFilterClause(args: ContentSearchArgs): string {
  const clauses = args.query ? [buildBareFilterClause(args.query)] : [];
  const { from, to } = args;
  if (from && to) {
    clauses.push(`publicationDateTime IN [${researchDateBoundaryIso(from)},${researchDateBoundaryIso(to, 1)}]`);
  } else if (from) {
    clauses.push(`publicationDateTime GEQ ${researchDateBoundaryIso(from)}`);
  } else if (to) {
    clauses.push(`publicationDateTime LEQ ${researchDateBoundaryIso(to, 1)}`);
  }

  return clauses.join(' AND ');
}

function buildSearchFilter(args: ContentSearchArgs): string | undefined {
  const clause = buildFilterClause(args);
  return clause ? `(${clause})` : undefined;
}

function buildAdvancedSearchBody(args: ContentSearchArgs): Record<string, unknown> {
  const filter = buildSearchFilter(args);
  return {
    ...(filter ? { filter } : {}),
    facets: buildFacets(args.facets ?? []),
    sort: normalizeSort(args.sort),
    page: 1,
    size: args.limit ?? DEFAULT_PAGE_SIZE,
    language: '["en"]',
    limitTo: '[""]',
    applyHighlighting: true,
  };
}

function quoteFacetValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFacets(facets: readonly ContentFacetInput[]): string {
  const byField = new Map<ContentFacetField, string[]>();
  for (const facet of facets) {
    byField.set(facet.field, [...(byField.get(facet.field) ?? []), quoteFacetValue(facet.value)]);
  }
  const clauses = [...byField.entries()].map(([field, values]) => (
    values.length === 1
      ? `${FACET_API_FIELDS[field]} CONTAINS_ALL [${values[0]}]`
      : `${FACET_API_FIELDS[field]} CONTAINS_ANY [${values.join(',')}]`
  ));
  return `(${clauses.join(' AND ')})`;
}

function buildSearchLink(
  args: ContentSearchArgs,
  appliedFacets: readonly ContentSearchAppliedFacet[],
): string {
  const filter = buildSearchFilter(args);
  const facets = buildFacets(appliedFacets.map(({ field, guid }) => ({ field, value: guid })));
  const sort = normalizeSort(args.sort);
  const query = [
    ...(filter ? [`filter=${encodeURIComponent(filter)}`] : []),
    ...(facets !== '()' ? [`facets=${encodeURIComponent(facets)}`] : []),
    `sort=${sort}`,
    'language=%5B%22en%22%5D',
  ].join('&');
  return `https://marquee.gs.com/content/research/site/search.html?${query}`;
}

function normalizeAuthors(value: string[] | undefined): string[] {
  assertContentSearchShape(Array.isArray(value), 'documents[].authors is not an array');
  return value.map((author) => requiredString(author, 'documents[].authors[]'));
}

// Advanced search marks matches with <b> and escapes only ampersands.
function stripSnippetMarkup(value: string): string {
  return value
    .replace(/<\/?b>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function optionalSnippetString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  assertContentSearchShape(typeof value === 'string', `${label} is not a string`);
  return stripSnippetMarkup(value);
}

function normalizeDocument(item: AdvancedSearchDocumentRaw): ContentSearchDocument {
  const id = requiredString(item.id, 'documents[].id');
  const title = requiredString(item.distributionHeadline, 'documents[].distributionHeadline');
  const publicationDate = new Date(
    requiredNumber(item.publicationDateTime, 'documents[].publicationDateTime'),
  ).toISOString();
  const authors = normalizeAuthors(item.authors);
  const source = requiredString(item.sourceDisplayName, 'documents[].sourceDisplayName');
  const documentSource = requiredString(item.source, 'documents[].source');
  const synopsis = optionalSnippetString(item.synopsis, 'documents[].synopsis');
  const snippet = optionalSnippetString(item.highlight, 'documents[].highlight');
  const path = requiredString(item.path, 'documents[].path');
  return {
    documentId: id,
    type: 'document',
    title,
    publicationDate,
    authors,
    source,
    documentSource,
    ...(synopsis ? { synopsis } : {}),
    ...(snippet ? { snippet } : {}),
    path,
    ...(item.downloadPath === null
      ? {}
      : { downloadPath: requiredString(item.downloadPath, 'documents[].downloadPath') }),
    url: `https://marquee.gs.com${path}`,
  };
}

function normalizeDocuments(raw: AdvancedSearchRaw): ContentSearchDocument[] {
  return advancedSearchDocuments(raw).map(normalizeDocument);
}

function normalizeFacetValues(values: AdvancedSearchFacetRaw['values']): ContentSearchFacetValue[] {
  assertContentSearchShape(Array.isArray(values), 'facetList[].values is not an array');
  return values.map((value: AdvancedSearchFacetValueRaw): ContentSearchFacetValue => {
    const id = requiredString(value.id, 'facetList[].values[].id');
    const guid = requiredString(value.guid, 'facetList[].values[].guid');
    const name = requiredString(value.name, 'facetList[].values[].name');
    return {
      facetValueId: id,
      guid,
      name,
      count: requiredNumber(value.count, 'facetList[].values[].count'),
      isSelected: requiredBoolean(value.selected, 'facetList[].values[].selected'),
    };
  });
}

function normalizeFacets(raw: AdvancedSearchRaw): ContentSearchFacet[] {
  const facets: ContentSearchFacet[] = [];
  for (const facet of advancedSearchFacets(raw)) {
    const label = requiredString(facet.label, 'facetList[].label');
    const values = normalizeFacetValues(facet.values);
    assertContentSearchShape(values.length > 0, 'facetList[].values is empty');
    facets.push({
      field: FACET_LABEL_FIELDS[label.toLowerCase()] ?? label,
      label,
      isSelected: requiredBoolean(facet.selected, 'facetList[].selected'),
      values,
    });
  }
  return facets;
}

function appliedFacetsFromEcho(
  facets: readonly ContentSearchFacet[],
  requested: readonly ContentFacetInput[],
): ContentSearchAppliedFacet[] {
  const applied: ContentSearchAppliedFacet[] = [];
  for (const input of requested) {
    const echo = facets.find((facet) => facet.field === input.field)?.values.find((value) => (
      value.name.toLowerCase() === input.value.toLowerCase()
    ));
    if (!echo?.guid || applied.some((facet) => facet.guid === echo.guid)) continue;
    applied.push({ field: input.field, guid: echo.guid, name: echo.name });
  }
  return applied;
}

function mechanicalFailure(error: unknown): DependencyFailure | undefined {
  if (!(error instanceof MarqueeError)) return undefined;
  if (error.code === 'auth_expired') {
    return { kind: 'authentication-required', realm: 'research' };
  }
  if (error.code === 'timeout') return { kind: 'timeout' };
  if (error.details?.isCanceled === true) return { kind: 'cancelled' };
  if (error.details?.status === 429) return { kind: 'rate-limited' };
  return { kind: 'unavailable' };
}

function recordAdapterFailure(
  evidence: ContentSearchEvidence | undefined,
  operation: string,
  error: unknown,
): void {
  evidence?.reserve({ owner: 'content.search', operation })?.fail({
    kind: 'adapter-failure',
    message: error instanceof Error ? error.message : String(error),
  });
}

function decodeContentSearch(raw: unknown, args: ContentSearchArgs): ContentSearchPage {
  const value = raw as AdvancedSearchRaw;
  const limit = args.limit ?? DEFAULT_PAGE_SIZE;
  const facets = normalizeFacets(value);
  const appliedFacets = appliedFacetsFromEcho(facets, args.facets ?? []);
  return {
    type: 'search-page',
    query: args.query,
    link: buildSearchLink(args, appliedFacets),
    resultCount: requiredNumber(value.totalRecords, 'totalRecords'),
    limit,
    page: requiredNumber(value.page, 'page'),
    sort: normalizeSort(args.sort),
    ...(args.from ? { from: args.from } : {}),
    ...(args.to ? { to: args.to } : {}),
    appliedFilters: [],
    appliedFacets,
    results: normalizeDocuments(value).slice(0, limit),
    facets,
  };
}

async function executeAdvancedSearch(
  transport: ContentSearchTransport,
  evidence: ContentSearchEvidence | undefined,
  input: ContentSearchArgs,
): Promise<ContentSearchResult<{ page: ContentSearchPage }>> {
  let raw: unknown;
  try {
    // The v2 search media type Web asks for.
    raw = await new ContentApi({
      request: (endpoint, init) => transport.request(endpoint, {
        ...init,
        headers: {
          Accept: 'application/prs.gir-search-service.v2+json;charset=UTF-8',
          'Content-Type': 'application/json;charset=UTF-8',
        },
      }),
    }).searchReports(buildAdvancedSearchBody(input));
  } catch (error) {
    const failure = mechanicalFailure(error);
    if (failure) {
      return {
        ok: false,
        error: { kind: 'dependency', failure },
      };
    }
    return { ok: false, error: { kind: 'discovery-failed' } };
  }
  try {
    return {
      ok: true,
      value: { page: decodeContentSearch(raw, input) },
    };
  } catch (error) {
    recordAdapterFailure(
      evidence,
      `decode POST ${ContentApi.advancedSearch.path}`,
      error,
    );
    return { ok: false, error: { kind: 'discovery-failed' } };
  }
}

export function createContentSearchProductionPort(
  transport: ContentSearchTransport,
  evidence?: ContentSearchEvidence,
): ContentSearchPort {
  return {
    async discover(input) {
      return executeAdvancedSearch(transport, evidence, input);
    },
    withAppliedFacets(page, appliedFacets) {
      const args = { query: page.query, sort: page.sort, from: page.from, to: page.to };
      return { ...page, link: buildSearchLink(args, appliedFacets), appliedFacets };
    },
  };
}
