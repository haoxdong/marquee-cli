import { describe, expect, it } from 'vitest';
import { presentDashboardLimit } from '../command-options.js';

function presentationSink() {
  let output = '';
  let error = '';
  let exitCode: number | undefined;
  return {
    sink: {
      write(text: string) {
        output += text;
      },
      writeError(text: string) {
        error += text;
      },
      setExitCode(code: number) {
        exitCode = code;
      },
    },
    presentation() {
      return { output, error, exitCode };
    },
  };
}

describe('MarketView command option presentation', () => {
  // ADR 0085 decision 4: agent misuse, classed `usage`.
  it('rejects a Dashboard limit that is not a positive integer as usage', () => {
    const dashboard = presentationSink();

    expect(() => presentDashboardLimit('0', dashboard.sink)).toThrow(expect.objectContaining({ code: 'marquee.usage' }));
    expect(dashboard.presentation()).toEqual({
      output: '',
      error: 'Error: -L must be a positive integer\n',
      exitCode: 1,
    });
  });

  it('accepts a positive integer Dashboard limit without writing an error', () => {
    const dashboard = presentationSink();

    expect(presentDashboardLimit('120', dashboard.sink)).toBe(120);
    expect(dashboard.presentation()).toEqual({ output: '', error: '', exitCode: undefined });
  });

  it.each(['', '05', '-1', '1.5', '1e3', 'x12', '12x', ' 12', '9'.repeat(400)])(
    'rejects the Dashboard limit %j',
    (value) => {
      const dashboard = presentationSink();

      expect(() => presentDashboardLimit(value, dashboard.sink)).toThrow(expect.objectContaining({ code: 'marquee.usage' }));
      expect(dashboard.presentation().error).toBe('Error: -L must be a positive integer\n');
    },
  );
});
