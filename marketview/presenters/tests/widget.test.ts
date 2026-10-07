import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConfigId,
  RenderedWidget,
  WidgetError,
  WidgetId,
  WidgetParameter,
} from '../../../widget/index.js';
import type {
  MarketViewOperationOutcome,
  MarketViewProviderEvidence,
  MarketViewWidgetGetError,
  MarketViewWidgetGetValue,
} from '../../index.js';
import {
  renderMarketviewWidgetTab,
  widgetPresentationProjection,
  type RenderMarketviewWidgetOptions,
} from '../widget.js';

type Outcome = MarketViewOperationOutcome<MarketViewWidgetGetValue, MarketViewWidgetGetError>;
type FullWidget = Extract<RenderedWidget, { detail: 'full' }>;

function widgetEvidence(value: unknown): MarketViewProviderEvidence {
  return { order: 1, owner: 'widget', operation: 'get', outcome: 'succeeded', value };
}

function fullWidget(
  widget: Partial<FullWidget['widget']> = {},
  execution: FullWidget['execution'] = { family: 'blank' },
): FullWidget {
  return {
    detail: 'full',
    widget: {
      widgetId: 'MW_ONE' as WidgetId,
      configurationId: null,
      title: 'One',
      bindings: [],
      parameters: [],
      ...widget,
    },
    snippet: { title: 'One', isTitleResolved: true, parameterLines: [] },
    execution,
  };
}

function succeeded(
  widget: RenderedWidget,
  evidence: readonly MarketViewProviderEvidence[] = [widgetEvidence({ intent: 'read', calls: [] })],
): Outcome {
  return { result: { ok: true, value: { widget, namespace: 'w1' } }, evidence };
}

function failed(
  error: MarketViewWidgetGetError,
  evidence: readonly MarketViewProviderEvidence[] = [widgetEvidence({ intent: 'read', calls: [] })],
): Outcome {
  return { result: { ok: false, error }, evidence };
}

async function render(outcome: Outcome, options: RenderMarketviewWidgetOptions = {}) {
  const out = { stdout: '', stderr: '', exitCode: undefined as number | undefined };
  await renderMarketviewWidgetTab(outcome, options, {
    write(text) {
      out.stdout += text;
    },
    writeError(text) {
      out.stderr += text;
    },
    setExitCode(code) {
      out.exitCode = code;
    },
  });
  return out;
}

function dateParam(overrides: Partial<WidgetParameter> = {}): WidgetParameter {
  return { field: 'asOf', type: 'Date', default: '2020-01-01', options: [], ...overrides };
}

async function hints(
  widget: Partial<FullWidget['widget']>,
): Promise<string[]> {
  const { stdout } = await render(succeeded(fullWidget({ title: 'Upcoming events', ...widget })));
  return stdout.split('\n').filter((line) => line.startsWith('To '));
}

const call = {
  name: 'widget.metadata',
  request: { method: 'GET', path: '/v1/marketview/widgets/MW_ONE' },
};

