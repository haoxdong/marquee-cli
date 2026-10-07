import {
  documentLocatorKey,
  type DocumentPort,
} from './module.js';
import type { Document, DocumentLocator } from './types.js';

export function createDocumentInMemoryPort(options: {
  documents: Readonly<Record<string, Document>>;
}): DocumentPort {
  return {
    async retrieve(locator) {
      const document = options.documents[documentLocatorKey(locator)];
      return document
        ? { ok: true, value: document }
        : {
            ok: false,
            error: {
              kind: 'not-found',
              locator: locator as DocumentLocator,
              problem: 'retrieval-miss',
            },
          };
    },
  };
}
