import { DocumentApi } from '../api/document/index.js';
import { MarqueeError, type Transport } from '../transport/index.js';
import {
  DocumentAdapterError,
  decodeRetrievedDocument,
  type DecodedDocument,
  type DocumentRetrievalInput,
  type RetrievedDownloadableModel,
} from './adapters/production.js';
import type {
  Document,
  DocumentError,
  DocumentResult,
} from './types.js';
import type { DocumentIdentifierLocator, DocumentPort } from './module.js';

type DocumentProductionTransport = Pick<Transport, 'request'> & {
  recordAdapterFailure?(operation: 'decode', value: unknown): void;
};

function retrievalInput(locator: DocumentIdentifierLocator): DocumentRetrievalInput {
  return {
    id: locator.documentId,
    ...(locator.metadata?.quote ? { quote: locator.metadata.quote } : {}),
  };
}

function errorIdentity(locator: DocumentIdentifierLocator) {
  return { kind: locator.kind, documentId: locator.documentId } as const;
}

function failureFrom(
  error: unknown,
  locator: DocumentIdentifierLocator,
): DocumentError {
  const identity = errorIdentity(locator);
  if (error instanceof MarqueeError) {
    if (error.code === 'auth_expired') {
      return { kind: 'authentication-required', realm: 'research' };
    }
    if (error.details?.status === 429) {
      return {
        kind: 'dependency',
        identity,
        failure: {
          kind: 'rate-limited',
          ...(error.details.retryAfterMs !== undefined
            ? { retryAfterMs: error.details.retryAfterMs }
            : {}),
        },
      };
    }
    if (error.code === 'timeout') {
      return { kind: 'dependency', identity, failure: { kind: 'timeout' } };
    }
    if (error.details?.isCanceled === true) {
      return { kind: 'dependency', identity, failure: { kind: 'cancelled' } };
    }
  }
  return { kind: 'dependency', identity, failure: { kind: 'unavailable' } };
}

function recordAdapterFailure(
  transport: DocumentProductionTransport,
  operation: 'decode',
  error: MarqueeError,
): void {
  transport.recordAdapterFailure?.(operation, {
    kind: 'adapter-failure',
    message: error.message,
    ...(error instanceof DocumentAdapterError ? { problem: error.problem } : {}),
    ...(error instanceof MarqueeError && error.details ? { details: error.details } : {}),
  });
}

function retrievalFailure(
  error: unknown,
  locator: DocumentIdentifierLocator,
): DocumentError {
  if (error instanceof MarqueeError) {
    if (error.details?.status === 404) {
      return { kind: 'not-found', locator, problem: 'retrieval-miss' };
    }
    if (error.details?.status === 403) return { kind: 'access-denied', locator };
    if (error instanceof DocumentAdapterError) {
      return {
        kind: 'malformed-document',
        identity: errorIdentity(locator),
        source: 'doc-search',
        problem: error.problem,
      };
    }
  }
  return failureFrom(error, locator);
}

function isDownloadableModel(
  result: DecodedDocument,
): result is RetrievedDownloadableModel {
  return 'kind' in result;
}

export function createDocumentProductionPort(
  transport: DocumentProductionTransport,
): DocumentPort {
  return {
    async retrieve(locator): Promise<DocumentResult<Document>> {
      const input = retrievalInput(locator);
      try {
        const raw = await new DocumentApi({
          request: (endpoint, init) => transport.request(endpoint, { ...init, headers: { Accept: '*/*' } }),
        }).getDocument(input.id);
        const decoded = decodeRetrievedDocument(raw, input);
        if (isDownloadableModel(decoded)) {
          return {
            ok: false,
            error: {
              kind: 'downloadable-model',
              identity: errorIdentity(locator),
              url: decoded.url,
            },
          };
        }
        return { ok: true, value: decoded };
      } catch (error) {
        if (error instanceof DocumentAdapterError) {
          recordAdapterFailure(transport, 'decode', error);
        }
        return { ok: false, error: retrievalFailure(error, locator) };
      }
    },
  };
}