describe('MarketView Widget presenter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('facade errors', () => {
    it.each([
      [
        { kind: 'invalid-widget-id', input: 'oil' },
        'Error: marketview widget expects a widget ID like MW..., got "oil". Use `marquee marketview search "oil"` to find widgets by query.\n',
      ],
      [
        { kind: 'artifact-not-found', ref: 'w9', availableRefs: [] },
        'Error: ref @w9 not found\nHint: run the previous command again or use one of the refs printed above.\n',
      ],
      [
        { kind: 'wrong-artifact-kind', ref: 'd1', artifact: { type: 'dashboard', dashboardId: 'DB_ONE' } },
        'Error: ref @d1 is a dashboard — use `marquee marketview dashboard view ...`\n',
      ],
    ] as const)('prints %j as one error line', async (error, stderr) => {
      const out = await render(failed(error, []));

      expect(out).toEqual({ stdout: '', stderr, exitCode: 1 });
    });
  });

  describe('Widget failures', () => {
    const mismatch: WidgetError = {
      kind: 'configuration-mismatch',
      identity: { widgetId: 'MW_ONE', configurationId: 'WC_TWO' },
    };
    const required: WidgetError = {
      kind: 'required-input',
      identity: { widgetId: 'MW_ONE' },
      input: 'asset',
    };

    it.each([
      [[]],
      [[{ ...widgetEvidence({ calls: [] }), owner: 'dashboard' }]],
      [[{ ...widgetEvidence({ calls: [] }), operation: 'render' }]],
      [[widgetEvidence({ calls: {} })]],
      [[widgetEvidence(null)]],
      [[widgetEvidence(undefined)]],
    ])('fails loud when the outcome carries no Widget get evidence (%j)', async (evidence) => {
      await expect(render(failed({ kind: 'widget', error: required }, evidence)))
        .rejects.toThrow('MarketView Widget outcome is missing provider evidence');
      await expect(render(succeeded(fullWidget(), evidence)))
        .rejects.toThrow('MarketView Widget outcome is missing provider evidence');
    });

    it('prints the Widget error with its classified exit code', async () => {
      const out = await render(failed({
        kind: 'widget',
        error: {
          kind: 'widget-load-failure',
          identity: { widgetId: 'MW_ONE' },
          failure: { kind: 'authentication-required', realm: 'marquee' },
        },
      }));

      expect(out.stdout).toBe('');
      expect(out.exitCode).toBe(4);
      expect(out.stderr).toMatch(/^Error: .+\n$/);
    });

    it('names the snippet adapter for a configuration mismatch under --config', async () => {
      const out = await render(failed({ kind: 'widget', error: mismatch }), {
        isSnippet: true,
        configId: 'WC_TWO',
      });

      expect(out).toEqual({
        stdout: '',
        stderr: 'Error: Adapter "marketview.widget-snippet" failed: Widget configuration WC_TWO does not belong to MW_ONE\n',
        exitCode: 1,
      });
    });

    it('names the snippet adapter only under --config, and not for a failed provider path', async () => {
      const pathFailure = widgetEvidence({
        intent: 'read',
        calls: [],
        failure: { message: 'boom', path: '/v1/x' },
      });

      expect((await render(failed({ kind: 'widget', error: required }), {
        isSnippet: true,
        configId: 'WC_ONE',
      })).stderr).toBe('Error: Adapter "marketview.widget-snippet" failed: Widget input asset is required\n');
      expect((await render(failed({ kind: 'widget', error: required }, [pathFailure]), {
        isSnippet: true,
        configId: 'WC_ONE',
      })).stderr).toBe('Error: Widget input asset is required\n');
      expect((await render(failed({ kind: 'widget', error: mismatch }, [pathFailure]), {
        isSnippet: true,
        configId: 'WC_TWO',
      })).stderr).toBe('Error: Adapter "marketview.widget-snippet" failed: Widget configuration WC_TWO does not belong to MW_ONE\n');
      expect((await render(failed({ kind: 'widget', error: mismatch }), {
        isSnippet: true,
      })).stderr).toBe('Error: Widget configuration WC_TWO does not belong to MW_ONE\n');
      expect((await render(failed({ kind: 'widget', error: required }), {
        isSnippet: true,
        configId: 'WC_ONE',
        paramOverrides: [{ field: 'asset', value: 'x' }],
        mutationFallbackRef: 'w1',
      })).stderr).toBe('Error: Adapter "marketview.widget-snippet" failed: Widget input asset is required\n');
    });

    it('reads the latest Widget get evidence', async () => {
      const older = widgetEvidence({ intent: 'read', calls: [], failure: { message: 'old', path: '/v1/old' } });
      const latest = widgetEvidence({ intent: 'read', calls: [] });

      expect((await render(failed({ kind: 'widget', error: required }, [older, latest]), {
        isSnippet: true,
        configId: 'WC_ONE',
      })).stderr).toBe('Error: Adapter "marketview.widget-snippet" failed: Widget input asset is required\n');
    });

    const withCalls = [widgetEvidence({ intent: 'read', calls: [call] })];
    const overridden = {
      paramOverrides: [{ field: 'asset', value: 'x' }],
      mutationFallbackRef: 'w1',
    };
    const fallback = '. Use `marquee browser open @w1` to adjust this widget in Marquee UI or try another option.';

    it('points a failed parameter change at Marquee UI', async () => {
      expect((await render(failed({ kind: 'widget', error: required }, withCalls), overridden)).stderr)
        .toBe(`Error: Widget input asset is required${fallback}\n`);
      expect((await render(failed({
        kind: 'widget',
        error: {
          kind: 'invalid-input',
          identity: { widgetId: 'MW_ONE' },
          input: 'tenor',
          problem: 'incompatible-dependent-input',
        },
      }), overridden)).stderr)
        .toBe(`Error: Widget input tenor is invalid: incompatible-dependent-input${fallback}\n`);
    });

    it('leaves the error unchanged when no parameter change reached Marquee', async () => {
      const invalid: WidgetError = {
        kind: 'invalid-input',
        identity: { widgetId: 'MW_ONE' },
        input: 'flag',
        problem: 'boolean-required',
      };

      expect((await render(failed({ kind: 'widget', error: required }), overridden)).stderr)
        .toBe('Error: Widget input asset is required\n');
      expect((await render(failed({ kind: 'widget', error: invalid }), overridden)).stderr)
        .toBe('Error: flag must be true or false\n');
      expect((await render(failed({ kind: 'widget', error: required }, withCalls), {
        mutationFallbackRef: 'w1',
      })).stderr).toBe('Error: Widget input asset is required\n');
      expect((await render(failed({ kind: 'widget', error: required }, withCalls), {
        paramOverrides: [{ field: 'asset', value: 'x' }],
      })).stderr).toBe('Error: Widget input asset is required\n');
    });

    it('keeps candidate lists and Marquee UI guidance free of the fallback', async () => {
      expect((await render(failed({
        kind: 'widget',
        error: {
          kind: 'ambiguous-input',
          identity: { widgetId: 'MW_ONE' },
          input: 'asset',
          requested: 'x',
          candidates: ['X1'],
        },
      }, withCalls), overridden)).stderr).toBe('Error: ambiguous asset "x" — candidates:\n  X1\n');
      expect((await render(failed({
        kind: 'widget',
        error: {
          kind: 'unmatched-input',
          identity: { widgetId: 'MW_ONE' },
          input: 'asset',
          requested: 'x',
          candidates: [],
        },
      }, withCalls), overridden)).stderr).toBe('Error: no asset option matches "x"\n');
      expect((await render(failed({
        kind: 'widget',
        error: {
          kind: 'plottool-failure',
          identity: { widgetId: 'MW_ONE', configurationId: 'WC_ONE' },
          problem: { kind: 'invalid-chart', chartId: 'CH_ONE', problem: 'invalid-expressions' },
        },
      }, [widgetEvidence({
        intent: 'read',
        calls: [call],
        failure: { message: 'Run marquee browser open @w1 to fix it' },
      })]), overridden)).stderr).toBe('Error: Run marquee browser open @w1 to fix it\n');
    });
  });

  describe('Widget Snippet and view availability', () => {
    it('fails loud when a --snippet read returns the full Widget', async () => {
      expect(await render(succeeded(fullWidget()), { isSnippet: true })).toEqual({
        stdout: '',
        stderr: 'Error: Widget snippet unavailable\n',
        exitCode: 1,
      });
    });

    it('fails loud when a view read returns only a Widget Snippet', async () => {
      const { widget, snippet } = fullWidget({ inputEchoes: ['asset = X'] });

      expect(await render(succeeded({ detail: 'snippet', widget, snippet }))).toEqual({
        stdout: '',
        stderr: 'Error: Widget view unavailable\n',
        exitCode: 1,
      });
    });

    it('echoes resolved inputs to stderr before the Widget', async () => {
      const out = await render(succeeded(fullWidget({ inputEchoes: ['asset = X', 'tenor = 1y'] })));

      expect(out.stderr).toBe('asset = X\ntenor = 1y\n');
      expect(out.stdout.split('\n')[0]).toBe('title:\tOne');
    });

    it('projects only a successful full Widget', () => {
      const { widget, snippet } = fullWidget();

      expect(widgetPresentationProjection({
        ok: false,
        error: { kind: 'required-input', identity: { widgetId: 'MW_ONE' }, input: 'asset' },
      })).toBeUndefined();
      expect(widgetPresentationProjection({ ok: true, value: { detail: 'snippet', widget, snippet } }))
        .toBeUndefined();
    });

    it.each([null, undefined, { kind: 'plot' }])('fails loud on a DataViz projection %j', (projection) => {
      expect(() => widgetPresentationProjection({
        ok: true,
        value: fullWidget({}, {
          family: 'data-viz',
          value: { kind: 'visualization', projection } as never,
        }),
      })).toThrow('DataViz execution is missing its Web-parity projection');
    });
  });

  describe('--json', () => {
    it('prints every Widget field', async () => {
      const out = await render(succeeded(fullWidget({
        configurationId: 'WC_ONE' as ConfigId,
        selectedContext: 'MA_ONE',
        authors: ['Ada Lovelace'],
        access: 'Firmwide: Anyone in your organization can view this widget',
        parameters: [{ field: 'tenor', type: 'Enum', default: '1y', options: [] }],
      }, {
        family: 'plot',
        value: {
          projection: { kind: 'plot', chartType: 'line', isOrdinal: false, series: [], axes: [] },
          rows: [{ date: '2026-07-30', Carry: 1 }],
        },
      })), { json: 'access,authors,data,id,params,ref,title,url' });

      expect(JSON.parse(out.stdout)).toEqual({
        access: 'Firmwide: Anyone in your organization can view this widget',
        authors: ['Ada Lovelace'],
        data: [{ date: '2026-07-30', Carry: 1 }],
        id: 'MW_ONE',
        params: [{ field: 'tenor', type: 'Enum', default: '1y', options: [] }],
        ref: '@w1',
        title: 'One',
        url: 'https://marquee.gs.com/s/marketview/widget/MW_ONE?config=WC_ONE&selectedContext=MA_ONE',
      });
      expect(out.stdout.endsWith('}\n')).toBe(true);
    });

    it('omits absent metadata and has no rows for a Widget without data', async () => {
      const out = await render(succeeded(fullWidget()), { json: 'access,authors,data,url' });

      expect(out.stdout).toBe('{"access":null,"authors":null,"data":[],"url":"https://marquee.gs.com/s/marketview/widget/MW_ONE"}\n');
    });

    it('falls back to the --config Widget Configuration for the URL', async () => {
      const out = await render(succeeded(fullWidget()), { json: 'url', configId: 'WC_FLAG' });

      expect(out.stdout).toBe('{"url":"https://marquee.gs.com/s/marketview/widget/MW_ONE?config=WC_FLAG"}\n');
    });

    it('prefers the Widget\'s own Widget Configuration over --config', async () => {
      const out = await render(
        succeeded(fullWidget({ configurationId: 'WC_ONE' as ConfigId })),
        { json: 'url', configId: 'WC_FLAG' },
      );

      expect(out.stdout).toBe('{"url":"https://marquee.gs.com/s/marketview/widget/MW_ONE?config=WC_ONE"}\n');
    });

    it('prints a --jq failure as an error line', async () => {
      const out = await render(succeeded(fullWidget()), { json: 'id', jq: '.[' });

      expect(out.stdout).toBe('');
      expect(out.exitCode).toBe(1);
      expect(out.stderr).toMatch(/^Error: .+\n$/s);
    });
  });

  describe('text', () => {
    it('prints Widget fields, Selected Context and a dashboard hint', async () => {
      const out = await render(succeeded(fullWidget({
        selectedContext: 'MA_ONE',
        authors: ['Ada Lovelace'],
        access: 'Public: Anyone with this link can view this widget',
        dashboards: [{ dashboardId: 'DB_ONE', title: 'Mine' }],
      })));

      expect(out.stdout).toContain('url:\thttps://marquee.gs.com/s/marketview/widget/MW_ONE?selectedContext=MA_ONE\n');
      expect(out.stderr).toBe('');
      expect(out.stdout).toContain('access:\tPublic\n');
      expect(out.stdout).toContain('To add it to a dashboard, try: marquee marketview dashboard edit <dashboard> --add-widget @w1\n');
    });
  });

  describe('stale Widget Date hints', () => {
    it('suggests refreshing a stale absolute Date on an upcoming Widget', async () => {
      expect(await hints({ parameters: [dateParam()] })).toEqual([
        'To change a param, try: marquee marketview widget view @w1 -p <name>=<value>',
        'To refresh asOf from 2020-01-01, try: marquee marketview widget view @w1 -p asOf=0b',
      ]);
    });

    it('uses the param ref key and the raw default first', async () => {
      expect(await hints({
        parameters: [dateParam({ refKey: 'date', rawDefault: '2020-02-03', default: '3 Feb 2020' })],
      })).toContain('To refresh asOf from 2020-02-03, try: marquee marketview widget view @w1 -p date=0b');
      expect(await hints({
        parameters: [dateParam({ rawDefault: 5, default: '2020-02-04' })],
      })).toContain('To refresh asOf from 2020-02-04, try: marquee marketview widget view @w1 -p asOf=0b');
    });

    it.each([[{}], [{ rdate: 'x' }], [{ rdate: { rule: 5 } }]])(
      'reads a Date default whose raw default %j is not a Relative Date rule',
      async (rawDefault) => {
        expect(await hints({ parameters: [dateParam({ rawDefault })] }))
          .toContain('To refresh asOf from 2020-01-01, try: marquee marketview widget view @w1 -p asOf=0b');
      },
    );

    it('sends a stale QuickPoll survey date to Marquee', async () => {
      expect(await hints({
        parameters: [dateParam({ fillBlocked: { reason: 'quickpoll-survey-date' } })],
      })).toContain('To pick a current asOf in Marquee, try: marquee browser open @w1');
      expect(await hints({
        parameters: [dateParam({ fillBlocked: { reason: 'other' } })],
      })).toContain('To refresh asOf from 2020-01-01, try: marquee marketview widget view @w1 -p asOf=0b');
    });

    it.each([
      ['a Relative Date rule', { parameters: [dateParam({ rawDefault: { rdate: { rule: '-1b' } } })] }],
      ['a non-Date param', { parameters: [dateParam({ type: 'String' })] }],
      ['a non-calendar date', { parameters: [dateParam({ default: '2020-02-30' })] }],
      ['a month past 12', { parameters: [dateParam({ default: '2020-13-01' })] }],
      ['a prefixed date', { parameters: [dateParam({ default: 'x2020-01-01' })] }],
      ['a suffixed date', { parameters: [dateParam({ default: '2020-01-01x' })] }],
      ['a short year', { parameters: [dateParam({ default: '202-01-01' })] }],
      ['a year below 100', { parameters: [dateParam({ default: '0099-01-01' })] }],
      ['a non-string default', { parameters: [dateParam({ default: 20200101 })] }],
      ['a recent date', { parameters: [dateParam({ default: '2999-01-01' })] }],
      ['a historical Widget', { title: 'Past events', parameters: [dateParam()] }],
      ['an embedded keyword', { title: 'Recurrent events', parameters: [dateParam()] }],
    ])('gives no refresh hint for %s', async (_case, widget) => {
      expect((await hints(widget)).filter((hint) => !hint.startsWith('To change a param'))).toEqual([]);
    });

    it.each([
      ['current'],
      ['today'],
      ['tomorrow'],
      ['next  week'],
      ['next month'],
      ['next quarter'],
      ['this  week'],
      ['this month'],
      ['THIS QUARTER'],
    ])('treats a "%s" Widget as current', async (phrase) => {
      expect(await hints({ title: `Events ${phrase}`, parameters: [dateParam()] }))
        .toContain('To refresh asOf from 2020-01-01, try: marquee marketview widget view @w1 -p asOf=0b');
    });

    it('reads a Date from year 100 on', async () => {
      expect(await hints({ parameters: [dateParam({ default: '0100-01-01' })] }))
        .toContain('To refresh asOf from 0100-01-01, try: marquee marketview widget view @w1 -p asOf=0b');
    });

    it('reads the upcoming phrase from the description', async () => {
      expect(await hints({ title: 'Events', description: 'Next week', parameters: [dateParam()] }))
        .toContain('To refresh asOf from 2020-01-01, try: marquee marketview widget view @w1 -p asOf=0b');
    });

    it('calls a Date stale only after 30 days', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.UTC(2020, 0, 31));
      expect(await hints({ parameters: [dateParam()] })).toHaveLength(1);
      vi.setSystemTime(Date.UTC(2020, 0, 31) + 1);
      expect(await hints({ parameters: [dateParam()] })).toHaveLength(2);
    });
  });
});
