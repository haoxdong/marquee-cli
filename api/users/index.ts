import { post, type ApiRequester } from '../index.js';

// Marquee's user directory endpoints, in gs-quant's client shape (ADR 0072).
export class UsersApi {
  constructor(private readonly requester: ApiRequester) {}

  // The id and name of each of up to 100 users.
  getUserNames(userIds: readonly string[]): Promise<unknown> {
    return this.requester.request(post('/v1/users/query'), {
      body: { fields: ['id', 'name'], limit: 100, orderBy: [], where: { id: [...userIds] } },
    });
  }
}
