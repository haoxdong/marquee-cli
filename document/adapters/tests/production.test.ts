import type { DocumentId } from '../../index.js';
import { describe, expect, it } from 'vitest';
import {
  DocumentAdapterError,
  decodeRetrievedDocument,
} from '../production.js';

const id = '123e4567-e89b-12d3-a456-426614174002';

function docSearchDocument(overrides: Record<string, unknown> = {}) {
  return {
    id,
    digitalPath: `/content/research/en/reports/2026/08/06/${id}.html`,
    publicationDateTime: Date.UTC(2026, 7, 6, 21, 2),
    distributionHeadline_input_en: 'Example Region: Growth outlook',
    content_input_en: 'Research body.',
    synopsis_input_en: 'Research synopsis.',
    sourceDisplayName: 'Global Investment Research & Strategy',
    tags: [
      { domain: 'regions', displayName_input_en: 'Europe' },
      { domain: 'authors', displayName_input_en: 'First Analyst' },
      { domain: 'authors', displayName_input_en: 'Second Analyst' },
    ],
    ...overrides,
  };
}

describe('doc-search document adapter', () => {

  it('decodes Research fields from v3 without normalizing source or author order', () => {
    expect(decodeRetrievedDocument(docSearchDocument(), {
      id: id as DocumentId,
      quote: 'Pinned search quote.',
    })).toEqual({
      identifier: { kind: 'gir-research-uuid', documentId: id },
      title: 'Example Region: Growth outlook',
      publicationDate: '2026-08-06T21:02:00.000Z',
      authors: ['First Analyst', 'Second Analyst'],
      source: 'Global Investment Research & Strategy',
      quote: 'Pinned search quote.',
      synopsis: 'Research synopsis.',
      body: 'Research body.',
      url: `https://marquee.gs.com/content/research/en/reports/2026/08/06/${id}.html`,
    });
  });

  it('derives Markets realm from digitalPath and omits an absent synopsis', () => {
    expect(decodeRetrievedDocument(docSearchDocument({
      digitalPath: `/content/markets/en/2026/08/06/${id}.html`,
      synopsis_input_en: null,
    }), { id: id as DocumentId })).toMatchObject({
      identifier: { kind: 'content-stream-id', documentId: id },
      source: 'Global Investment Research & Strategy',
      url: `https://marquee.gs.com/content/markets/en/2026/08/06/${id}.html`,
    });
    expect(decodeRetrievedDocument(docSearchDocument({
      digitalPath: `/content/markets/en/2026/08/06/${id}.html`,
      synopsis_input_en: null,
    }), { id: id as DocumentId })).not.toHaveProperty('synopsis');
  });

  it('classifies an exact bodyless Research Model as a downloadable artifact', () => {
    expect(decodeRetrievedDocument(docSearchDocument({
      digitalPath: `/content/research/en/models/2026/08/10/${id}.html`,
      content_input_en: null,
    }), { id: id as DocumentId })).toEqual({
      kind: 'downloadable-model',
      id,
      url: `https://marquee.gs.com/content/research/en/models/2026/08/10/${id}.html`,
    });
  });

  it.each([
    `/content/research/en/reports/2026/08/10/${id}.html`,
    `/content/markets/en/models/2026/08/10/${id}.html`,
  ])('keeps adjacent bodyless paths malformed: %s', (digitalPath) => {
    expect(() => decodeRetrievedDocument(docSearchDocument({
      digitalPath,
      content_input_en: null,
    }), { id: id as DocumentId })).toThrowError(
      expect.objectContaining({ problem: 'content-required' }) as DocumentAdapterError,
    );
  });

  it.each([
    ['response-not-object', null],
    ['id-required', docSearchDocument({ id: null })],
    ['id-mismatch', docSearchDocument({ id: 'different-id' })],
    ['title-required', docSearchDocument({ distributionHeadline_input_en: '' })],
    ['publication-date-required', docSearchDocument({ publicationDateTime: '2026-08-06' })],
    ['digital-path-invalid', docSearchDocument({ digitalPath: '/not-content/doc.html' })],
    ['content-required', docSearchDocument({ content_input_en: null })],
    ['authors-not-array', docSearchDocument({ tags: null })],
    ['author-name-required', docSearchDocument({
      tags: [{ domain: 'authors', displayName_input_en: null }],
    })],
    ['source-required', docSearchDocument({ sourceDisplayName: '' })],
  ] as const)('rejects %s v3 payloads', (problem, raw) => {
    expect(() => decodeRetrievedDocument(raw, { id: id as DocumentId })).toThrowError(
      expect.objectContaining({ problem }) as DocumentAdapterError,
    );
  });
});
