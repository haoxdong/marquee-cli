import { get, type ApiRequester } from '../index.js';

const DOC_SEARCH_MEDIA_TYPE = 'application/prs.gir-search-service.v3+json';

// Marquee's research Document endpoints, in gs-quant's client shape (ADR 0072).
export class DocumentApi {
  constructor(private readonly requester: ApiRequester) {}

  // One research Document with its body, answered in GIR's v3 search media type.
  getDocument(documentId: string): Promise<unknown> {
    return this.requester.request(
      get(`/research/search/reports_2/doc-search/${encodeURIComponent(documentId)}`),
      { expectedContentType: DOC_SEARCH_MEDIA_TYPE },
    );
  }
}
