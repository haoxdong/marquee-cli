import { describe, expect, it } from 'vitest';
import {
  contextParamDefault,
  controlField,
  controlParamDefault,
  widgetControlDefault,
  widgetFromEnvelope,
} from '../payload.js';

const REL = { rdate: { rule: '1Y' }, value: '2023-01-01' };
describe('controlField', () => {
  it('prefers id, then field, then name', () => {
    expect(controlField({ id: 'a', field: 'b', name: 'c' })).toBe('a');
    expect(controlField({ field: 'b', name: 'c' })).toBe('b');
    expect(controlField({ name: 'c' })).toBe('c');
  });

  it('is undefined for an empty control and fails loud for nullish controls', () => {
    expect(controlField({})).toBeUndefined();
    const unsupported = expect.objectContaining({
      error: {
        source: 'widget',
        problem: 'unsupported-payload-shape',
        detail: 'render control is not a record',
      },
    });
    expect(() => controlField(null)).toThrow(unsupported);
    expect(() => controlField(undefined)).toThrow(unsupported);
  });
});

describe('controlParamDefault (relative-date-aware superset)', () => {
  it('returns the relative-date object when the raw default matches its rule', () => {
    expect(controlParamDefault({ value: '1Y' }, REL)).toEqual(REL);
  });

  it('returns the relative-date object when the raw default matches its concrete value', () => {
    expect(controlParamDefault({ value: '2023-01-01' }, REL)).toEqual(REL);
  });

  it('returns the raw default when nothing matches the relative-date object', () => {
    expect(controlParamDefault({ value: 'X' }, REL)).toBe('X');
  });

  it('returns the raw default for non-relative component values', () => {
    expect(controlParamDefault({ value: 'ABC' }, 'plain')).toBe('ABC');
  });

  it('prefers value when legacy defaultValue is also present', () => {
    expect(controlParamDefault({ value: 'V', defaultValue: 'D' }, undefined)).toBe('V');
  });

  it('fails loud when the render control omits value', () => {
    // Every recorded render control carries `value`, so the component-value and
    // defaultValue fallbacks are unrecorded shapes per ADR 0040 §2.
    expect(() => controlParamDefault({ values: ['A', 'B'] }, 'B')).toThrow(/render control has no value/);
    expect(() => controlParamDefault({ defaultValue: 'D' }, 'C')).toThrow(/render control has no value/);
    expect(() => controlParamDefault({ values: ['A'] }, undefined)).toThrow(/render control has no value/);
  });
});

describe('widgetControlDefault (relative-date-aware superset)', () => {
  const widget = {
    renderParams: {
      component: { asOf: REL },
      controls: [{ id: 'asOf', value: '1Y' }],
    },
  };

  it('resolves a matching control to the relative-date object, not the bare rule', () => {
    expect(widgetControlDefault(widget, 'asOf')).toEqual(REL);
  });

  it('is undefined when no control matches the field', () => {
    expect(widgetControlDefault(widget, 'missing')).toBeUndefined();
  });

  it('fails loud for a descriptive control with no default or component value', () => {
    // A live-auth scan found zero widgets of this shape, so per ADR 0040 §2 the
    // silent fallback is a would-be wrong answer — surface it instead of guessing. The
    // throw comes from controlParamDefault's render-control `value` assert.
    const descriptive = { renderParams: { controls: [{ id: 'ctx', values: ['A', 'B'] }] } };
    expect(() => widgetControlDefault(descriptive, 'ctx')).toThrow(/render control has no value/);
  });
});

describe('contextParamDefault', () => {
  it('reads the component value first', () => {
    expect(contextParamDefault({ renderParams: { component: { ctx: 'MA1' } } }, 'ctx')).toBe('MA1');
  });

  it('falls back to the context parameter default', () => {
    expect(contextParamDefault({ contextParameter: { value: 'MA2' } }, 'ctx')).toBe('MA2');
    expect(contextParamDefault({ contextParameter: { values: { default: 'MA3' } } }, 'ctx')).toBe('MA3');
  });

  it('fails loud when the matching render control is descriptive with no default or component value', () => {
    // Previously this fell through to contextParameter.value; a live scan found
    // no widget of this shape, so ADR 0040 §2 makes the unrecorded fallback fail loud.
    const widget = {
      renderParams: {
        controls: [{ id: 'ctx', values: ['MA2', 'MA3'] }],
      },
      contextParameter: { field: 'ctx', value: 'MA2' },
    };

    expect(() => contextParamDefault(widget, 'ctx', ['MA2', 'MA3'])).toThrow(/render control has no value/);
  });

  it('returns the only option when no default exists', () => {
    expect(contextParamDefault({}, 'ctx', ['ONLY'])).toBe('ONLY');
  });
});

describe('widgetFromEnvelope', () => {
  it('returns the record itself when there is no data envelope', () => {
    expect(widgetFromEnvelope({ id: 'MW1' })).toEqual({ id: 'MW1' });
  });

  it('fails loud for unrecorded data-envelope fallbacks', () => {
    expect(() => widgetFromEnvelope({ data: { widget: { id: 'W' } } })).toThrow(/data envelope/);
    expect(() => widgetFromEnvelope({ data: { id: 'MW1' } })).toThrow(/data envelope/);
  });

  it('fails loud for empty widget responses', () => {
    expect(() => widgetFromEnvelope(undefined)).toThrow(/empty/);
    expect(() => widgetFromEnvelope(null)).toThrow(/empty/);
  });
});
