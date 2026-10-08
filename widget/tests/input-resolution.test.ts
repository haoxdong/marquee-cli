import { beforeEach, describe, it, expect } from 'vitest';
import {
  entityIdentityKind,
  identityKind,
  resolveWidgetInput,
  widgetInputDomain,
  ParamResolutionError,
  type WidgetControlGroupModule,
  type WidgetEntityModule,
  type WidgetInputContext,
} from '../input-resolution.js';
import { WidgetSemanticFailure } from '../semantic-failure.js';
import { unwrapSliderValue } from '../slider.js';
import type { Asset, EntityMatch } from '../../entity/index.js';
import { createEntityModule } from '../../entity/index.js';

const MSFT = `MA${'L'.repeat(15)}`;
const MSF = `MA${'N'.repeat(15)}`;
const EXAMPLE_UW = `MA${'Q'.repeat(15)}`;
const EXAMPLE_UN = `MA${'P'.repeat(15)}`;
const EQUITIES = `CG${'K'.repeat(15)}`;
const CURRENCIES = `CG${'J'.repeat(15)}`;
const SAMPLE_PORTFOLIO = `MP${'T'.repeat(15)}`;

const unexpected = async (): Promise<never> => {
  throw new Error('unexpected lookup');
};

function entityModule(overrides: Partial<WidgetEntityModule> = {}): WidgetEntityModule {
  return { resolve: unexpected, resolveIdentity: unexpected, resolveMatches: unexpected, ...overrides };
}

function controlGroupModule(
  members: readonly Asset[],
  calls: unknown[] = [],
): WidgetControlGroupModule {
  return {
    async match(...input) {
      calls.push(input);
      return { ok: true, value: members };
    },
    async expand([controlGroupId = '']) {
      return { ok: true, value: [{ controlGroupId, members }] };
    },
  };
}

function asset(entityId: string, label: string, aliases: string[] = []): Asset {
  return { kind: 'asset', entityId, label, aliases };
}

function context(overrides: Partial<WidgetInputContext> = {}): WidgetInputContext {
  return {
    widgetId: `MW${'U'.repeat(15)}`,
    field: 'example',
    entity: entityModule(),
    controlGroup: { match: unexpected, expand: unexpected },
    ...overrides,
  };
}

const noLabels = new Map<string, string>();

async function resolve(
  type: string,
  options: readonly unknown[],
  requested: string,
  overrides: Partial<WidgetInputContext> = {},
) {
  return resolveWidgetInput(widgetInputDomain(type, options, noLabels), requested, context(overrides));
}

describe('identityKind', () => {
  it.each([
    [MSFT, 'asset'],
    [SAMPLE_PORTFOLIO, 'portfolio'],
    [EQUITIES, 'control-group'],
  ])('classifies %s as %s', (value, kind) => {
    expect(identityKind(value)).toBe(kind);
  });

  it.each(['MA123', 'MA_AAPL', `${MSFT} US`, `x${MSFT}`, MSFT.toLowerCase(), `MW${'U'.repeat(15)}`, 'AAPL', 42, undefined])(
    'does not classify %s as an identity',
    (value) => {
      expect(identityKind(value)).toBeUndefined();
    },
  );
});

describe('entityIdentityKind', () => {
  it.each([
    [MSFT, 'asset'],
    [SAMPLE_PORTFOLIO, 'portfolio'],
    [EQUITIES, undefined],
    ['AAPL', undefined],
  ])('classifies %s as %s', (value, kind) => {
    expect(entityIdentityKind(value)).toBe(kind);
  });
});

