import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { describe, expect, it } from 'vitest';
import {
  formatMarketViewSearchEntries,
  MARKETVIEW_SEARCH_JSON_FIELDS,
  presentMarketViewSearchError,
  runMarketViewSearch,
} from '../search.js';

describe('MarketView Search presenter', () => {
  it('recovers discovery guidance from ordered evidence', () => {
    expect(presentMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'unavailable' },
    }, [
      {
        order: 1,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'failed',
        value: {
          kind: 'provider-failure',
          message: 'Credential Service rejected MarketView Search',
          code: 'http',
          details: {
            status: 403,
            credentialServiceCode: 'relink_required',
          },
        },
      },
      {
        order: 2,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: {
          kind: 'discovery-failure-reference',
          providerEvidenceOrder: 1,
          selectors: ['keyword-widget'],
        },
      },
    ])).toEqual({
      message: 'Credential Service rejected MarketView Search',
      exitCode: 1,
    });
  });

  it('follows the latest discovery failure reference', () => {
    const providerFailure = (order: number, message: string) => ({
      order,
      owner: 'marketview-search',
      operation: 'GET /v1/marketview/search',
      outcome: 'failed' as const,
      value: { kind: 'provider-failure', message },
    });
    const reference = (order: number, providerEvidenceOrder: number) => ({
      order,
      owner: 'marketview-search',
      operation: 'failure-reference',
      outcome: 'succeeded' as const,
      value: { kind: 'discovery-failure-reference', providerEvidenceOrder, selectors: ['keyword-widget'] },
    });

    expect(presentMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'unavailable' },
    }, [
      providerFailure(1, 'First search failed'),
      reference(2, 1),
      providerFailure(3, 'Second search failed'),
      reference(4, 3),
      { order: 5, owner: 'marketview-search', operation: 'presentation', outcome: 'succeeded', value: {} },
    ])).toEqual({ message: 'Second search failed', exitCode: 1 });
  });

  it('matches authentication guidance to its transport evidence when a sibling is cancelled', () => {
    expect(presentMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'authentication-required', realm: 'marquee' },
    }, [
      {
        order: 1,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'failed',
        value: {
          kind: 'provider-failure',
          message: 'Not authenticated. Run: marquee auth login',
          code: 'auth_expired',
        },
      },
      {
        order: 2,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'cancelled',
        value: {
          kind: 'provider-failure',
          message: 'Request canceled after caller aborted',
          code: 'network',
          details: { isCanceled: true },
        },
      },
      {
        order: 3,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: {
          kind: 'discovery-failure-reference',
          providerEvidenceOrder: 1,
          selectors: ['keyword-widget'],
        },
      },
    ])).toEqual({
      message: 'Not authenticated. Run: marquee auth login',
      exitCode: 4,
    });
  });

  it('does not render sibling cancellation diagnostics for rate limiting', () => {
    expect(presentMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'rate-limited' },
    }, [
      {
        order: 1,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'failed',
        value: {
          kind: 'provider-failure',
          message: 'MarketView rate limit reached',
          code: 'http',
          details: { status: 429 },
        },
      },
      {
        order: 2,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'cancelled',
        value: {
          kind: 'provider-failure',
          message: 'Request canceled after caller aborted',
          code: 'network',
          details: { isCanceled: true },
        },
      },
      {
        order: 3,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: {
          kind: 'discovery-failure-reference',
          providerEvidenceOrder: 1,
          selectors: ['keyword-widget'],
        },
      },
    ])).toEqual({
      message: 'MarketView rate limit reached',
      exitCode: 1,
    });
  });

  it('uses the exact dispatch reference when sibling failures share one kind', () => {
    expect(presentMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'unavailable' },
    }, [
      {
        order: 1,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'failed',
        value: {
          kind: 'provider-failure',
          message: 'Sibling unavailable',
          code: 'network',
        },
      },
      {
        order: 2,
        owner: 'marketview-search',
        operation: 'GET /v1/marketview/search',
        outcome: 'failed',
        value: {
          kind: 'provider-failure',
          message: 'Selected unavailable',
          code: 'network',
        },
      },
      {
        order: 3,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: {
          kind: 'discovery-failure-reference',
          providerEvidenceOrder: 2,
          selectors: ['asset'],
        },
      },
    ])).toEqual({
      message: 'Selected unavailable',
      exitCode: 1,
    });
  });

  it('uses the selected adapter evidence instead of a sibling decode failure', () => {
    expect(presentMarketViewSearchError({
      kind: 'discovery-failed',
      failure: { kind: 'unavailable' },
    }, [
      {
        order: 1,
        owner: 'marketview-search.adapter',
        operation: 'discover',
        outcome: 'failed',
        value: {
          kind: 'adapter-failure',
          message: 'Sibling adapter failed',
          selectors: ['asset'],
        },
      },
      {
        order: 2,
        owner: 'marketview-search.adapter',
        operation: 'discover',
        outcome: 'failed',
        value: {
          kind: 'adapter-failure',
          message: 'Selected adapter failed',
          selectors: ['keyword-widget'],
        },
      },
      {
        order: 3,
        owner: 'marketview-search',
        operation: 'failure-reference',
        outcome: 'succeeded',
        value: {
          kind: 'discovery-failure-reference',
          selectors: ['keyword-widget'],
        },
      },
    ])).toEqual({
      message: 'Selected adapter failed',
      exitCode: 1,
    });
  });

  it('prints complete widget and dashboard groups as titled tables without counts, and footer hints', () => {
    const widget = {
      kind: 'configured-widget' as const,
      identity: { widgetId: 'MW1' as WidgetId, configurationId: 'WC1' as ConfigId },
      snippet: {
        title: 'Carry widget',
        isTitleResolved: true,
        parameterLines: ['cross=EURUSD', 'relativeDate='],
      },
    };
    const asset = {
      kind: 'entity' as const,
      identity: { kind: 'asset' as const, entityId: 'MA1' },
      label: 'Apple',
    };
    const output = formatMarketViewSearchEntries([widget, asset], {
      limit: 10,
      searchNamespace: 's1',
      presentation: {
        entries: [
          { entry: widget },
          {
            entry: asset,
            detail: { kind: 'entity', qualifiers: ['Equity', 'AAPL'] },
            url: 'https://marquee.gs.com/s/marketview/asset/MA1',
          },
        ],
      },
    });

    expect(output).toBe([
      'Widgets',
      'ref\ttitle\tparams',
      '@s1.w1\tCarry widget\tcross=EURUSD, relativeDate=',
      '',
      'Dashboards',
      'ref\ttitle\tdetails',
      '@s1.d1\tApple\tEquity, AAPL',
      '',
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      "To see a dashboard's widgets, try: marquee marketview dashboard view <ref>",
      '',
    ].join('\n'));
  });

  it('titles a group that may be cut at its limit `(N shown)`, since its total is unknown', () => {
    const widgets = ['MW1', 'MW2'].map((widgetId) => ({
      kind: 'configured-widget' as const,
      identity: { widgetId: widgetId as WidgetId, configurationId: `WC_${widgetId}` as ConfigId },
      snippet: { title: widgetId, isTitleResolved: true, parameterLines: [] },
    }));
    const thematic = Array.from({ length: 5 }, (_, index) => ({
      kind: 'dashboard' as const,
      identity: { dashboardId: `MD${index}` },
      title: `Dashboard ${index}`,
    }));
    const output = formatMarketViewSearchEntries([...widgets, ...thematic], { limit: 2 });

    expect(output).toContain('Widgets (2 shown)\nref\ttitle\tparams\n@w1\tMW1\t\n@w2\tMW2\t\n\nDashboards (5 shown)\nref');
    expect(formatMarketViewSearchEntries(thematic, { limit: 10 })).toMatch(/^Dashboards \(5 shown\)\n/);
    expect(formatMarketViewSearchEntries(thematic.slice(0, 4), { limit: 10 }))
      .toMatch(/^Dashboards\nref/);
  });

  it('hints at a higher -L that keeps the query and flags when a group is full', () => {
    const widgets = ['MW1', 'MW2'].map((widgetId) => ({
      kind: 'configured-widget' as const,
      identity: { widgetId: widgetId as WidgetId, configurationId: `WC_${widgetId}` as ConfigId },
      snippet: { title: widgetId, isTitleResolved: true, parameterLines: [] },
    }));
    const assets = ['MA1', 'MA2'].map((entityId) => ({
      kind: 'entity' as const,
      identity: { kind: 'asset' as const, entityId },
      label: entityId,
    }));
    const command = 'marquee marketview search "carry vol" --type widget,asset-dashboard';

    expect(formatMarketViewSearchEntries(widgets, { limit: 2, command }))
      .toContain(`To see more widgets, try: ${command} -L 4\n`);
    expect(formatMarketViewSearchEntries(assets, { limit: 2, command }))
      .toContain(`To see more dashboards, try: ${command} -L 4\n`);
    expect(formatMarketViewSearchEntries([...widgets, ...assets], { limit: 2, command }))
      .toContain(`To see more widgets and dashboards, try: ${command} -L 4\n`);
    expect(formatMarketViewSearchEntries([...widgets, ...assets], { limit: 3, command }))
      .not.toContain('see more');
  });

  it('gives no -L hint for a full Dashboard kind whose cap -L cannot raise', () => {
    const thematic = Array.from({ length: 5 }, (_, index) => ({
      kind: 'dashboard' as const,
      identity: { dashboardId: `MD${index}` },
      title: `Dashboard ${index}`,
    }));
    const command = 'marquee marketview search "fx"';

    expect(formatMarketViewSearchEntries(thematic, { limit: 10, command }))
      .not.toContain('see more');
    expect(formatMarketViewSearchEntries(thematic.slice(0, 2), { limit: 2, command }))
      .toContain(`To see more dashboards, try: ${command} -L 4\n`);
  });

  it('prints nothing for an empty search', () => {
    expect(formatMarketViewSearchEntries([], {
      limit: 10,
      hints: [{ action: 'search articles', command: 'marquee content search "x"' }],
    })).toBe('');
  });

  it('omits the Widget hint when no Widget Snippet is present', () => {
    const output = formatMarketViewSearchEntries([{
      kind: 'entity',
      identity: { kind: 'asset', entityId: 'MA1' },
      label: 'Apple',
    }], { limit: 10 });

    expect(output).not.toContain('marquee marketview widget view');
  });

  it('joins a named Dashboard classification and widget count as details', () => {
    const dashboard = {
      kind: 'dashboard' as const,
      identity: { dashboardId: 'MD_CUSTOM' },
      title: 'Custom Dashboard',
    };
    const output = formatMarketViewSearchEntries([dashboard], {
      limit: 10,
      presentation: {
        entries: [{
          entry: dashboard,
          detail: {
            kind: 'dashboard',
            category: { kind: 'named', value: 'Custom' },
            widgetCount: 8,
          },
        }],
      },
    });

    expect(output).toContain('@d1\tCustom Dashboard\tCustom, 8 widgets\n');
  });

  it('leaves the params cell empty for a Configured Widget with none', () => {
    const output = formatMarketViewSearchEntries([{
      kind: 'configured-widget',
      identity: { widgetId: 'MW_CONFIGURED' as WidgetId, configurationId: 'WC_CONFIGURED' as ConfigId },
      snippet: {
        title: 'Configured Widget',
        isTitleResolved: true,
        parameterLines: [],
      },
    }], { limit: 10, searchNamespace: 's1' });

    expect(output).toContain('@s1.w1\tConfigured Widget\t\n');
  });

  it.each([
    ['authentication', 'Not authenticated. Run: marquee auth login', 4],
    ['timeout', 'Widget request timed out', 1],
    ['cancelled', 'Widget request cancelled', 2],
    ['rate-limit', 'Widget request rate limited', 1],
    ['invalid-response', 'Widget response was invalid', 1],
    ['dependency', 'Widget dependency unavailable', 1],
    ['unexpected-result-mode', 'Widget snippet hydration returned an unexpected result mode', 1],
  ] as const)(
    'presents %s Widget hydration failures without provider detail',
    (problem, message, exitCode) => {
      expect(presentMarketViewSearchError({
        kind: 'widget-hydration-failed',
        identity: { widgetId: 'MW_FAIL' },
        problem,
      })).toEqual({ message, exitCode });
    },
  );

  it('prints typed Widget hydration failures as text errors under --json', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCodes: number[] = [];

    await runMarketViewSearch({
      query: 'synthetic-unconfigured',
      type: 'widget',
      limit: '1',
      typeSource: 'cli',
      json: 'title',
    }, {
      write: (text) => output.push(text),
      writeError: (text) => errors.push(text),
      setExitCode: (exitCode) => exitCodes.push(exitCode),
      marketView: {
        async search() {
          return {
            result: {
              ok: false,
              error: {
                kind: 'widget-hydration-failed',
                identity: { widgetId: 'MW_FAIL' },
                problem: 'invalid-response',
              },
            },
            evidence: [],
          };
        },
      },
    });

    expect(exitCodes).toEqual([1]);
    expect(output).toEqual([]);
    expect(errors.join('')).toBe('Error: Widget response was invalid\n');
  });

  it('preserves adjacent hydration evidence without placing it in the semantic error', () => {
    expect(presentMarketViewSearchError({
      kind: 'widget-hydration-failed',
      identity: { widgetId: 'MW_FAIL' },
      problem: 'dependency',
    }, [{
      order: 1,
      owner: 'widget',
      operation: 'GET /v1/marketview/widgets/MW_FAIL',
      outcome: 'failed',
      value: {
        kind: 'provider-failure',
        message: 'Exact immutable provider guidance',
        status: 503,
      },
    }])).toEqual({
      message: 'Exact immutable provider guidance',
      exitCode: 1,
    });
  });

  it('presents the typed Widget Snippet failure instead of a dependency outage', () => {
    expect(presentMarketViewSearchError({
      kind: 'widget-hydration-failed',
      identity: { widgetId: 'MW_FAIL' },
      problem: 'widget-error',
      widgetError: {
        kind: 'missing-display-evidence',
        identity: { widgetId: 'MW_FAIL' },
        field: 'Basket',
      },
    })).toEqual({
      message: 'Widget MW_FAIL has no display evidence for snippet parameter Basket',
      exitCode: 1,
    });
  });

});

