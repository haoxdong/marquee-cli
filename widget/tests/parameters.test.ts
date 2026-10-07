import { assert, describe, expect, it } from 'vitest';
import { createEntityModule } from '../../entity/index.js';
import { buildWidgetParams, type BuildWidgetParamsInput } from '../parameters.js';
import type { WidgetPayload } from '../payload.js';
import { parsePlotToolWindow } from '../plottool/window.js';
import { InvalidWidgetResponseError } from '../semantic-failure.js';

const entity = createEntityModule({
  request: async (path) => {
    throw new Error(`unexpected request ${JSON.stringify(path)}`);
  },
});

function build(input: Partial<BuildWidgetParamsInput> & { widget: WidgetPayload }) {
  return buildWidgetParams({
    entity,
    entityMap: {},
    cgMembers: {},
    chart: {},
    isDV: true,
    ...input,
  });
}

function widget(parts: WidgetPayload): WidgetPayload {
  return { parameters: [], renderParams: { component: {}, controls: [] }, ...parts };
}

function assetContext(rawDefault: string, options: string[]): WidgetPayload {
  return widget({
    contextParameter: { field: 'asset', type: 'Asset', values: { default: rawDefault }, options },
  });
}

const assets = (count: number) => Array.from({ length: count }, (_, index) => `MA${index}`);
const assetLabels = (count: number) => Object.fromEntries(
  assets(count).map((id, index) => [id, `Asset ${index}`]),
);

describe('buildWidgetParams context parameter', () => {
  it('offers the Control Groups of an Asset context as filters', () => {
    expect(build({
      widget: assetContext('MA1', ['MA1', `CG${'J'.repeat(15)}`]),
      entityMap: { MA1: 'Apple', [`CG${'J'.repeat(15)}`]: 'Tech group' },
    })).toEqual([{
      field: 'asset',
      type: 'Asset',
      values: ['Apple', 'Tech group'],
      rawValues: ['MA1', `CG${'J'.repeat(15)}`],
      options: [
        { label: 'Apple', rawValue: 'MA1' },
        { label: 'Tech group', rawValue: `CG${'J'.repeat(15)}` },
      ],
      default: 'Apple',
      rawDefault: 'MA1',
      isFilterable: true,
      cgGroupIds: [`CG${'J'.repeat(15)}`],
      display: ['Apple', 'Tech group'],
    }]);
  });

  it('offers no filters for a non-Asset context', () => {
    expect(build({
      widget: widget({
        contextParameter: { field: 'region', type: 'Enum', values: { default: 'EU' }, options: ['EU', 'US'] },
      }),
    })).toEqual([{
      field: 'region',
      type: 'Enum',
      values: ['EU', 'US'],
      rawValues: ['EU', 'US'],
      options: [{ label: 'EU', rawValue: 'EU' }, { label: 'US', rawValue: 'US' }],
      default: 'EU',
      rawDefault: 'EU',
      display: ['EU', 'US'],
    }]);
  });

  it('drops Control Groups from Portfolio context options', () => {
    expect(build({
      widget: widget({
        contextParameter: { field: 'portfolio', type: 'Portfolio', values: { default: 'MP1' }, options: ['MP1', `CG${'J'.repeat(15)}`] },
      }),
      entityMap: { MP1: 'Book', [`CG${'J'.repeat(15)}`]: 'Group' },
    })).toEqual([{
      field: 'portfolio',
      type: 'Portfolio',
      values: ['Book'],
      rawValues: ['MP1'],
      options: [{ label: 'Book', rawValue: 'MP1' }],
      default: 'Book',
      rawDefault: 'MP1',
      display: ['Book'],
    }]);
  });

  it('keeps every raw option of a large context', () => {
    const [param] = build({
      widget: assetContext('MA0', assets(31)),
      entityMap: assetLabels(31),
    });
    assert.isDefined(param);

    expect(param.rawValues).toEqual(assets(30));
    expect(param.totalOptions).toBe(31);
    expect(param.allRawOptions).toEqual(assets(31));
  });

  it('keeps no option summary when a context fits the display limit', () => {
    const [param] = build({
      widget: assetContext('MA0', assets(30)),
      entityMap: assetLabels(30),
    });
    assert.isDefined(param);

    expect(param.rawValues).toEqual(assets(30));
    expect(param).not.toHaveProperty('totalOptions');
    expect(param).not.toHaveProperty('allRawOptions');
  });

  it('fails loud on a non-string context option', () => {
    expect(() => build({
      widget: widget({ contextParameter: { field: 'asset', values: { default: 'MA1' }, options: ['MA1', 5] } }),
    })).toThrow('contextParameter.options contain a non-string value');
  });

  it('fails loud on a non-string context default', () => {
    expect(() => build({
      widget: widget({ contextParameter: { field: 'region', values: { default: 5 }, options: ['EU', 'US'] } }),
    })).toThrow('contextParameter default is not a string');
  });

  it('builds no context parameter without context options', () => {
    expect(build({
      widget: widget({ contextParameter: { field: 'asset', type: 'Asset', values: { default: 'MA1' }, options: [] } }),
    })).toEqual([]);
  });

  it('names an unnamed DataViz context "context"', () => {
    expect(build({
      widget: widget({ contextParameter: { type: 'Enum', values: { default: 'EU' }, options: ['EU', 'US'] } }),
    }).map((param) => param.field)).toEqual(['context']);
  });

  it('claims an unnamed non-DataViz context without building it', () => {
    expect(build({
      isDV: false,
      widget: widget({
        contextParameter: { type: 'Enum', values: { default: 'EU' }, options: ['EU', 'US'] },
        renderParams: { component: {}, controls: [{ controlId: 'context', value: 'EU', values: ['EU'] }] },
      }),
    })).toEqual([]);
  });

  it('builds a named non-DataViz context', () => {
    expect(build({
      isDV: false,
      widget: widget({
        contextParameter: { field: 'region', type: 'Enum', values: { default: 'EU' }, options: ['EU', 'US'] },
      }),
    }).map((param) => param.field)).toEqual(['region']);
  });
});

