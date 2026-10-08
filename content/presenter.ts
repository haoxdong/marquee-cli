import type { Document, DocumentError } from '../document/index.js';
import {
  CLI_EXIT_CODES,
  formatJsonFields,
  formatWrongArtifactRefGuidance,
  type JsonOutputOptions,
  type JsonRecord,
} from '../presentation/index.js';
import { renderText, shellArgument, type TextBlock, type TextHint } from '../presentation/text.js';
import type {
  ContentGetError,
  ContentGetValue,
  ContentOperationOutcome,
  ContentPresentation,
  ContentProviderEvidence,
  ContentSearchFailure,
  ContentSearchValue,
} from './types.js';
import {
  CONTENT_FACETS,
  type ContentSearchError,
  type ContentSearchFacet,
  type ContentSearchPage,
} from './search/index.js';

type ContentFailureKind =
  | 'authentication-required'
  | 'cancelled'
  | 'rate-limited'
  | 'timeout'
  | 'unavailable';

function exitCodeForContentFailureKind(kind: ContentFailureKind): 1 | 2 | 4 {
  if (kind === 'authentication-required') return CLI_EXIT_CODES.authRequired;
  if (kind === 'cancelled') return CLI_EXIT_CODES.cancelled;
  return CLI_EXIT_CODES.failure;
}

function exitCodeForGetError(error: ContentGetError): 1 | 2 | 4 {
  if (error.kind !== 'document-retrieval-failed') return CLI_EXIT_CODES.failure;
  if (error.error.kind === 'authentication-required') return CLI_EXIT_CODES.authRequired;
  if (error.error.kind === 'dependency') return exitCodeForContentFailureKind(error.error.failure.kind);
  return CLI_EXIT_CODES.failure;
}

function exitCodeForSearchError(error: ContentSearchError): 1 | 2 | 4 {
  return error.kind === 'dependency'
    ? exitCodeForContentFailureKind(error.failure.kind)
    : CLI_EXIT_CODES.failure;
}

/** `marquee content view --json` fields. */
export const CONTENT_VIEW_JSON_FIELDS = [
  'authors',
  'body',
  'id',
  'published',
  'ref',
  'source',
  'title',
  'url',
] as const;

/** `marquee content search --json` fields, one record per result. */
export const CONTENT_SEARCH_JSON_FIELDS = [
  'authors',
  'id',
  'published',
  'ref',
  'snippet',
  'source',
  'title',
  'url',
] as const;

async function presentJson(
  value: JsonRecord | readonly JsonRecord[],
  options: JsonOutputOptions,
): Promise<ContentPresentation> {
  const formatted = await formatJsonFields(value, options);
  return formatted.ok
    ? { output: `${formatted.output}\n` }
    : { output: `Error: ${formatted.error}\n`, exitCode: 1 };
}

type ProviderFailure = Readonly<{
  message: string;
  details?: Readonly<{ body?: string; credentialServiceCode?: string }>;
}>;

// The latest failed or cancelled provider call; the provider records each one with its failure.
function diagnosticFailure(
  evidence: readonly ContentProviderEvidence[],
): ProviderFailure | undefined {
  return [...evidence]
    .reverse()
    .find((entry) => entry.outcome === 'failed' || entry.outcome === 'cancelled')
    ?.value as ProviderFailure | undefined;
}

function diagnosticFailureMessage(
  evidence: readonly ContentProviderEvidence[],
): string | undefined {
  const failure = diagnosticFailure(evidence);
  if (!failure) return undefined;
  const body = failure.details?.body;
  return body ? `${failure.message} — ${body.slice(0, 200)}` : failure.message;
}

function presentMalformedDocument(
  error: Extract<DocumentError, { kind: 'malformed-document' }>,
): string {
  const reasons: Record<typeof error.problem, string> = {
    'response-not-object': 'response must be an object',
    'id-required': 'id is required',
    'id-mismatch': 'id must match the requested document',
    'title-required': 'distributionHeadline_input_en is required',
    'publication-date-required': 'publicationDateTime must be a number',
    'publication-date-invalid': 'publicationDateTime is invalid',
    'digital-path-invalid': 'digitalPath must name a Markets or Research content path',
    'content-required': 'content_input_en is required',
    'authors-not-array': 'tags must be an array',
    'author-name-required': 'author tags require displayName_input_en',
    'source-required': 'sourceDisplayName is required',
  };
  return `Unsupported doc-search v3 response shape: ${reasons[error.problem]}; record a Scenario before accepting this fallback.`;
}

