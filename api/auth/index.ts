import type { Endpoint } from '../../transport/index.js';
import { get, post, type ApiRequester } from '../index.js';

// Marquee's endpoints that prove each realm's login, in gs-quant's client shape (ADR 0072).
export class AuthApi {
  // The signed-in user, which answers only with a live MarketView session.
  static readonly currentUser: Endpoint = get('/v1/users/self');
  // GIR advanced search, which answers only when the Marquee session can read research.
  static readonly researchSearch: Endpoint = post('/research/search/reports/advanced-search');

  constructor(private readonly requester: ApiRequester) {}

  getCurrentUser(): Promise<unknown> {
    return this.requester.request(AuthApi.currentUser);
  }

  searchResearch(search: unknown): Promise<unknown> {
    return this.requester.request(AuthApi.researchSearch, { body: search });
  }
}