describe('buildWidgetParams controls and parameters', () => {
  it('builds each control field once, after the context that claims it', () => {
    expect(build({
      widget: widget({
        contextParameter: { field: 'asset', type: 'Asset', values: { default: 'MA1' }, options: ['MA1'] },
        renderParams: {
          component: {},
          controls: [
            { controlId: 'asset', value: 'MA1', values: ['MA2'] },
            { controlId: 'freq', value: 'D', values: ['D', 'W'] },
            { controlId: 'freq', value: 'W', values: ['W'] },
            { controlId: 'side', value: 'Buy', values: ['Buy'] },
          ],
        },
      }),
      entityMap: { MA1: 'Apple' },
    })).toEqual([
      expect.objectContaining({ field: 'asset', rawDefault: 'MA1' }),
      {
        field: 'freq',
        type: 'Enum',
        values: ['D', 'W'],
        rawValues: ['D', 'W'],
        options: [{ label: 'D', rawValue: 'D' }, { label: 'W', rawValue: 'W' }],
        default: 'D',
        rawDefault: 'D',
        display: ['D', 'W'],
      },
      expect.objectContaining({ field: 'side', rawDefault: 'Buy' }),
    ]);
  });

  it('reads a control without options from the Chart control with the same field', () => {
    expect(build({
      widget: widget({ renderParams: { component: {}, controls: [{ controlId: 'freq', value: 'D' }] } }),
      chart: {
        controls: [
          { field: 'side', values: ['Buy', 'Sell'] },
          { field: 'freq', values: ['D', 'W'] },
        ],
      },
    })).toEqual([expect.objectContaining({ field: 'freq', rawValues: ['D', 'W'] })]);
  });

  it('builds each parameter field once, after the control that claims it', () => {
    expect(build({
      widget: widget({
        renderParams: { component: {}, controls: [{ controlId: 'freq', value: 'D', values: ['D'] }] },
        parameters: [
          { field: 'freq', values: { default: 'W' }, options: ['W'] },
          { field: 'tenor', values: { default: '1y' }, options: ['1y', '2y'] },
          { field: 'tenor', values: { default: '2y' }, options: ['2y'] },
          { field: 'side', values: { default: 'Buy' }, options: ['Buy'] },
        ],
      }),
    })).toEqual([
      expect.objectContaining({ field: 'freq', rawDefault: 'D' }),
      {
        field: 'tenor',
        type: 'Enum',
        values: ['1y', '2y'],
        rawValues: ['1y', '2y'],
        options: [{ label: '1y', rawValue: '1y' }, { label: '2y', rawValue: '2y' }],
        default: '1y',
        rawDefault: '1y',
        display: ['1y', '2y'],
      },
      expect.objectContaining({ field: 'side', rawDefault: 'Buy' }),
    ]);
  });

  it.each([{}, { controlId: '' }])('fails loud on a control without a field: %j', (control) => {
    expect(() => build({
      widget: widget({ renderParams: { component: {}, controls: [{ ...control, value: 'D', values: ['D'] }] } }),
    })).toThrow('control field is missing');
  });

  it.each([{}, { field: '' }, { field: 5 }])('fails loud on a parameter without a string field: %j', (param) => {
    expect(() => build({
      widget: widget({ parameters: [{ ...param, values: { default: 'W' }, options: ['W'] }] }),
    })).toThrow('parameter field is missing or not a string');
  });

  describe('a numbered asset parameter beside chart controls', () => {
    const withControls = (field: string, isDV = false, controls = [{ controlId: 'freq', value: 'D', values: ['D'] }]) => build({
      isDV,
      widget: widget({
        renderParams: { component: {}, controls },
        parameters: [{ field, values: { default: 'MA1' }, options: ['MA1'] }],
      }),
    }).map((param) => param.field);

    it.each(['asset1', 'Asset12'])('fails loud on %s', (field) => {
      expect(() => withControls(field))
        .toThrow('CH asset# parameter requires suppression');
    });

    it.each(['asset1x', 'xasset1', 'region'])('accepts %s', (field) => {
      expect(withControls(field)).toEqual(['freq', field]);
    });

    it('accepts it in a DataViz Widget', () => {
      expect(withControls('asset1', true)).toEqual(['freq', 'asset1']);
    });

    it('accepts it without chart controls', () => {
      expect(withControls('asset1', false, [])).toEqual(['asset1']);
    });
  });
});

