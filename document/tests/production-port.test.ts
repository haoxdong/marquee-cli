import type { DocumentId } from '../index.js';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentProductionPort } from '../production-port.js';

const documentId = '123e4567-e89b-12d3-a456-426614174001';

function payload(digitalPath: string) {
  return {
    id: documentId,
    digitalPath,
    publicationDateTime: 1_768_392_000_000,
    distributionHeadline_input_en: 'Document note',
    content_input_en: 'Document body.',
    sourceDisplayName: 'Global Investment Research',
    tags: [{ domain: 'authors', displayName_input_en: 'Sample Analyst' }],
  };
}

describe('Document production port', () => {
  it.each([
    ['research', 'gir-research-uuid', [], '', undefined],
    ['markets', 'content-stream-id', [], '', undefined],
    ['research', 'gir-research-uuid', [{ domain: 'authors', displayName_input_en: ' Analyst ' }], ' ', [' Analyst ']],
    ['markets', 'content-stream-id', [{ domain: 'authors', displayName_input_en: ' Analyst ' }], ' ', [' Analyst ']],
  ] as const)('preserves the complete %s Document with %j author tags', async (
    realm,
    identifierKind,
    tags,
    quote,
    expectedAuthors,
  ) => {
    const url = `https://marquee.gs.com/content/${realm}/en/reports/${documentId}.html`;
    const port = createDocumentProductionPort({
      async request() {
        return {
          ...payload(`/content/${realm}/en/reports/${documentId}.html`),
          content_input_en: ' Document body. ',
          sourceDisplayName: ' Source ',
          synopsis_input_en: ' Synopsis ',
          tags,
        };
      },
    });

    await expect(port.retrieve({
      kind: 'document-id',
      documentId: documentId as DocumentId,
      metadata: { quote },
    })).resolves.toEqual({
      ok: true,
      value: {
        identifier: { kind: identifierKind, documentId },
        title: 'Document note',
        publicationDate: '2026-01-14T12:00:00.000Z',
        ...(expectedAuthors ? { authors: expectedAuthors } : {}),
        source: ' Source ',
        ...(quote ? { quote } : {}),
        synopsis: 'Synopsis',
        body: ' Document body. ',
        url,
      },
    });
  });

  it.each([
    ['research', `/content/research/en/reports/2026/07/15/${documentId}.html`, 'gir-research-uuid'],
    ['markets', `/content/markets/en/2026/07/15/${documentId}.html`, 'content-stream-id'],
  ] as const)('derives the %s origin from the retrieved digitalPath', async (
    _realm,
    digitalPath,
    identifierKind,
  ) => {
    const port = createDocumentProductionPort({
      async request() {
        return payload(digitalPath);
      },
    });

    await expect(port.retrieve({
      kind: 'document-id',
      documentId: documentId as DocumentId,
    })).resolves.toMatchObject({
      ok: true,
      value: {
        identifier: { kind: identifierKind, documentId },
        title: 'Document note',
      },
    });
  });

  it('records decoder diagnostics outside the closed Document error', async () => {
    const recordAdapterFailure = vi.fn();
    const port = createDocumentProductionPort({
      request: async () => null,
      recordAdapterFailure,
    });

    await expect(port.retrieve({
      kind: 'document-id',
      documentId: documentId as DocumentId,
    })).resolves.toMatchObject({
      ok: false,
      error: {
        kind: 'malformed-document',
        problem: 'response-not-object',
      },
    });
    expect(recordAdapterFailure).toHaveBeenCalledWith(
      'decode',
      expect.objectContaining({
        kind: 'adapter-failure',
        problem: 'response-not-object',
      }),
    );
  });

  it('returns actionable Model metadata without treating a valid download as malformed', async () => {
    const recordAdapterFailure = vi.fn();
    const url = `https://marquee.gs.com/content/research/en/models/2026/08/10/${documentId}.html`;
    const port = createDocumentProductionPort({
      async request() {
        return {
          ...payload(`/content/research/en/models/2026/08/10/${documentId}.html`),
          content_input_en: null,
        };
      },
      recordAdapterFailure,
    });

    await expect(port.retrieve({
      kind: 'document-id',
      documentId: documentId as DocumentId,
    })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'downloadable-model',
        identity: { kind: 'document-id', documentId },
        url,
      },
    });
    expect(recordAdapterFailure).not.toHaveBeenCalled();
  });
});
