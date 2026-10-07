/** Widget view text blocks (ADR 0070): fields, the Description body, the Params table, the chart tables and hints. */
import { describe, expect, it } from 'vitest';
import type { WidgetParameter } from '../../../widget/index.js';
import { presentWidgetView } from '../widget-view.js';
import type { WidgetPresentation } from '../widget-types.js';

type View = Parameters<typeof presentWidgetView>[0];

function blocks(widget: Partial<WidgetPresentation>, rest: Partial<Omit<View, 'widget'>> = {}) {
  return presentWidgetView({
    widget: { title: 'Test', widgetId: 'MW1', params: [], ...widget },
    ref: 'w1',
    hints: [],
    ...rest,
  });
}

function paramRows(...params: WidgetParameter[]) {
  const table = blocks({ params }).find((block) => block.type === 'table' && block.title === 'Params');
  return table?.type === 'table' ? table.rows : undefined;
}

function hints(widget: Partial<WidgetPresentation>, rest: Partial<Omit<View, 'widget'>> = {}) {
  const block = blocks(widget, rest).find((candidate) => candidate.type === 'hints');
  return block?.type === 'hints' ? block.hints : undefined;
}

const DATE_RULE_0B = { rdate: { rule: '0b' }, value: '2025-03-13' };

function dateParam(options: WidgetParameter['options'], overrides: Partial<WidgetParameter> = {}): WidgetParameter {
  return { field: 'pricingDate', type: 'Date', default: '0b', rawDefault: DATE_RULE_0B, options, ...overrides };
}

