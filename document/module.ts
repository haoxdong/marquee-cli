import type {
  Document,
  DocumentId,
  DocumentLocator,
  DocumentMetadata,
  DocumentModule,
  DocumentResult,
} from './types.js';

export type DocumentIdentifierLocator = Omit<
  Extract<DocumentLocator, { kind: 'document-id' }>,
  'documentId'
> & Readonly<{ documentId: DocumentId }>;

export interface DocumentPort {
  retrieve(locator: DocumentIdentifierLocator): Promise<DocumentResult<Document>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MARQUEE_ORIGIN = 'https://marquee.gs.com';

function parseDocumentId(value: string): DocumentId | undefined {
  const id = value.trim().toLowerCase();
  return UUID_PATTERN.test(id) ? id as DocumentId : undefined;
}

function locatorError(
  locator: string,
  problem: Extract<
    Extract<DocumentResult<never>, { ok: false }>['error'],
    { kind: 'invalid-locator' }
  >['problem'],
): DocumentResult<never> {
  return { ok: false, error: { kind: 'invalid-locator', locator, problem } };
}

function locatorFromPath(
  path: string,
  metadata?: DocumentMetadata,
): DocumentResult<DocumentIdentifierLocator> {
  if (!path.startsWith('/content/') && !path.startsWith('/s/content/')) {
    return locatorError(path, 'unsupported-path');
  }
  // Stryker disable next-line StringLiteral: any fallback that is not a UUID parses to no Document Identifier
  const id = parseDocumentId(path.match(UUID_IN_TEXT_PATTERN)?.[0] ?? '');
  if (!id) return locatorError(path, 'invalid-uuid');
  return {
    ok: true,
    value: {
      kind: 'document-id',
      documentId: id,
      ...(metadata ? { metadata } : {}),
    },
  };
}

function normalizeLocator(
  locator: DocumentLocator,
): DocumentResult<DocumentIdentifierLocator> {
  if (locator.kind === 'marquee-content-path') {
    return locatorFromPath(locator.path, locator.metadata);
  }
  if (locator.kind === 'marquee-content-url') {
    let url: URL;
    try {
      url = new URL(locator.url);
    } catch {
      return locatorError(locator.url, 'unsupported-path');
    }
    if (url.origin !== MARQUEE_ORIGIN) {
      return locatorError(locator.url, 'foreign-host');
    }
    const normalized = locatorFromPath(url.pathname, locator.metadata);
    if (!normalized.ok && normalized.error.kind === 'invalid-locator') {
      return locatorError(locator.url, normalized.error.problem);
    }
    return normalized;
  }
  if (!locator.documentId.trim()) return locatorError(locator.documentId, 'blank');
  const id = parseDocumentId(locator.documentId);
  if (!id) return locatorError(locator.documentId, 'invalid-uuid');
  return { ok: true, value: { ...locator, documentId: id } };
}

export function createDocumentModuleFromPort(port: DocumentPort): DocumentModule {
  return {
    async get(locator) {
      const normalized = normalizeLocator(locator);
      return normalized.ok ? port.retrieve(normalized.value) : normalized;
    },
  };
}

export function documentLocatorKey(locator: DocumentIdentifierLocator): string {
  return `document:${locator.documentId.toLowerCase()}`;
}
