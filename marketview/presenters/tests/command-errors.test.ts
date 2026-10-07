import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../../artifact-registry/index.js';
import { formatUnknownMarketViewRef, writeWrongMarketViewRef } from '../command-errors.js';

function wrongRefError(ref: ArtifactRef) {
  let stderr = '';
  let exitCode: number | undefined;
  writeWrongMarketViewRef({
    write() {},
    writeError(text) {
      stderr += text;
    },
    setExitCode(code) {
      exitCode = code;
    },
  }, 'x1', ref);
  return { stderr, exitCode };
}

describe('MarketView command errors', () => {
  it('names an Entity Feed ref a dashboard and any other ref by its type', () => {
    expect(wrongRefError({ type: 'entity-feed', entityId: 'MA_ONE', entityKind: 'asset' }))
      .toStrictEqual({
        stderr: 'Error: ref @x1 is a dashboard — use `marquee marketview dashboard view ...`\n',
        exitCode: 1,
      });
    expect(wrongRefError({ type: 'search', searchKind: 'research' }))
      .toStrictEqual({
        stderr: 'Error: ref @x1 is a search — use `marquee content search ...`\n',
        exitCode: 1,
      });
  });

  it('lists the refs of the unknown ref\'s namespace first, then refs of its kind, then the rest', () => {
    expect(formatUnknownMarketViewRef('s1.w9', ['d1', 's2', 's1.w1', 's1', 'w3'])).toBe([
      'Error: ref @s1.w9 not found',
      'Hint: current refs include @s1, @s1.w1, @s2, @d1, @w3.',
      'Run the previous command again or use one of the refs printed above.',
    ].join('\n'));
  });

  it('lists at most six refs and marks the cut', () => {
    expect(formatUnknownMarketViewRef('w9', ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']).split('\n')[1])
      .toBe('Hint: current refs include @w1, @w2, @w3, @w4, @w5, @w6.');
    expect(formatUnknownMarketViewRef('w9', ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']).split('\n')[1])
      .toBe('Hint: current refs include @w1, @w2, @w3, @w4, @w5, @w6, ....');
  });
});
