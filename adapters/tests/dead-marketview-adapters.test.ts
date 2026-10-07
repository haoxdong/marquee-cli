import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { packageRoot } from '../../lib/tests/package-root.js';

const RETIRED_ACTIONS = [
  'widget-detail',
  'widget-title',
  'widget-metadata-title',
  'visualization-detail',
] as const;

const EXCLUDED_DIRS = new Set(['tests', 'fixtures', 'node_modules']);
const PRODUCTION_EXTENSIONS = ['.ts', '.js', '.mjs'] as const;

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) {
        files.push(...productionFiles(path));
      }
    } else if (
      PRODUCTION_EXTENSIONS.some((extension) => entry.endsWith(extension)) &&
      !entry.endsWith('.test.ts')
    ) {
      files.push(path);
    }
  }
  return files;
}

function mayContainRetiredAction(source: string): boolean {
  if (RETIRED_ACTIONS.some((action) => source.includes(action))) return true;
  if (!source.includes('\\')) return false;

  const candidate = source.replace(
    /\\(?:u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|x([\da-fA-F]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|\r\n|[\r\n\u2028\u2029])/g,
    (escape: string, braced: string | undefined, unicode: string | undefined,
      hex: string | undefined, octal: string | undefined) => {
      const digits = braced ?? unicode ?? hex ?? octal;
      if (digits === undefined) return '';
      const codePoint = Number.parseInt(digits, octal === undefined ? 16 : 8);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : escape;
    },
  );
  if (/\\[xu]/.test(candidate)) return true;
  const unescaped = candidate.replaceAll('\\', '');
  return RETIRED_ACTIONS.some((action) => unescaped.includes(action));
}

function retiredActionLiterals(file: string, source: string): string[] {
  if (!mayContainRetiredAction(source)) return [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const matches: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && RETIRED_ACTIONS.includes(node.text as typeof RETIRED_ACTIONS[number])) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      matches.push(`${relative(packageRoot, file)}:${line}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

describe('retired MarketView adapters', () => {
  it('reports decoded retired actions in source and dist with their literal locations', () => {
    expect(retiredActionLiterals(join(packageRoot, 'adapters/sample.ts'), [
      "const a = 'widget-detail';",
      'const b = "widget-title";',
      "const c = 'widget-metadata-title';",
      "const d = 'visualization-detail';",
    ].join('\n'))).toEqual([
      'adapters/sample.ts:1: widget-detail',
      'adapters/sample.ts:2: widget-title',
      'adapters/sample.ts:3: widget-metadata-title',
      'adapters/sample.ts:4: visualization-detail',
    ]);
    expect(retiredActionLiterals(join(packageRoot, 'dist/sample.js'),
      "const a = 'widget-detail'; const b = 'widget-title'; " +
      "const c = 'widget-metadata-title'; const d = 'visualization-detail';",
    )).toEqual([
      'dist/sample.js:1: widget-detail',
      'dist/sample.js:1: widget-title',
      'dist/sample.js:1: widget-metadata-title',
      'dist/sample.js:1: visualization-detail',
    ]);
  });

  it.each([
    ['hexadecimal', String.raw`'widget\x2Ddetail'`],
    ['unicode', String.raw`'widget\u002Ddetail'`],
    ['braced unicode', String.raw`'widget\u{2D}detail'`],
    ['mixed escapes', String.raw`'\x77\u0069\u{64}get-detail'`],
    ['identity escape', String.raw`'w\idget-detail'`],
    ['legacy octal', String.raw`'\167idget-detail'`],
    ['two-digit octal', String.raw`'widget\55detail'`],
    ['LF continuation', "'widget-\\\ndetail'"],
    ['CR continuation', "'widget-\\\rdetail'"],
    ['CRLF continuation', "'widget-\\\r\ndetail'"],
    ['line separator continuation', "'widget-\\\u2028detail'"],
    ['paragraph separator continuation', "'widget-\\\u2029detail'"],
    ['interpolation expression', '`prefix ${"widget-detail"}`'],
  ])('reports the exact decoded literal for %s', (_name, literal) => {
    expect(retiredActionLiterals(join(packageRoot, 'dist/sample.mjs'), `const action = ${literal};`))
      .toEqual(['dist/sample.mjs:1: widget-detail']);
  });

  it.each([
    ['longer name', "'widget-detail-extra'"],
    ['comment', '/* "widget-detail" */'],
    ['regex', '/widget-detail/'],
    ['template', '`widget-detail`'],
    ['template interpolation text', '`widget-detail ${1}`'],
    ['escaped backslash', String.raw`'widget\\x2ddetail'`],
    ['uppercase escape marker', String.raw`'widget\X2Ddetail'`],
    ['out-of-range unicode', String.raw`'widget\u{110000}detail'`],
    ['malformed hexadecimal', String.raw`'widget\xZdetail'`],
    ['malformed unicode', String.raw`'widget\uZZZZdetail'`],
  ])('rejects %s while retaining a positive control', (_name, source) => {
    const file = join(packageRoot, 'adapters/sample.ts');
    expect(retiredActionLiterals(file, source)).toEqual([]);
    expect(retiredActionLiterals(file, "'widget-detail'"))
      .toEqual(['adapters/sample.ts:1: widget-detail']);
  });

  it('keeps dead adapter actions out of the production surface', () => {
    const presentFiles = RETIRED_ACTIONS
      .flatMap((action) => [
        `adapters/marketview/${action}.ts`,
        `dist/adapters/marketview/${action}.js`,
        `dist/adapters/marketview/${action}.mjs`,
      ])
      .filter((path) => existsSync(join(packageRoot, path)));

    const actionReferences = productionFiles(packageRoot)
      .flatMap((file) => retiredActionLiterals(file, readFileSync(file, 'utf8')));

    expect([...presentFiles, ...actionReferences]).toEqual([]);
  });
});
