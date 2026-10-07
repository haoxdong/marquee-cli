import { CONTENT_FACETS as CONTENT_SEARCH_FACETS, createContentSearch } from './search/index.js';
import { createContentModule } from './module.js';
import {
  CONTENT_SEARCH_JSON_FIELDS as SEARCH_JSON_FIELDS,
  CONTENT_VIEW_JSON_FIELDS as VIEW_JSON_FIELDS,
  presentContentGet as presentContentGetImplementation,
  presentContentSearch as presentContentSearchImplementation,
} from './presenter.js';
import type {
  ContentGetError,
  ContentOperationOutcome,
  ContentSearchFailure,
  ContentPresentationOptions,
  ContentPresentation,
  ContentGetValue,
  ContentFacetSelection,
  ContentSearchValue,
  Content,
  ContentConfig,
} from './types.js';
export type {
  ContentProviderEvidence,
  ContentOperationOutcome,
  ContentPresentationOptions,
  ContentPresentation,
  ContentGetValue,
  ContentFacetSelection,
  ContentSearchInput,
  ContentSearchValue,
  Content,
  ContentConfig,
} from './types.js';

export function createContent(config: ContentConfig): Content {
  return createContentModule({
    document: config.document,
    evidence: config.evidence,
    registry: config.registry,
    search: createContentSearch(config.requester(config.evidence), config.evidence),
  });
}

export function contentFacetDefinitions(): readonly Readonly<{
  field: ContentFacetSelection['field'];
  input: string;
  description: string;
}>[] {
  return CONTENT_SEARCH_FACETS;
}

export function presentContentGet(
  outcome: ContentOperationOutcome<ContentGetValue, ContentGetError>,
  options: ContentPresentationOptions,
): Promise<ContentPresentation> {
  return presentContentGetImplementation(outcome, options);
}

export function presentContentSearch(
  outcome: ContentOperationOutcome<ContentSearchValue, ContentSearchFailure>,
  options: ContentPresentationOptions,
): Promise<ContentPresentation> {
  return presentContentSearchImplementation(outcome, options);
}

/** `marquee content search --json` fields. */
export function contentSearchJsonFields(): readonly string[] {
  return SEARCH_JSON_FIELDS;
}

/** `marquee content view --json` fields. */
export function contentViewJsonFields(): readonly string[] {
  return VIEW_JSON_FIELDS;
}
