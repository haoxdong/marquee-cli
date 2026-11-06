import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransport } from '../index.js';
import type { Endpoint } from '../types.js';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const target = { method: 'GET', path: '/v1/users/self' } as Endpoint;
function session(fetchFn: typeof fetch, sessionToken = 'sess_synthetic') {
  return createTransport({ execution: 'session', baseUrl: 'https://gateway.example/marquee', sessionToken, fetchFn });
}

describe('account-session transport', () => {
  it('sends only the opaque session and disables redirects', async () => {
    const fetchFn = vi.fn(async () => new Response('{"login":"synthetic"}'));
    await expect(session(fetchFn).request(target, { headers: {
      Authorization: 'spoof', Cookie: 'spoof', 'x-botcube-account-id': 'other', 'X-BotCube-Session-Id': 'other',
    } })).resolves.toEqual({ login: 'synthetic' });
    expect(fetchFn).toHaveBeenCalledWith('https://gateway.example/marquee/v1/users/self', expect.objectContaining({
      redirect: 'manual', headers: { Accept: 'application/json', Cookie: 'marqueebot_session=sess_synthetic' },
    }));
  });
  it.each(['', 'not-a-session', 'sess_bad;injected=x', 'sess_bad\n'])('rejects malformed sessions without sending them', (token) => {
    const fetchFn = vi.fn();
    expect(() => session(fetchFn, token)).toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each(['/../auth/session', '/%2e%2e/auth/session', '/v1/%2f/auth', 'https://other.example/read'])('rejects escaping targets', async (path) => {
    const fetchFn = vi.fn();
    await expect(session(fetchFn).request({ method: 'GET', path } as Endpoint)).rejects.toMatchObject({ code: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('masks the session in debug output and sanitizes thrown failures', async () => {
    vi.stubEnv('MARQUEE_DEBUG', 'api');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(session(async () => { throw new Error('sess_synthetic'); }).request(target)).rejects.toMatchObject({ code: 'network' });
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).not.toContain('sess_synthetic');
    expect(output).toContain('cookie:');
  });
  it('classifies gateway refusals as HTTP rather than authentication failures', async () => {
    await expect(session(async () => new Response('{"detail":{"code":"gateway_refused","message":"Credential Service only allows read-scoped Marquee requests"}}', { status: 403 })).request(target)).rejects.toMatchObject({ code: 'http' });
  });
  it('classifies revoked session and sanitizes network failure', async () => {
    await expect(session(async () => new Response('{"detail":{"code":"session_invalid","message":"MarqueeBot session is invalid or expired"}}', { status: 401 })).request(target)).rejects.toMatchObject({
      code: 'auth_expired', details: { credentialServiceCode: 'session_invalid' },
    });
    await expect(session(async () => { throw new Error('sess_synthetic'); }).request(target)).rejects.toMatchObject({ code: 'network', message: 'Cannot reach Marquee gateway' });
  });
});

 it.each(['', 'api'])('retains the network cause without exposing it in output (debug=%s)', async (level) => {
    vi.stubEnv('MARQUEE_DEBUG', level);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const cause = new TypeError('sess_synthetic', { cause: new Error('ECONNREFUSED') });
    const error = await session(async () => { throw cause; }).request(target).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'network', message: 'Cannot reach Marquee gateway' });
    expect(error).toHaveProperty('cause');
    expect((error as Error).cause === cause || ((error as Error).cause as Error).cause === cause).toBe(true);
    expect(JSON.stringify(error)).not.toContain('sess_synthetic');
    expect(stderr.mock.calls.flat().join('')).not.toContain('sess_synthetic');
  });