type SearchOutcome = Awaited<ReturnType<Parameters<typeof runMarketViewSearch>[1]['marketView']['search']>>;
type SearchRequest = Parameters<Parameters<typeof runMarketViewSearch>[1]['marketView']['search']>[0];
type Evidence = SearchOutcome['evidence'][number];
type PresentationEntries = Parameters<typeof formatMarketViewSearchEntries>[1]['presentation'];

function configuredWidget(widgetId: string, title = widgetId, parameterLines: string[] = []) {
  return {
    kind: 'configured-widget' as const,
    identity: { widgetId: widgetId as WidgetId, configurationId: `WC_${widgetId}` as ConfigId },
    snippet: { title, isTitleResolved: true, parameterLines },
  };
}

function searchOutcome(
  presentation: NonNullable<PresentationEntries>,
  options: Readonly<{ limit?: number; namespace?: string | null; evidence?: Evidence[] }> = {},
): SearchOutcome {
  const namespace = options.namespace === undefined ? 's1' : options.namespace;
  return {
    result: {
      ok: true,
      value: {
        kind: 'search',
        search: {
          page: {
            type: 'marketview-search',
            query: 'q',
            results: presentation.entries.map(({ entry }) => entry),
            continuation: { query: 'q', selectors: ['keyword-widget'], limit: options.limit ?? 10 },
          },
          ...(namespace === null ? {} : { artifact: { namespace, searchUrl: 'https://marquee.gs.com/s/marketview/search?query=q' } }),
        },
      },
    },
    evidence: options.evidence ?? [{
      order: 1,
      owner: 'marketview-search',
      operation: 'presentation',
      outcome: 'succeeded',
      value: presentation,
    }],
  };
}

