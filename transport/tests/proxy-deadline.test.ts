/** @format */

import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createTransport, type HttpRequestInit } from '../index.js';

// Regression: real fetch resolves headers before consuming the body.
// Recorded response replay cannot express this split lifecycle.
async function heldBody(status: number) {
  let bodyTimer: ReturnType<typeof setTimeout> | undefined;
  let receivedHeaders!: () => void;
  const headersReceived = new Promise<void>((resolve) => {
    receivedHeaders = resolve;
  });
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.flushHeaders();
    bodyTimer = setTimeout(() => response.end('{"held":true}'), 500);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const transport = createTransport({
    execution: 'proxy',
    baseUrl: `http://127.0.0.1:${address.port}`,
    accountId: 'fixture-account',
    sessionId: 'fixture-session',
    invocationToken: 'fixture-not-a-credential',
    fetchFn: async (input, init) => {
      const response = await fetch(input, init);
      setImmediate(receivedHeaders);
      return response;
    },
  });
  return {
    transport,
    headersReceived,
    close: async () => {
      clearTimeout(bodyTimer);
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

const bodyCases: {
  name: string;
  status: number;
  responseType?: HttpRequestInit['responseType'];
}[] = [
  { name: 'JSON', status: 200 },
  { name: 'text', status: 200, responseType: 'text' },
  { name: 'binary', status: 200, responseType: 'arrayBuffer' },
  { name: 'HTTP error', status: 500 },
  { name: 'unauthorized', status: 401 },
  { name: 'forbidden', status: 403 },
];

describe('proxy response body deadline regression', () => {
  it.each(bodyCases)(
    'times out while reading $name after headers arrive',
    async ({ status, responseType }) => {
      const fixture = await heldBody(status);
      try {
        const outcome = fixture.transport
          .request(
            { path: '/fixture', method: 'GET' },
            {
              timeoutMs: 150,
              ...(responseType ? { responseType } : {}),
            }
          )
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error })
          );
        await fixture.headersReceived;
        expect(await outcome).toMatchObject({
          error: { code: 'timeout', details: { path: '/fixture' } },
        });
      } finally {
        await fixture.close();
      }
    }
  );

  it.each(bodyCases)(
    'cancels while reading $name after headers arrive',
    async ({ status, responseType }) => {
      const fixture = await heldBody(status);
      const controller = new AbortController();
      try {
        const outcome = fixture.transport
          .request(
            { path: '/fixture', method: 'GET' },
            {
              timeoutMs: 2000,
              signal: controller.signal,
              ...(responseType ? { responseType } : {}),
            }
          )
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error })
          );
        await fixture.headersReceived;
        controller.abort();
        expect(await outcome).toMatchObject({
          error: {
            code: 'network',
            details: { isCanceled: true, path: '/fixture' },
          },
        });
      } finally {
        await fixture.close();
      }
    }
  );

  it('finishes an ordinary body within its deadline', async () => {
    const fixture = await heldBody(200);
    try {
      await expect(
        fixture.transport.request(
          { path: '/fixture', method: 'GET' },
          { timeoutMs: 2000 }
        )
      ).resolves.toEqual({ held: true });
    } finally {
      await fixture.close();
    }
  });
});
