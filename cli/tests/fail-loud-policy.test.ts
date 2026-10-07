import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { assert, describe, expect, it } from 'vitest';

import { packageRoot } from '../../lib/tests/package-root.js';

// ADR 0030 (Fail-Loud Error Policy): no operation's failure may be silently
// discarded. This scans production source for swallow patterns and pins every
// allowed site by scope, ordinal and statement fingerprint, so a new swallow
// cannot take the place of a removed one. New violations fail this test — do
// not add to the allowlist; propagate the error instead.
// See docs/adr/0030-fail-loud-error-policy.md.

// PERMANENT allowlist — the two ADR 0030 exception categories:
//   1. Documented-transient choke point (transport-layer single retry for
//      gateway HTML) — implemented as a conditional retry, so it does not
//      match a swallow pattern; listed here only if it ever does.
//   2. Probe semantics — a failed check reported truthfully as state.
// Entries: 'relative/path.ts' -> audited `scope#ordinal:fingerprint` sites, with a reason.
const PERMANENT: Record<string, { sites: string[]; reason: string }> = {
  'marquee-cli/agent-browser-runtime/process.ts': { sites: ['resolveAgentBrowserBinForRuntime#1:a3613cdc39', 'resolveAgentBrowserBinForRuntime#2:2e5f567dff', 'readGitPath#1:043dbb7902'], reason: 'Probe: dependency, worktree, and PATH resolution misses select the next binary-resolution source' },
  'marquee-cli/cli/commands/browser.ts': { sites: ['isMarqueeWebUrl#1:18102bd4fe'], reason: 'Probe: a malformed page URL means the current browser page is not Marquee Web' },
  'marquee-cli/transport/recording.ts': { sites: ['readRecordingTolerant#1:747908b672'], reason: 'Record-mode concurrency probe: half-written readable recordings are absent before atomic rewrite' },
  'marquee-cli/transport/direct.ts': { sites: ['HttpTransport.exchangeAccessToken#1:a8701e2312'], reason: 'Probe: optional token-exchange parse failure preserves the louder HTTP/auth failure path' },
};

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

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function unwrappedExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isDefaultLiteral(node: ts.Expression): boolean {
  const value = unwrappedExpression(node);
  if (
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (ts.isIdentifier(value)) return value.text === 'undefined';
  if (ts.isArrayLiteralExpression(value)) return value.elements.length === 0;
  if (ts.isObjectLiteralExpression(value)) return value.properties.length === 0;
  if (ts.isStringLiteral(value)) return value.text === '';
  if (ts.isNumericLiteral(value)) return value.text === '0';
  if (value.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
    return (value as ts.NoSubstitutionTemplateLiteral).text === '';
  }
  return false;
}

function blockSwallowsWithDefault(block: ts.Block): boolean {
  const [statement, ...rest] = block.statements.filter((statement) => !ts.isEmptyStatement(statement));
  if (statement === undefined) return true;
  if (rest.length > 0) return false;
  if (!ts.isReturnStatement(statement)) return false;
  return !statement.expression || isDefaultLiteral(statement.expression);
}

function functionSwallowsWithDefault(
  node: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  if (ts.isBlock(node.body)) return blockSwallowsWithDefault(node.body);
  return isDefaultLiteral(node.body);
}

function isCatchCall(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'catch';
}

interface SwallowSite {
  line: number;
  scope: string;
  fingerprint: string;
}

const printer = ts.createPrinter({ removeComments: true });

// Hashes the printed statement, so formatting and comments do not move a site
// but any code change inside it does.
function fingerprintOf(sourceFile: ts.SourceFile, node: ts.Node): string {
  const printed = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
  return createHash('sha1').update(printed).digest('hex').slice(0, 10);
}

function scopeNameOf(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertyAssignment(node)) &&
    node.name &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }
  return undefined;
}

