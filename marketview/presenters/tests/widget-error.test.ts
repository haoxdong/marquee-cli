import { describe, expect, it } from 'vitest';
import type { WidgetError } from '../../../widget/index.js';
import type { WidgetCallLog } from '../widget-evidence.js';
import { presentWidgetError } from '../widget-error.js';

describe('Widget error presentation', () => {
  it.each([
    [
      {
        kind: 'malformed-member',
        controlGroupIds: ['CG_EQUITIES'],
        problem: 'invalid-response',
      },
      'Entity resolution failed: malformed-entity',
    ],
    [
      {
        kind: 'malformed-member',
        controlGroupIds: ['CG_EQUITIES'],
        problem: 'incomplete-expansion',
      },
      'Control Group response reached its limit without completeness evidence',
    ],
    [
      { kind: 'access-denied', controlGroupIds: ['CG_EQUITIES'] },
      'Entity resolution failed: access-denied',
    ],
    [
      {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
      'Not authenticated. Run: marquee auth login',
    ],
    [
      {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'rate-limited' },
      },
      'Too many requests',
    ],
    [
      {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'timeout' },
      },
      'Request timed out after 30s',
    ],
    [
      {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'cancelled' },
      },
      'Request canceled after faster hedge completed',
    ],
    [
      {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'unavailable' },
      },
      'Entity resolution failed: dependency',
    ],
  ] as const)('owns stable Control Group text for %j', (failure, message) => {
    expect(presentWidgetError({
      kind: 'control-group-resolution-failure',
      identity: { widgetId: 'MW_BAD' },
      failure,
    })).toEqual({ message });
  });

  it('preserves audit-backed Control Group dependency guidance', () => {
    const audit: WidgetCallLog = {
      intent: 'resolve-input',
      calls: [],
      failure: {
        message: 'Credential Service request timed out after 12s',
        status: 504,
        path: '/v1/marketview/constituents',
      },
    };

    expect(presentWidgetError({
      kind: 'control-group-resolution-failure',
      identity: { widgetId: 'MW_BAD' },
      failure: {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'timeout' },
      },
    }, audit)).toEqual({
      message: 'Credential Service request timed out after 12s at upstream path /v1/marketview/constituents',
      status: 504,
    });
  });

  it.each([
    ['/v1/data/visualizations/DV_TEST/render', 'DV render endpoint /v1/data/visualizations/DV_TEST/render'],
    ['/v1/plots/runner', 'CH runner endpoint /v1/plots/runner'],
  ])('names the upstream endpoint a failed %s call reached', (path, place) => {
    const audit: WidgetCallLog = {
      intent: 'read',
      calls: [],
      failure: { message: 'Marquee request failed', status: 502, path },
    };

    expect(presentWidgetError({
      kind: 'control-group-resolution-failure',
      identity: { widgetId: 'MW_BAD' },
      failure: {
        kind: 'dependency',
        controlGroupIds: ['CG_EQUITIES'],
        failure: { kind: 'timeout' },
      },
    }, audit)).toEqual({ message: `Marquee request failed at ${place}`, status: 502 });
  });

  it('rejects a Control Group Selected Context input the way Marquee Web does', () => {
    expect(presentWidgetError({
      kind: 'invalid-input',
      identity: { widgetId: 'MW_BAD' },
      input: 'Selected Context',
      problem: 'control-group',
    })).toEqual({
      message: 'Selected Context cannot be a Control Group; Marquee Web accepts only one of its members as a widget\'s Selected Context',
    });
  });

  it('names the Widget Parameter missing display evidence', () => {
    expect(presentWidgetError({
      kind: 'missing-display-evidence',
      identity: { widgetId: 'MW_BAD' },
      field: 'asset',
    })).toEqual({
      message: 'Widget MW_BAD has no display evidence for snippet parameter asset',
    });
  });

  it.each([
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'widget response uses a data envelope',
      },
      'Unsupported widget module response shape: widget response uses a data envelope; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'selected-context-control-group',
      },
      'Widget MW_BAD has a Control Group as its Selected Context; Marquee Web cannot load that either ("Sorry, we are experiencing an issue loading this widget").',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'data-viz-configuration-missing',
      },
      'Unsupported widget module response shape: Data Viz Widget has no configuration id; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'configuration',
        problem: 'parameters-not-array',
      },
      'Unsupported widget module response shape: configuration.parameters is not an array; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'configuration',
        problem: 'parameter-not-record',
        index: 2,
      },
      'Unsupported widget module response shape: configuration.parameters[2] is not a record; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'configuration',
        problem: 'parameter-value-missing',
        index: 1,
      },
      'Unsupported widget module response shape: configuration.parameters[1] has no value; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'configuration',
        problem: 'configuration-id-missing',
      },
      'Unsupported widget module response shape: configuration.id is missing; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'configuration',
        problem: 'calculated-dates-without-relative-date',
      },
      'Unsupported widget module response shape: configuration.calculatedDates has no relative date; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'render-params-not-record',
      },
      'Unsupported widget module response shape: widget.renderParams is not a record; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'render-controls-not-array',
      },
      'Unsupported widget module response shape: widget.renderParams.controls is not an array; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'unsupported-payload-shape',
      },
      'Unsupported widget module response shape: unsupported Widget Payload shape; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'parameters-missing',
      },
      'Unsupported widget module response shape: widget.parameters is missing; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'parameter-field-missing',
      },
      'Unsupported widget module response shape: widget parameter has no field; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'parameter-values-not-record',
      },
      'Unsupported widget module response shape: widget parameter values is not a record; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'render-control-value-missing',
      },
      'Unsupported widget module response shape: widget render control has no value; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'context-parameter-control-group',
      },
      'Unsupported widget module response shape: widget context parameter names a Control Group; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'date-parameter-default-missing',
      },
      'Unsupported widget module response shape: widget Date parameter has no default; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'configuration',
        problem: 'configuration-assignment-missing',
      },
      'Unsupported widget module response shape: configuration.parameters omits a current widget value it would re-save; record a Scenario before accepting this fallback.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'render-input-invalid',
      },
      'Widget MW_BAD data contradicts its own definition: its Relative Date or Selected Context is not one the widget accepts.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD' },
        source: 'widget',
        problem: 'render-assignment-invalid',
      },
      'Widget MW_BAD data contradicts its own definition: a parameter override names an input or option the widget does not define.',
    ],
    [
      {
        kind: 'invalid-response',
        identity: { widgetId: 'MW_BAD', configurationId: 'WC_EMPTY' },
        source: 'configuration',
        problem: 'empty-configuration',
      },
      'Config detail returned empty response for WC_EMPTY',
    ],
  ] as const)('maps closed malformed response %j to stable text', (error, message) => {
    expect(presentWidgetError(error as WidgetError)).toEqual({ message });
  });

  it('caps printed unmatched-input candidates at ten and counts the rest', () => {
    const candidates = Array.from({ length: 11 }, (_, index) => `Option ${index + 1}`);
    expect(presentWidgetError({
      kind: 'unmatched-input',
      identity: { widgetId: 'MW_BAD' },
      input: 'asset',
      requested: 'SPX',
      candidates,
    })).toStrictEqual({
      message: [
        'no asset option matches "SPX" — candidates:',
        '  Option 1',
        '  Option 2',
        '  Option 3',
        '  Option 4',
        '  Option 5',
        '  Option 6',
        '  Option 7',
        '  Option 8',
        '  Option 9',
        '  Option 10',
        '  …and 1 more',
      ].join('\n'),
    });
  });

  it.each([
    [[], 'no asset option matches "SPX"'],
    [
      Array.from({ length: 10 }, (_, index) => `Option ${index + 1}`),
      [
        'no asset option matches "SPX" — candidates:',
        '  Option 1',
        '  Option 2',
        '  Option 3',
        '  Option 4',
        '  Option 5',
        '  Option 6',
        '  Option 7',
        '  Option 8',
        '  Option 9',
        '  Option 10',
      ].join('\n'),
    ],
  ])('prints every unmatched-input candidate up to the cap: %j', (candidates, message) => {
    expect(presentWidgetError({
      kind: 'unmatched-input',
      identity: { widgetId: 'MW_BAD' },
      input: 'asset',
      requested: 'SPX',
      candidates,
    })).toStrictEqual({ message });
  });

  it.each([
    [{ kind: 'widget-not-found', identity: { widgetId: 'MW_GONE' } }, { message: 'Widget MW_GONE was not found', status: 404 }],
    [{ kind: 'widget-access-denied', identity: { widgetId: 'MW_LOCK' } }, { message: 'Access denied: widget MW_LOCK', status: 403 }],
    [
      { kind: 'widget-load-failure', identity: { widgetId: 'MW_DOWN' }, failure: { kind: 'unavailable' } },
      { message: 'Widget MW_DOWN could not be loaded' },
    ],
    [
      { kind: 'invalid-definition', identity: { widgetId: 'MW_BAD' }, problem: 'malformed' },
      { message: 'Widget MW_BAD has an invalid definition: malformed' },
    ],
    [
      { kind: 'invalid-definition', identity: { widgetId: '' }, problem: 'missing-identity' },
      { message: 'Widget (missing) has an invalid definition: missing-identity' },
    ],
    [
      { kind: 'configuration-not-found', identity: { widgetId: 'MW_BAD', configurationId: 'WC_GONE' } },
      { message: 'Widget configuration WC_GONE was not found', status: 404 },
    ],
    [
      { kind: 'configuration-mismatch', identity: { widgetId: 'MW_BAD', configurationId: 'WC_OTHER' }, ownerWidgetId: 'MW_OWNER' },
      { message: 'Configuration WC_OTHER belongs to widget MW_OWNER, not MW_BAD' },
    ],
    [
      { kind: 'configuration-mismatch', identity: { widgetId: 'MW_BAD', configurationId: 'WC_OTHER' } },
      { message: 'Widget configuration WC_OTHER does not belong to MW_BAD' },
    ],
    [
      { kind: 'configuration-mint-failure', identity: { widgetId: 'MW_BAD' } },
      { message: 'Widget configuration creation did not return id' },
    ],
    [
      { kind: 'missing-display-evidence', identity: { widgetId: 'MW_BAD' }, field: 'title' },
      { message: 'Widget MW_BAD has no display evidence for snippet title' },
    ],
    [
      { kind: 'unknown-input', identity: { widgetId: 'MW_BAD' }, input: 'colour', candidates: ['asset', 'tenor'] },
      { message: 'Widget MW_BAD has no input named colour. Available: asset, tenor' },
    ],
    [
      { kind: 'ambiguous-input', identity: { widgetId: 'MW_BAD' }, input: 'asset', requested: 'SP', candidates: ['SPX', 'SPY'] },
      { message: 'ambiguous asset "SP" — candidates:\n  SPX\n  SPY' },
    ],
    [
      { kind: 'required-input', identity: { widgetId: 'MW_BAD' }, input: 'asset' },
      { message: 'Widget input asset is required' },
    ],
    [
      { kind: 'unsupported-execution-target', identity: { widgetId: 'MW_BAD' }, targetId: 'XX_TARGET' },
      { message: 'Widget MW_BAD has unsupported execution target XX_TARGET' },
    ],
    [
      { kind: 'unsupported-execution-target', identity: { widgetId: 'MW_BAD' }, targetId: '' },
      { message: 'Widget MW_BAD has unsupported execution target (missing)' },
    ],
    [
      {
        kind: 'plottool-failure',
        identity: { widgetId: 'MW_BAD', configurationId: 'WC_1' },
        problem: { kind: 'chart-not-found', chartId: 'CH_1' },
      },
      { message: 'Widget MW_BAD render failed: chart-not-found' },
    ],
    [
      {
        kind: 'data-viz-failure',
        identity: { widgetId: 'MW_BAD', configurationId: 'WC_1' },
        problem: { kind: 'unavailable' },
      },
      { message: 'Widget MW_BAD render failed: unavailable' },
    ],
  ] as const)('presents %j without call evidence', (error, presented) => {
    expect(presentWidgetError(error as WidgetError)).toStrictEqual(presented);
  });

  it.each([
    ['boolean-required', 'flag must be true or false'],
    ['date-required', 'flag must be YYYY-MM-DD or a relative date like 0b or -1b'],
    ['integer-required', 'flag must be an integer'],
    ['empty', 'flag must not be empty'],
    ['malformed', 'Widget input flag is invalid: malformed'],
    ['incompatible-dependent-input', 'Widget input flag is invalid: incompatible-dependent-input'],
  ] as const)('words invalid input %s', (problem, message) => {
    expect(presentWidgetError({
      kind: 'invalid-input',
      identity: { widgetId: 'MW_BAD' },
      input: 'flag',
      problem,
    })).toStrictEqual({ message });
  });

  it('steers a QuickPoll surveyDate change back to the Marquee UI', () => {
    expect(presentWidgetError({
      kind: 'invalid-input',
      identity: { widgetId: 'MW_QP' },
      input: 'surveyDate',
      problem: 'incompatible-dependent-input',
    })).toStrictEqual({
      message: 'QuickPoll surveyDate depends on question; changing surveyDate from the CLI can render mismatched title/data/description. Load the QuickPoll result for the desired survey date, or choose a valid question in Marquee UI before reading data',
    });
  });

  it('names a surveyDate that is invalid for another reason', () => {
    expect(presentWidgetError({
      kind: 'invalid-input',
      identity: { widgetId: 'MW_QP' },
      input: 'surveyDate',
      problem: 'malformed',
    })).toStrictEqual({ message: 'Widget input surveyDate is invalid: malformed' });
  });

  it.each([
    [{ problem: 'empty-configuration', source: 'configuration' }, 'Config detail returned empty response for '],
    [{ problem: 'parameter-not-record', source: 'configuration' }, 'Unsupported widget module response shape: configuration.parameters[0] is not a record; record a Scenario before accepting this fallback.'],
    [{ problem: 'parameter-value-missing', source: 'configuration' }, 'Unsupported widget module response shape: configuration.parameters[0] has no value; record a Scenario before accepting this fallback.'],
    [{ problem: 'expression-labels-not-array', source: 'configuration' }, 'Unsupported widget module response shape: configuration.metadata.expressionLabels is not an array; record a Scenario before accepting this fallback.'],
    [{ problem: 'expression-labels-missing', source: 'configuration' }, 'Unsupported widget module response shape: configuration.metadata.expressionLabels is missing; record a Scenario before accepting this fallback.'],
    [{ problem: 'entity-metadata-not-record', source: 'widget' }, 'Unsupported widget module response shape: Widget entity metadata is not a record; record a Scenario before accepting this fallback.'],
    [{ problem: 'entity-metadata-entry-not-record', source: 'widget' }, 'Unsupported widget module response shape: Widget entity metadata entry 0 is not a record; record a Scenario before accepting this fallback.'],
    [{ problem: 'entity-metadata-entry-not-record', source: 'widget', index: 3 }, 'Unsupported widget module response shape: Widget entity metadata entry 3 is not a record; record a Scenario before accepting this fallback.'],
    [{ problem: 'entity-metadata-name-missing', source: 'widget' }, 'Unsupported widget module response shape: Widget entity metadata entry 0 has no name; record a Scenario before accepting this fallback.'],
    [{ problem: 'entity-metadata-name-missing', source: 'widget', index: 4 }, 'Unsupported widget module response shape: Widget entity metadata entry 4 has no name; record a Scenario before accepting this fallback.'],
  ] as const)('words malformed response %j', (shape, message) => {
    expect(presentWidgetError({
      kind: 'invalid-response',
      identity: { widgetId: 'MW_BAD' },
      ...shape,
    })).toStrictEqual({ message });
  });

  describe('with call evidence', () => {
    const loadFailure: WidgetError = {
      kind: 'widget-load-failure',
      identity: { widgetId: 'MW_BAD' },
      failure: { kind: 'unavailable' },
    };
    const rateLimited: WidgetError = {
      kind: 'widget-load-failure',
      identity: { widgetId: 'MW_BAD' },
      failure: { kind: 'rate-limited' },
    };
    function failed(failure: NonNullable<WidgetCallLog['failure']>): WidgetCallLog {
      return { intent: 'read', calls: [], failure };
    }

    it('reports the failed call and its status for a load failure', () => {
      expect(presentWidgetError(loadFailure, failed({ message: 'Marquee request failed', status: 502 })))
        .toStrictEqual({ message: 'Marquee request failed', status: 502 });
    });

    it('omits a status the failed call did not carry', () => {
      expect(presentWidgetError(loadFailure, failed({ message: 'socket hang up' })))
        .toStrictEqual({ message: 'socket hang up' });
      expect(presentWidgetError({
        kind: 'control-group-resolution-failure',
        identity: { widgetId: 'MW_BAD' },
        failure: { kind: 'dependency', controlGroupIds: ['CG_1'], failure: { kind: 'timeout' } },
      }, failed({ message: 'socket hang up' }))).toStrictEqual({ message: 'socket hang up' });
    });

    it('does not repeat a path the message already names', () => {
      expect(presentWidgetError(loadFailure, failed({
        message: 'GET /v1/widgets/MW_BAD failed',
        status: 500,
        path: '/v1/widgets/MW_BAD',
      }))).toStrictEqual({ message: 'GET /v1/widgets/MW_BAD failed', status: 500 });
    });

    it('falls back to the latest call error when no failure was recorded', () => {
      const audit: WidgetCallLog = {
        intent: 'read',
        calls: [
          { name: 'widget.get', request: { method: 'GET', path: '/v1/widgets/MW_BAD' }, error: 'first error' },
          { name: 'configuration.get', request: { method: 'GET', path: '/v1/configurations/WC_1' }, error: 'latest error' },
          { name: 'plot.run', request: { method: 'POST', path: '/v1/plots/runner' } },
        ],
      };
      expect(presentWidgetError(loadFailure, audit)).toStrictEqual({ message: 'latest error' });
    });

    it('falls back to the default text when no call failed', () => {
      const audit: WidgetCallLog = {
        intent: 'read',
        calls: [{ name: 'widget.get', request: { method: 'GET', path: '/v1/widgets/MW_BAD' } }],
      };
      expect(presentWidgetError(loadFailure, audit)).toStrictEqual({ message: 'Widget MW_BAD could not be loaded' });
    });

    it('reports call evidence for a render failure', () => {
      expect(presentWidgetError({
        kind: 'plottool-failure',
        identity: { widgetId: 'MW_BAD', configurationId: 'WC_1' },
        problem: { kind: 'chart-not-found', chartId: 'CH_1' },
      }, failed({ message: 'Chart failed', status: 500, body: '{"error":"boom"}' })))
        .toStrictEqual({ message: 'Chart failed — boom' });
    });

    it.each([
      ['{"errorMessages":["bad asset",42]}', 'bad asset; 42'],
      ['{"errorMessages":[],"errors":["fallback"]}', '{"errorMessages":[],"errors":["fallback"]}'],
      ['{"errorMessages":[],"error":"the error"}', 'the error'],
      ['{"errors":["bad tenor"]}', 'bad tenor'],
      ['{"messages":"stringy messages"}', 'stringy messages'],
      ['{"message":"plain message"}', 'plain message'],
      ['{"message":"","error":"the error"}', 'the error'],
      ['{"error":"","code":7}', '{"error":"","code":7}'],
      ['{"detail":"Too  many"}', '{"detail":"Too  many"}'],
      ['"quoted text"', 'quoted text'],
      ['[1,2]', '[1,2]'],
      ['null', 'null'],
      ['not json', 'Malformed upstream error body'],
    ])('summarizes provider body %s', (body, hint) => {
      expect(presentWidgetError(loadFailure, failed({ message: 'Marquee request failed', body })))
        .toStrictEqual({ message: `Marquee request failed — ${hint}` });
    });

    it('omits an empty provider body', () => {
      expect(presentWidgetError(loadFailure, failed({ message: 'Marquee request failed', body: '' })))
        .toStrictEqual({ message: 'Marquee request failed' });
    });

    it('preserves a rate-limit detail with its spacing', () => {
      expect(presentWidgetError(rateLimited, failed({
        message: 'Too many requests',
        status: 429,
        body: '{"detail":"Request  was throttled"}',
      }))).toStrictEqual({ message: 'Too many requests — {"detail": "Request  was throttled"}', status: 429 });
      expect(presentWidgetError(rateLimited, failed({
        message: 'Too many requests',
        status: 429,
        body: '{"detail":""}',
      }))).toStrictEqual({ message: 'Too many requests — {"detail":""}', status: 429 });
      expect(presentWidgetError(rateLimited, failed({
        message: 'Too many requests',
        body: '{"error":"","detail":"Back  off"}',
      }))).toStrictEqual({ message: 'Too many requests — {"detail": "Back  off"}' });
    });

    it('keeps a detail body compact for failures other than rate limits', () => {
      const body = '{"detail":"Chart  broke"}';
      expect(presentWidgetError({
        kind: 'plottool-failure',
        identity: { widgetId: 'MW_BAD', configurationId: 'WC_1' },
        problem: { kind: 'chart-not-found', chartId: 'CH_1' },
      }, failed({ message: 'Chart failed', body }))).toStrictEqual({ message: 'Chart failed — {"detail":"Chart  broke"}' });
      expect(presentWidgetError({
        kind: 'control-group-resolution-failure',
        identity: { widgetId: 'MW_BAD' },
        failure: { kind: 'dependency', controlGroupIds: ['CG_1'], failure: { kind: 'timeout' } },
      }, failed({ message: 'Timed out', body }))).toStrictEqual({ message: 'Timed out — {"detail":"Chart  broke"}' });
    });

    it('preserves a Control Group rate-limit detail with its spacing', () => {
      expect(presentWidgetError({
        kind: 'control-group-resolution-failure',
        identity: { widgetId: 'MW_BAD' },
        failure: { kind: 'dependency', controlGroupIds: ['CG_1'], failure: { kind: 'rate-limited' } },
      }, failed({ message: 'Too many requests', status: 429, body: '{"detail":"Slow  down"}' })))
        .toStrictEqual({ message: 'Too many requests — {"detail": "Slow  down"}', status: 429 });
    });

    it.each(['gateway_html', 'generic_html'])('quotes the first 200 characters of a %s body', (responseClassification) => {
      const body = `<html>${'x'.repeat(250)}</html>`;
      expect(presentWidgetError(loadFailure, failed({ message: 'Bad gateway', status: 502, body, responseClassification })))
        .toStrictEqual({ message: `Bad gateway — <html>${'x'.repeat(194)}`, status: 502 });
    });

    it('keeps a 200-character HTML body whole', () => {
      const body = `<p>${'y'.repeat(193)}</p>`;
      expect(presentWidgetError(loadFailure, failed({ message: 'Bad gateway', body, responseClassification: 'gateway_html' })))
        .toStrictEqual({ message: `Bad gateway — ${body}` });
    });

    it('truncates a long JSON string body to 200 characters', () => {
      expect(presentWidgetError(loadFailure, failed({ message: 'Failed', body: JSON.stringify('z'.repeat(201)) })))
        .toStrictEqual({ message: `Failed — ${'z'.repeat(200)}` });
    });

    describe('for a parameter change', () => {
      function changeAudit(...bodies: unknown[]): WidgetCallLog {
        return {
          intent: 'change',
          calls: bodies.map((body) => ({
            name: 'configuration.create',
            request: { method: 'POST', path: '/v1/configurations', body },
          })),
          failure: { message: 'Marquee request failed', status: 400 },
        };
      }

      it('names the changed parameters of the latest configuration create', () => {
        const audit = changeAudit(
          { parameters: [{ field: 'stale', value: 'old' }] },
          {
            relativeDate: '-1y',
            parameters: [
              { field: 'asset', value: 'SPX' },
              { field: 'tenors', value: ['1m', '3m', '6m', '1y', '2y'] },
              { field: 'few', value: ['a', 'b', 'c'] },
              { field: 'nested', value: { a: 1, b: [true], c: 3 } },
              { field: 'pair', value: { a: 1, b: 2 } },
              { field: 'long', value: 'abcdefghijklmnopqrstu' },
              { field: 'twenty', value: 'abcdefghijklmnopqrst' },
              { field: 'id15', value: 'ZZ4B66MW5E27U8P' },
              { field: 'id16', value: 'ZZ4B66MW5E27U8PQ' },
              { field: 'id14', value: 'ZZ4B66MW5E27U8' },
              { field: 'lowerLead', value: 'xZZ4B66MW5E27U8P' },
              { field: 'lowerTail', value: 'ZZ4B66MW5E27U8Px' },
              { field: 'blank', value: null },
              { field: 7, value: 'skipped' },
              'skipped',
              null,
            ],
          },
        );
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({
          message: 'Widget param change failed (Relative Date=-1Y, asset=SPX, tenors=[1m, 3m, 6m, +2 more], few=[a, b, c], nested={a:1, b:[true], ...}, pair={a:1, b:2}, long=..., twenty=abcdefghijklmnopqrst, id15=..., id16=..., id14=ZZ4B66MW5E27U8, lowerLead=xZZ4B66MW5E27U8P, lowerTail=ZZ4B66MW5E27U8Px, blank=null) — Marquee request failed',
          status: 400,
        });
      });

      it('adds change context to access denial', () => {
        expect(presentWidgetError(
          { kind: 'widget-access-denied', identity: { widgetId: 'MW_LOCK' } },
          changeAudit({ parameters: [{ field: 'asset', value: 'SPX' }] }),
        )).toStrictEqual({
          message: 'Widget param change failed (asset=SPX) — Access denied: widget MW_LOCK',
          status: 403,
        });
      });

      it.each([
        [{ parameters: [] }],
        [{ parameters: 'nope' }],
        [{ relativeDate: 5 }],
        ['not a record'],
        [null],
      ])('omits change context when the create body %j names nothing', (body) => {
        expect(presentWidgetError(loadFailure, changeAudit(body)))
          .toStrictEqual({ message: 'Marquee request failed', status: 400 });
      });

      it('prints scalar parameter values as text', () => {
        expect(presentWidgetError(loadFailure, changeAudit({
          parameters: [{ field: 'window', value: 30 }, { field: 'live', value: true }, { field: 'gone' }],
        }))).toStrictEqual({
          message: 'Widget param change failed (window=30, live=true, gone=undefined) — Marquee request failed',
          status: 400,
        });
      });

      it.each([
        [{ relativeDate: '0b' }, 'Relative Date=0B'],
        [{ relativeDate: '0b', parameters: 'nope' }, 'Relative Date=0B'],
      ])('names only the Relative Date of create body %j', (body, summary) => {
        expect(presentWidgetError(loadFailure, changeAudit(body))).toStrictEqual({
          message: `Widget param change failed (${summary}) — Marquee request failed`,
          status: 400,
        });
      });

      it('names the parameters of a failed widget metadata POST over the default configuration create', () => {
        const metadataPath = '/v1/marketview/widgets/MW_COUNTRY/metadata';
        const audit: WidgetCallLog = {
          intent: 'change',
          calls: [
            {
              name: 'configuration.create',
              request: {
                method: 'POST',
                path: '/v1/marketview/widgets/configurations',
                body: { parameters: [{ field: 'Country', value: 'US' }] },
              },
            },
            {
              name: 'widget.metadata',
              request: {
                method: 'POST',
                path: metadataPath,
                body: { parameters: [{ field: 'Country', value: 'DE' }] },
              },
              error: `Marquee returned 503 for ${metadataPath}`,
            },
          ],
          failure: {
            message: `Marquee returned 503 for ${metadataPath}`,
            status: 503,
            path: metadataPath,
            body: 'Service Unavailable',
            responseClassification: 'generic_html',
          },
        };
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({
          message: `Widget param change failed (Country=DE) — Marquee returned 503 for ${metadataPath} — Service Unavailable`,
          status: 503,
        });
      });

      it.each([
        [
          '/v1/marketview/widgets/MW_COUNTRY/metadata',
          'Widget param change failed (Country=DE) — Marquee request failed at upstream path /v1/marketview/widgets/MW_COUNTRY/metadata',
        ],
        [
          '/v1/data/visualizations/DV_TEST/render',
          'Widget param change failed (Country=US) — Marquee request failed at DV render endpoint /v1/data/visualizations/DV_TEST/render',
        ],
      ])('names the parameters of the call that failed first, at %s, when two calls fail', (failedPath, message) => {
        const audit: WidgetCallLog = {
          intent: 'change',
          calls: [
            {
              name: 'configuration.create',
              request: {
                method: 'POST',
                path: '/v1/marketview/widgets/configurations',
                body: { parameters: [{ field: 'Country', value: 'US' }] },
              },
            },
            {
              name: 'widget.metadata',
              request: {
                method: 'POST',
                path: '/v1/marketview/widgets/MW_COUNTRY/metadata',
                body: { parameters: [{ field: 'Country', value: 'DE' }] },
              },
              error: 'Marquee request failed',
            },
            {
              name: 'dv.render',
              request: {
                method: 'POST',
                path: '/v1/data/visualizations/DV_TEST/render',
                body: { component: {}, visualization: {}, references: { useTableViz: false } },
              },
              error: 'Marquee request failed',
            },
          ],
          failure: { message: 'Marquee request failed', status: 503, path: failedPath },
        };
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({ message, status: 503 });
      });

      it('names the failed call, not an earlier successful one at the same path', () => {
        const audit = changeAudit({ parameters: [{ field: 'asset', value: 'SPX' }] }, { parameters: [{ field: 'asset', value: 'NDX' }] });
        audit.calls = audit.calls.map((call, index) => (index === 1 ? { ...call, error: 'Marquee request failed' } : call));
        audit.failure = { message: 'Marquee request failed', status: 400, path: '/v1/configurations' };
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({
          message: 'Widget param change failed (asset=NDX) — Marquee request failed at upstream path /v1/configurations',
          status: 400,
        });
      });

      it.each([
        ['dv.render', '/v1/data/visualizations/DV_TEST/render', { component: {}, visualization: {}, references: { configId: 'WC_TEST', useTableViz: false } }],
        ['ch.runner', '/v1/plots/runner', { expressions: [], statistics: false, realTime: false, hints: [], controls: [{ id: 'tenor', type: 'select', value: '1m' }] }],
        ['widget.metadata', '/v1/marketview/widgets/MW_TEST/metadata', undefined],
      ])('names the configuration create when a %s whose body names no parameters fails', (name, path, body) => {
        const audit = changeAudit({ parameters: [{ field: 'asset', value: 'SPX' }] });
        audit.calls.push({ name, request: { method: 'POST', path, body }, error: `Marquee request failed for ${path}` });
        audit.failure = { message: `Marquee request failed for ${path}`, status: 400, path };
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({
          message: `Widget param change failed (asset=SPX) — Marquee request failed for ${path}`,
          status: 400,
        });
      });

      it('ignores calls other than configuration create', () => {
        const audit: WidgetCallLog = {
          intent: 'change',
          calls: [{ name: 'configuration.update', request: { method: 'PUT', path: '/v1/configurations/WC_1', body: { parameters: [{ field: 'asset', value: 'SPX' }] } } }],
          failure: { message: 'Marquee request failed', status: 400 },
        };
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({ message: 'Marquee request failed', status: 400 });
      });

      it('omits change context for a read', () => {
        const audit: WidgetCallLog = { ...changeAudit({ parameters: [{ field: 'asset', value: 'SPX' }] }), intent: 'read' };
        expect(presentWidgetError(loadFailure, audit)).toStrictEqual({ message: 'Marquee request failed', status: 400 });
        expect(presentWidgetError({ kind: 'widget-access-denied', identity: { widgetId: 'MW_LOCK' } }, audit))
          .toStrictEqual({ message: 'Access denied: widget MW_LOCK', status: 403 });
      });
    });
  });
});