function presentContentDocumentError(
  error: DocumentError,
  evidence: readonly ContentProviderEvidence[],
): string {
  switch (error.kind) {
    case 'invalid-locator':
      return `"${error.locator}" is not a Marquee content URL — expected a marquee.gs.com /content/ or /s/content/ path, a document UUID, or a stored ref`;
    case 'not-found':
      return diagnosticFailureMessage(evidence) ?? `no content document matching "${error.locator.kind === 'document-id' ? error.locator.documentId : 'document'}"`;
    case 'authentication-required':
      return diagnosticFailureMessage(evidence) ?? 'Not authenticated. Run: marquee auth login';
    case 'access-denied':
      return diagnosticFailureMessage(evidence) ?? 'Content document access denied';
    case 'downloadable-model':
      return `This Content is a downloadable Model. Run: marquee browser open ${error.url}`;
    case 'dependency':
      return diagnosticFailureMessage(evidence) ?? 'Content document dependency is unavailable';
    case 'malformed-document':
      return presentMalformedDocument(error);
  }
}

function documentBlocks(document: Document, ref: string): TextBlock[] {
  return [
    { type: 'field', key: 'title', value: document.title },
    { type: 'field', key: 'ref', value: `@${ref}` },
    { type: 'field', key: 'url', value: document.url },
    { type: 'field', key: 'published', value: document.publicationDate },
    { type: 'field', key: 'authors', value: { items: document.authors ?? [], separator: '; ' } },
    { type: 'field', key: 'source', value: document.source },
    ...(document.body?.trim() ? [{ type: 'body' as const, title: 'Body', text: document.body }] : []),
    { type: 'hints', hints: [{ action: 'open it in a browser', command: `marquee browser open @${ref}` }] },
  ];
}

function contentViewRecord(
  document: Document,
  ref: string,
): Record<(typeof CONTENT_VIEW_JSON_FIELDS)[number], unknown> {
  return {
    authors: document.authors,
    body: document.body,
    id: document.identifier.documentId,
    published: document.publicationDate,
    ref: `@${ref}`,
    source: document.source,
    title: document.title,
    url: document.url,
  };
}

function presentContentFacetRejection(
  rejection: Extract<ContentSearchError, { kind: 'facet-resolution-rejected' }>['rejections'][number],
): string {
  const shown = rejection.candidates.slice(0, 10);
  const lines = [
    rejection.status === 'not-found'
      ? `no ${rejection.field} matching "${rejection.input}" — known ${rejection.field}s:`
      : `ambiguous ${rejection.field} "${rejection.input}" — candidates:`,
    ...shown.map((candidate) => `  ${candidate.name}`),
  ];
  const remaining = rejection.candidates.length - shown.length;
  if (remaining > 0) {
    const hint = rejection.status === 'not-found' ? 'copy an exact value' : 'narrow the value';
    lines.push(`  …and ${remaining} more — ${hint}`);
  }
  return lines.join('\n');
}

function contentSearchDependencyMessage(
  error: Extract<ContentSearchError, { kind: 'dependency' }>,
  evidence: readonly ContentProviderEvidence[],
): string {
  const failure = diagnosticFailure(evidence);
  if (error.failure.kind === 'authentication-required' && failure?.details?.credentialServiceCode === undefined) {
    return 'Research session expired or missing. Run: marquee auth login';
  }
  const diagnostic = diagnosticFailureMessage(evidence);
  if (diagnostic) return diagnostic;
  if (error.failure.kind === 'timeout') return 'Content search timed out';
  if (error.failure.kind === 'cancelled') return 'Content search cancelled';
  if (error.failure.kind === 'rate-limited') return 'Content search rate limited';
  return 'Content search dependency failed';
}