function shapeFailure(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error instanceof InvalidWidgetResponseError ? error.error : error;
  }
  return undefined;
}

describe('buildWidgetParams unsupported response shapes', () => {
  const dateParameter = (options: unknown[]) => widget({
    parameters: [{ field: 'asOf', type: 'Date', values: { default: '2026-01-01' }, options }],
  });

  it.each([
    ['a non-record renderParams', widget({ renderParams: 5 as never }), 'renderParams.controls parent is not a record'],
    ['a non-record parameter', widget({ parameters: [5 as never] }), 'parameters contains a non-record'],
    ['a control enums fallback', widget({ renderParams: { component: {}, controls: [{ controlId: 'side', value: 'Buy', enums: ['Buy'] }] } }), 'control uses enums fallback'],
    ['a control allowedValues fallback', widget({ renderParams: { component: {}, controls: [{ controlId: 'side', value: 'Buy', allowedValues: ['Buy'] }] } }), 'control uses allowedValues fallback'],
    ['a null control default', widget({ renderParams: { component: {}, controls: [{ controlId: 'side', value: null, values: ['Buy'] }] } }), 'render control default is null'],
    ['a parameter enums fallback', widget({ parameters: [{ field: 'side', values: { default: 'Buy' }, enums: ['Buy'] }] }), 'parameter uses enums fallback'],
    ['a parameter allowedValues fallback', widget({ parameters: [{ field: 'side', values: { default: 'Buy' }, allowedValues: ['Buy'] }] }), 'parameter uses allowedValues fallback'],
    ['a parameter value fallback', widget({ parameters: [{ field: 'side', values: { default: 'Buy' }, value: 'Buy' }] }), 'parameter uses value fallback'],
    ['a parameter defaultValue fallback', widget({ parameters: [{ field: 'side', values: { default: 'Buy' }, defaultValue: 'Buy' }] }), 'parameter uses defaultValue fallback'],
    ['non-record parameter values', widget({ parameters: [{ field: 'side', values: 'Buy' }] }), 'parameter.values is not a record'],
    ['a wrapped Date option', dateParameter([{ rawValue: '2026-01-01' }]), 'Date option uses a rawValue wrapper'],
    ['duplicate Date options', dateParameter(['2026-01-01', '2026-01-01']), 'Date options contain a duplicate value'],
    ['an Enum asset context', widget({ contextParameter: { field: 'asset', type: 'Enum', values: { default: 'MA1' }, options: ['MA1'] } }), 'context parameter type requires repair'],
  ])('fails invalid-response on %s', (_name, payload, detail) => {
    expect(shapeFailure(() => build({ widget: payload }))).toEqual({
      source: 'widget',
      problem: 'unsupported-payload-shape',
      detail,
    });
  });

  it('accepts distinct unwrapped Date options', () => {
    expect(build({ widget: dateParameter(['2026-01-01', '2026-01-02']) })).toEqual([
      expect.objectContaining({ field: 'asOf', rawValues: ['2026-01-01', '2026-01-02'] }),
    ]);
  });
});

describe('buildWidgetParams relative date', () => {
  it('offers the chart relative start date on a non-DataViz Widget', () => {
    // Web lists its seven choices on a 10Y Chart, not 10Y itself.
    const options = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y'];

    expect(build({ isDV: false, widget: widget({}), chart: chartWindow({ relativeStartDate: '-10y' }) })).toEqual([{
      field: 'Relative Date',
      type: 'Enum',
      values: [],
      rawValues: [],
      options: options.map((option) => ({ label: option, rawValue: option })),
      display: options,
      default: '10Y',
      rawDefault: '-10y',
    }]);
  });

  it('falls back to the chart start date', () => {
    expect(build({ isDV: false, widget: widget({}), chart: chartWindow({ startDate: '2020-01-01' }) })).toEqual([
      expect.objectContaining({
        field: 'Relative Date',
        display: ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y'],
        default: undefined,
        rawDefault: '2020-01-01',
      }),
    ]);
  });

  it('offers none on a DataViz Widget, a chart without a window, or one Web hides it on', () => {
    expect(build({ widget: widget({}), chart: chartWindow({ relativeStartDate: '-5y' }) })).toEqual([]);
    expect(build({ isDV: false, widget: widget({}) })).toEqual([]);
    expect(build({
      isDV: false,
      widget: widget({}),
      chart: chartWindow({ relativeStartDate: '-1m', relativeEndDate: '+5y' }),
    })).toEqual([]);
  });
});

function chartWindow(fields: Parameters<typeof parsePlotToolWindow>[0]): BuildWidgetParamsInput['chart'] {
  const window = parsePlotToolWindow(fields);
  if (!window.ok) throw new Error(window.reason);
  return { window: window.value };
}
