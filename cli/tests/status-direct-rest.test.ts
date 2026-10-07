import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The URL a fetch mock was called with. */
function hrefOf(url: RequestInfo | URL): string {
  return url instanceof Request ? url.url : String(url);
}

const originalEnvironment = Object.fromEntries([
  'MARQUEE_COOKIE_JAR',
  'MARQUEE_OWNER_SESSION_ID',
  'MARQUEE_BASE_URL',
  'MARQUEEBOT_ACCOUNT_ID',
  'MARQUEE_AUTH_TOKEN',
].map((name) => [name, process.env[name]]));
const cookieDirectories: string[] = [];

function cookieJar(populated = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'mq-status-'));
  cookieDirectories.push(dir);
  const jarPath = join(dir, 'cookies.json');
  if (populated) {
    writeFileSync(jarPath, JSON.stringify({
      cookies: [
        { name: 'MarqueeLogin', value: '1', domain: '.gs.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 },
        { name: 'sid', value: 'abc', domain: 'marquee.gs.com', path: '/' },
      ],
      updatedAt: 0,
    }), 'utf-8');
  }
  return jarPath;
}

function forbidBrowserTransport(): void {
  vi.doMock('../browser-transport.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../browser-transport.js')>();
    return {
      ...actual,
      createBrowserTransport: vi.fn(() => {
        throw new Error('browser transport should not be used for status');
      }),
    };
  });
}

async function runStatus(): Promise<{ output: string; error: string }> {
  const { createProgram } = await import('../../cli-composition/index.js');
  let output = '';
  let error = '';
  const { program } = createProgram((chunk) => { output += chunk; }, {
    writeError: (chunk) => { error += chunk; },
  });
  await program.parseAsync(['auth', 'status'], { from: 'user' });
  return { output, error };
}

beforeAll(async () => {
  // Warm Vitest's transform cache outside the unchanged per-test time budget;
  // each case still reloads the graph after installing its transport mock.
  await import('../../cli-composition/index.js');
  vi.resetModules();
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const dir of cookieDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = undefined;
  vi.unstubAllGlobals();
  vi.doUnmock('../browser-transport.js');
  vi.resetModules();
});