describe('widgetInputDomain', () => {
  it('splits entity options into Asset ids and Control Group ids', () => {
    expect(widgetInputDomain('AssetList', [MSFT, EQUITIES, 'USDJPY'], new Map([[MSFT, 'Microsoft Corp']])))
      .toEqual({
        kind: 'entity',
        list: true,
        options: [
          { label: MSFT, value: MSFT },
          { label: EQUITIES, value: EQUITIES },
          { label: 'USDJPY', value: 'USDJPY' },
          { label: 'Microsoft Corp', value: MSFT },
        ],
        assetIds: [MSFT],
        controlGroupIds: [EQUITIES],
      });
  });

  it('takes Portfolio ids verbatim and offers labeled options', () => {
    expect(widgetInputDomain('Portfolio', [SAMPLE_PORTFOLIO], new Map([[SAMPLE_PORTFOLIO, 'Sample Portfolio']])))
      .toEqual({
        kind: 'options',
        list: false,
        identity: 'portfolio',
        options: [
          { label: SAMPLE_PORTFOLIO, value: SAMPLE_PORTFOLIO },
          { label: 'Sample Portfolio', value: SAMPLE_PORTFOLIO },
        ],
        controlGroupIds: [],
      });
  });

  it('offers Enum options by value without a verbatim identity kind', () => {
    expect(widgetInputDomain('Enum', ['Daily', CURRENCIES], noLabels)).toEqual({
      kind: 'options',
      list: false,
      options: [
        { label: 'Daily', value: 'Daily' },
        { label: CURRENCIES, value: CURRENCIES },
      ],
      controlGroupIds: [CURRENCIES],
    });
  });

  it('unwraps slider option values', () => {
    const slider = { marks: { 0: '0' }, step: 6, value: { type: 'Number', value: 12 } };
    expect(widgetInputDomain('Enum', [slider], noLabels)).toMatchObject({
      options: [{ label: '[object Object]', value: 12 }],
    });
  });

  it('classifies Country and scalar inputs', () => {
    expect(widgetInputDomain('Country', ['US'], noLabels)).toEqual({
      kind: 'country',
      options: [{ label: 'US', value: 'US' }],
    });
    expect(widgetInputDomain('Date', [], noLabels)).toEqual({ kind: 'scalar', type: 'Date' });
  });
});

