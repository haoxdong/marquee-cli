import type { WidgetId } from '../../../widget/index.js';
/**
 * Dashboard view text (ADR 0070): fields with the
 * `widgets` count, one `ref→title→params` table per section on the page, and hints.
 */
import { describe, expect, it } from 'vitest';
import { formatDashboardText, renderMarketviewDashboardTab } from '../../presenter.js';
import type { MarketViewDashboardValue } from '../../index.js';
import type {
  DashboardPresentation,
  DashboardPresentationWidget,
} from '../../dashboard-presentation.js';

function widget(index: number, parameterLines: string[] = []): DashboardPresentationWidget {
  const title = `Widget ${index}`;
  return {
    widgetId: `MW${index}` as WidgetId,
    title,
    snippet: { title, isTitleResolved: true, parameterLines },
  };
}

function widgets(count: number): DashboardPresentationWidget[] {
  return Array.from({ length: count }, (_, index) => widget(index + 1));
}

describe('formatDashboardText', () => {
  it('prints one table per section on the page, cutting widgets in page order and dropping sections past it', () => {
    const all = widgets(36);
    all[0] = widget(1, ['relativeDate=']);
    all[2] = widget(3, ['ric=GC', 'forward=12', 'prevDates=[-1w, 2026-02-27]', 'twoDigits=true']);
    const payload: DashboardPresentation = {
      title: 'Metals Monitor',
      author: 'Research',
      description: 'Gold dashboard',
      tags: ['Commodities', 'Gold'],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_METALS',
      total: 36,
      widgets: all,
      sections: [
        { title: 'Price & Positioning', startIndex: 0, widgetCount: 28 },
        { title: 'Metal ETFs', startIndex: 28, widgetCount: 6 },
        { title: 'Metal Miners', startIndex: 34, widgetCount: 2 },
        { title: 'Notes', startIndex: 36, widgetCount: 0 },
      ],
    };

    const lines = formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 30, total: 36 },
    }).split('\n');

    expect(lines.slice(0, 12)).toEqual([
      'title:\tMetals Monitor',
      'ref:\t@d1',
      'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_METALS',
      'tags:\tCommodities, Gold',
      'widgets:\t30 of 36',
      '',
      'Price & Positioning',
      'ref:\t@d1.s1',
      'ref\ttitle\tparams',
      '@d1.w1\tWidget 1\trelativeDate=',
      '@d1.w2\tWidget 2\t',
      '@d1.w3\tWidget 3\tric=GC, forward=12, prevDates=[-1w, 2026-02-27], twoDigits=true',
    ]);
    expect(lines.slice(36)).toEqual([
      '@d1.w28\tWidget 28\t',
      '',
      'Metal ETFs (2 of 6 widgets)',
      'ref:\t@d1.s2',
      'ref\ttitle\tparams',
      '@d1.w29\tWidget 29\t',
      '@d1.w30\tWidget 30\t',
      '',
      'To see more widgets, try: marquee marketview dashboard view @d1 -L 36',
      'To find widgets, try: marquee marketview dashboard view @d1 -S <query>',
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      '',
    ]);
  });

  it('prints an entity feed as one Widgets table with its details field', () => {
    const payload: DashboardPresentation = {
      title: 'Acme Corp',
      identity: 'ACME · Equity · Single Stock · NASD · USD',
      entityId: 'MA_ACME',
      entityKind: 'asset',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/asset/MA_ACME',
      total: 236,
      widgets: widgets(20),
    };

    expect(formatDashboardText(payload, {
      ns: 'd2',
      cursor: { pageSize: 10, total: 236 },
    })).toBe([
      'title:\tAcme Corp',
      'ref:\t@d2',
      'url:\thttps://marquee.gs.com/s/marketview/asset/MA_ACME',
      'tags:\t',
      'details:\tACME, Equity, Single Stock, NASD, USD',
      'widgets:\t10 of 236',
      '',
      'Widgets',
      'ref\ttitle\tparams',
      ...Array.from({ length: 10 }, (_, index) => `@d2.w${index + 1}\tWidget ${index + 1}\t`),
      '',
      'To see more widgets, try: marquee marketview dashboard view @d2 -L 236',
      'To find widgets, try: marquee marketview dashboard view @d2 -S <query>',
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      '',
    ].join('\n'));
  });

  it('prints a widget title with its whitespace runs collapsed, as widget view does', () => {
    const title = 'Retail participation in Acme Corp  as of\nclose? ';
    const payload: DashboardPresentation = {
      title: 'Acme Corp',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/asset/MA_ACME',
      total: 1,
      widgets: [{ widgetId: 'MW1' as WidgetId, title, snippet: { title, isTitleResolved: true, parameterLines: [] } }],
    };

    expect(formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 1 },
    })).toContain('\n@d1.w1\tRetail participation in Acme Corp as of close?\t\n');
  });

  it('prints the Widgets title and a no-widgets sentence for a dashboard without widgets', () => {
    const payload: DashboardPresentation = {
      title: 'Empty',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MDEMPTY',
      total: 0,
      widgets: [],
    };

    expect(formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 0 },
    })).toBe([
      'title:\tEmpty',
      'ref:\t@d1',
      'url:\thttps://marquee.gs.com/s/marketview/dashboards/MDEMPTY',
      'tags:\t',
      'widgets:\t0',
      '',
      'Widgets',
      '  There are no widgets',
      '',
      'To find widgets, try: marquee marketview dashboard view @d1 -S <query>',
      '',
    ].join('\n'));
  });

  it('fails loud when a shown widget has no snippet', () => {
    const payload: DashboardPresentation = {
      title: 'Broken',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MDBROKEN',
      total: 1,
      widgets: [{ widgetId: 'MW1' as WidgetId, title: 'No snippet' }],
    };

    expect(() => formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 1 },
    })).toThrow('Dashboard Widget MW1 is missing its authoritative snippet');
  });

  it('fails loud when the page shows more widgets than the presentation holds', () => {
    const payload: DashboardPresentation = {
      title: 'Short',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MDSHORT',
      total: 2,
      widgets: widgets(1),
    };

    expect(() => formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 2 },
    })).toThrow('Dashboard presentation has no widget at position 2');
  });

  it('drops a section that starts exactly where the page ends', () => {
    const payload: DashboardPresentation = {
      title: 'Metals Monitor',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_METALS',
      total: 4,
      widgets: widgets(4),
      sections: [
        { title: 'Prices', startIndex: 0, widgetCount: 2 },
        { title: 'ETFs', startIndex: 2, widgetCount: 2 },
      ],
    };

    expect(formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 2, total: 4 },
    })).not.toContain('ETFs');
  });
});