async function runSearch(
  input: Partial<Parameters<typeof runMarketViewSearch>[0]>,
  outcome: SearchOutcome = searchOutcome({ entries: [] }),
) {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  const requests: SearchRequest[] = [];
  await runMarketViewSearch({
    query: 'carry',
    type: 'widget',
    limit: '10',
    typeSource: 'cli',
    ...input,
  }, {
    write: (text) => output.push(text),
    writeError: (text) => errors.push(text),
    setExitCode: (exitCode) => exitCodes.push(exitCode),
    marketView: {
      async search(request) {
        requests.push(request);
        return outcome;
      },
    },
  });
  return { output: output.join(''), errors: errors.join(''), exitCodes, requests };
}

function failure(order: number, owner: string, operation: string, value: unknown, outcome: Evidence['outcome'] = 'failed'): Evidence {
  return { order, owner, operation, outcome, value };
}

function providerFailure(message: string, details?: Record<string, unknown>) {
  return { kind: 'provider-failure', message, code: 'http', ...(details ? { details } : {}) };
}

function failureReference(selectors: string[], providerEvidenceOrder?: number): Evidence {
  return failure(99, 'marketview-search', 'failure-reference', {
    kind: 'discovery-failure-reference',
    selectors,
    ...(providerEvidenceOrder === undefined ? {} : { providerEvidenceOrder }),
  }, 'succeeded');
}