function swallowsIn(source: string): SwallowSite[] {
  const sourceFile = ts.createSourceFile('policy-source.ts', source, ts.ScriptTarget.Latest, true);
  const found: SwallowSite[] = [];
  const scope: string[] = [];

  function record(anchor: ts.Node, fingerprinted: ts.Node): void {
    found.push({
      line: lineOf(sourceFile, anchor),
      scope: scope.length > 0 ? scope.join('.') : '<module>',
      fingerprint: fingerprintOf(sourceFile, fingerprinted),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isCatchClause(node) && blockSwallowsWithDefault(node.block)) {
      record(node, node.parent);
    }
    if (ts.isCallExpression(node) && isCatchCall(node)) {
      const [handler] = node.arguments;
      if (
        handler &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
        functionSwallowsWithDefault(handler)
      ) {
        record(node, node);
      }
    }
    const name = scopeNameOf(node);
    if (name) scope.push(name);
    ts.forEachChild(node, visit);
    if (name) scope.pop();
  }

  visit(sourceFile);
  return found.sort((a, b) => a.line - b.line);
}

// Sites are `scope#ordinal:fingerprint`, matching the Python policy scanner.
function swallowSitesIn(source: string): string[] {
  const ordinals = new Map<string, number>();
  return swallowsIn(source).map(({ scope, fingerprint }) => {
    const ordinal = (ordinals.get(scope) ?? 0) + 1;
    ordinals.set(scope, ordinal);
    return `${scope}#${ordinal}:${fingerprint}`;
  });
}

function allowlistProblems(
  found: Map<string, string[]>,
  permanent: Record<string, { sites: string[]; reason: string }>,
): string[] {
  const problems: string[] = [];
  for (const [path, sites] of found) {
    const allowed = new Set(permanent[path]?.sites ?? []);
    const unaudited = sites.filter((site) => !allowed.has(site));
    if (unaudited.length > 0) {
      problems.push(
        `${path}: unaudited swallow site(s) ${unaudited.join(', ')}. ` +
        'Errors must propagate (ADR 0030) — do not extend the allowlist.',
      );
    }
  }
  for (const [path, entry] of Object.entries(permanent)) {
    const actual = new Set(found.get(path) ?? []);
    const missing = entry.sites.filter((site) => !actual.has(site));
    if (missing.length > 0) {
      problems.push(`${path}: allowlist site(s) ${missing.join(', ')} no longer exist — shrink its entry in this file.`);
    }
  }
  return problems;
}

describe('fail-loud policy (ADR 0030)', () => {
  it('flags catch bodies that return default literals', () => {
    const source = [
      'async function demo() {',
      '  try { await load(); } catch { return []; }',
      '  try { await load(); } catch { return; }',
      '  pending.catch(() => { return null; });',
      '  pending.catch(() => { return; });',
      '  pending.catch(() => (null));',
      '  pending.catch(() => []);',
      '  pending.catch(() => { throw new Error("not a swallow"); });',
      '}',
    ].join('\n');

    expect(swallowsIn(source).map(({ line }) => line)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('flags a swallow that replaces a removed one in the same file', () => {
    const original = 'function load() {\n  try { read(); } catch { return null; }\n}';
    const replacement = 'function load() {\n  try { parse(); } catch { return null; }\n}';
    const [originalSite] = swallowSitesIn(original);
    assert.isDefined(originalSite);
    const [replacementSite] = swallowSitesIn(replacement);
    assert.isDefined(replacementSite);

    expect(originalSite).toMatch(/^load#1:/);
    expect(replacementSite).toMatch(/^load#1:/);
    expect(allowlistProblems(
      new Map([['marquee-cli/example.ts', [replacementSite]]]),
      { 'marquee-cli/example.ts': { sites: [originalSite], reason: 'Probe semantics.' } },
    )).toEqual([
      `marquee-cli/example.ts: unaudited swallow site(s) ${replacementSite}. Errors must propagate (ADR 0030) — do not extend the allowlist.`,
      `marquee-cli/example.ts: allowlist site(s) ${originalSite} no longer exist — shrink its entry in this file.`,
    ]);
  });

  it('has no unlisted error-swallowing sites in production source', () => {
    const found = new Map<string, string[]>();
    for (const file of productionFiles(SCAN_ROOT)) {
      const sites = swallowSitesIn(readFileSync(file, 'utf8'));
      if (sites.length > 0) {
        found.set(join('marquee-cli', relative(packageRoot, file)), sites);
      }
    }

    expect(allowlistProblems(found, PERMANENT)).toEqual([]);
  });
});