describe('renderMarketviewDashboardTab -S matches', () => {
  async function renderMatches(refinement: NonNullable<MarketViewDashboardValue['refinement']>): Promise<string> {
    const output: string[] = [];
    await renderMarketviewDashboardTab(
      {
        result: {
          ok: true,
          value: {
            kind: 'dashboard',
            dashboard: {} as Extract<MarketViewDashboardValue, { kind: 'dashboard' }>['dashboard'],
            window: {
              title: 'Carry Monitor',
              author: null,
              description: null,
              tags: [],
              link: 'https://marquee.gs.com/s/marketview/dashboards/MD_CARRY',
              total: 3,
              widgets: [widget(1, ['cross=EURUSD']), widget(2), widget(3, ['cross=USDJPY'])],
            },
            artifact: {
              namespace: 's1.d1',
              root: { type: 'dashboard', dashboardId: 'MD_CARRY', cursor: { page: 1, pageSize: 30, total: 3 } },
            },
            refinement,
          },
        },
        evidence: [],
      },
      {},
      {
        write: (text) => output.push(text),
        writeError: (text) => output.push(`stderr: ${text}`),
        setExitCode: (code) => output.push(`exit: ${code}`),
      },
    );
    return output.join('');
  }

  it('prints the shown matches as a Widget Snippet table with a hint for the rest', async () => {
    await expect(renderMatches({
      kind: 'filter',
      query: 'fx carry',
      matches: [
        { index: 0, ref: 's1.d1.w1', title: 'Widget 1' },
        { index: 2, ref: 's1.d1.w3', title: 'Widget 3' },
      ],
      totalMatches: 5,
    })).resolves.toBe([
      'Matches for "fx carry" (2 of 5 widgets)',
      'ref\ttitle\tparams',
      '@s1.d1.w1\tWidget 1\tcross=EURUSD',
      '@s1.d1.w3\tWidget 3\tcross=USDJPY',
      '',
      'To see more matches, try: marquee marketview dashboard view @s1.d1 -S "fx carry" -L 5',
      '',
    ].join('\n'));
  });

  it('prints every match without a hint when all are shown', async () => {
    await expect(renderMatches({
      kind: 'filter',
      query: 'Widget 2',
      matches: [{ index: 1, ref: 's1.d1.w2', title: 'Widget 2' }],
      totalMatches: 1,
    })).resolves.toBe([
      'Matches for "Widget 2"',
      'ref\ttitle\tparams',
      '@s1.d1.w2\tWidget 2\t',
      '',
    ].join('\n'));
  });

  it('reports no matches on stderr', async () => {
    await expect(renderMatches({ kind: 'filter', query: 'gold', matches: [], totalMatches: 0 })).resolves.toBe('stderr: no widgets match "gold"\n');
  });
});