const unavailable = { kind: 'discovery-failed', failure: { kind: 'unavailable' } } as const;

describe('MarketView Search input parsing', () => {
  it.each([
    ['an empty query', { query: '  ' }, 'Error: marketview search query must not be empty\n'],
    ['no --type value', { type: ' , ' }, 'Error: marketview search requires at least one --type value\n'],
    [
      'one unknown type',
      { type: 'widget,dashboard' },
      'Error: Unknown marketview search type "dashboard". Supported types: widget, widget-semantic, widget-hybrid, thematic-dashboard, asset-dashboard, country-dashboard, portfolio-dashboard\n',
    ],
    [
      'two unknown types',
      { type: 'chart,dashboard,chart' },
      'Error: Unknown marketview search types "chart", "dashboard". Supported types: widget, widget-semantic, widget-hybrid, thematic-dashboard, asset-dashboard, country-dashboard, portfolio-dashboard\n',
    ],
  ])('rejects %s before searching', async (_name, input, message) => {
    const run = await runSearch(input);

    expect(run).toEqual({ output: '', errors: message, exitCodes: [1], requests: [] });
  });

  it.each(['0', '01', '-1', '1.5', '1a', 'a1', '', `1${'0'.repeat(400)}`])(
    'rejects --limit %j as not a positive integer',
    async (limit) => {
      const run = await runSearch({ limit });

      expect(run).toEqual({
        output: '',
        errors: 'Error: --limit must be a positive integer\n',
        exitCodes: [1],
        requests: [],
      });
    },
  );

  it.each([['1', 1], ['7', 7], ['120', 120]])('searches with --limit %s', async (limit, expected) => {
    const run = await runSearch({ limit });

    expect(run.requests).toEqual([{ query: 'carry', selectors: ['keyword-widget'], limit: expected }]);
  });

  it('maps each public type once to its selector, keeping the typed query', async () => {
    const run = await runSearch({
      query: ' fx carry ',
      type: ' widget,widget-semantic,widget-hybrid,thematic-dashboard,asset-dashboard,country-dashboard,portfolio-dashboard,widget ',
    });

    expect(run.requests).toEqual([{
      query: ' fx carry ',
      selectors: ['keyword-widget', 'semantic-widget', 'hybrid-widget', 'thematic', 'asset', 'country', 'portfolio'],
      limit: 10,
    }]);
  });

  it('searches the Web Dashboard pool for the default thematic Dashboards', async () => {
    const run = await runSearch({ type: 'widget,thematic-dashboard', typeSource: 'default' });

    expect(run.requests).toEqual([{ query: 'carry', selectors: ['keyword-widget', 'web-dashboard'], limit: 10 }]);
  });
});

