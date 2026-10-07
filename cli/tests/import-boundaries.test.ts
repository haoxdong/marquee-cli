import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { packageRoot } from '../../lib/tests/package-root.js';

function productionCliFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry !== 'tests') {
        files.push(...productionCliFiles(path));
      }
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('CLI import boundaries', () => {
  it('does not runtime-import MarketView adapter internals', () => {
    const root = join(packageRoot, 'cli');
    const offenders = productionCliFiles(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const imports = source.matchAll(/import\s+(?!type\b)[\s\S]*?\sfrom\s+['"][^'"]*adapters\/marketview\/[^'"]+['"]/g);
      return [...imports].map((statement) => `${relative(packageRoot, file)}: ${statement[0].replace(/\s+/g, ' ')}`);
    });

    expect(offenders).toEqual([]);
  });
});