describe('formatDashboardText sections', () => {
  it('prints every section on a full page, an empty last section included, and no Widgets table', () => {
    const payload: DashboardPresentation = {
      title: 'Rates',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_RATES',
      total: 2,
      widgets: widgets(2),
      sections: [
        { title: 'Curves', startIndex: 0, widgetCount: 2 },
        { title: 'Notes', startIndex: 2, widgetCount: 0 },
      ],
    };

    expect(formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 2 },
    })).toBe([
      'title:\tRates',
      'ref:\t@d1',
      'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_RATES',
      'tags:\t',
      'widgets:\t2',
      '',
      'Curves',
      'ref:\t@d1.s1',
      'ref\ttitle\tparams',
      '@d1.w1\tWidget 1\t',
      '@d1.w2\tWidget 2\t',
      '',
      'Notes',
      'ref:\t@d1.s2',
      '  There are no widgets',
      '',
      'To find widgets, try: marquee marketview dashboard view @d1 -S <query>',
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      '',
    ].join('\n'));
  });

  it('prints the widgets after the last section in a trailing Widgets table', () => {
    const payload: DashboardPresentation = {
      title: 'Rates',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_RATES',
      total: 3,
      widgets: widgets(3),
      sections: [{ title: 'Curves', startIndex: 0, widgetCount: 2 }],
    };

    expect(formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 3 },
    }).split('\n').slice(5, 15)).toEqual([
      '',
      'Curves',
      'ref:\t@d1.s1',
      'ref\ttitle\tparams',
      '@d1.w1\tWidget 1\t',
      '@d1.w2\tWidget 2\t',
      '',
      'Widgets',
      'ref\ttitle\tparams',
      '@d1.w3\tWidget 3\t',
    ]);
  });

  it('prints an empty details field for an entity feed without an identity line', () => {
    const payload: DashboardPresentation = {
      title: 'Japan',
      entityId: 'MC_JP',
      entityKind: 'country',
      author: null,
      description: null,
      tags: [],
      link: 'https://marquee.gs.com/s/marketview/country/MC_JP',
      total: 0,
      widgets: [],
    };

    expect(formatDashboardText(payload, {
      ns: 'd1',
      cursor: { pageSize: 10, total: 0 },
    }).split('\n').slice(3, 6)).toEqual(['tags:\t', 'details:\t', 'widgets:\t0']);
  });
});

type DashboardOutcome = Parameters<typeof renderMarketviewDashboardTab>[0];

async function render(
  outcome: DashboardOutcome,
  options: Parameters<typeof renderMarketviewDashboardTab>[1] = {},
): Promise<string> {
  const output: string[] = [];
  await renderMarketviewDashboardTab(outcome, options, {
    write: (text) => output.push(text),
    writeError: (text) => output.push(`stderr: ${text}`),
    setExitCode: (code) => output.push(`exit: ${code}`),
  });
  return output.join('');
}

function sectionedDashboard(
  refinement?: NonNullable<MarketViewDashboardValue['refinement']>,
  pageSize = 30,
): DashboardOutcome {
  return {
    result: {
      ok: true,
      value: {
        kind: 'dashboard',
        dashboard: {} as Extract<MarketViewDashboardValue, { kind: 'dashboard' }>['dashboard'],
        window: {
          title: 'Carry Monitor',
          author: null,
          description: null,
          tags: ['FX'],
          link: 'https://marquee.gs.com/s/marketview/dashboards/MD_CARRY',
          total: 3,
          widgets: [widget(1, ['cross=EURUSD']), widget(2), widget(3, ['cross=USDJPY'])],
          sections: [
            { title: 'Majors', startIndex: 0, widgetCount: 2 },
            { title: 'Crosses', startIndex: 2, widgetCount: 1 },
          ],
        },
        artifact: {
          namespace: 'd1',
          root: { type: 'dashboard', dashboardId: 'MD_CARRY', cursor: { page: 1, pageSize, total: 3 } },
        },
        ...(refinement ? { refinement } : {}),
      },
    },
    evidence: [],
  };
}

