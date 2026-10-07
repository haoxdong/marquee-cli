import { describe, expect, it } from 'vitest';

import {
  PlotToolResultDecodeError,
  PlotToolResultItemError,
  readPlotToolRunnerResponse,
} from '../results.js';

describe('Widget PlotTool Pro result policy', () => {
  it('returns drawable results and statistics when no error key is present', () => {
    const response = {
      results: [
        { type: 'series', values: { '2026-01-01': 1 }, errorExpr: 'wire-success' },
      ],
      statistics: [
        { type: 'statistics', values: { min: 1 }, expression: 'wire-success' },
      ],
    };

    expect(readPlotToolRunnerResponse(response)).toEqual(response);
  });

  it('branches on error-key presence even when the value is falsy', () => {
    expect(() => readPlotToolRunnerResponse({
      results: [{ error: '', message: 'empty error code' }],
    })).toThrowError(expect.objectContaining({
      name: 'PlotToolResultItemError',
      source: 'results',
      index: 0,
    }));
  });

  it('preserves the provider result-error shape on a typed error', () => {
    const providerError = {
      error: 'InvalidExpression',
      message: 'Expression failed',
      statusCode: 400,
      requestId: 'request-1',
      isFnlpError: true,
      isWarning: false,
    };

    expect(() => readPlotToolRunnerResponse({ results: [providerError] }))
      .toThrowError(expect.objectContaining({
        name: 'PlotToolResultItemError',
        kind: 'plot-result-item',
        source: 'results',
        providerError,
        statusCode: 400,
        requestId: 'request-1',
        isFnlpError: true,
        isWarning: false,
      }));
  });

  it('preserves the exact statistics error shape', () => {
    const providerError = { error: 'StatisticsFailed', message: 'No statistics' };

    try {
      readPlotToolRunnerResponse({
        results: [{ type: 'series', values: { '2026-01-01': 1 } }],
        statistics: [providerError],
      });
      throw new Error('expected readPlotToolRunnerResponse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PlotToolResultItemError);
      expect(error).toMatchObject({
        source: 'statistics',
        index: 0,
        providerError,
      });
    }
  });

  it('discards healthy siblings when any result item fails', () => {
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
    [
      'results[0].requestId',
      'expected a string',
      { results: [{ error: 'InvalidExpression', message: 'failed', requestId: 1 }] },
    ],
    [
      'results[0].isWarning',
      'expected a boolean',
      { results: [{ error: 'InvalidExpression', message: 'failed', isWarning: 'no' }] },
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