describe('MarketView Search output', () => {
  const widget = configuredWidget('MW1', 'Carry  widget', ['cross=EURUSD']);

  it('repeats an explicit --type, deduplicated, in the -L hint', async () => {
    const run = await runSearch(
      { query: 'fx "carry"', type: 'widget, widget ,asset-dashboard', limit: '1' },
      searchOutcome({ entries: [{ entry: widget }] }, { limit: 1 }),
    );

    expect(run).toEqual({
      output: [
        'Widgets (1 shown)',
        'ref\ttitle\tparams',
        '@s1.w1\tCarry widget\tcross=EURUSD',
        '',
        'To see more widgets, try: marquee marketview search "fx \\"carry\\"" --type widget,asset-dashboard -L 2',
        'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
        '',
      ].join('\n'),
      errors: '',
      exitCodes: [],
      requests: [{ query: 'fx "carry"', selectors: ['keyword-widget', 'asset'], limit: 1 }],
    });
  });

  it('leaves the default --type out of the -L hint', async () => {
    const run = await runSearch(
      { type: 'widget', typeSource: 'default', limit: '1' },
      searchOutcome({ entries: [{ entry: widget }] }, { limit: 1 }),
    );

    expect(run.output).toContain('To see more widgets, try: marquee marketview search "carry" -L 2\n');
  });

  it('pages by the limit the search reports, not the typed one', async () => {
    const run = await runSearch(
      { limit: '1' },
      searchOutcome({ entries: [{ entry: widget }] }, { limit: 2 }),
    );

    expect(run.output).toMatch(/^Widgets\n/);
    expect(run.output).not.toContain('see more');
  });

  it('reports an empty search on stderr', async () => {
    const run = await runSearch({ query: 'latest research notes' });

    expect(run).toMatchObject({ output: '', errors: 'no widgets match "latest research notes"\n', exitCodes: [] });
  });

  it('keeps a multiline empty query diagnostic on one line', async () => {
    const run = await runSearch({ query: 'carry\n3m' });

    expect(run).toMatchObject({ output: '', errors: 'no widgets match "carry\\n3m"\n', exitCodes: [] });
  });

  it.each([
    ['the presentation', searchOutcome({ entries: [] }, { evidence: [] })],
    ['the Artifact', searchOutcome({ entries: [] }, { namespace: null })],
  ])('fails loud on a search outcome missing %s', async (_name, outcome) => {
    await expect(runSearch({}, outcome)).rejects.toThrow(
      'MarketView Search outcome is missing its presentation or Artifact',
    );
  });

  it('prints one JSON record per result in text order with the text refs', async () => {
    const semantic = configuredWidget('MW_SEM', 'Semantic widget', ['tenor=1y']);
    const keyword = configuredWidget('MW_KEY', 'Keyword widget');
    const dashboard = { kind: 'dashboard' as const, identity: { dashboardId: 'MD1' }, title: 'Sample Dashboard' };
    const untitled = { kind: 'entity' as const, identity: { kind: 'asset' as const, entityId: 'MA0' }, label: '' };
    const country = { kind: 'entity' as const, identity: { kind: 'country' as const, entityId: 'MC1' }, label: 'Japan' };
    const run = await runSearch({ json: 'ref,id,type,group,title,params,details,url' }, searchOutcome({
      entries: [
        { entry: semantic, widgetMode: 'semantic', url: 'https://marquee.gs.com/s/w/MW_SEM' },
        { entry: keyword, widgetMode: 'keyword' },
        { entry: dashboard, detail: { kind: 'dashboard', category: { kind: 'thematic' }, widgetCount: 3 }, url: 'https://marquee.gs.com/s/d/MD1' },
        { entry: untitled },
        { entry: country, detail: { kind: 'entity', qualifiers: ['Country'] } },
      ],
    }, { namespace: 's7' }));

    expect(run.errors).toBe('');
    expect(JSON.parse(run.output)).toEqual([
      { ref: '@s7.w1', id: 'MW_KEY', type: 'widget', group: 'Keyword widgets', title: 'Keyword widget', params: [], details: null, url: null },
      { ref: '@s7.w2', id: 'MW_SEM', type: 'widget', group: 'Semantic widgets', title: 'Semantic widget', params: ['tenor=1y'], details: null, url: 'https://marquee.gs.com/s/w/MW_SEM' },
      { ref: '@s7.d1', id: 'MD1', type: 'dashboard', group: 'Dashboards', title: 'Sample Dashboard', params: null, details: ['Thematic', '3 widgets'], url: 'https://marquee.gs.com/s/d/MD1' },
      { ref: null, id: 'MA0', type: 'asset', group: 'Dashboards', title: '', params: null, details: [], url: null },
      { ref: '@s7.d2', id: 'MC1', type: 'country', group: 'Dashboards', title: 'Japan', params: null, details: ['Country'], url: null },
    ]);
  });

  it('offers each JSON record field to --json', () => {
    expect(MARKETVIEW_SEARCH_JSON_FIELDS).toEqual(['details', 'group', 'id', 'params', 'ref', 'title', 'type', 'url']);
  });

  it('groups single-mode widgets under one Widgets group in JSON', async () => {
    const run = await runSearch({ json: 'ref,group' }, searchOutcome({
      entries: [{ entry: configuredWidget('MW1'), widgetMode: 'semantic' }, { entry: configuredWidget('MW2'), widgetMode: 'semantic' }],
    }));

    expect(JSON.parse(run.output)).toEqual([
      { ref: '@s1.w1', group: 'Widgets' },
      { ref: '@s1.w2', group: 'Widgets' },
    ]);
  });

  it('reports a failed --jq filter as a command error', async () => {
    const run = await runSearch({ json: 'ref', jq: '.[' }, searchOutcome({ entries: [{ entry: widget }] }));

    expect(run.output).toBe('');
    expect(run.exitCodes).toEqual([1]);
    expect(run.errors).toMatch(/^Error: .+\n$/);
  });

  it.each([
    'latest articles on fx',
    'Commentary',
    'research notes on carry',
    'macro report',
    'recent GS take',
    'the newest one two three four five views',
    'notes by strategists',
    'views from GIR',
    'gs insights on rates',
    'GIR research',
    'insight on rates and vol from gs',
    'macro  report',
    'latest views',
    'current  outlook  takes',
    'notes  by strategists',
    'gs  insights',
  ])('hints at an article search for %j', async (query) => {
    const run = await runSearch({ query: ` ${query} ` }, searchOutcome({ entries: [{ entry: widget }] }));

    expect(run.output).toContain(`To find articles, try: marquee content search ${JSON.stringify(query)}\n`);
  });

  it.each([
    'fx carry',
    'articlesx',
    'research desk notes',
    'latest one two three four five six views',
    'reports in by',
    'gsx research',
    'research on rates and vol and the whole curve shape from gs',
  ])('gives no article hint for %j', async (query) => {
    const run = await runSearch({ query }, searchOutcome({ entries: [{ entry: widget }] }));

    expect(run.output).not.toContain('find articles');
  });
});