describe('renderMarketviewDashboardTab text', () => {
  it('prints the Dashboard view text for a Dashboard without -S', async () => {
    await expect(render(sectionedDashboard(undefined, 2))).resolves.toBe([
      'title:\tCarry Monitor',
      'ref:\t@d1',
      'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_CARRY',
      'tags:\tFX',
      'widgets:\t2 of 3',
      '',
      'Majors',
      'ref:\t@d1.s1',
      'ref\ttitle\tparams',
      '@d1.w1\tWidget 1\tcross=EURUSD',
      '@d1.w2\tWidget 2\t',
      '',
      'To see more widgets, try: marquee marketview dashboard view @d1 -L 3',
      'To find widgets, try: marquee marketview dashboard view @d1 -S <query>',
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      '',
    ].join('\n'));
  });
});

describe('renderMarketviewDashboardTab --json', () => {
  it('keeps empty and off-page section refs in ordinal order even with duplicate titles', async () => {
    const outcome = sectionedDashboard(undefined, 1);
    if (!outcome.result.ok) throw new Error('expected dashboard');
    const payload = outcome.result.value.window as DashboardPresentation;
    const sections = [
      { title: 'Same', startIndex: 0, widgetCount: 0 },
      { title: 'Same', startIndex: 0, widgetCount: 2 },
      { title: 'Same', startIndex: 2, widgetCount: 1 },
    ];
    const sectioned = {
      ...outcome,
      result: {
        ...outcome.result,
        value: { ...outcome.result.value, window: { ...payload, sections } },
      },
    };
    await expect(render(sectioned, { json: 'sections' })).resolves.toBe(
      JSON.stringify({ sections: [
        { ref: '@d1.s1', title: 'Same' },
        { ref: '@d1.s2', title: 'Same' },
        { ref: '@d1.s3', title: 'Same' },
      ] }) + '\n',
    );
    expect(formatDashboardText({ ...payload, sections }, {
      ns: 'd1', cursor: { pageSize: 1, total: 3 },
    })).toContain('Same (1 of 2 widgets)\nref:\t@d1.s2\n');
    await expect(render(entityFeed('MA_ACME', ''), { json: 'sections' }))
      .resolves.toBe('{"sections":[]}\n');
  });

  it('prints the page widgets with their refs, params and sections', async () => {
    await expect(render(sectionedDashboard(), {
      json: 'details,ref,tags,title,total,url,widgets',
    })).resolves.toBe(`${JSON.stringify({
      details: null,
      ref: '@d1',
      tags: ['FX'],
      title: 'Carry Monitor',
      total: 3,
      url: 'https://marquee.gs.com/s/marketview/dashboards/MD_CARRY',
      widgets: [
        { id: 'MW1', params: ['cross=EURUSD'], ref: '@d1.w1', section: 'Majors', title: 'Widget 1' },
        { id: 'MW2', params: [], ref: '@d1.w2', section: 'Majors', title: 'Widget 2' },
        { id: 'MW3', params: ['cross=USDJPY'], ref: '@d1.w3', section: 'Crosses', title: 'Widget 3' },
      ],
    })}\n`);
  });

  it('prints only the widgets on the page', async () => {
    await expect(render(sectionedDashboard(undefined, 1), { json: 'widgets' })).resolves.toBe(
      `${JSON.stringify({
        widgets: [{ id: 'MW1', params: ['cross=EURUSD'], ref: '@d1.w1', section: 'Majors', title: 'Widget 1' }],
      })}\n`,
    );
  });

  it('prints the -S matches instead of the page', async () => {
    await expect(render(sectionedDashboard({
      kind: 'filter',
      query: 'usdjpy',
      matches: [{ index: 2, ref: 'd1.w3', title: 'Widget 3' }],
      totalMatches: 1,
    }), { json: 'widgets' })).resolves.toBe(
      `${JSON.stringify({
        widgets: [{ id: 'MW3', params: ['cross=USDJPY'], ref: '@d1.w3', section: 'Crosses', title: 'Widget 3' }],
      })}\n`,
    );
  });

  function entityFeed(entityId: string, identity: string): DashboardOutcome {
    return {
      result: {
        ok: true,
        value: {
          kind: 'entity-feed',
          entityFeed: {} as Extract<MarketViewDashboardValue, { kind: 'entity-feed' }>['entityFeed'],
          window: {
            title: entityId,
            identity,
            entityId,
            entityKind: 'asset',
            author: null,
            description: null,
            tags: [],
            link: `https://marquee.gs.com/s/marketview/asset/${entityId}`,
            total: 0,
            widgets: [],
          },
          artifact: {
            namespace: 'd2',
            root: {
              type: 'entity-feed',
              entityId,
              entityKind: 'asset',
              cursor: { page: 1, pageSize: 30, total: 0 },
            },
          },
        },
      },
      evidence: [],
    };
  }

  it('prints an entity feed identity line as its details, and null details for an empty one', async () => {
    await expect(Promise.all([
      render(entityFeed('MA_ACME', 'ACME · Equity'), { json: 'details,ref' }),
      render(entityFeed('MC_JP', ''), { json: 'details,ref' }),
    ])).resolves.toEqual([
      `${JSON.stringify({ details: ['ACME', 'Equity'], ref: '@d2' })}\n`,
      `${JSON.stringify({ details: null, ref: '@d2' })}\n`,
    ]);
  });

  it('fails loud when a page widget has no snippet', async () => {
    const outcome = sectionedDashboard();
    if (!outcome.result.ok) throw new Error('expected a Dashboard');
    outcome.result.value.window.widgets[0] = { widgetId: 'MW1', title: 'Widget 1' };

    await expect(render(outcome, { json: 'widgets' }))
      .rejects.toThrow('Dashboard Widget MW1 is missing its authoritative snippet');
  });

  it('writes a jq failure as a MarketView error line', async () => {
    await expect(render(sectionedDashboard(), { json: 'title', jq: '.[' }))
      .resolves.toMatch(/^exit: 1stderr: Error: .+\n$/s);
  });
});

