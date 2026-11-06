import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../cli-composition/index.js';

beforeEach(() => {
  for (const name of ['MARQUEE_BASE_URL', 'MARQUEEBOT_ACCOUNT_ID', 'MARQUEE_AUTH_TOKEN', 'MARQUEE_OWNER_SESSION_ID', 'MARQUEEBOT_SESSION', 'MARQUEEBOT_GATEWAY_URL']) vi.stubEnv(name, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); process.exitCode = undefined; });
async function read() {
  const { program } = createProgram(() => {});
  await program.parseAsync(['api', '/v1/users/self'], { from: 'user' });
}
describe('standalone account-session configuration', () => {
  it('uses the supported public route from the session alone', async () => {
    vi.stubEnv('MARQUEEBOT_SESSION', 'sess_synthetic');
    const fetchFn = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchFn);
    await read();
    expect(fetchFn).toHaveBeenCalledWith('https://api.marqueebot.com/marquee/v1/users/self', expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'marqueebot_session=sess_synthetic' }) }));
  });
  it('retains complete invocation precedence and rejects partial invocation with a session', async () => {
    vi.stubEnv('MARQUEEBOT_SESSION', 'sess_synthetic');
    vi.stubEnv('MARQUEE_BASE_URL', 'https://private.example/marquee');
    vi.stubEnv('MARQUEEBOT_ACCOUNT_ID', 'synthetic-account');
    vi.stubEnv('MARQUEE_AUTH_TOKEN', 'synthetic-invocation');
    const fetchFn = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchFn);
    await expect(read()).rejects.toThrow('Incomplete Marquee proxy configuration');
    vi.stubEnv('MARQUEE_OWNER_SESSION_ID', 'synthetic-thread');
    await read();
    expect(fetchFn).toHaveBeenCalledWith('https://private.example/marquee/v1/users/self', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-invocation' }) }));
  });
  it('rejects owner-session-only invocation configuration alongside a browser session', async () => {
    vi.stubEnv('MARQUEE_OWNER_SESSION_ID', 'synthetic-thread');
    vi.stubEnv('MARQUEEBOT_SESSION', 'sess_synthetic');
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await expect(read()).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('Incomplete Marquee proxy configuration') });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-session'])('fails classified without direct fallback for malformed sessions', async (token) => {
    vi.stubEnv('MARQUEEBOT_SESSION', token);
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await expect(read()).rejects.toMatchObject({ code: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
