import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { describe, expect, it } from 'vitest';
import { createEntityModule } from '../../../entity/index.js';
import { artifactOwnerCommandPath } from '../../../presentation/index.js';
import {
  resolveMarqueeUrl,
  resolveStoredRefUrl,
} from '../browser-target.js';

const entity = createEntityModule({
  async request() {
    throw new Error('URL resolution dispatched unexpectedly');
  },
});

describe('browser target registration', () => {
  it('maps canonical Artifact families to their owner commands', () => {
    expect(artifactOwnerCommandPath({
      type: 'widget',
      widgetId: 'MW1' as WidgetId,
      configurationId: 'WC1' as ConfigId,
    })).toBe('marquee marketview widget view');
    expect(artifactOwnerCommandPath({ type: 'dashboard', dashboardId: 'MD1' }))
      .toBe('marquee marketview dashboard view');
    expect(artifactOwnerCommandPath({ type: 'section', dashboardId: 'MD1', sectionId: 'SECTION1' }))
      .toBe('marquee marketview dashboard edit');
    expect(artifactOwnerCommandPath({ type: 'document', documentId: 'doc-1', realm: 'research' }))
      .toBe('marquee content view');
  });

  it('uses the search surface to distinguish commands', () => {
    expect(artifactOwnerCommandPath({
      type: 'search',
      searchKind: 'market-data',
    })).toBe('marquee marketview search');
    expect(artifactOwnerCommandPath({
      type: 'search',
      searchKind: 'research',
    })).toBe('marquee content search');
  });

  it('builds URLs only from canonical Artifact fields', () => {
    expect(resolveStoredRefUrl({
      type: 'widget',
      widgetId: 'MW1' as WidgetId,
      configurationId: 'WC1' as ConfigId,
      selectedContext: 'MA_CONTEXT',
    })).toBe(
      'https://marquee.gs.com/s/marketview/widget/MW1?config=WC1&selectedContext=MA_CONTEXT',
    );
  });

  it('reads only surface-owned browser targets from resumable payloads', () => {
    expect(resolveStoredRefUrl(
      { type: 'search', searchKind: 'research' },
      { browserTarget: 'https://marquee.gs.com/content/search' },
      's1',
    )).toBe('https://marquee.gs.com/content/search');
    expect(resolveStoredRefUrl(
      { type: 'document', documentId: 'doc-1', realm: 'research' },
      {
        browserTargets: {
          's1.c1': 'https://marquee.gs.com/content/research/en/reports/doc-1.html',
        },
      },
      's1.c1',
    )).toBe('https://marquee.gs.com/content/research/en/reports/doc-1.html');
    expect(resolveStoredRefUrl(
      { type: 'entity-feed', entityId: 'BR', entityKind: 'country' },
      {
        browserTarget: 'https://marquee.gs.com/s/marketview/search?query=Brazil',
        browserTargets: {
          's1.d1': 'https://marquee.gs.com/s/marketview/country/BR',
        },
      },
      's1.d1',
    )).toBe('https://marquee.gs.com/s/marketview/country/BR');
    expect(resolveStoredRefUrl(
      { type: 'entity-feed', entityId: 'BR', entityKind: 'country' },
      { browserTarget: 'https://marquee.gs.com/s/marketview/search?query=Brazil' },
      's1.d1',
    )).toBeUndefined();
  });
});

describe('resolveMarqueeUrl', () => {
  it('resolves MW prefix to widget URL', () => {
    expect(resolveMarqueeUrl(entity, 'MW_SYNTH_043')).toBe(
      'https://marquee.gs.com/s/marketview/widget/MW_SYNTH_043',
    );
  });

  it('resolves MD prefix to dashboard URL', () => {
    expect(resolveMarqueeUrl(entity, 'MD_SYNTH_029')).toBe(
      'https://marquee.gs.com/s/marketview/dashboards/MD_SYNTH_029',
    );
  });

  it('resolves MA prefix to asset URL', () => {
    expect(resolveMarqueeUrl(entity, 'MA_SYNTH_012')).toBe(
      'https://marquee.gs.com/s/marketview/asset/MA_SYNTH_012',
    );
  });

  it('passes through raw URLs', () => {
    expect(resolveMarqueeUrl(entity, 'https://example.com')).toBe('https://example.com');
  });

  it('normalizes lowercase Marquee IDs before resolving URLs', () => {
    const widgetId = `MW${'A'.repeat(16)}`;
    expect(resolveMarqueeUrl(entity, widgetId.toLowerCase())).toBe(
      `https://marquee.gs.com/s/marketview/widget/${widgetId}`,
    );
  });
});
