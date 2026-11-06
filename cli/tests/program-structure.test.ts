import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { packageRoot } from '../../lib/tests/package-root.js';
import { createProgram } from '../../cli-composition/index.js';

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const signatureEnd = source.indexOf(') {', start);
  expect(signatureEnd).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', signatureEnd);
  expect(open).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(open + 1, index);
    }
  }

  throw new Error(`function ${name} body is not closed`);
}

describe('buildProgram structure', () => {
  const programSource = readFileSync(
    join(packageRoot, 'cli-composition', 'registration', 'program.ts'),
    'utf8',
  );
  const buildProgramBody = functionBody(programSource, 'buildProgram');

  it('keeps command registration delegated to command modules', () => {
    const inlineRootCommands = ['open', 'next', 'prev', 'page', 'status'].filter((command) => (
      buildProgramBody.includes(`.command('${command}')`)
    ));

    expect(inlineRootCommands).toEqual([]);
  });

  it('does not keep command implementation helpers inside buildProgram', () => {
    const helperNames = [
      'resolveStoredRefUrl',
      'resolveBrowserOpenTarget',
      'renderWidgetTab',
      'renderDashboardTab',
      'renderContentDocument',
      'openStoredLinkRef',
    ].filter((name) => buildProgramBody.includes(`function ${name}`));

    expect(helperNames).toEqual([]);
  });

  it('stays small enough to be wiring-only', () => {
    expect(buildProgramBody.trim().split('\n').length).toBeLessThan(200);
  });

  it('creates a fresh Commander program per invocation', () => {
    const first = createProgram(() => {});
    const second = createProgram(() => {});

    expect(first.program).not.toBe(second.program);
  });

  it('keeps Content Search provider paths inside the production adapter', () => {
    expect(programSource).not.toContain('/research/search/tags-search');
    expect(programSource).not.toContain('/research/search/reports/advanced-search');
  });

  it('composes Content Search without generic current-operation shims', () => {
    expect(programSource).not.toContain('CONTENT_SEARCH_OPERATIONS');
    expect(programSource).not.toContain('currentOperationContentSearchPort');
    expect(programSource).not.toContain('contentSearchRequestOperation');
  });
});