describe('MarketView Search text tables', () => {
  it('splits mixed widget modes into ordered mode groups with running refs', () => {
    const output = formatMarketViewSearchEntries([], {
      limit: 2,
      presentation: {
        entries: [
          { entry: configuredWidget('MW_LLM'), widgetMode: 'llm-reranked' },
          { entry: configuredWidget('MW_SEM'), widgetMode: 'semantic' },
          { entry: configuredWidget('MW_KEY') },
          { entry: configuredWidget('MW_SEM2'), widgetMode: 'semantic' },
        ],
      },
    });

    expect(output).toBe([
      'Keyword widgets',
      'ref\ttitle\tparams',
      '@w1\tMW_KEY\t',
      '',
      'Semantic widgets (2 shown)',
      'ref\ttitle\tparams',
      '@w2\tMW_SEM\t',
      '@w3\tMW_SEM2\t',
      '',
      'Llm-reranked widgets',
      'ref\ttitle\tparams',
      '@w4\tMW_LLM\t',
      '',
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      '',
    ].join('\n'));
  });

  it('prints Dashboard kinds with their details, an untitled Asset without a ref, and no Dashboard hint for it alone', () => {
    const untitled = { kind: 'entity' as const, identity: { kind: 'asset' as const, entityId: 'MA0' }, label: '' };
    const portfolio = { kind: 'entity' as const, identity: { kind: 'portfolio' as const, entityId: 'MP1' }, label: 'Book' };
    const named = { kind: 'dashboard' as const, identity: { dashboardId: 'MD1' }, title: 'Rates' };

    expect(formatMarketViewSearchEntries([untitled], { limit: 10 })).toBe('Dashboards\nref\ttitle\tdetails\n\t\t\n');
    expect(formatMarketViewSearchEntries([], {
      limit: 10,
      searchNamespace: 's2',
      presentation: {
        entries: [
          { entry: untitled },
          { entry: portfolio },
          { entry: named, detail: { kind: 'dashboard', category: { kind: 'named', value: 'macro' }, widgetCount: 1 } },
        ],
      },
    })).toBe([
      'Dashboards',
      'ref\ttitle\tdetails',
      '\t\t',
      '@s2.d1\tBook\t',
      '@s2.d2\tRates\tMacro, 1 widgets',
      '',
      "To see a dashboard's widgets, try: marquee marketview dashboard view <ref>",
      '',
    ].join('\n'));
  });

  it('counts every Dashboard kind against its own cap', () => {
    const entities = (kind: 'asset' | 'country' | 'portfolio', count: number) => Array.from(
      { length: count },
      (_, index) => ({ kind: 'entity' as const, identity: { kind, entityId: `${kind}${index}` }, label: `${kind} ${index}` }),
    );
    const command = 'marquee marketview search "x"';

    expect(formatMarketViewSearchEntries([...entities('asset', 6), ...entities('country', 4)], { limit: 7, command }))
      .toMatch(/^Dashboards\n/);
    expect(formatMarketViewSearchEntries([...entities('asset', 1), ...entities('country', 5)], { limit: 7, command }))
      .toMatch(/^Dashboards \(6 shown\)\n[^]*\n\nTo see a dashboard's widgets/);
    expect(formatMarketViewSearchEntries(entities('portfolio', 3), { limit: 3, command }))
      .toContain(`To see more dashboards, try: ${command} -L 6\n`);
    expect(formatMarketViewSearchEntries(entities('asset', 3), { limit: 4, command }))
      .not.toContain('see more');
  });

  it('adds the caller hints after its own', () => {
    expect(formatMarketViewSearchEntries([configuredWidget('MW1')], {
      limit: 10,
      hints: [{ action: 'find articles', command: 'marquee content search "x"' }],
    })).toContain([
      'To see all params, chart and data for a widget, try: marquee marketview widget view <ref>',
      'To find articles, try: marquee content search "x"',
      '',
    ].join('\n'));
  });
});

describe('MarketView Search failure messages', () => {
  it.each([
    [{ kind: 'invalid-query' }, 'marketview search query must not be empty', 1],
    [{ kind: 'invalid-selector-set' }, 'marketview search requires at least one selector', 1],
    [{ kind: 'invalid-limit' }, 'marketview search limit must be a positive integer', 1],
    [{ kind: 'entity-resolution-failed' }, 'MarketView entity resolution failed', 1],
    [{ kind: 'artifact-policy-failed' }, 'MarketView Search artifact policy failed', 1],
    [{ kind: 'discovery-failed', failure: { kind: 'authentication-required', realm: 'marquee' } }, 'Not authenticated. Run: marquee auth login', 4],
    [{ kind: 'discovery-failed', failure: { kind: 'timeout' } }, 'MarketView search timed out', 1],
    [{ kind: 'discovery-failed', failure: { kind: 'cancelled' } }, 'MarketView search cancelled', 2],
    [{ kind: 'discovery-failed', failure: { kind: 'rate-limited' } }, 'MarketView search rate limited', 1],
    [unavailable, 'MarketView search unavailable', 1],
  ] as const)('presents %j without evidence as %j', (error, message, exitCode) => {
    expect(presentMarketViewSearchError(error)).toEqual({ message, exitCode });
  });

  it('appends the first 200 characters of the provider response body', () => {
    const body = `${'x'.repeat(200)}TAIL`;

    expect(presentMarketViewSearchError(unavailable, [
      failure(1, 'marketview-search', 'GET /v1/marketview/search', providerFailure('Upstream failed', { status: 502, body })),
      failureReference(['keyword-widget'], 1),
    ]).message).toBe(`Upstream failed — ${'x'.repeat(200)}`);
    expect(presentMarketViewSearchError(unavailable, [
      failure(1, 'marketview-search', 'GET /v1/marketview/search', providerFailure('Upstream failed', { status: 502, body: '' })),
      failureReference(['keyword-widget'], 1),
    ]).message).toBe('Upstream failed');
  });

  it('falls back to the semantic message for an empty provider message', () => {
    expect(presentMarketViewSearchError(unavailable, [
      failure(1, 'marketview-search', 'GET /v1/marketview/search', providerFailure('')),
      failureReference(['keyword-widget'], 1),
    ]).message).toBe('MarketView search unavailable');
  });

  it('uses the adapter failure when the referenced provider call succeeded', () => {
    expect(presentMarketViewSearchError(unavailable, [
      failure(1, 'marketview-search', 'GET /v1/marketview/search', { results: [] }, 'succeeded'),
      failure(2, 'marketview-search.adapter', 'discover', {
        kind: 'adapter-failure',
        message: 'Adapter "marketview.search" failed: bad page',
        selectors: ['asset', 'country'],
      }),
      failureReference(['asset', 'country'], 1),
    ]).message).toBe('Adapter "marketview.search" failed: bad page');
  });

  it('ignores an adapter failure whose selectors only start like the reference', () => {
    expect(presentMarketViewSearchError(unavailable, [
      failure(1, 'marketview-search.adapter', 'discover', {
        kind: 'adapter-failure',
        message: 'Sibling adapter failed',
        selectors: ['asset'],
      }),
      failure(2, 'marketview-search', 'GET /v1/marketview/search', providerFailure('Unreferenced failure')),
      failure(3, 'marketview-search', 'GET /v1/marketview/search', undefined, 'dispatched'),
      failureReference(['asset', 'country']),
    ]).message).toBe('MarketView search unavailable');
  });

  it('ignores an adapter failure whose selectors differ after the first', () => {
    expect(presentMarketViewSearchError(unavailable, [
      failure(1, 'marketview-search.adapter', 'discover', {
        kind: 'adapter-failure',
        message: 'Sibling adapter failed',
        selectors: ['asset', 'portfolio'],
      }),
      failureReference(['asset', 'country']),
    ]).message).toBe('MarketView search unavailable');
  });

  it('presents the latest artifact policy failure', () => {
    expect(presentMarketViewSearchError({ kind: 'artifact-policy-failed' }, [
      failure(1, 'marketview-search', 'artifact-policy', { kind: 'artifact-policy-failure', message: 'first' }),
      failure(2, 'marketview-search', 'artifact-policy', { kind: 'artifact-policy-failure', message: 'Registry is read-only' }),
      failure(3, 'marketview-search', 'artifact-policy', undefined, 'dispatched'),
      failure(4, 'marketview-search', 'GET /v1/marketview/search', providerFailure('search failed')),
    ])).toEqual({ message: 'Registry is read-only', exitCode: 1 });
  });

  it('presents the latest entity failure for entity resolution', () => {
    expect(presentMarketViewSearchError({ kind: 'entity-resolution-failed' }, [
      failure(1, 'entity', 'GET /v1/entities', providerFailure('Entity Service unavailable')),
      failure(2, 'marketview-search', 'GET /v1/marketview/search', providerFailure('search failed')),
      failure(3, 'entity', 'GET /v1/entities', { kind: 'entity-audit' }),
    ])).toEqual({ message: 'Entity Service unavailable', exitCode: 1 });
  });

  it('presents only the hydrated Widget own failure', () => {
    const error = { kind: 'widget-hydration-failed', identity: { widgetId: 'MW_FAIL' }, problem: 'timeout' } as const;

    expect(presentMarketViewSearchError(error, [
      failure(1, 'widget', 'GET /v1/marketview/widgets/MW_OTHER', providerFailure('Sibling failed')),
      failure(2, 'entity', 'GET /v1/entities/MW_FAIL', providerFailure('Entity failed')),
    ])).toEqual({ message: 'Widget request timed out', exitCode: 1 });
  });

  it('keeps the semantic message for invalid input even with failure evidence', () => {
    expect(presentMarketViewSearchError({ kind: 'invalid-limit' }, [
      failure(1, 'marketview-search', 'artifact-policy', { kind: 'artifact-policy-failure', message: 'policy' }),
    ]).message).toBe('marketview search limit must be a positive integer');
  });
});