describe('presentWidgetView', () => {
  it('lists the Description body, an empty Params table and the Axes table', () => {
    const blocks = presentWidgetView({
      widget: {
        title: 'EURUSD carry',
        widgetId: 'MW_CARRY',
        params: [],
        description: 'Carry per tenor.\n',
      },
      ref: 'w1',
      chart: {
        axes: { headers: ['axis', 'label'], rows: [['y', 'Carry (bp)']] },
        data: { headers: ['tenor', 'carry'], rows: [['1m', '12']] },
      },
      hints: [],
    });

    expect(blocks.filter((block) => block.type === 'body' || block.type === 'table').slice(0, 3)).toEqual([
      { type: 'body', title: 'Description', text: 'Carry per tenor.' },
      { type: 'table', title: 'Params', noun: 'params', headers: ['name', 'value', 'type', 'options'], rows: [] },
      { type: 'table', title: 'Axes', noun: 'axes', headers: ['axis', 'label'], rows: [['y', 'Carry (bp)']] },
    ]);
  });

  it('previews date-ordered Data rows newest first and other tables in provider order', () => {
    const view = (data: NonNullable<Parameters<typeof presentWidgetView>[0]['chart']>['data']) => {
      const blocks = presentWidgetView({
        widget: { title: 'Holdings', widgetId: 'MW_HOLDINGS', params: [] },
        ref: 'w1',
        chart: { data },
        hints: [],
      });
      return blocks.find((block) => block.type === 'table' && block.title === 'Data');
    };
    const rows = Array.from({ length: 32 }, (_, index) => ['Net', `d${index + 1}`]);

    expect(view({ headers: ['series', 'x'], rows, dateOrdered: true })).toMatchObject({
      count: { shown: 30, total: 32 },
      rows: rows.slice(2).reverse(),
    });
    expect(view({ headers: ['date', 'value'], rows: [['2026-01-01', '1'], ['2026-02-01', '2']] }))
      .toMatchObject({ rows: [['2026-01-01', '1'], ['2026-02-01', '2']] });
  });

  it('prints every field, the Series table, the chart message and all hints in order', () => {
    expect(blocks({
      title: 'Carry',
      widgetId: 'MW_CARRY',
      configurationId: 'WC_CARRY',
      selectedContext: 'CTX1',
      authors: ['Sample, Morgan', 'Single Name'],
      access: 'Public: Anyone with this link can view this widget',
      tags: ['G10'],
      sources: ['SYNTHETIC_DAILY'],
      chartId: 'CH123',
      params: [{ field: 'tenor', type: 'String', default: '3m', options: [] }],
      dashboards: [],
    }, {
      chart: {
        series: { headers: ['series'], rows: [['Net']] },
        data: { headers: ['x'], rows: Array.from({ length: 31 }, (_, index) => [`d${index}`]) },
        message: 'Showing the latest values.',
      },
      hints: [{ action: 'refresh the date', command: 'marquee x' }],
    })).toEqual([
      { type: 'field', key: 'title', value: 'Carry' },
      { type: 'field', key: 'ref', value: '@w1' },
      {
        type: 'field',
        key: 'url',
        value: 'https://marquee.gs.com/s/marketview/widget/MW_CARRY?config=WC_CARRY&selectedContext=CTX1',
      },
      { type: 'field', key: 'author', value: { items: ['Morgan Sample', 'Single Name'], separator: '; ' } },
      { type: 'field', key: 'access', value: 'Public' },
      { type: 'field', key: 'tags', value: ['G10'] },
      { type: 'field', key: 'sources', value: ['SYNTHETIC_DAILY'] },
      { type: 'field', key: 'chart', value: 'CH123' },
      {
        type: 'table',
        title: 'Params',
        noun: 'params',
        headers: ['name', 'value', 'type', 'options'],
        rows: [['tenor', '3m', 'String', []]],
      },
      { type: 'table', title: 'Series', noun: 'series', headers: ['series'], rows: [['Net']] },
      {
        type: 'table',
        title: 'Data',
        noun: 'rows',
        count: { shown: 30, total: 31 },
        headers: ['x'],
        rows: Array.from({ length: 30 }, (_, index) => [`d${index}`]),
      },
      { type: 'sentence', text: 'Showing the latest values.' },
      {
        type: 'hints',
        hints: [
          { action: 'get all rows as raw numbers', command: 'marquee marketview widget view @w1 --json data' },
          { action: 'change a param', command: 'marquee marketview widget view @w1 -p <name>=<value>' },
          { action: 'refresh the date', command: 'marquee x' },
          { action: 'add it to a dashboard', command: 'marquee marketview dashboard edit <dashboard> --add-widget @w1' },
        ],
      },
    ]);
  });

  it('leaves optional fields empty and adds no tables, sentence or hints a bare Widget lacks', () => {
    expect(blocks({ widgetId: 'MW_BARE', params: [{ field: 'hidden', type: 'String', default: 'x', options: [], isNotParam: true }] }))
      .toEqual([
        { type: 'field', key: 'title', value: 'Test' },
        { type: 'field', key: 'ref', value: '@w1' },
        { type: 'field', key: 'url', value: 'https://marquee.gs.com/s/marketview/widget/MW_BARE' },
        { type: 'field', key: 'author', value: { items: [], separator: '; ' } },
        { type: 'field', key: 'access', value: undefined },
        { type: 'field', key: 'tags', value: [] },
        { type: 'field', key: 'sources', value: [] },
        { type: 'field', key: 'chart', value: undefined },
        { type: 'table', title: 'Params', noun: 'params', headers: ['name', 'value', 'type', 'options'], rows: [] },
        { type: 'hints', hints: [] },
      ]);
  });

  it('counts no cut and offers no raw-rows hint when every Data row fits', () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`d${index}`]);
    const view = blocks({}, { chart: { data: { headers: ['x'], rows } } });

    expect(view.find((block) => block.type === 'table' && block.title === 'Data'))
      .toEqual({ type: 'table', title: 'Data', noun: 'rows', headers: ['x'], rows });
    expect(view.find((block) => block.type === 'hints')).toEqual({ type: 'hints', hints: [] });
  });

  it('omits ?config= from the url when the configuration id is empty', () => {
    expect(blocks({ widgetId: 'MW_NOCONFIG', configurationId: '' }).find((block) => block.type === 'field' && block.key === 'url'))
      .toEqual({ type: 'field', key: 'url', value: 'https://marquee.gs.com/s/marketview/widget/MW_NOCONFIG' });
  });

  describe('Params table', () => {
    it('names each param by its ref key and lists its default, type and options', () => {
      expect(paramRows(
        { field: 'cross', type: 'Asset', default: 'EURUSD', options: [], display: ['EURUSD', 'GBPUSD'] },
        { field: 'universe', type: 'Enum', default: 'G10', options: [], display: ['G10', 'EM'] },
        { field: 'seniority', type: 'EnumList', default: 'Senior', options: [], display: ['Senior', 'Sub'] },
        { field: 'tenor', type: 'String', default: '3m', options: [], display: ['3m'] },
        { field: 'getRank', type: 'Boolean', default: true, options: [] },
        { field: 'assets', type: 'AssetList', default: ['SPX', 'NDX'], options: [], display: ['SPX', 'NDX'] },
        { field: 'precision', type: 'Integer', default: 2, options: [] },
        { field: 'Relative Date', refKey: 'relativeDate', type: 'RelativeDate', default: '1Y', options: [], display: ['1M', '1Y'] },
        { field: 'context', type: 'Context', default: 'SPX', options: [], display: ['SPX'] },
        { field: 'book', type: 'Portfolio', default: 'Main', options: [], display: ['Main'] },
        { field: 'empty', type: 'String', default: null, options: [] },
        { field: 'unset', type: 'String', default: undefined, options: [] },
      )).toEqual([
        ['cross', 'EURUSD', 'Asset', { items: ['EURUSD', 'GBPUSD'], separator: '; ' }],
        ['universe', 'G10', 'Enum', ['G10', 'EM']],
        ['seniority', 'Senior', 'EnumList', ['Senior', 'Sub']],
        ['tenor', '3m', 'String', []],
        ['getRank', 'true', 'Boolean', []],
        ['assets', 'SPX, NDX', 'AssetList', { items: ['SPX', 'NDX'], separator: '; ' }],
        ['precision', '2', 'Integer', []],
        ['relativeDate', '1Y', 'Enum', ['1M', '1Y']],
        ['context', 'SPX', 'Asset', { items: ['SPX'], separator: '; ' }],
        ['book', 'Main', 'Portfolio', ['Main']],
        ['empty', undefined, 'String', []],
        ['unset', undefined, 'String', []],
      ]);
    });

    it('shows a relative-date default by its rule and other object defaults as JSON', () => {
      expect(paramRows(
        { field: 'window', type: 'String', default: { rdate: { rule: '-1m' } }, options: [] },
        { field: 'noRule', type: 'String', default: { rdate: {} }, options: [] },
        { field: 'flatRule', type: 'String', default: { rdate: '-1m' }, options: [] },
        { field: 'tenor', type: 'String', default: { tenor: '2Y' }, options: [] },
      )).toEqual([
        ['window', '-1m', 'String', []],
        ['noRule', undefined, 'String', []],
        ['flatRule', '{"rdate":"-1m"}', 'String', []],
        ['tenor', '{"tenor":"2Y"}', 'String', []],
      ]);
    });

    it('drops blank options', () => {
      expect(paramRows({ field: 'window', type: 'Enum', default: '1M', options: [], display: ['', null, '1Y'] }))
        .toEqual([['window', '1M', 'Enum', ['1Y']]]);
    });

    it('lists no options for a param without a display list or with only blank options', () => {
      expect(paramRows(
        { field: 'universe', type: 'Enum', default: 'G10', options: [{ label: 'G10', rawValue: 'G10' }] },
        { field: 'blank', type: 'Enum', default: 'G10', options: [], display: [''], totalOptions: 5 },
        { field: 'asset', type: 'Asset', default: 'SPX', options: [], totalOptions: 8932 },
      )).toEqual([
        ['universe', 'G10', 'Enum', []],
        ['blank', 'G10', 'Enum', []],
        ['asset', 'SPX', 'Asset', { items: [], separator: '; ' }],
      ]);
    });

    it('caps options at 30 and counts the rest, including options the Widget did not send', () => {
      const display = Array.from({ length: 31 }, (_, index) => `OPT${index}`);

      expect(paramRows(
        { field: 'listed', type: 'Enum', default: 'OPT0', options: [], display },
        { field: 'paged', type: 'Enum', default: 'OPT0', options: [], display: display.slice(0, 30), totalOptions: 580 },
        { field: 'exact', type: 'Enum', default: 'OPT0', options: [], display: display.slice(0, 30), totalOptions: 2 },
      )).toEqual([
        ['listed', 'OPT0', 'Enum', [...display.slice(0, 30), '+1 more']],
        ['paged', 'OPT0', 'Enum', [...display.slice(0, 30), '+550 more']],
        ['exact', 'OPT0', 'Enum', display.slice(0, 30)],
      ]);
    });

    it('summarizes an asset list over 1500 options by its count', () => {
      expect(paramRows(
        { field: 'asset', type: 'Asset', default: 'Example Corp A', options: [], display: ['CGX Energy Inc'], totalOptions: 8932 },
        { field: 'assets', type: 'AssetList', default: 'SPX', options: [], display: ['SPX'], totalOptions: 1501 },
        { field: 'edge', type: 'Asset', default: 'SPX', options: [], display: ['SPX'], totalOptions: 1500 },
        { field: 'zones', type: 'Enum', default: 'UTC', options: [], display: ['UTC'], totalOptions: 1501 },
      )).toEqual([
        ['asset', 'Example Corp A', 'Asset', '8932 options'],
        ['assets', 'SPX', 'AssetList', '1501 options'],
        ['edge', 'SPX', 'Asset', { items: ['SPX', '+1499 more'], separator: '; ' }],
        ['zones', 'UTC', 'Enum', ['UTC', '+1500 more']],
      ]);
    });

    it('caps a multi-value default at 8 values and drops blank ones', () => {
      expect(paramRows(
        {
          field: 'assets',
          type: 'String',
          default: [...Array.from({ length: 9 }, (_, index) => `ASSET${index}`), '', null],
          options: [],
        },
        { field: 'eight', type: 'String', default: Array.from({ length: 8 }, (_, index) => `A${index}`), options: [] },
        { field: 'nested', type: 'String', default: [['X', 'Y'], { rdate: { rule: '-1b' } }], options: [] },
      )).toEqual([
        ['assets', 'ASSET0, ASSET1, ASSET2, ASSET3, ASSET4, ASSET5, ASSET6, ASSET7, +1 more', 'String', []],
        ['eight', 'A0, A1, A2, A3, A4, A5, A6, A7', 'String', []],
        ['nested', 'X, Y, -1b', 'String', []],
      ]);
    });

    it('hides an unresolved opaque id default', () => {
      expect(paramRows(
        { field: 'single_stock', type: 'String', default: `CG${'A'.repeat(13)}`, options: [] },
        { field: 'short', type: 'String', default: `CG${'A'.repeat(12)}`, options: [] },
        { field: 'prefixed', type: 'String', default: `x${'A'.repeat(15)}`, options: [] },
        { field: 'suffixed', type: 'String', default: `${'A'.repeat(15)}x`, options: [] },
      )).toEqual([
        ['single_stock', undefined, 'String', []],
        ['short', 'CGAAAAAAAAAAAA', 'String', []],
        ['prefixed', 'xAAAAAAAAAAAAAAA', 'String', []],
        ['suffixed', 'AAAAAAAAAAAAAAAx', 'String', []],
      ]);
    });
  });

  describe('Date param value', () => {
    it('shows the rule with its concrete date', () => {
      expect(paramRows(dateParam([]))).toEqual([['pricingDate', '0b [2025-03-13]', 'Date', []]]);
    });

    it('shows a numeric concrete date', () => {
      expect(paramRows(dateParam([], { rawDefault: { rdate: { rule: '0b' }, value: 20250313 } })))
        .toEqual([['pricingDate', '0b [20250313]', 'Date', []]]);
    });

    it('falls back to the rule when the default has no display', () => {
      expect(paramRows(dateParam([], { default: null }))).toEqual([['pricingDate', '0b [2025-03-13]', 'Date', []]]);
    });

    it('does not repeat a concrete date the default already shows', () => {
      expect(paramRows(
        dateParam([], { default: '2025-03-13' }),
        dateParam([], { default: 'as of 2025-03-13' }),
      )).toEqual([
        ['pricingDate', '2025-03-13', 'Date', []],
        ['pricingDate', 'as of 2025-03-13', 'Date', []],
      ]);
    });

    it('shows only the default when the raw default is not a usable relative date', () => {
      expect(paramRows(
        dateParam([], { rawDefault: '2025-03-13' }),
        dateParam([], { rawDefault: { rdate: '0b', value: '2025-03-13' } }),
        dateParam([], { rawDefault: { rdate: { rule: '' }, value: '2025-03-13' } }),
        dateParam([], { rawDefault: { rdate: { rule: 0 }, value: '2025-03-13' } }),
        dateParam([], { rawDefault: { rdate: { rule: '0b' }, value: true } }),
        dateParam([], { rawDefault: [DATE_RULE_0B] }),
        dateParam([], { rawDefault: null }),
      )).toEqual(Array.from({ length: 7 }, () => ['pricingDate', '0b', 'Date', []]));
    });

    it('shows only the default for a non-Date param with a relative raw default', () => {
      expect(paramRows(dateParam([], { type: 'String' }))).toEqual([['pricingDate', '0b', 'String', []]]);
    });

    it('resolves to the freshest later option with the same rule', () => {
      const option = (rule: string, value: unknown) => ({ label: rule, rawValue: { rdate: { rule }, value } });

      expect(paramRows(dateParam([
        'plain',
        option('0b', '2026-05-05'),
        option('0b', '2026-05-07'),
        option('0b', '2026-05-07T00:00:00Z'),
        option('0b', '2026-05-06'),
        option('-1b', '2027-01-01'),
        option('0b', '2025-03-13'),
        option('0b', 'not a date'),
        option('0b', '2025-01-01'),
      ].map((entry) => (typeof entry === 'string' ? { label: entry, rawValue: entry } : entry)))))
        .toEqual([['pricingDate', '0b [2026-05-07]', 'Date', []]]);
    });

    it('keeps the stored concrete date when no option is later', () => {
      expect(paramRows(
        dateParam([{ label: '0b', rawValue: { rdate: { rule: '0b' }, value: '2025-03-13T00:00:00Z' } }]),
        dateParam([{ label: '0b', rawValue: { rdate: { rule: '0b' }, value: '2026-05-06' } }], {
          rawDefault: { rdate: { rule: '0b' }, value: 'not a date' },
        }),
      )).toEqual([
        ['pricingDate', '0b [2025-03-13]', 'Date', []],
        ['pricingDate', '0b [not a date]', 'Date', []],
      ]);
    });
  });

  it('offers to change a param only when the Widget has one it shows', () => {
    expect(hints({ params: [{ field: 'tenor', type: 'String', default: '3m', options: [] }] }))
      .toEqual([{ action: 'change a param', command: 'marquee marketview widget view @w1 -p <name>=<value>' }]);
  });
});