describe('renderMarketviewDashboardTab errors', () => {
  function failed(
    error: Extract<DashboardOutcome['result'], { ok: false }>['error'],
    evidence: DashboardOutcome['evidence'] = [],
  ): DashboardOutcome {
    return { result: { ok: false, error }, evidence };
  }

  it('writes each Ref and refinement error with exit code 1', async () => {
    await expect(Promise.all([
      render(failed({ kind: 'artifact-not-found', ref: 'd9', availableRefs: [] })),
      render(failed({ kind: 'wrong-artifact-kind', ref: 'w1', artifact: { type: 'widget', widgetId: 'MW1' as WidgetId } })),
      render(failed({ kind: 'invalid-refinement', problem: 'empty-search' })),
      render(failed({ kind: 'invalid-refinement', problem: 'ref-required' })),
      render(failed({ kind: 'artifact-payload-not-found', ref: 'd1' })),
    ])).resolves.toEqual([
      'exit: 1stderr: Error: ref @d9 not found\nHint: run the previous command again or use one of the refs printed above.\n',
      expect.stringMatching(/^exit: 1stderr: Error: ref @w1 is a widget/),
      'exit: 1stderr: Error: -S requires a non-empty query\n',
      'exit: 1stderr: Error: -S requires a dashboard ref such as @d1\n',
      'exit: 1stderr: Error: ref @d1 payload not cached. Re-run `marquee marketview dashboard view <ID>`.\n',
    ]);
  });

  it('writes a Dashboard read error with its classified exit code', async () => {
    await expect(render(failed({
      kind: 'dashboard',
      error: { kind: 'dependency', failure: { kind: 'cancelled' } },
    }))).resolves.toMatch(/^exit: 2stderr: Error: /);
  });

  it('explains a Dashboard Widget failure with the Dashboard Widget hydrate audit only', async () => {
    const audit = (message: string) => ({ intent: 'read', calls: [], failure: { message } });
    await expect(render(failed({
      kind: 'widget',
      action: 'widget-snippet',
      error: { kind: 'widget-load-failure', identity: { widgetId: 'MW1' }, failure: { kind: 'timeout' } },
    }, [
      { order: 1, owner: 'widget', operation: 'hydrate', outcome: 'failed', value: audit('other owner') },
      { order: 2, owner: 'dashboard-widget', operation: 'load', outcome: 'failed', value: audit('other operation') },
      { order: 3, owner: 'dashboard-widget', operation: 'hydrate', outcome: 'failed', value: audit('Widget feed timed out') },
    ]))).resolves.toBe('exit: 1stderr: Error: Widget feed timed out\n');
  });
});