describe('resolveWidgetInput', () => {
  it('short-circuits a case-insensitive exact option without an echo', async () => {
    expect(await resolve('Enum', ['1M', '5Y'], '5y')).toEqual({ ok: true, value: '5Y', label: '5Y' });
  });

  it('keeps a single EnumList selection list-shaped', async () => {
    expect(await resolve('EnumList', ['rolling return', 'rolling volatility'], 'rolling volatility')).toEqual({
      ok: true,
      value: ['rolling volatility'],
      label: 'rolling volatility',
      displayValue: ['rolling volatility'],
    });
  });

  it('echoes EnumList items matched by prefix', async () => {
    expect(await resolve('EnumList', ['1M', '5Y'], '1M, 5', { field: 'tenors' })).toEqual({
      ok: true,
      value: ['1M', '5Y'],
      label: '1M, 5Y',
      displayValue: ['1M', '5Y'],
      echo: 'tenors = 1M, 5Y (matched "1M, 5")',
    });
  });

  it('skips empty EnumList items', async () => {
    expect(await resolve('EnumList', ['Daily', 'Weekly'], 'Daily,,Weekly')).toMatchObject({
      ok: true,
      value: ['Daily', 'Weekly'],
    });
  });

  it('does not rejoin option list items around the separator', async () => {
    expect(await resolve('EnumList', ['Daily, Weekly', 'Monthly'], 'Daily, Weekly')).toEqual({
      ok: false,
      error: { kind: 'unknown', requested: 'Weekly', candidates: ['Daily, Weekly', 'Monthly'] },
    });
  });

  it('takes an exact literal option before its Control Group members', async () => {
    expect(await resolve('Enum', ['Custom', CURRENCIES], ' custom ')).toEqual({
      ok: true,
      value: 'Custom',
      label: 'Custom',
    });
  });

  it('resolves a unique prefix and returns the visibility echo', async () => {
    expect(await resolve('Enum', ['1M', '1Y', '5Y'], '5', { field: 'relativeDate' })).toEqual({
      ok: true,
      value: '5Y',
      label: '5Y',
      echo: 'relativeDate = 5Y (matched "5")',
    });
  });

  it('fails loud with candidates for an ambiguous prefix', async () => {
    expect(await resolve('Enum', ['1M', '1Y', '5Y'], '1')).toEqual({
      ok: false,
      error: { kind: 'ambiguous', requested: '1', candidates: ['1M', '1Y'] },
    });
  });

  it('caps ambiguous candidates and reports the omitted count', async () => {
    const options = Array.from({ length: 12 }, (_, index) => `All ${index + 1}`);
    expect(await resolve('Enum', options, 'A')).toEqual({
      ok: false,
      error: {
        kind: 'ambiguous',
        requested: 'A',
        candidates: [...options.slice(0, 10), '…and 2 more — narrow the value'],
      },
    });
  });

  it('fails loud when no option matches', async () => {
    expect(await resolve('Enum', ['1M', '1Y', '5Y'], '10')).toEqual({
      ok: false,
      error: { kind: 'unknown', requested: '10', candidates: ['1M', '1Y', '5Y'] },
    });
  });

  it('accepts only literal Boolean values', async () => {
    expect(await resolve('Boolean', [], 'FALSE')).toEqual({ ok: true, value: false, label: 'false' });
    expect(await resolve('Boolean', [], 'TRUE')).toEqual({ ok: true, value: true, label: 'true' });
    for (const value of ['yes', 'xtrue', 'truex']) {
      // eslint-disable-next-line no-await-in-loop -- test cases run one at a time
      expect(await resolve('Boolean', [], value)).toEqual({
        ok: false,
        error: { kind: 'invalid', problem: 'boolean-required' },
      });
    }
  });

  it('accepts only integer spellings', async () => {
    expect(await resolve('Integer', [], '-02')).toEqual({ ok: true, value: -2, label: '-2' });
    for (const value of ['1.5', '1e2', 'abc']) {
      // eslint-disable-next-line no-await-in-loop -- test cases run one at a time
      expect(await resolve('Integer', [], value)).toEqual({
        ok: false,
        error: { kind: 'invalid', problem: 'integer-required' },
      });
    }
  });

  it.each([
    ['9007199254740991', 9007199254740991],
    ['-9007199254740991', -9007199254740991],
  ])('accepts safe Integer boundary %s', async (requested, value) => {
    expect(await resolve('Integer', [], requested)).toEqual({ ok: true, value, label: requested });
  });

  it.each([
    '9007199254740992',
    '9007199254740993',
    '-9007199254740992',
    '-9007199254740993',
    '+9007199254740993',
    '09007199254740993',
    '99999999999999999999',
    '9'.repeat(400),
  ])('rejects unsafe Integer %s without changing its spelling', async (requested) => {
    expect(await resolve('Integer', [], requested)).toEqual({
      ok: false,
      error: { kind: 'unsafe-integer', requested },
    });
  });

  it.each(['2026-02-28', '0b', '-1b', '-10b', '+2d', '1Y', '-1bd', '-4y+A'])('accepts valid Date value %s', async (requested) => {
    expect(await resolve('Date', [], requested)).toEqual({ ok: true, value: requested, label: requested });
  });

  it.each(['not-a-date', 'x-1b', '-1bx', '2026-02-30', '2026-13-01', '2026-2-3'])('rejects invalid Date value %s', async (requested) => {
    expect(await resolve('Date', [], requested)).toEqual({
      ok: false,
      error: { kind: 'invalid', problem: 'date-required' },
    });
  });

  it('passes free text through, including an empty String', async () => {
    expect(await resolve('String', [], 'rolling volatility')).toEqual({
      ok: true,
      value: 'rolling volatility',
      label: 'rolling volatility',
    });
    expect(await resolve('String', [], '')).toEqual({ ok: true, value: '', label: '' });
  });

  describe('Slider marks', () => {
    // A captured Marquee slider, and the slider Marquee Web sends once mark 5 is chosen.
    const mark = (value: number) => ({ type: 'Number', value });
    const slider = {
      defaultValue: mark(10),
      marks: { 0: mark(1), 20: mark(2), 40: mark(5), 60: mark(10), 80: mark(15), 100: mark(30) },
      value: mark(10),
      step: 20,
    };

    it('sends the slider with the chosen mark as its value and default', async () => {
      expect(await resolve('Slider', [slider], ' 5 ')).toEqual({
        ok: true,
        value: { ...slider, defaultValue: mark(5), value: mark(5) },
        label: '5',
      });
    });

    it('writes the chosen slider in the key order Marquee Web sends', async () => {
      const resolution = await resolve('Slider', [slider], '5');
      expect(resolution.ok && JSON.stringify(resolution.value)).toBe(
        '{"defaultValue":{"type":"Number","value":5},"marks":{"0":{"type":"Number","value":1},"20":{"type":"Number","value":2},"40":{"type":"Number","value":5},"60":{"type":"Number","value":10},"80":{"type":"Number","value":15},"100":{"type":"Number","value":30}},"step":20,"value":{"type":"Number","value":5}}',
      );
    });

    it('fails loud with the marks for a value off the slider', async () => {
      expect(await resolve('Slider', [slider], '7')).toEqual({
        ok: false,
        error: { kind: 'unknown', requested: '7', candidates: ['1', '2', '5', '10', '15', '30'] },
      });
    });
  });

  it.each(['Enum', 'Boolean', 'Integer', 'Date', 'Asset', 'Country'])('keeps an empty %s value invalid', async (type) => {
    expect(await resolve(type, ['value'], '')).toEqual({
      ok: false,
      error: { kind: 'invalid', problem: 'empty' },
    });
  });

  it('applies an advertised Country code or label without a lookup', async () => {
    const domain = widgetInputDomain('Country', ['US', 'DE'], new Map([['US', 'United States']]));
    expect(await resolveWidgetInput(domain, ' United States ', context())).toEqual({
      ok: true,
      value: 'US',
      label: 'United States',
    });
    expect(await resolveWidgetInput(domain, 'de', context())).toEqual({ ok: true, value: 'DE', label: 'DE' });
  });

  describe('Country names', () => {
    const domain = widgetInputDomain('Country', ['US', 'DE', 'GB'], new Map([['US', 'United States']]));
    const names: Record<string, string> = { US: 'United States', DE: 'Germany', GB: 'United Kingdom' };
    const calls: unknown[] = [];
    const countries = context({
      entity: entityModule({
        async resolve(inputs) {
          calls.push(inputs);
          return {
            ok: true,
            value: inputs.map(({ value }) => ({ kind: 'country' as const, entityId: value, label: names[value] ?? value, aliases: [] })),
          };
        },
      }),
    });
    beforeEach(() => {
      calls.length = 0;
    });

    it('resolves a name to its advertised code from the option entities', async () => {
      expect(await resolveWidgetInput(domain, 'Germany', countries)).toEqual({ ok: true, value: 'DE', label: 'Germany' });
      expect(calls).toEqual([[
        { kind: 'country', value: 'US' },
        { kind: 'country', value: 'DE' },
        { kind: 'country', value: 'GB' },
      ]]);
    });

    it('applies a unique name prefix with an echo', async () => {
      expect(await resolveWidgetInput(domain, 'germ', countries)).toEqual({
        ok: true,
        value: 'DE',
        label: 'Germany',
        echo: 'example = Germany (matched "germ")',
      });
    });

    it('lists the candidates for an ambiguous or unknown value', async () => {
      expect(await resolveWidgetInput(domain, 'United', countries)).toEqual({
        ok: false,
        error: { kind: 'ambiguous', requested: 'United', candidates: ['United States', 'United Kingdom'] },
      });
      expect(await resolveWidgetInput(domain, 'ZZ', countries)).toEqual({
        ok: false,
        error: { kind: 'unknown', requested: 'ZZ', candidates: ['United States', 'Germany', 'United Kingdom'] },
      });
    });

    it('resolves a code or name against the members of an advertised Control Group', async () => {
      const grouped = widgetInputDomain('Country', [EQUITIES], noLabels);
      const brazil = asset('BR', 'Brazil');
      // The group lists a country twice, as a Country and an Enum row, so the duplicate must not read as ambiguous.
      const members = context({ controlGroup: controlGroupModule([asset('IL', 'Israel'), asset('IS', 'Iceland'), brazil, brazil]) });
      expect(await resolveWidgetInput(grouped, 'is', members)).toEqual({ ok: true, value: 'IS', label: 'Iceland' });
      expect(await resolveWidgetInput(grouped, 'Brazil', members)).toEqual({ ok: true, value: 'BR', label: 'Brazil' });
    });

    it('matches an exact Country code against the recorded Germany member identity', async () => {
      // The recorded Country and Enum Germany rows both decode to DE, Germany, and no aliases.
      const germany = asset('DE', 'Germany');
      const result = await resolve('Country', [EQUITIES], 'DE', {
        controlGroup: controlGroupModule([germany, germany]),
      });
      expect(result).toEqual({ ok: true, value: 'DE', label: 'Germany' });
    });

    it.each(['BR', 'br'])('applies the recorded Brazil code %s exactly without prefix echo', async (requested) => {
      const brazil = asset('BR', 'Brazil');
      expect(await resolve('Country', [EQUITIES], requested, {
        controlGroup: controlGroupModule([brazil, brazil]),
      })).toEqual({ ok: true, value: 'BR', label: 'Brazil' });
    });

    it.each([
      ['Germany', { ok: true, value: 'DE', label: 'Germany' }],
      ['germ', { ok: true, value: 'DE', label: 'Germany', echo: 'example = Germany (matched "germ")' }],
      ['D', { ok: false, error: { kind: 'unknown', requested: 'D', candidates: ['Germany'] } }],
      ['ZZ', { ok: false, error: { kind: 'unknown', requested: 'ZZ', candidates: ['Germany'] } }],
    ])('retains name matching and rejects nonmember or partial codes: %s', async (requested, expected) => {
      const germany = asset('DE', 'Germany');
      expect(await resolve('Country', [EQUITIES], requested, {
        controlGroup: controlGroupModule([germany, germany]),
      })).toEqual(expected);
    });

    it('retains ambiguity between distinct recorded group countries', async () => {
      // These member identities and names are present in the captured limit=100 group response.
      const members = [asset('AE', 'United Arab Emirates'), asset('GB', 'United Kingdom'), asset('US', 'United States of America')];
      expect(await resolve('Country', [EQUITIES], 'United', { controlGroup: controlGroupModule(members) })).toEqual({
        ok: false,
        error: { kind: 'ambiguous', requested: 'United', candidates: ['United Arab Emirates', 'United Kingdom', 'United States of America'] },
      });
    });

    it('fails loud when the option names cannot be resolved', async () => {
      const failing = context({
        entity: entityModule({ resolve: async () => ({ ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } }) }),
      });
      await expect(resolveWidgetInput(domain, 'Germany', failing)).rejects.toThrow(ParamResolutionError);
    });
  });

  it('takes an Asset id verbatim without a lookup', async () => {
    expect(await resolve('Asset', [EQUITIES], MSFT)).toEqual({ ok: true, value: MSFT, label: MSFT });
  });

  it('takes a Portfolio id verbatim and maps a Portfolio label to its id', async () => {
    const domain = widgetInputDomain('Portfolio', [SAMPLE_PORTFOLIO], new Map([[SAMPLE_PORTFOLIO, 'Sample Portfolio']]));
    const other = `MP${'R'.repeat(15)}`;
    expect(await resolveWidgetInput(domain, other, context())).toEqual({ ok: true, value: other, label: other });
    expect(await resolveWidgetInput(domain, 'sample portfolio', context())).toEqual({
      ok: true,
      value: SAMPLE_PORTFOLIO,
      label: 'Sample Portfolio',
    });
  });

  it('matches group-backed Asset prefixes against trimmed Control Group members', async () => {
    const calls: unknown[] = [];
    const result = await resolve('Asset', [EQUITIES, MSFT], '  MSFT  ', {
      field: 'asset',
      controlGroup: controlGroupModule([
        asset(MSFT, 'Microsoft Corp', ['MSFT US']),
        asset(MSF, 'Microsoft Corp', ['MSF LN']),
      ], calls),
    });

    expect(result).toEqual({
      ok: true,
      value: MSFT,
      label: 'Microsoft Corp',
      echo: 'asset = Microsoft Corp (matched "  MSFT  ")',
    });
    expect(calls).toEqual([[[EQUITIES], 'MSFT', 30]]);
  });

  it('points ambiguous same-label Control Group members at a distinguishing alias', async () => {
    const result = await resolve('Asset', [EQUITIES], 'Micro', {
      controlGroup: controlGroupModule([
        asset(MSFT, 'Microsoft Corp', ['MSFT US']),
        asset(MSF, 'Microsoft Corp', []),
      ]),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'ambiguous',
        requested: 'Micro',
        candidates: ['Microsoft Corp — use "MSFT US"', `Microsoft Corp — use "${MSF}"`],
      },
    });
  });

  it('reports every member whose label matches exactly as ambiguous', async () => {
    const result = await resolve('Asset', [EQUITIES], 'microsoft corp', {
      controlGroup: controlGroupModule([
        asset(MSFT, 'Microsoft Corp', ['MSFT US']),
        asset(MSF, 'Microsoft Corp', ['MSF LN']),
        asset(EXAMPLE_UW, 'Microsoft Corp Holdings', []),
      ]),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'ambiguous',
        requested: 'microsoft corp',
        candidates: ['Microsoft Corp — use "MSFT US"', 'Microsoft Corp — use "MSF LN"'],
      },
    });
  });

  it('resolves an Enum value against its Control Group members', async () => {
    const calls: unknown[] = [];
    const result = await resolve('Enum', [CURRENCIES], 'TRY', {
      controlGroup: controlGroupModule([asset('TRY', 'TRY')], calls),
    });

    expect(result).toEqual({ ok: true, value: 'TRY', label: 'TRY' });
    expect(calls).toEqual([[[CURRENCIES], 'TRY', 30]]);
  });

  it.each([
    ['Asset', 'MSFT', 'match'],
    ['Country', 'DE', 'expand'],
  ] as const)('carries a Control Group failure to Widget as a semantic failure (%s)', async (type, requested, operation) => {
    const failure = { kind: 'malformed-member', controlGroupIds: [EQUITIES], problem: 'incomplete-expansion' } as const;
    const failing = async () => ({ ok: false as const, error: failure });
    const resolution = resolve(type, [EQUITIES], requested, {
      controlGroup: operation === 'match' ? { match: failing, expand: unexpected } : { match: unexpected, expand: failing },
    });

    await expect(resolution).rejects.toBeInstanceOf(WidgetSemanticFailure);
    await expect(resolution).rejects.toMatchObject({
      error: {
        kind: 'control-group-resolution-failure',
        identity: { widgetId: `MW${'U'.repeat(15)}` },
        failure,
      },
    });
  });

  it('matches raw Asset options remotely by label or ticker alias', async () => {
    const matches: EntityMatch[] = [
      { entityId: EXAMPLE_UW, display: 'Example Corp A', aliases: ['EXMPL', 'EXMPL UW'] },
    ];
    const entity = entityModule({
      async resolveMatches() {
        return { ok: true, value: matches };
      },
    });

    expect(await resolve('Asset', [EXAMPLE_UW], ' exmpl ', { entity })).toEqual({
      ok: true,
      value: EXAMPLE_UW,
      label: 'Example Corp A',
    });
  });

  it('resolves a unique alias and rejects a shared alias for duplicate Asset labels', async () => {
    const entity = createEntityModule({
      async request() {
        return { assets: [
          { id: EXAMPLE_UW, name: 'Example Corp', bbid: 'EXMPL UW', ticker: 'EXMPL' },
          { id: EXAMPLE_UN, name: 'Example Corp', bbid: 'EXMPL UN', ticker: 'EXMPL' },
        ] };
      },
    });

    expect(await resolve('Asset', [EXAMPLE_UW, EXAMPLE_UN], 'EXMPL UW', { entity })).toEqual({
      ok: true,
      value: EXAMPLE_UW,
      label: 'Example Corp (EXMPL UW)',
    });
    expect(await resolve('Asset', [EXAMPLE_UW, EXAMPLE_UN], 'EXMPL', { entity })).toEqual({
      ok: false,
      error: {
        kind: 'ambiguous',
        requested: 'EXMPL',
        candidates: ['Example Corp (EXMPL UW)', 'Example Corp (EXMPL UN)'],
      },
    });
  });

  it('rejects an exact Asset alias shared by several options', async () => {
    const entity = entityModule({
      async resolveMatches() {
        return {
          ok: true,
          value: [
            { entityId: EXAMPLE_UW, display: 'Example Corp (EXMPL UW)', aliases: ['EXMPL'] },
            { entityId: EXAMPLE_UN, display: 'Example Corp (EXMPL UN)', aliases: ['EXMPL'] },
          ],
        };
      },
    });

    expect(await resolve('Asset', [EXAMPLE_UW, EXAMPLE_UN], 'EXMPL', { entity })).toEqual({
      ok: false,
      error: {
        kind: 'ambiguous',
        requested: 'EXMPL',
        candidates: ['Example Corp (EXMPL UW)', 'Example Corp (EXMPL UN)'],
      },
    });
  });

  it('falls back to the generic Asset resolver without option ids', async () => {
    const calls: unknown[] = [];
    const entity = entityModule({
      async resolveIdentity(identifier) {
        calls.push(identifier);
        return { ok: true, value: asset(MSFT, 'Microsoft Corp', ['MSFT']) };
      },
    });

    expect(await resolve('Asset', ['USDJPY'], ' msft ', { entity })).toEqual({
      ok: true,
      value: MSFT,
      label: 'Microsoft Corp',
    });
    expect(calls).toEqual([{ kind: 'asset', value: 'msft' }]);
  });

  it('reports an Asset the generic resolver does not know', async () => {
    const entity = entityModule({ resolveIdentity: async () => ({ ok: true, value: null }) });
    expect(await resolve('Asset', [], 'NOPE', { entity })).toEqual({
      ok: false,
      error: { kind: 'unknown', requested: 'NOPE', candidates: [] },
    });
  });

  it('fails loud on an Entity lookup failure', async () => {
    const entity = entityModule({
      resolveIdentity: async () => ({ ok: false, error: { kind: 'dependency', failure: { kind: 'timeout' } } }),
    });

    const failure = resolve('Asset', [], 'AAPL', { entity });
    await expect(failure).rejects.toBeInstanceOf(ParamResolutionError);
    await expect(failure).rejects.toMatchObject({ name: 'ParamResolutionError', message: 'Entity resolution failed: dependency' });
  });

  it('keeps an AssetList label containing the list separator whole', async () => {
    const entity = entityModule({
      async resolveMatches() {
        const all: EntityMatch[] = [
          { entityId: EXAMPLE_UW, display: 'Example, Inc', aliases: [] },
          { entityId: MSFT, display: 'Microsoft Corp', aliases: [] },
        ];
        return { ok: true, value: all };
      },
    });

    expect(await resolve('AssetList', [EXAMPLE_UW, MSFT], 'Example, Inc, Micro', { entity, field: 'assets' })).toEqual({
      ok: true,
      value: [EXAMPLE_UW, MSFT],
      label: 'Example, Inc, Microsoft Corp',
      displayValue: ['Example, Inc', 'Microsoft Corp'],
      echo: 'assets = Example, Inc, Microsoft Corp (matched "Example, Inc, Micro")',
    });
  });

  it('rejoins an exact AssetList item only into an exact label', async () => {
    const all: EntityMatch[] = [
      { entityId: MSFT, display: 'Microsoft Corp', aliases: [] },
      { entityId: MSF, display: 'Microsoft Corp, Ltd', aliases: [] },
      { entityId: EXAMPLE_UW, display: 'Ltd', aliases: [] },
    ];
    const entity = entityModule({
      async resolveMatches() {
        return { ok: true, value: all };
      },
    });

    expect(await resolve('AssetList', [MSFT, MSF, EXAMPLE_UW], 'Microsoft Corp, Ltd', { entity })).toMatchObject({
      ok: true,
      value: [MSFT, EXAMPLE_UW],
    });
  });
});

describe('unwrapSliderValue', () => {
  it('passes through scalar values and objects without marks and step', () => {
    const obj = { type: 'Number', value: 10 };
    expect(unwrapSliderValue(10)).toBe(10);
    expect(unwrapSliderValue(null)).toBe(null);
    expect(unwrapSliderValue(obj)).toBe(obj);
  });

  it('extracts the slider value, falling back to its default', () => {
    const marks = { 0: '0', 24: '24' };
    expect(unwrapSliderValue({ marks, step: 6, value: { value: 10 }, defaultValue: { value: 12 } })).toBe(10);
    expect(unwrapSliderValue({ marks, step: 6, defaultValue: { value: 12 } })).toBe(12);
  });

  it('returns the descriptor when its inner value has no value key', () => {
    const slider = { defaultValue: 'plain', marks: {}, step: 1 };
    expect(unwrapSliderValue(slider)).toBe(slider);
  });
});