describe('status direct REST auth', () => {
  it('reports authenticated from the Credential Service after one MarketView and one research read', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ login: 'doejane' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = join(tmpdir(), 'missing-credential-service-status-cookies.json');
    process.env.MARQUEE_OWNER_SESSION_ID = 'thread-1';
    process.env.MARQUEE_BASE_URL = 'https://credential-service.internal/marquee';
    process.env.MARQUEEBOT_ACCOUNT_ID = 'acct-1';
    process.env.MARQUEE_AUTH_TOKEN = 'signed-invocation';

    const { output } = await runStatus();

    expect(output).toMatch(/^status:\tsigned in\nhost:\tmarquee.gs.com\nusername:\tdoejane\n/);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://credential-service.internal/marquee/v1/users/self',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer signed-invocation',
          'X-MarqueeBot-Account-Id': 'acct-1',
          'X-MarqueeBot-Session-Id': 'thread-1',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://credential-service.internal/marquee/research/search/reports/advanced-search',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('names every proxy setting when the proxy env is incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.MARQUEE_BASE_URL = 'https://credential-service.internal/marquee';

    const { createProgram } = await import('../../cli-composition/index.js');
    const { program } = createProgram(() => {});

    await expect(program.parseAsync(['auth', 'status'], { from: 'user' })).rejects.toThrow(
      'Incomplete Marquee proxy configuration: set MARQUEE_BASE_URL, MARQUEEBOT_ACCOUNT_ID, MARQUEE_OWNER_SESSION_ID, and MARQUEE_AUTH_TOKEN',
    );
  });

  it.each([
    'MARQUEE_BASE_URL',
    'MARQUEEBOT_ACCOUNT_ID',
    'MARQUEE_OWNER_SESSION_ID',
    'MARQUEE_AUTH_TOKEN',
  ])('rejects the proxy env when only %s is missing', async (missing) => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.MARQUEE_BASE_URL = 'https://credential-service.internal/marquee';
    process.env.MARQUEEBOT_ACCOUNT_ID = 'acct-1';
    process.env.MARQUEE_OWNER_SESSION_ID = 'thread-1';
    process.env.MARQUEE_AUTH_TOKEN = 'signed-invocation';
    delete process.env[missing];

    const { createProgram } = await import('../../cli-composition/index.js');
    const { program } = createProgram(() => {});

    await expect(program.parseAsync(['auth', 'status'], { from: 'user' })).rejects.toThrow(
      'Incomplete Marquee proxy configuration',
    );
  });

  it('reports re-link required when proxy durable credential expires', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      detail: {
        code: 'relink_required',
        message: 'Goldman link expired. Re-link Goldman to continue.',
      },
    }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = join(tmpdir(), 'missing-credential-service-status-cookies.json');
    process.env.MARQUEE_BASE_URL = 'https://credential-service.internal/marquee';
    process.env.MARQUEEBOT_ACCOUNT_ID = 'acct-1';
    process.env.MARQUEE_OWNER_SESSION_ID = 'thread-1';
    process.env.MARQUEE_AUTH_TOKEN = 'signed-invocation';

    const { error } = await runStatus();

    expect(error.trim()).toBe('status:\texpired\nhost:\tmarquee.gs.com\nGoldman link expired. Re-link Goldman to continue.');
    expect(process.exitCode).toBe(1);
  });

  it('reports signed in when MarketView and one research read answer on a jar without the research session cookie', async () => {
    const jarPath = cookieJar();

    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      const pathname = new URL(hrefOf(url)).pathname;
      if (pathname === '/research/search/reports/advanced-search') {
        return new Response(JSON.stringify({ documents: [], totalRecords: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'me' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = jarPath;
    process.env.MARQUEE_OWNER_SESSION_ID = 'thread-with-cookie-auth';

    const { output } = await runStatus();

    expect(output).toMatch(/^status:\tsigned in\n/);
    expect(process.exitCode).toBeUndefined();
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${hrefOf(url)}`).sort()).toEqual([
      'GET https://marquee.gs.com/v1/users/self',
      'POST https://marquee.gs.com/research/search/reports/advanced-search',
    ]);
    const research = fetchMock.mock.calls.find(([url]) => hrefOf(url).includes('/research/'));
    expect(research?.[1]?.body).toBe(
      '{"filter":"(all EQ ${(zqxjvkwpfhq)}$)","sort":"time","page":1,"size":1,"language":"[\\"en\\"]","limitTo":"[\\"\\"]","applyHighlighting":true}',
    );
    expect(research?.[1]?.headers).toMatchObject({ Cookie: 'MarqueeLogin=1; sid=abc' });
    expect(research?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('reports expired when the research read is unauthorized after MarketView answers', async () => {
    const jarPath = cookieJar();

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const pathname = new URL(hrefOf(url)).pathname;
      if (pathname === '/research/search/reports/advanced-search') {
        return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
      }
      return new Response(JSON.stringify({ id: 'me' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = jarPath;

    const { error } = await runStatus();

    expect(error.trim()).toBe('status:\texpired\nhost:\tmarquee.gs.com\n\nTo sign in again, try: marquee auth login');
    expect(process.exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://marquee.gs.com/research/search/reports/advanced-search',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails loud when the research read fails for a non-auth reason', async () => {
    const jarPath = cookieJar();

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const pathname = new URL(hrefOf(url)).pathname;
      if (pathname === '/research/search/reports/advanced-search') {
        return new Response(JSON.stringify({ error: 'server unavailable' }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: 'me' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = jarPath;

    const { error } = await runStatus();

    expect(error.trim()).toBe('Research session unavailable. Check network and retry.');
    expect(process.exitCode).toBe(1);
  });

  it('fails loud when the research read answers with something other than a JSON object', async () => {
    const jarPath = cookieJar();

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const pathname = new URL(hrefOf(url)).pathname;
      if (pathname === '/research/search/reports/advanced-search') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'me' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = jarPath;

    const { error } = await runStatus();

    expect(error.trim()).toBe('Research session unavailable. Check network and retry.');
    expect(error).not.toContain('signed in');
    expect(process.exitCode).toBe(1);
  });

  it('reports auth status unavailable when the REST auth probe fails for a non-auth reason', async () => {
    const jarPath = cookieJar();

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'server unavailable' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    forbidBrowserTransport();

    process.env.MARQUEE_COOKIE_JAR = jarPath;

    const { error } = await runStatus();

    expect(error.trim()).toBe('Auth status unavailable. Check cookie jar and network, then retry.');
    expect(error).not.toContain('Not authenticated');
    expect(process.exitCode).toBe(1);
  });

  it('reports expired locally when the direct REST cookie jar is empty', async () => {
    const jarPath = cookieJar(false);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'me' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.MARQUEE_COOKIE_JAR = jarPath;

    const { error } = await runStatus();

    expect(error.trim()).toBe('status:\texpired\nhost:\tmarquee.gs.com\n\nTo sign in again, try: marquee auth login');
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
