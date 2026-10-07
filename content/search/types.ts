import type { DependencyFailure } from '../../transport/index.js';

export type ContentFacetField =
  | 'source'
  | 'subsource'
  | 'type'
  | 'publication'
  | 'author'
  | 'region'
  | 'subject'
  | 'company'
  | 'industry'
  | 'action'
  | 'focus';

export type ContentSearchSort = 'time' | 'relevance';

export type ContentFacetInput = Readonly<{
  field: ContentFacetField;
  value: string;
}>;

export type ContentSearchAppliedFacet = Readonly<{
  field: ContentFacetField;
  guid: string;
  name: string;
}>;

export type ContentSearchDocument = Readonly<{
  documentId: string;
  type: 'document';
  title: string;
  publicationDate?: string;
  authors?: readonly string[];
  source?: string;
  documentSource?: string;
  synopsis?: string;
  snippet?: string;
  path?: string;
  downloadPath?: string;
  url?: string;
}>;

export type ContentSearchFacetValue = Readonly<{
  facetValueId?: string;
  guid?: string;
  name: string;
  count: number;
  isSelected: boolean;
  query?: string;
}>;

export type ContentSearchFacet = Readonly<{
  field: string;
  label: string;
  isSelected: boolean;
  values: readonly ContentSearchFacetValue[];
}>;

export type ContentSearchPage = Readonly<{
  type: 'search-page';
  query: string;
  link: string;
  resultCount: number;
  limit: number;
  page: number;
  sort: ContentSearchSort;
  from?: string;
  to?: string;
  appliedFilters: readonly Readonly<{ field: string; value: string }>[];
  appliedFacets: readonly ContentSearchAppliedFacet[];
  results: readonly ContentSearchDocument[];
  facets: readonly ContentSearchFacet[];
}>;

export type ContentSearchInput = Readonly<{
  query: string;
  limit?: string | number;
  published?: string;
  sort?: string;
  facets?: readonly ContentFacetInput[];
}>;

type ContentSearchFacetRejection = Readonly<{
  status: 'ambiguous' | 'not-found';
  field: ContentFacetField;
  input: string;
  candidates: readonly Readonly<{ name: string; guid: string }>[];
}>;

export type ContentSearchError =
  | Readonly<{
      kind: 'invalid-limit';
      problem: 'not-positive' | 'above-maximum';
    }>
  | Readonly<{
      kind: 'invalid-date-range';
      problem: 'invalid-date' | 'invalid-range' | 'inverted';
      value?: string;
    }>
  | Readonly<{ kind: 'invalid-sort' }>
  | Readonly<{
      kind: 'invalid-facet';
      field: string;
      problem: 'value-required';
    }>
  | Readonly<{ kind: 'facet-resolution-failed'; input: ContentFacetInput }>
  | Readonly<{
      kind: 'facet-resolution-rejected';
      rejections: readonly ContentSearchFacetRejection[];
    }>
  | Readonly<{ kind: 'discovery-failed' }>
  | Readonly<{ kind: 'dependency'; failure: DependencyFailure }>;

export type ContentSearchResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: ContentSearchError }>;

type ContentSearchValue = Readonly<{
  page: ContentSearchPage;
  facetMatches: readonly Readonly<{
    field: ContentFacetField;
    input: string;
    name: string;
  }>[];
}>;

export interface ContentSearch {
  search(input: ContentSearchInput): Promise<ContentSearchResult<ContentSearchValue>>;
}
