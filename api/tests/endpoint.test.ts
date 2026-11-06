import { describe, expect, it } from 'vitest';
import type { Transport } from '../../transport/index.js';
import { get } from '../index.js';

// Transport accepts only an Endpoint built in the API Client layer (ADR 0072).

type TransportTarget = Parameters<Transport['request']>[0];
type ProviderTarget = Parameters<ReturnType<Transport['provider']>['request']>[0];

describe('Endpoint', () => {
  it('is the only target transport accepts, so a raw path does not compile', () => {
    // @ts-expect-error a raw path is not an Endpoint
    const transportTarget: TransportTarget = '/v1/users/self';
    // @ts-expect-error a raw path is not an Endpoint
    const providerTarget: ProviderTarget = '/v1/users/self';
    const endpoint: TransportTarget & ProviderTarget = get('/v1/users/self');
    expect([transportTarget, providerTarget, endpoint]).toHaveLength(3);
  });
});
