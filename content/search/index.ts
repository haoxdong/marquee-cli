import type { Transport } from '../../transport/index.js';
import { createContentSearchProductionPort } from './adapters/production.js';
import { createContentSearchModule } from './module.js';
import type { ContentFacetField, ContentSearch } from './types.js';
export type {
  ContentFacetField,
  ContentSearchDocument,
  ContentSearchFacet,
  ContentSearchPage,
  ContentSearchInput,
  ContentSearchError,
  ContentSearch,
} from './types.js';

export const CONTENT_FACETS = [
  { field: 'source', input: 'sources', description: 'filter by source' },
  { field: 'subsource', input: 'subsources', description: 'filter by subsource' },
  { field: 'type', input: 'types', description: 'filter by content type' },
  { field: 'publication', input: 'publications', description: 'filter by publication' },
  { field: 'author', input: 'authors', description: 'filter by author' },
  { field: 'region', input: 'regions', description: 'filter by region' },
  { field: 'subject', input: 'subjects', description: 'filter by subject' },
  { field: 'company', input: 'companies', description: 'filter by company' },
  { field: 'industry', input: 'industries', description: 'filter by industry' },
  { field: 'action', input: 'actions', description: 'filter by action' },
  { field: 'focus', input: 'focuses', description: 'filter by focus' },
] as const satisfies readonly Readonly<{ field: ContentFacetField; input: string; description: string }>[];

export function createContentSearch(
  transport: Pick<Transport, 'request'>,
  evidence?: Readonly<{
    reserve(call: Readonly<{ owner: string; operation: string }>): Readonly<{
      fail(value?: unknown): void;
    }> | undefined;
  }>,
): ContentSearch {
  return createContentSearchModule(createContentSearchProductionPort(transport, evidence));
}
