import { soleElement } from '../../lib/sole-element.js';
import type {
  ContentFacetField,
  ContentFacetInput,
  ContentSearch,
  ContentSearchAppliedFacet,
  ContentSearchError,
  ContentSearchInput,
  ContentSearchPage,
  ContentSearchResult,
  ContentSearchSort,
} from './types.js';

class ContentFacetFailure extends Error {
  constructor(readonly outcome: Extract<ContentSearchResult<never>, { ok: false }>) {
    super('Content facet resolution failed');
  }
}

type ContentFacetCandidate = Readonly<{
  name: string;
  guid: string;
}>;

type ContentFacetRejection = Readonly<{
  status: 'ambiguous' | 'not-found';
  field: ContentFacetField;
  input: string;
  candidates: readonly ContentFacetCandidate[];
}>;

export type ContentSearchDiscoveryInput = Readonly<{
  query: string;
  limit?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort?: ContentSearchSort | undefined;
  facets?: readonly ContentFacetInput[] | undefined;
}>;

export interface ContentSearchPort {
  discover(input: ContentSearchDiscoveryInput): Promise<ContentSearchResult<{
    page: ContentSearchPage;
  }>>;
  withAppliedFacets(
    page: ContentSearchPage,
    appliedFacets: readonly ContentSearchAppliedFacet[],
  ): ContentSearchPage;
}

