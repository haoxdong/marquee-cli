import type { Tagged } from 'type-fest';

/** The Document Identifier: the lowercase document UUID. */
export type DocumentId = Tagged<string, 'DocumentId'>;

type DocumentIdentifier =
  | { kind: 'gir-research-uuid'; documentId: DocumentId }
  | { kind: 'content-stream-id'; documentId: DocumentId };

type DocumentErrorIdentity = { kind: 'document-id'; documentId: string };

export type DocumentMetadata = Readonly<{
  title?: string;
  publicationDate?: string;
  authors?: readonly string[];
  source?: string;
  quote?: string;
  synopsis?: string;
  url?: string;
  path?: string;
}>;

type LocatedDocument = Readonly<{
  metadata?: DocumentMetadata;
}>;

export type DocumentLocator =
  | (LocatedDocument & { kind: 'document-id'; documentId: string })
  | (LocatedDocument & { kind: 'marquee-content-url'; url: string })
  | (LocatedDocument & { kind: 'marquee-content-path'; path: string });

export type Document = Readonly<{
  identifier: DocumentIdentifier;
  title: string;
  publicationDate?: string;
  authors?: readonly string[];
  source?: string;
  quote?: string;
  synopsis?: string;
  body?: string;
  url?: string;
}>;

type DocumentMalformedProblem =
  | 'response-not-object'
  | 'id-required'
  | 'id-mismatch'
  | 'title-required'
  | 'publication-date-required'
  | 'publication-date-invalid'
  | 'digital-path-invalid'
  | 'content-required'
  | 'authors-not-array'
  | 'author-name-required'
  | 'source-required';

export type DocumentError =
  | {
      kind: 'invalid-locator';
      locator: string;
      problem: 'blank' | 'foreign-host' | 'unsupported-path' | 'invalid-uuid';
    }
  | {
      kind: 'not-found';
      locator: DocumentLocator;
      problem: 'retrieval-miss';
    }
  | { kind: 'authentication-required'; realm: 'marquee' | 'research' }
  | { kind: 'access-denied'; locator: DocumentLocator }
  | {
      kind: 'downloadable-model';
      identity: DocumentErrorIdentity;
      url: string;
    }
  | {
      kind: 'dependency';
      identity: DocumentErrorIdentity;
      failure:
        | { kind: 'authentication-required'; realm: 'marquee' | 'research' }
        | { kind: 'rate-limited'; retryAfterMs?: number }
        | { kind: 'timeout' }
        | { kind: 'unavailable' }
        | { kind: 'cancelled' };
    }
  | {
      kind: 'malformed-document';
      identity: DocumentErrorIdentity;
      source: 'doc-search';
      problem: DocumentMalformedProblem;
    };

export type DocumentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DocumentError };

export interface DocumentModule {
  get(locator: DocumentLocator): Promise<DocumentResult<Document>>;
}
