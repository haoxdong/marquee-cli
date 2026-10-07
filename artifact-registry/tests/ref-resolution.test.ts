import type { Tagged } from 'type-fest';
type WidgetId = Tagged<string, 'WidgetId'>;
type ConfigId = Tagged<string, 'ConfigId'>;
import { describe, expect, it } from 'vitest';
import {
  isArtifactRef,
  normalizeRefName,
  refNamespace,
  resolveRefOrError,
  resolveStoredRef,
} from '../ref-resolution.js';
import type {
  ArtifactRef,
  ArtifactRegistry,
} from '../index.js';

const widget: ArtifactRef = {
  type: 'widget',
  widgetId: 'MW123' as WidgetId,
  configurationId: 'WC123' as ConfigId,
};

function registry(refs: Record<string, ArtifactRef>): ArtifactRegistry {
  return {
    resolveRef: (name) => refs[name],
    getAllRefs: () => refs,
  } as ArtifactRegistry;
}

describe('Artifact Ref resolution', () => {
  it('accepts only canonical Artifact families', () => {
    expect(isArtifactRef(widget)).toBe(true);
    expect(isArtifactRef({ type: 'link', url: 'http://example.com' })).toBe(false);
    expect(isArtifactRef({ type: 'widget', id: 'MW123', configurationId: 'WC123' })).toBe(false);
    expect(isArtifactRef({ type: 'dashboard', id: 'MD123' })).toBe(false);
    expect(isArtifactRef({ type: 'search', surface: ['market', 'view'].join(''), query: 'rates' })).toBe(false);
    expect(isArtifactRef({})).toBe(false);
  });

  it.each([
    { type: 'search', searchKind: 'market-data', query: 'rates' },
    { type: 'dashboard', dashboardId: 'MD123', cursor: { page: 1, pageSize: 50, total: 1 } },
    { type: 'entity-feed', entityId: 'MA123', entityKind: 'asset', dashboardId: 'MA123' },
    { type: 'document', documentId: 'report', realm: 'research', url: 'https://example.test' },
    { type: 'widget', widgetId: 'MW123', dashboardId: 'MD123' },
    { type: 'widget', widgetId: 'MW123', childId: 'CHILD123' },
  ])('rejects resumable or incomplete membership fields on %o', (ref) => {
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('accepts exact Dashboard Widget membership', () => {
    expect(isArtifactRef({
      type: 'widget',
      widgetId: 'MW123',
      configurationId: 'WC123',
      dashboardId: 'MD123',
      childId: 'CHILD123',
    })).toBe(true);
  });

  it('normalizes names and resolves namespaces', () => {
    expect(normalizeRefName('@s1.w3')).toBe('s1.w3');
    expect(refNamespace('@s1.w3')).toBe('s1');
    expect(refNamespace('w1')).toBe('w1');
  });

  it('resolves known refs through the registry interface', () => {
    expect(resolveStoredRef(registry({ w1: widget }), '@w1')).toEqual({ cleanRef: 'w1', ref: widget });
    expect(resolveRefOrError(registry({ w1: widget }), '@w1')).toEqual({ ok: true, cleanRef: 'w1', ref: widget });
  });

  it('returns ranked recovery guidance for unknown refs', () => {
    expect(resolveRefOrError(registry({ s1: { type: 'search', searchKind: 'market-data' } }), '@s2.d1'))
      .toEqual({
        ok: false,
        cleanRef: 's2.d1',
        message: [
          'Error: ref @s2.d1 not found',
          'Hint: current refs include @s1.',
          'Run the previous command again or use one of the refs printed above.',
        ].join('\n'),
      });
  });
});