function presentContentSearchError(
  error: ContentSearchError,
  evidence: readonly ContentProviderEvidence[],
): string[] {
  switch (error.kind) {
    case 'invalid-limit':
      return [error.problem === 'above-maximum'
        ? '--limit max is 50'
        : '--limit must be a positive integer'];
    case 'invalid-date-range':
      if (error.problem === 'inverted') return ['--published range start must not be later than its end'];
      if (error.problem === 'invalid-range') {
        return [`invalid --published "${error.value ?? ''}"; expected ">=YYYY-MM-DD", "<=YYYY-MM-DD" or YYYY-MM-DD..YYYY-MM-DD`];
      }
      return [`invalid date "${error.value ?? ''}"; expected YYYY-MM-DD`];
    case 'invalid-sort':
      return ['--sort must be time or relevance'];
    case 'invalid-facet':
      return [`--${error.field} value is required`];
    case 'facet-resolution-rejected':
      return error.rejections.map(presentContentFacetRejection);
    case 'facet-resolution-failed':
      return [diagnosticFailureMessage(evidence) ?? 'content facet resolution failed'];
    case 'discovery-failed':
      return [diagnosticFailureMessage(evidence) ?? 'Content search discovery failed'];
    case 'dependency':
      return [contentSearchDependencyMessage(error, evidence)];
  }
}

const CONTENT_FACET_FLAGS: ReadonlySet<string> = new Set(CONTENT_FACETS.map(({ field }) => field));
const TOP_FACET_VALUES = 5;

function contentFacetFlag(field: string): string {
  return CONTENT_FACET_FLAGS.has(field) ? `--${field}` : field;
}

function contentFiltersTable(facets: readonly ContentSearchFacet[]): TextBlock | undefined {
  // Content Search decodes every facet with a label and at least one named value.
  const rows = facets.map(({ field, values }) => {
    const top = values.slice(0, TOP_FACET_VALUES).map(({ name, count }) => `${name} (${count})`);
    const more = values.length - top.length;
    return [
      contentFacetFlag(field),
      ...Array.from({ length: TOP_FACET_VALUES }, (_, index) => top[index]),
      more > 0 ? more : undefined,
    ];
  });
  if (rows.length === 0) return undefined;
  return {
    type: 'table',
    title: 'Filters',
    // renderText prints a table's noun only in its title-line count or in the sentence for a table
    // with no rows. The Filters table has no count and is built only when it has rows.
    // Stryker disable next-line StringLiteral: no output ever carries the Filters noun
    noun: 'filters',
    headers: ['flag', 'top 1', 'top 2', 'top 3', 'top 4', 'top 5', 'more'],
    rows,
  };
}

function publishedArgument(page: ContentSearchPage): string[] {
  if (page.from && page.to) return ['--published', `${page.from}..${page.to}`];
  if (page.from) return ['--published', shellArgument(`>=${page.from}`)];
  if (page.to) return ['--published', shellArgument(`<=${page.to}`)];
  return [];
}

function contentSearchCommand(page: ContentSearchPage, extra: readonly string[]): string {
  return [
    'marquee content search',
    ...(page.query.length > 0 ? [shellArgument(page.query)] : []),
    ...page.appliedFacets.flatMap((facet) => [`--${facet.field}`, shellArgument(facet.name)]),
    ...publishedArgument(page),
    ...extra,
  ].join(' ');
}

function contentSearchHints(page: ContentSearchPage): TextHint[] {
  const otherSort = page.sort === 'time' ? 'relevance' : 'time';
  const narrowing = page.facets
    .flatMap(({ field, values }) => values
      .filter((value) => !value.isSelected)
      .map((value) => [contentFacetFlag(field), shellArgument(value.name)]))[0];
  return [
    { action: `sort by ${otherSort}`, command: contentSearchCommand(page, ['--sort', otherSort]) },
    ...(narrowing === undefined
      ? []
      : [{ action: 'narrow results', command: contentSearchCommand(page, narrowing) }]),
  ];
}

