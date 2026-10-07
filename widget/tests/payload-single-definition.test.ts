import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { packageRoot } from '../../lib/tests/package-root.js';

// Single-definition check: each semantic Widget Payload reader is defined in
// exactly one place — widget/payload.ts. The reader is the single owner of
// "how to read a value out of a Widget Payload"; a second definition is a fork
// re-forming. If this fails, delete the new copy and import from the reader —
// do not relax this test. isRecord is deliberately NOT policed here: the name is
// too generic (owner-local record checks are intentionally not ratcheted).
const SEMANTIC_READERS = [
  'contextParamDefault',
  'controlParamDefault',
  'widgetControlDefault',
  'widgetFromEnvelope',
];

const SCAN_ROOT = packageRoot;
const EXCLUDED_DIRS = new Set(['tests', 'fixtures', 'node_modules', 'dist']);

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) {
        files.push(...productionFiles(path));
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

function definitionSites(name: string, files: string[]): string[] {
  // Matches `function name(` and `export function name(`; a re-export
  // (`export { name }`), an import, or a call site has no `function` keyword.
  const pattern = new RegExp(`function\\s+${name}\\s*\\(`);
  return files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
}

describe('Widget Payload reader single-definition ratchet', () => {
  const files = productionFiles(SCAN_ROOT);

  it('defines each semantic reader in exactly one file', () => {
    const problems: string[] = [];
    for (const name of SEMANTIC_READERS) {
      const sites = definitionSites(name, files).map((f) => relative(packageRoot, f));
      const [site, ...others] = sites;
      if (site === undefined || others.length > 0) {
        problems.push(`${name}: defined in ${sites.length} file(s) [${sites.join(', ')}] — expected exactly 1 (widget/payload.ts).`);
      } else if (!site.endsWith('widget/payload.ts')) {
        problems.push(`${name}: defined in ${site} — expected widget/payload.ts.`);
      }
    }
    expect(problems).toEqual([]);
  });
});
