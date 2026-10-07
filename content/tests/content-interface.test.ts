import type { DocumentId } from '../../document/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifactRegistry } from '../../artifact-registry/index.js';
import { createContent, type ContentProviderEvidence } from '../index.js';

describe('Content interface', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) rmSync(refsDir, { recursive: true, force: true });
    refsDir = undefined;
  });

  it('exposes only search and get and returns operation-local evidence', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-content-interface-'));
    const evidence: ContentProviderEvidence[] = [];
    const evidenceLog = {
      reserve(call: Readonly<{ owner: string; operation: string }>) {
        const entry = {
          order: evidence.length + 1,
          ...call,
          outcome: 'dispatched' as const,
        };
        evidence.push(entry);
        return {
          succeed(value?: unknown) {
            evidence[entry.order - 1] = {
              ...entry,
              outcome: 'succeeded',
              ...(value === undefined ? {} : { value }),
            };
          },
          fail() {
            evidence[entry.order - 1] = { ...entry, outcome: 'failed' };
          },
          cancel() {
            evidence[entry.order - 1] = { ...entry, outcome: 'cancelled' };
          },
        };
      },
      snapshot: () => evidence,
    };
    const content = createContent({
      registry: createArtifactRegistry(refsDir, 'content-interface-test'),
      evidence: evidenceLog,
      document: {
        async get() {
          evidence.push({
            order: 1,
            owner: 'document.request',
            operation: 'GET /content/document',
            outcome: 'succeeded',
          });
          return {
            ok: true,
            value: {
              identifier: { kind: 'content-stream-id', documentId: '123e4567-e89b-12d3-a456-426614174000' as DocumentId },
              title: 'Markets note',
            },
          };
        },
      },
      requester: () => ({
        async request() {
          throw new Error('unexpected Content Search request');
        },
      }),
    });

    expect(Object.keys(content)).toEqual(['get', 'search']);

    const outcome = await content.get({
      target: 'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
    });

    expect(outcome).toEqual({
      result: {
        ok: true,
        value: {
          document: {
            identifier: { kind: 'content-stream-id', documentId: '123e4567-e89b-12d3-a456-426614174000' as DocumentId },
            title: 'Markets note',
          },
          namespace: 'c1',
        },
      },
      evidence: [{
        order: 1,
        owner: 'document.request',
        operation: 'GET /content/document',
        outcome: 'succeeded',
      }],
    });
    expect(outcome).not.toHaveProperty('presentation');
  });

  it('wires provider evidence through direct factory construction', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-content-interface-'));
    const entries: ContentProviderEvidence[] = [];
    const evidenceLog = {
      reserve(call: Readonly<{ owner: string; operation: string }>) {
        const entry = {
          order: entries.length + 1,
          ...call,
          outcome: 'dispatched' as const,
        };
        entries.push(entry);
        return {
          succeed(value?: unknown) {
            entries[entry.order - 1] = {
              ...entry,
              outcome: 'succeeded',
              ...(value === undefined ? {} : { value }),
            };
          },
          fail(value?: unknown) {
            entries[entry.order - 1] = {
              ...entry,
              outcome: 'failed',
              ...(value === undefined ? {} : { value }),
            };
          },
          cancel() {
            entries[entry.order - 1] = { ...entry, outcome: 'cancelled' };
          },
        };
      },
      snapshot: () => entries,
    };
    let raw: unknown = {
      documents: [],
      totalRecords: 0,
      page: 1,
      ['facet' + 'List']: [],
    };
    const content = createContent({
      registry: createArtifactRegistry(refsDir, 'content-interface-evidence-test'),
      evidence: evidenceLog,
      document: {
        async get() {
          throw new Error('unexpected Document retrieval');
        },
      },
      requester: (evidence) => ({
        async request({ method, path }) {
          const reservation = evidence.reserve({
            owner: 'content.request',
            operation: `${method} ${path}`,
          });
          reservation?.succeed(raw);
          return raw;
        },
      }),
    });

    const outcome = await content.search({ query: 'US CPI' });

    expect(outcome.evidence).toEqual([{
      order: 1,
      owner: 'content.request',
      operation: 'POST /research/search/reports/advanced-search',
      outcome: 'succeeded',
      value: raw,
    }]);
    expect(outcome.result).toMatchObject({ ok: true });

    raw = {};
    const failed = await content.search({ query: 'US CPI' });

    expect(failed.result).toEqual({
      ok: false,
      error: {
        kind: 'search-failed',
        error: { kind: 'discovery-failed' },
      },
    });
    expect(failed.evidence.map(({ order, owner, outcome }) => ({
      order,
      owner,
      outcome,
    }))).toEqual([
      { order: 2, owner: 'content.request', outcome: 'succeeded' },
      { order: 3, owner: 'content.search', outcome: 'failed' },
    ]);
  });
});
