import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WidgetModule, RenderedWidget } from '../../../widget/index.js';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
import { createMarketViewWidget } from '../../widget.js';
import { renderMarketviewWidgetTab, widgetPresentationProjection } from '../widget.js';
import { createWidgetEvidenceRecorder } from '../widget-evidence.js';

const get = (path: string) => ({ method: 'GET', path }) as Endpoint;

function fullValue(id: string, configurationId: string): RenderedWidget {
  return {
    detail: 'full',
    widget: {
      widgetId: id as WidgetId,
      configurationId: configurationId as ConfigId,
      title: id,
      chartId: `CH_${id}`,
      family: 'plot',
      bindings: [],
      parameters: [],
    },
    snippet: {
      title: id,
      isTitleResolved: true,
      parameterLines: [],
    },
    execution: {
      family: 'plot',
      value: {
        projection: {
          kind: 'plot',
          chartType: 'line',
          isOrdinal: false,
          series: [],
          axes: [],
        },
        rows: [],
      },
    },
  };
}

function dataVizFullValue(
  rows: readonly Readonly<Record<string, unknown>>[] = [],
): Extract<RenderedWidget, { detail: 'full' }> {
  return {
    detail: 'full',
    widget: {
      widgetId: 'MW_DATAVIZ' as WidgetId,
      configurationId: 'WC_DATAVIZ' as ConfigId,
      title: 'DataViz',
      chartId: 'DV_DATAVIZ',
      family: 'data-viz',
      bindings: [],
      parameters: [],
    },
    snippet: {
      title: 'DataViz',
      isTitleResolved: true,
      parameterLines: [],
    },
    execution: {
      family: 'data-viz',
      value: {
        kind: 'table',
        projection: {
          kind: 'table',
          columns: [{ id: 'value', header: 'Value', text: 'Value' }],
          rows: rows.map((raw) => ({
            kind: 'data',
            raw,
            cells: [{ columnId: 'value', value: raw.value, text: String(raw.value) }],
          })),
          sourceRowCount: rows.length,
        },
      },
    },
  };
}

function blankFullValue(): Extract<RenderedWidget, { detail: 'full' }> {
  return {
    detail: 'full',
    widget: {
      widgetId: 'MW_BLANK' as WidgetId,
      configurationId: null,
      title: 'Blank Widget',
      bindings: [],
      parameters: [{
        field: 'tenor',
        type: 'Enum',
        default: '1y',
        options: [],
      }],
    },
    snippet: {
      title: 'Blank Widget',
      isTitleResolved: true,
      parameterLines: ['tenor = 1y'],
    },
    execution: { family: 'blank' },
  };
}

