import { MarqueeError } from '../../transport/index.js';
import type { Document, DocumentError, DocumentId } from '../types.js';
import { isRecord, text } from '../../lib/json-value.js';

type DocumentMalformedProblem = Extract<
  DocumentError,
  { kind: 'malformed-document' }
>['problem'];

export class DocumentAdapterError extends MarqueeError {
  constructor(
    readonly problem: DocumentMalformedProblem,
    diagnostic?: string,
  ) {
    super('adapter', diagnostic ?? `Document adapter rejected ${problem}`);
  }
}

export interface DocumentRetrievalInput {
  id: DocumentId;
  quote?: string;
}

export interface RetrievedDownloadableModel {
  kind: 'downloadable-model';
  id: DocumentId;
  url: string;
}

export type DecodedDocument = Document | RetrievedDownloadableModel;

type DocSearchTag = {
  domain?: unknown;
  displayName_input_en?: unknown;
};

type DocSearchDocument = {
  id?: unknown;
  digitalPath?: unknown;
  publicationDateTime?: unknown;
  distributionHeadline_input_en?: unknown;
  content_input_en?: unknown;
  synopsis_input_en?: unknown;
  sourceDisplayName?: unknown;
  tags?: unknown;
};

const MARQUEE_ORIGIN = 'https://marquee.gs.com';

function reject(problem: DocumentMalformedProblem): never {
  throw new DocumentAdapterError(problem);
}

function requiredString(
  value: unknown,
  problem: DocumentMalformedProblem,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) return reject(problem);
  return value;
}

function publicationDate(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return reject('publication-date-required');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return reject('publication-date-invalid');
  return date.toISOString();
}

function canonicalUrl(value: unknown): {
  path: string;
  realm: 'markets' | 'research';
  url: string;
} {
  const path = requiredString(value, 'digital-path-invalid').trim();
  if (!path.startsWith('/content/markets/') && !path.startsWith('/content/research/')) {
    return reject('digital-path-invalid');
  }
  return {
    path,
    realm: path.startsWith('/content/research/') ? 'research' : 'markets',
    url: `${MARQUEE_ORIGIN}${path}`,
  };
}

function authors(value: unknown): string[] {
  if (!Array.isArray(value)) return reject('authors-not-array');
  return value
    .filter((tag): tag is DocSearchTag => isRecord(tag) && tag.domain === 'authors')
    .map((tag) => requiredString(tag.displayName_input_en, 'author-name-required'));
}

export function decodeRetrievedDocument(
  raw: unknown,
  args: DocumentRetrievalInput,
): DecodedDocument {
  if (!isRecord(raw)) return reject('response-not-object');
  const value = raw as DocSearchDocument;
  const id = requiredString(value.id, 'id-required').trim().toLowerCase();
  if (id !== args.id.toLowerCase()) return reject('id-mismatch');
  const location = canonicalUrl(value.digitalPath);
  const synopsis = text(value.synopsis_input_en);
  const title = requiredString(value.distributionHeadline_input_en, 'title-required').trim();
  const publishedAt = publicationDate(value.publicationDateTime);
  const documentAuthors = authors(value.tags);
  const source = requiredString(value.sourceDisplayName, 'source-required');
  if (
    text(value.content_input_en) === undefined
    && location.path.startsWith('/content/research/en/models/')
  ) {
    return {
      kind: 'downloadable-model',
      id: args.id,
      url: location.url,
    };
  }
  return {
    identifier: {
      kind: location.realm === 'research' ? 'gir-research-uuid' : 'content-stream-id',
      documentId: args.id,
    },
    title,
    publicationDate: publishedAt,
    ...(documentAuthors.length > 0 ? { authors: documentAuthors } : {}),
    source,
    ...(args.quote ? { quote: args.quote } : {}),
    ...(synopsis ? { synopsis } : {}),
    body: requiredString(value.content_input_en, 'content-required'),
    url: location.url,
  };
}

