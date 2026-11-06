import { describe, expect, it } from 'vitest';
import { configParameters, configRelativeDate, configUnderlyingChartId } from '../configuration-anchors.js';
import { InvalidWidgetResponseError } from '../semantic-failure.js';

function expectInvalidResponse(read: () => unknown, detail: string): void {
  let thrown: unknown;
  try {
    read();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(InvalidWidgetResponseError);
  expect((thrown as InvalidWidgetResponseError).error).toEqual({
    source: 'configuration',
    problem: 'unsupported-payload-shape',
    detail,
  });
}

describe('Widget Configuration anchors', () => {
  it('reads the relative date of a configuration wrapped in a one-element array', () => {
    expect(configRelativeDate([{ relativeDate: '5y' }])).toBe('5y');
  });

  it('skips parameters before the Relative Date parameter', () => {
    expect(configRelativeDate({
      parameters: [
        { field: 'start', value: '2020-01-01' },
        { field: 'Relative Date', value: '5Y' },
      ],
    })).toBe('5y');
  });

  it('reads a numeric Relative Date parameter', () => {
    expect(configRelativeDate({ parameters: [{ field: 'Relative Date', value: 5 }] })).toBe('5');
  });

  it('skips an empty modified Relative Date for the configured parameter', () => {
    expect(configRelativeDate({
      modifiedParameters: [{ field: 'Relative Date', value: '' }],
      parameters: [{ field: 'Relative Date', value: '3M' }],
    })).toBe('3m');
  });

  it('reads the underlying Chart identity', () => {
    expect(configUnderlyingChartId({ underlyingChartId: 'CH123' })).toBe('CH123');
  });

  it.each([
    ['a configuration array that holds more than one record', () => configRelativeDate([{ relativeDate: '5y' }, { relativeDate: '1y' }]), 'configuration is not a record'],
    ['non-array modifiedParameters', () => configRelativeDate({ modifiedParameters: 'bogus' }), 'configuration.modifiedParameters is not an array'],
    ['non-array parameters', () => configParameters({ parameters: 'bogus' }), 'configuration.parameters is not an array'],
    ['a non-record modifiedParameters entry', () => configRelativeDate({ modifiedParameters: [{ field: 'start' }, 'bogus'] }), 'configuration.modifiedParameters[1] is not a record'],
    ['a non-record parameters entry', () => configParameters({ parameters: [{ field: 'start' }, 'bogus'] }), 'configuration.parameters[1] is not a record'],
    ['an empty underlying Chart identity', () => configUnderlyingChartId({ underlyingChartId: '' }), 'configuration.underlyingChartId is missing'],
  ] as const)('fails invalid-response on %s', (_name, read, detail) => {
    expectInvalidResponse(read, detail);
  });
});