describe('MarketView Widget facade', () => {
  const unexpectedRender: WidgetModule['render'] = async () => {
    throw new Error('unexpected Widget render');
  };

  it('presents target-less MW Widget chrome without a data body', async () => {
    const value = blankFullValue();
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const execution = await createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value };
      },
    }, evidence).get({
      widgetId: 'MW_BLANK' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });
    let output = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, {}, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output.split('\n')[0]).toBe('title:\tBlank Widget');
    expect(output).toContain('Params\nname\tvalue\ttype\toptions\ntenor\t1y\tEnum\t\n');
    expect(output).not.toMatch(/^Data$/m);
  });

  it.each([
    [
      { chartId: 'CH_SET', description: 'About the chart', tags: ['G10'], sources: [] },
      '{"chart":"CH_SET","description":"About the chart","sources":null,"tags":["G10"]}',
    ],
    [
      { chartId: 7, description: '', tags: [], sources: ['Research', 2] },
      '{"chart":null,"description":null,"sources":["Research","2"],"tags":null}',
    ],
  ])('keeps only present Widget metadata in --json output (%j)', async (metadata, expected) => {
    const value = fullValue('MW_META', 'WC_META');
    const widget = { ...value.widget, ...metadata } as unknown as typeof value.widget;
    let output = '';

    await renderMarketviewWidgetTab({
      result: { ok: true, value: { widget: { ...value, widget }, namespace: 'w1' } },
      evidence: [{ order: 1, owner: 'widget', operation: 'get', outcome: 'succeeded', value: { calls: [] } }],
    }, { json: 'chart,description,sources,tags' }, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output).toBe(`${expected}\n`);
  });

  it('prints a --snippet read as one Widget Snippet row', async () => {
    const { widget, snippet } = blankFullValue();
    const value: RenderedWidget = {
      detail: 'snippet',
      widget,
      snippet: { ...snippet, title: 'Blank  Widget\n', parameterLines: ['tenor=1y'] },
    };
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const execution = await createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value };
      },
    }, evidence).get({
      widgetId: 'MW_BLANK' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'snippet',
    });
    let output = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, { isSnippet: true }, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output).toBe('ref\ttitle\tparams\n@w1\tBlank Widget\ttenor=1y\n');
  });

  it('defaults DataViz text to the first 30 rows', async () => {
    const value = dataVizFullValue(
      Array.from({ length: 32 }, (_, index) => ({ value: index + 1 })),
    );
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const execution = await createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value };
      },
    }, evidence).get({
      widgetId: 'MW_DATAVIZ' as WidgetId,
      configurationId: 'WC_DATAVIZ' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    let output = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, { configId: 'WC_DATAVIZ' }, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output).toContain(
      'Data (30 of 32 rows)\nValue\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n'
        + '16\n17\n18\n19\n20\n21\n22\n23\n24\n25\n26\n27\n28\n29\n30\n\n',
    );
    expect(output).toContain(
      'To get all rows as raw numbers, try: marquee marketview widget view @w1 --json data',
    );
  });

  it('prints an empty DataViz table as its title and a no-rows sentence', async () => {
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const execution = await createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value: dataVizFullValue() };
      },
    }, evidence).get({
      widgetId: 'MW_DATAVIZ' as WidgetId,
      configurationId: 'WC_DATAVIZ' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    let output = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, { configId: 'WC_DATAVIZ' }, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output).toMatch(/\n\nData\n {2}There are no rows\n$/);
  });

  it('lists a legend-only series over an empty Data table', async () => {
    const base = dataVizFullValue();
    const value: RenderedWidget = {
      ...base,
      execution: {
        family: 'data-viz',
        value: {
          kind: 'visualization',
          projection: {
            kind: 'figure',
            title: 'No visible points',
            chart: { showLegend: true },
            axes: [],
            series: [{
              id: 'series-1',
              sourceIndex: 0,
              traceType: 'scatter',
              identity: 'Hidden series',
              showLegend: true,
              visibility: 'legend-only',
              axes: {},
              style: {},
              hover: { source: 'plotly-default', hoverInfo: 'all', fields: ['x', 'y'] },
              points: [{
                index: 0,
                fields: [
                  { path: 'x', raw: 'Q1', text: 'Q1' },
                  { path: 'y', raw: 1, text: '1' },
                ],
              }],
            }],
            notes: [],
            shapes: [],
          },
        },
      },
    };
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const execution = await createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value };
      },
    }, evidence).get({
      widgetId: 'MW_DATAVIZ' as WidgetId,
      configurationId: 'WC_DATAVIZ' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    let output = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, { configId: 'WC_DATAVIZ' }, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output).toContain('Series\nseries\ttype\taxis\tcolor\tline style\nHidden series\tscatter\t\t\t\n\nData\n  There are no rows\n');
  });

  it('preserves the DataViz empty-result message without inventing rows', () => {
    const value: RenderedWidget = {
      ...dataVizFullValue(),
      execution: {
        family: 'data-viz',
        value: {
          kind: 'empty',
          message: 'No index composition for Example Basket on 2026-08-07.',
        },
      },
    };

    expect(widgetPresentationProjection({ ok: true, value })?.data).toEqual({
      rows: [],
      chart: {
        kind: 'empty',
        message: 'No index composition for Example Basket on 2026-08-07.',
      },
    });
  });

  it('scales DataViz JSON rows to text units while carrying the Web-parity projection', () => {
    const base = dataVizFullValue();
    const value: RenderedWidget = {
      ...base,
      execution: {
        family: 'data-viz',
        value: {
          kind: 'visualization',
          projection: {
            kind: 'figure',
            chart: { showLegend: false },
            axes: [],
            series: [{
              id: 'series-1',
              sourceIndex: 0,
              traceType: 'bar',
              identity: 'Exposure',
              showLegend: false,
              visibility: 'visible',
              axes: {},
              style: {},
              hover: { source: 'plotly-default', hoverInfo: 'all', fields: ['x', 'y'] },
              points: [
                { index: 0, fields: [{ path: 'x', raw: 'Long', text: 'Long' }, { path: 'y', raw: 0.41, text: '41%', format: '.0%' }] },
                { index: 1, fields: [{ path: 'x', raw: 'Short', text: 'Short' }, { path: 'y', raw: 0.1, text: '10%', format: '.0%' }] },
              ],
            }],
            notes: [],
            shapes: [],
          },
        },
      },
    };

    const projection = widgetPresentationProjection({ ok: true, value });

    expect(projection?.data?.rows).toEqual([
      { x: 'Long', y: 41 },
      { x: 'Short', y: 10 },
    ]);
  });

  it('preserves the Widget-owned title when an Asset override is present', async () => {
    const baseValue = fullValue('MW_ONE', 'WC_ONE');
    if (baseValue.detail !== 'full') throw new Error('expected full Widget fixture');
    const title = 'Resolved Widget title';
    const value: RenderedWidget = {
      ...baseValue,
      widget: {
        ...baseValue.widget,
        title,
        parameters: [{
          field: 'asset',
          type: 'Asset',
          default: 'Example Corp',
          options: [],
        }],
      },
      snippet: { ...baseValue.snippet, title },
    };
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const execution = await createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value };
      },
    }, evidence).get({
      widgetId: 'MW_ONE' as WidgetId,
      configurationId: 'WC_ONE' as ConfigId,
      parameters: [{ field: 'asset', value: 'Example Corp' }],
      detail: 'full',
    });
    let output = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, {
      configId: 'WC_ONE',
      paramOverrides: [{ field: 'asset', value: 'Example Corp' }],
    }, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError() {},
    });

    expect(output.split('\n')[0]).toBe(`title:\t${title}`);
  });

  it('attaches ordered provider evidence outside the Widget result', async () => {
    const evidence = createWidgetEvidenceRecorder({
      async request({ path }) {
        return { path };
      },
    });
    const widget: Pick<WidgetModule, 'get' | 'render'> = {
      render: unexpectedRender,
      async get() {
        await evidence.port.request(get('/v1/marketview/widgets/MW_ONE'));
        await evidence.port.request(get('/v1/charts/CH_ONE'));
        return { ok: true, value: fullValue('MW_ONE', 'WC_ONE') };
      },
    };

    const output = await createMarketViewWidget(widget, evidence).get({
      widgetId: 'MW_ONE' as WidgetId,
      configurationId: 'WC_ONE' as ConfigId,
      parameters: [],
      detail: 'full',
    });

    expect(output.result).not.toHaveProperty('audit');
    expect(output.result).not.toHaveProperty('apiCalls');
    expect(output.audit.intent).toBe('read');
    expect(output.audit.calls.map((call) => call.name)).toEqual([
      'widget.metadata',
      'chart.definition',
    ]);
  });

  it('preserves the first provider failure as MarketView evidence', async () => {
    const evidence = createWidgetEvidenceRecorder({
      async request({ path }) {
        throw new MarqueeError('http', `Marquee returned 403 for ${path}`, {
          path,
          status: 403,
          body: 'denied',
        });
      },
    });
    const widget: Pick<WidgetModule, 'get' | 'render'> = {
      render: unexpectedRender,
      async get() {
        try {
          await evidence.port.request(get('/v1/marketview/widgets/MW_PRIVATE'));
        } catch {
          return {
            ok: false,
            error: {
              kind: 'widget-load-failure',
              identity: { widgetId: 'MW_PRIVATE' },
              failure: { kind: 'unavailable' },
            },
          };
        }
        throw new Error('unreachable');
      },
    };

    const output = await createMarketViewWidget(widget, evidence).get({
      widgetId: 'MW_PRIVATE' as WidgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });

    expect(output.result.ok).toBe(false);
    expect(output.audit.failure).toEqual({
      message: 'Marquee returned 403 for /v1/marketview/widgets/MW_PRIVATE',
      path: '/v1/marketview/widgets/MW_PRIVATE',
      status: 403,
      body: 'denied',
    });
    expect(output.audit.calls).toHaveLength(1);
  });

  it('reports the semantic Widget failure when optional Dashboard evidence is aborted', async () => {
    const evidence = createWidgetEvidenceRecorder({
      request({ path }, init) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new MarqueeError('network', 'Request cancelled', {
              path,
              isCanceled: true,
            }));
          }, { once: true });
        });
      },
    });
    const widget: Pick<WidgetModule, 'get' | 'render'> = {
      render: unexpectedRender,
      async get() {
        const controller = new AbortController();
        const dashboards = evidence.port.request(get('/v1/marketview/dashboards'), {
          signal: controller.signal,
        }).catch(() => undefined);
        controller.abort();
        await dashboards;
        return {
          ok: false,
          error: {
            kind: 'plottool-failure',
            identity: { widgetId: 'MW_FAIL', configurationId: 'WC_FAIL' },
            problem: {
              kind: 'invalid-chart',
              chartId: 'CH_FAIL',
              problem: 'invalid-expressions',
            },
          },
        };
      },
    };
    const execution = await createMarketViewWidget(widget, evidence).get({
      widgetId: 'MW_FAIL' as WidgetId,
      configurationId: 'WC_FAIL' as ConfigId,
      parameters: [],
      detail: 'full',
    });
    let output = '';
    let error = '';

    await renderMarketviewWidgetTab({
      result: execution.result.ok
        ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
        : { ok: false, error: { kind: 'widget', error: execution.result.error } },
      evidence: [{
        order: 1,
        owner: 'widget',
        operation: 'get',
        outcome: execution.result.ok ? 'succeeded' : 'failed',
        value: execution.audit,
      }],
    }, {}, {
      write(text) {
        output += text;
      },
      setExitCode() {},
      writeError(text) {
        error += text;
      },
    });

    expect(output).toBe('');
    expect(error).toContain('Widget MW_FAIL render failed: invalid-chart');
    expect(output).not.toContain('Request cancelled');
  });

  it('records a genuine Dashboard failure even when its signal is also aborted', async () => {
    const evidence = createWidgetEvidenceRecorder({
      request({ path }, init) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new MarqueeError('timeout', 'Dashboard request timed out', {
              path,
            }));
          }, { once: true });
        });
      },
    });
    const controller = new AbortController();
    const { audit } = await evidence.record('read', () => {
      const dashboards = evidence.port.request(get('/v1/marketview/dashboards'), {
        signal: controller.signal,
      }).catch(() => undefined);
      controller.abort();
      return dashboards;
    });

    expect(audit.failure).toEqual({
      message: 'Dashboard request timed out',
      path: '/v1/marketview/dashboards',
    });
    expect(audit.calls[0]?.error).toBe('Dashboard request timed out');
  });

  it('expands a Widget ref from its fresh semantic result without storing payload', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'widget-ref-expansion-'));
    const baseValue = fullValue('MW_ONE', 'WC_ONE');
    if (baseValue.detail !== 'full' || baseValue.execution.family !== 'plot') {
      throw new Error('expected plot fixture');
    }
    const value: RenderedWidget = {
      ...baseValue,
      execution: {
        ...baseValue.execution,
        value: {
          ...baseValue.execution.value,
          projection: {
            ...baseValue.execution.value.projection,
            series: [{
              sourceIndex: 0,
              label: 'Carry',
              legendLabel: 'Carry',
              axisId: 'Right',
              isOrdinal: false,
              paletteSlot: 1,
              points: [
                { rawKey: '2026-07-30', value: 1 },
                { rawKey: '2026-07-31', value: 2 },
              ],
            }],
            axes: [{
              axisId: 'Right',
              dimension: 'y',
              side: 'right',
              label: '',
              labelFormat: 'none',
              dataDomains: [1, 2],
              numberRule: {
                labelFormat: 'none',
                decimals: 2,
                precision: 'auto',
                precisionDomains: [1, 2],
              },
              isHidden: false,
              isInverted: false,
              hasGridLines: true,
            }],
          },
          rows: [
            { date: '2026-07-30', Carry: 1 },
            { date: '2026-07-31', Carry: 2 },
          ],
        },
      },
    };
    const evidence = createWidgetEvidenceRecorder({
      async request() {
        throw new Error('unexpected provider request');
      },
    });
    const marketViewWidget = createMarketViewWidget({
      render: unexpectedRender,
      async get() {
        return { ok: true, value };
      },
    }, evidence);
    let output = '';

    try {
      const execution = await marketViewWidget.get({
        widgetId: 'MW_ONE' as WidgetId,
        configurationId: 'WC_ONE' as ConfigId,
        selectedContext: null,
        parameters: [],
        detail: 'full',
      });
      await renderMarketviewWidgetTab({
        result: execution.result.ok
          ? { ok: true, value: { widget: execution.result.value, namespace: 'w1' } }
          : { ok: false, error: { kind: 'widget', error: execution.result.error } },
        evidence: [{
          order: 1,
          owner: 'widget',
          operation: 'get',
          outcome: execution.result.ok ? 'succeeded' : 'failed',
          value: execution.audit,
        }],
      }, {
        configId: 'WC_ONE',
      }, {
        write(text) {
          output += text;
        },
        setExitCode() {},
        writeError() {},
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    expect(output).toContain(
      'Data\ndate\tCarry\n31 Jul 2026\t2\n30 Jul 2026\t1\n',
    );
  });
});
