import type { DocumentId } from '../index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentModule,
  type Document,
} from '../index.js';
import { createDocumentInMemoryPort } from '../in-memory-port.js';
import {
  createDocumentModuleFromPort,
  type DocumentPort,
} from '../module.js';

const documentId = '123e4567-e89b-12d3-a456-426614174000';
const document: Document = {
  identifier: { kind: 'content-stream-id', documentId: documentId as DocumentId },
  title: 'A document',
  body: 'Evidence.',
};

function retrievedDocument() {
  return {
    id: documentId,
    digitalPath: `/content/markets/en/2026/07/15/${documentId}.html`,
    publicationDateTime: 1_768_392_000_000,
    distributionHeadline_input_en: 'A document',
    content_input_en: 'Evidence.',
    sourceDisplayName: 'FICC and Equities',
    tags: [],
  };
}

describe('Document', () => {
  it('retrieves a bare UUID directly through doc-search', async () => {
    const request = vi.fn(async () => retrievedDocument());
    const module = createDocumentModule({ request });

    await expect(module.get({
      kind: 'document-id',
      documentId: documentId.toUpperCase(),
    })).resolves.toMatchObject({ ok: true, value: { identifier: { documentId } } });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      { method: 'GET', path: `/research/search/reports_2/doc-search/${documentId}` },
      { headers: { Accept: '*/*' }, expectedContentType: 'application/prs.gir-search-service.v3+json' },
    );
  });

  it('normalizes a Marquee URL to the Document Identifier before retrieval', async () => {
    const retrieve = vi.fn<DocumentPort['retrieve']>(async () => ({ ok: true, value: document }));
    const module = createDocumentModuleFromPort({ retrieve });

    await expect(module.get({
      kind: 'marquee-content-url',
      url: `https://marquee.gs.com/content/markets/en/2026/07/15/${documentId.toUpperCase()}.html`,
    })).resolves.toEqual({ ok: true, value: document });
    expect(retrieve).toHaveBeenCalledWith({ kind: 'document-id', documentId });
  });

  it('retrieves a stored Document Identifier without an origin lookup', async () => {
    const port = createDocumentInMemoryPort({
      documents: { [`document:${documentId}`]: document },
    });

    await expect(createDocumentModuleFromPort(port).get({
      kind: 'document-id',
      documentId: documentId.toUpperCase(),
    })).resolves.toEqual({ ok: true, value: document });
  });

  it('trims a padded Document Identifier before retrieval', async () => {
    const retrieve = vi.fn<DocumentPort['retrieve']>(async () => ({ ok: true, value: document }));

    await createDocumentModuleFromPort({ retrieve }).get({ kind: 'document-id', documentId: ` ${documentId} ` });
    expect(retrieve).toHaveBeenCalledWith({ kind: 'document-id', documentId });
  });

  it('rejects foreign content URLs before the port', async () => {
    const retrieve = vi.fn<DocumentPort['retrieve']>();
    const module = createDocumentModuleFromPort({ retrieve });
    const url = `https://example.com/content/markets/${documentId}.html`;

    await expect(module.get({ kind: 'marquee-content-url', url })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-locator', locator: url, problem: 'foreign-host' },
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('preserves the caller URL in unsupported-path errors', async () => {
    const retrieve = vi.fn<DocumentPort['retrieve']>();
    const module = createDocumentModuleFromPort({ retrieve });
    const url = `https://marquee.gs.com/not-content/${documentId}.html`;

    await expect(module.get({ kind: 'marquee-content-url', url })).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid-locator', locator: url, problem: 'unsupported-path' },
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('rejects a blank Document Identifier before the port', async () => {
    const retrieve = vi.fn<DocumentPort['retrieve']>();
    const module = createDocumentModuleFromPort({ retrieve });

    await expect(module.get({ kind: 'document-id', documentId: '   ' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-locator', problem: 'blank' },
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('rejects malformed UUIDs before the port', async () => {
    const retrieve = vi.fn<DocumentPort['retrieve']>();
    const module = createDocumentModuleFromPort({ retrieve });

    await expect(module.get({
      kind: 'document-id',
      documentId: '123e4567-e89b-12d3-a456-42661417400z',
    })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-locator', problem: 'invalid-uuid' },
    });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
