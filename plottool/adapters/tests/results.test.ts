import { describe, expect, it } from 'vitest';

import {
  PlotToolResultDecodeError,
  PlotToolResultItemError,
  readPlotToolRunnerResponse,
} from '../results.js';

describe('Widget PlotTool Pro result policy', () => {
  it('returns drawable results when no error key is present', () => {
    const response = {
      results: [
        { type: 'series', values: { '2026-01-01': 1 }, errorExpr: 'wire-success' },
      ],
    };

    expect(readPlotToolRunnerResponse(response)).toEqual(response);
  });

  it('branches on error-key presence even when the value is falsy', () => {
    expect(() => readPlotToolRunnerResponse({
      results: [{ error: '', message: 'empty error code' }],
    })).toThrowError(expect.objectContaining({
      name: 'PlotToolResultItemError',
      index: 0,
    }));
  });

  it('types a result error with its message and status', () => {
    expect(() => readPlotToolRunnerResponse({
      results: [{ error: 'InvalidExpression', message: 'Expression failed', statusCode: 403 }],
    })).toThrowError(expect.objectContaining({
      name: 'PlotToolResultItemError',
      kind: 'plot-result-item',
      index: 0,
      message: 'Expression failed',
      statusCode: 403,
      isAccessDenied: true,
    }));
  });

  it('rejects a Widget Chart whose runner response holds any failed result', () => {
    expect(() => readPlotToolRunnerResponse({
      results: [
        { type: 'series', values: { '2026-01-01': 1 } },
        { error: 'InvalidExpression', message: 'second series failed' },
      ],
    })).toThrowError(PlotToolResultItemError);
  });

  it('does not branch on client-stamped fields', () => {
    const response = {
      results: [{
        type: 'series',
        values: { '2026-01-01': 1 },
        errorExpr: 'ignored',
        expression: 'ignored',
        timestamp: 'ignored',
        frequency: 'ignored',
        startDate: 'ignored',
        endDate: 'ignored',
        startTime: 'ignored',
        endTime: 'ignored',
      }],
    };

    expect(readPlotToolRunnerResponse(response)).toEqual(response);
  });

  it.each([
    ['response', 'expected a record', null],
    ['results', 'expected an array', {}],
    ['results[0]', 'expected a record', { results: [null] }],
    [
      'results[0].message',
      'expected a string',
      { results: [{ error: 'InvalidExpression' }] },
    ],
    [
      'results[0].statusCode',
      'expected a number',
      { results: [{ error: 'InvalidExpression', message: 'failed', statusCode: '400' }] },
    ],
  ])('classifies malformed %s as a typed decode failure', (path, problem, response) => {
    expect(() => readPlotToolRunnerResponse(response)).toThrowError(
      expect.objectContaining({
        name: 'PlotToolResultDecodeError',
        path,
        problem,
        message: `Unsupported PlotTool Pro runner ${path}: ${problem}`,
      }),
    );
    expect(() => readPlotToolRunnerResponse(response)).toThrowError(PlotToolResultDecodeError);
  });
});