function retainedFacetInputs(inputs: readonly ContentFacetInput[] | undefined): ContentFacetInput[] {
  const seen = new Set<string>();
  return (inputs ?? []).filter((input) => {
    const key = `${input.field}\0${input.value.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function invalidFacet(
  inputs: readonly ContentFacetInput[] | undefined,
): Readonly<{ ok: false; error: ContentSearchError }> | undefined {
  const blank = inputs?.find((input) => !input.value.trim());
  return blank && {
    ok: false,
    error: { kind: 'invalid-facet', field: blank.field, problem: 'value-required' },
  };
}

function parsedLimit(value: string | number | undefined): ContentSearchResult<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const raw = String(value);
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    return { ok: false, error: { kind: 'invalid-limit', problem: 'not-positive' } };
  }
  const limit = Number(raw);
  if (limit > 50) {
    return { ok: false, error: { kind: 'invalid-limit', problem: 'above-maximum' } };
  }
  return { ok: true, value: limit };
}

// A calendar date in YYYY-MM-DD form: it must read back unchanged, which rejects both other
// formats and overflowing days such as 2026-02-30.
function normalizedDate(value: string | undefined): ContentSearchResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) {
    return { ok: true, value };
  }
  return {
    ok: false,
    error: {
      kind: 'invalid-date-range',
      problem: 'invalid-date',
      value,
    },
  };
}

const PUBLISHED_RANGE = /^(?:>=([^.]+)|<=([^.]+)|([^.<>=]+)\.\.([^.<>=]+))$/;

function publishedBounds(
  published: string | undefined,
): ContentSearchResult<Readonly<{ from?: string; to?: string }>> {
  if (published === undefined) return { ok: true, value: {} };
  const value = published.trim();
  const match = PUBLISHED_RANGE.exec(value);
  if (!match) {
    return { ok: false, error: { kind: 'invalid-date-range', problem: 'invalid-range', value } };
  }
  const [, atLeast, atMost, start, end] = match;
  const from = atLeast ?? start;
  const to = atMost ?? end;
  return {
    ok: true,
    value: {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    },
  };
}

function validatedDiscoveryInput(
  input: ContentSearchInput,
): ContentSearchResult<ContentSearchDiscoveryInput> {
  const limit = parsedLimit(input.limit);
  if (!limit.ok) return limit;
  const bounds = publishedBounds(input.published);
  if (!bounds.ok) return bounds;
  const from = normalizedDate(bounds.value.from);
  if (!from.ok) return from;
  const to = normalizedDate(bounds.value.to);
  if (!to.ok) return to;
  if (from.value !== undefined && to.value !== undefined && from.value > to.value) {
    return {
      ok: false,
      error: {
        kind: 'invalid-date-range',
        problem: 'inverted',
      },
    };
  }
  if (input.sort !== undefined && input.sort !== 'time' && input.sort !== 'relevance') {
    return {
      ok: false,
      error: { kind: 'invalid-sort' },
    };
  }
  return {
    ok: true,
    value: {
      query: input.query,
      limit: limit.value,
      from: from.value,
      to: to.value,
      sort: input.sort,
    },
  };
}

function appliedFacetFor(
  page: ContentSearchPage,
  input: ContentFacetInput,
): ContentSearchAppliedFacet | undefined {
  return page.appliedFacets.find((facet) => (
    facet.field === input.field && facet.name.toLowerCase() === input.value.toLowerCase()
  ));
}

// Every input token starts some name token. An empty token, from a run of whitespace, starts
// every name token, so splitting on single whitespace characters is enough.
function tokensMatch(input: string, name: string): boolean {
  const nameTokens = name.toLowerCase().split(/\s/);
  return input.toLowerCase().split(/\s/)
    .every((token) => nameTokens.some((nameToken) => nameToken.startsWith(token)));
}

type ContentFacetResolution = Readonly<{
  status: 'resolved';
  input: ContentFacetInput;
  applied: ContentSearchAppliedFacet;
  match: 'exact' | 'fuzzy';
}>;

async function resolveFacet(
  port: ContentSearchPort,
  rail: ContentSearchPage,
  input: ContentFacetInput,
): Promise<ContentSearchResult<ContentFacetResolution | ContentFacetRejection>> {
  const candidates = (rail.facets.find((facet) => facet.field === input.field)?.values ?? [])
    .flatMap(({ name, guid }) => guid ? [{ name, guid }] : []);
  const exact = candidates.find(({ name }) => name.toLowerCase() === input.value.toLowerCase());
  if (exact) return { ok: true, value: { status: 'resolved', input, applied: { field: input.field, ...exact }, match: 'exact' } };
  const matches = candidates.filter(({ name }) => tokensMatch(input.value, name));
  const fuzzy = soleElement(matches);
  if (fuzzy) {
    return { ok: true, value: { status: 'resolved', input, applied: { field: input.field, ...fuzzy }, match: 'fuzzy' } };
  }
  if (matches.length > 0) {
    return { ok: true, value: { status: 'ambiguous', field: input.field, input: input.value, candidates: matches } };
  }
  const probe = await port.discover({ query: '', limit: 1, facets: [input] });
  if (!probe.ok) return probe;
  if (probe.value.page.resultCount === 0) {
    return { ok: true, value: { status: 'not-found', field: input.field, input: input.value, candidates } };
  }
  const applied = appliedFacetFor(probe.value.page, input);
  if (!applied) return { ok: false, error: { kind: 'facet-resolution-failed', input } };
  return { ok: true, value: { status: 'resolved', input, applied, match: 'exact' } };
}

export function createContentSearchModule(port: ContentSearchPort): ContentSearch {
  return {
    async search(input) {
      const discoveryInput = validatedDiscoveryInput(input);
      if (!discoveryInput.ok) return discoveryInput;
      const facetInputError = invalidFacet(input.facets);
      if (facetInputError) return facetInputError;
      const requested = retainedFacetInputs(input.facets);
      const first = await port.discover({ ...discoveryInput.value, facets: requested });
      if (!first.ok) return first;
      const unconfirmed = requested.filter((facet) => !appliedFacetFor(first.value.page, facet));
      if (unconfirmed.length === 0) return { ok: true, value: { ...first.value, facetMatches: [] } };

      const rail = await port.discover({ query: '', limit: 1 });
      if (!rail.ok) return rail;
      let resolved: Array<ContentFacetResolution | ContentFacetRejection>;
      try {
        resolved = await Promise.all(unconfirmed.map(async (facet) => {
          const outcome = await resolveFacet(port, rail.value.page, facet);
          if (!outcome.ok) throw new ContentFacetFailure(outcome);
          return outcome.value;
        }));
      } catch (error) {
        if (error instanceof ContentFacetFailure) return error.outcome;
        throw error;
      }
      const rejections = resolved.filter(
        (outcome): outcome is ContentFacetRejection => outcome.status !== 'resolved',
      );
      if (rejections.length > 0) {
        return { ok: false, error: { kind: 'facet-resolution-rejected', rejections } };
      }
      // With no rejection, every outcome is a resolution.
      const resolutions = resolved as readonly ContentFacetResolution[];
      const facetMatches = resolutions.flatMap(({ input: facet, applied, match }) => (
        match === 'fuzzy' ? [{ field: facet.field, input: facet.value, name: applied.name }] : []
      ));
      let page = first.value.page;
      if (facetMatches.length > 0) {
        const resolvedNames = new Map<ContentFacetInput, string>(
          resolutions.flatMap(({ input: facet, applied, match }): Array<[ContentFacetInput, string]> => (
            match === 'fuzzy' ? [[facet, applied.name]] : []
          )),
        );
        const final = await port.discover({
          ...discoveryInput.value,
          facets: requested.map((facet) => ({ field: facet.field, value: resolvedNames.get(facet) ?? facet.value })),
        });
        if (!final.ok) return final;
        page = final.value.page;
      }
      const applied = [...page.appliedFacets];
      for (const { applied: facet } of resolutions) {
        if (!applied.some((known) => known.guid === facet.guid)) applied.push(facet);
      }
      return { ok: true, value: { page: port.withAppliedFacets(page, applied), facetMatches } };
    },
  };
}