function presentContentSearchText({ page, documentRefs }: ContentSearchValue): string {
  const filters = contentFiltersTable(page.facets);
  return renderText([
    {
      type: 'table',
      title: 'Results',
      noun: 'results',
      count: { shown: page.results.length, total: page.resultCount },
      headers: ['ref', 'title', 'published', 'source', 'authors', 'snippet'],
      rows: page.results.map((document, index) => [
        `@${documentRefs[index]}`,
        document.title,
        document.publicationDate,
        document.source,
        { items: document.authors ?? [], separator: '; ' },
        document.snippet,
      ]),
    },
    ...(filters === undefined ? [] : [filters]),
    { type: 'sentence', text: `Sorted by ${page.sort}.` },
    { type: 'hints', hints: contentSearchHints(page) },
  ]);
}

function contentSearchRecords(
  value: ContentSearchValue,
): Record<(typeof CONTENT_SEARCH_JSON_FIELDS)[number], unknown>[] {
  return value.page.results.map((document, index) => ({
    authors: document.authors,
    id: document.documentId,
    published: document.publicationDate,
    ref: `@${value.documentRefs[index]}`,
    snippet: document.snippet,
    source: document.source,
    title: document.title,
    url: document.url,
  }));
}

function presentUnknownContentRef(ref: string, availableRefs: readonly string[]): string {
  const namespace = ref.split('.')[0];
  const kind = ref.slice(0, 1);
  const rank = (name: string): number => {
    if (name === namespace) return 0;
    if (name.startsWith(`${namespace}.`)) return 1;
    return name.startsWith(kind) ? 2 : 3;
  };
  const ranked = [...availableRefs].sort((left, right) => rank(left) - rank(right));
  const visible = ranked.slice(0, 6);
  const hint = visible.length === 0
    ? ['Hint: run the previous command again or use one of the refs printed above.']
    : [
        `Hint: current refs include ${visible.map((name) => `@${name}`).join(', ')}${ranked.length > visible.length ? ', ...' : ''}.`,
        'Run the previous command again or use one of the refs printed above.',
      ];
  return [`ref @${ref} not found`, ...hint].join('\n');
}

function contentGetErrorMessage(
  error: ContentGetError,
  evidence: readonly ContentProviderEvidence[],
): string {
  switch (error.kind) {
    case 'artifact-not-found':
      return presentUnknownContentRef(error.ref, error.availableRefs);
    case 'wrong-artifact-kind':
      return `ref @${error.ref} is a ${error.artifact.type}${formatWrongArtifactRefGuidance(error.artifact)}`;
    case 'invalid-locator':
    case 'document-retrieval-failed':
      return presentContentDocumentError(error.error, evidence);
  }
}

export async function presentContentGet(
  outcome: ContentOperationOutcome<ContentGetValue, ContentGetError>,
  options: JsonOutputOptions,
): Promise<ContentPresentation> {
  if (!outcome.result.ok) {
    const message = contentGetErrorMessage(outcome.result.error, outcome.evidence);
    return { output: `Error: ${message}\n`, exitCode: exitCodeForGetError(outcome.result.error) };
  }
  const { document, namespace } = outcome.result.value;
  return options.json === undefined
    ? { output: renderText(documentBlocks(document, namespace)) }
    : presentJson(contentViewRecord(document, namespace), options);
}

export async function presentContentSearch(
  outcome: ContentOperationOutcome<ContentSearchValue, ContentSearchFailure>,
  options: JsonOutputOptions,
): Promise<ContentPresentation> {
  if (!outcome.result.ok) {
    const { error } = outcome.result.error;
    const errors = presentContentSearchError(error, outcome.evidence);
    return {
      output: errors.map((message) => `Error: ${message}\n`).join(''),
      exitCode: exitCodeForSearchError(error),
    };
  }
  const { value } = outcome.result;
  if (options.json === undefined && value.page.results.length === 0) {
    return { output: `no results match ${JSON.stringify(value.page.query)}\n`, channel: 'stderr' };
  }
  return options.json === undefined
    ? { output: presentContentSearchText(value) }
    : presentJson(contentSearchRecords(value), options);
}
