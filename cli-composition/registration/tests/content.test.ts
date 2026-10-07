import type { Ref } from '../../../artifact-registry/index.js';
import type { DocumentId } from '../../../document/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { MarqueeError } from '../../../transport/index.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerContentCommands } from '../content.js';
import { createArtifactRegistry } from '../../../artifact-registry/index.js';
import type {
  ContentRegistration,
} from '../registrations.js';
import {
  createContent,
  type Content,
  type ContentSearchInput,
} from '../../../content/index.js';
import {
  type DocumentModule,
} from '../../../document/index.js';
import { createProviderEvidenceLog } from '../../evidence.js';

function registrationContent(
  search: (input: ContentSearchInput) => ReturnType<Content['search']>,
): Content {
  return {
    async get() {
      throw new Error('unexpected Content get');
    },
    search,
  };
}

function unusedDocument(): DocumentModule {
  return {
    async get() {
      throw new Error('unexpected Document retrieval');
    },
  };
}

function commandContext(
  write: (chunk: string) => void,
  document: DocumentModule,
  registry: ReturnType<typeof createArtifactRegistry>,
  configured?: Content,
): ContentRegistration {
  const evidence = createProviderEvidenceLog();
  const content = configured ?? createContent({
    document,
    evidence,
    registry,
    requester: () => ({
      async request() {
        throw new Error('unexpected Content Search request');
      },
    }),
  });
  return {
    write,
    writeError: write,
    getContent: () => content,
  };
}

describe('content command module', () => {
  let refsDir: string | undefined;

  afterEach(() => {
    if (refsDir) {
      rmSync(refsDir, { recursive: true, force: true });
      refsDir = undefined;
    }
    process.exitCode = undefined;
  });

  it('returns a failed facet command before a held sibling and recovers explicitly', async () => {
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-bulk-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const responses = JSON.parse(readFileSync(new URL('../../../content/search/adapters/tests/fixtures/multi-facet-responses.json', import.meta.url), 'utf8')) as { empty: unknown; confirmed: unknown };
    let healthy = false;
    const request = vi.fn<ReturnType<Parameters<typeof createContent>[0]['requester']>['request']>(async (_endpoint, init) => {
      const facets = (init?.body as { facets: string }).facets;
      if (!healthy && facets === '(report_types CONTAINS_ALL ["Blogs"])') throw new MarqueeError('timeout', 'type timed out');
      if (!healthy && facets === '(sources CONTAINS_ALL ["Research"])') await held;
      return healthy ? responses.confirmed : responses.empty;
    });
    const content = createContent({ registry, document: unusedDocument(), evidence: createProviderEvidenceLog(), requester: () => ({ request }) });
    let output = '';
    const program = new Command();
    registerContentCommands(program, commandContext((chunk) => { output += chunk; }, unusedDocument(), registry, content));
    const run = program.parseAsync(['content', 'search', 'US CPI', '--type', 'Blogs', '--source', 'Research'], { from: 'user' });
    try {
      const first = await Promise.race([run.then(() => 'completed'), new Promise<string>((resolve) => { setImmediate(() => resolve('pending')); })]);
      expect(first).toBe('completed');
      expect(process.exitCode).toBe(1);
      expect(output).toContain('timed out');
      expect(output).not.toContain('Results');
    } finally {
      release();
      await run;
    }
    healthy = true;
    output = '';
    process.exitCode = undefined;
    await program.parseAsync(['content', 'search', 'US CPI', '--type', 'Blogs', '--source', 'Research'], { from: 'user' });
    expect(process.exitCode).toBeUndefined();
    expect(output).not.toContain('Error:');
  });

  it('passes raw Content search grammar values to the owner', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const document = unusedDocument();
    const search = vi.fn<Content['search']>(async () => ({
      result: {
        ok: false,
        error: {
          kind: 'search-failed',
          error: { kind: 'discovery-failed' },
        },
      },
      evidence: [],
    }));
    let output = '';
    registerContentCommands(program, commandContext(
      (chunk) => { output += chunk; },
      document,
      registry,
      registrationContent(search),
    ));

    await program.parseAsync([
      'content',
      'search',
      'US CPI',
      '--source',
      'Research',
      '--source',
      ' research ',
      '--published',
      '2026-05-01..2026-05-31',
    ], { from: 'user' });

    expect(search).toHaveBeenCalledWith({
      query: 'US CPI',
      limit: '10',
      facets: [
        { field: 'source', value: 'Research' },
        { field: 'source', value: ' research ' },
      ],
      published: '2026-05-01..2026-05-31',
    });
    expect(output).toBe('Error: Content search discovery failed\n');
    expect(process.exitCode).toBe(1);
  });

  it('passes malformed dates through for Content-owned failure construction', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const document = unusedDocument();
    const search = vi.fn<Content['search']>(async () => ({
      result: {
        ok: false,
        error: {
          kind: 'search-failed',
          error: {
            kind: 'invalid-date-range',
            problem: 'invalid-date',
            value: '2026-02-30',
          },
        },
      },
      evidence: [],
    }));
    registerContentCommands(
      program,
      commandContext(() => {}, document, registry, registrationContent(search)),
    );

    await program.parseAsync([
      'content',
      'search',
      'US CPI',
      '--published',
      '>=2026-02-30',
    ], { from: 'user' });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ published: '>=2026-02-30' }));
  });

  it('routes Markets and Research URLs through unified content view', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>(async (locator) => {
      const url = locator.kind === 'marquee-content-url' ? locator.url : '';
      const id = url.match(/[0-9a-f-]{36}/i)?.[0] ?? '';
      return {
        ok: true,
        value: {
          identifier: url.includes('/content/research/')
            ? { kind: 'gir-research-uuid', documentId: id as DocumentId }
            : { kind: 'content-stream-id', documentId: id as DocumentId },
          title: 'Article',
          url,
        },
      };
    });

    registerContentCommands(program, commandContext(() => {}, { get }, registry));

    await program.parseAsync([
      'content',
      'view',
      'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
    ], { from: 'user' });
    await program.parseAsync([
      'content',
      'view',
      'https://marquee.gs.com/content/research/en/reports/2026/07/15/123e4567-e89b-12d3-a456-426614174001.html',
    ], { from: 'user' });

    expect(get).toHaveBeenNthCalledWith(1, {
      kind: 'marquee-content-url',
      url: 'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
    });
    expect(get).toHaveBeenNthCalledWith(2, {
      kind: 'marquee-content-url',
      url: 'https://marquee.gs.com/content/research/en/reports/2026/07/15/123e4567-e89b-12d3-a456-426614174001.html',
    });
  });

  it.each([
    '/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
  ])('renders a foreign-host Document failure for %s', async (path) => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>(async (locator) => ({
      ok: false,
      error: {
        kind: 'invalid-locator',
        locator: locator.kind === 'marquee-content-url' ? locator.url : '',
        problem: 'foreign-host',
      },
    }));
    let output = '';

    registerContentCommands(program, commandContext((chunk) => { output += chunk; }, { get }, registry));

    await program.parseAsync([
      'content',
      'view',
      `https://attacker.invalid${path}`,
    ], { from: 'user' });

    expect(output).toMatch(/^Error: .* is not a Marquee content URL/);
    expect(process.exitCode).toBe(1);
    expect(get).toHaveBeenCalledOnce();
  });

  it('claims a single Content ref from a resolved Document', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const id = '123e4567-e89b-12d3-a456-426614174001';
    const get = vi.fn<DocumentModule['get']>(async () => ({
      ok: true,
      value: {
        identifier: { kind: 'gir-research-uuid', documentId: id as DocumentId },
        title: 'Resolved research article',
      },
    }));

    registerContentCommands(program, commandContext(() => {}, { get }, registry));

    await program.parseAsync([
      'content',
      'view',
      id,
    ], { from: 'user' });

    expect(get).toHaveBeenCalledWith({ kind: 'document-id', documentId: id });
    expect(registry.resolveRef('c1' as Ref)).toEqual({
      type: 'document',
      documentId: '123e4567-e89b-12d3-a456-426614174001',
      realm: 'research',
    });
  });

  it('returns a Document failure without claiming an article ref', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>(async (locator) => ({
      ok: false,
      error: {
        kind: 'not-found',
        locator,
        problem: 'retrieval-miss',
      },
    }));
    let output = '';

    registerContentCommands(program, commandContext((chunk) => { output += chunk; }, { get }, registry));

    await program.parseAsync([
      'content',
      'view',
      '123e4567-e89b-12d3-a456-426614174001',
    ], { from: 'user' });

    expect(output).toBe('Error: no content document matching "123e4567-e89b-12d3-a456-426614174001"\n');
    expect(process.exitCode).toBe(1);
    expect(registry.resolveRef('c1' as Ref)).toBeUndefined();
  });

  it('projects and filters content view JSON through the shared output layer', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>(async () => ({
      ok: true,
      value: {
        identifier: {
          kind: 'content-stream-id',
          documentId: '123e4567-e89b-12d3-a456-426614174000' as DocumentId,
        },
        title: 'Projected article',
      },
    }));
    let output = '';

    registerContentCommands(program, commandContext((chunk) => { output += chunk; }, { get }, registry));

    await program.parseAsync([
      'content',
      'view',
      'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
      '--json',
      'title,ref',
      '--jq',
      '.title',
    ], { from: 'user' });

    expect(output).toBe('Projected article\n');
  });

  it('rejects content view --jq without --json before querying', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>();
    let stderr = '';
    program.configureOutput({ writeErr: (chunk) => { stderr += chunk; } });

    registerContentCommands(program, commandContext(() => {}, { get }, registry));

    await expect(program.parseAsync([
      'content',
      'view',
      'https://marquee.gs.com/content/markets/en/2026/07/15/123e4567-e89b-12d3-a456-426614174000.html',
      '--jq',
      '.title',
    ], { from: 'user' })).rejects.toMatchObject({ code: 'marquee.usage', exitCode: 1 });

    expect(get).not.toHaveBeenCalled();
    expect(stderr).toBe('cannot use `--jq` without specifying `--json`\n');
  });

  it.each([
    ['market-data', 'Error: ref @s1 is a search — use `marquee marketview search ...`'],
    ['research', 'Error: ref @s1 is a search — use `marquee content search ...`'],
  ] as const)('guides a wrong-typed %s ref on content view to its owning path', async (searchKind, message) => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.setRefs('s1', {
      s1: { type: 'search', searchKind },
    });
    const get = vi.fn<DocumentModule['get']>();
    let output = '';

    registerContentCommands(program, commandContext((chunk) => { output += chunk; }, { get }, registry));
    await program.parseAsync(['content', 'view', '@s1'], { from: 'user' });

    expect(output.trim()).toBe(message);
    expect(process.exitCode).toBe(1);
    expect(get).not.toHaveBeenCalled();
  });

  it('reports an unknown content view ref', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>();
    let output = '';

    registerContentCommands(program, commandContext((chunk) => { output += chunk; }, { get }, registry));
    await program.parseAsync(['content', 'view', '@missing'], { from: 'user' });

    expect(output.split('\n')[0]).toBe('Error: ref @missing not found');
    expect(process.exitCode).toBe(1);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects the retired content discovery verb as an unknown command', async () => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>();

    registerContentCommands(program, commandContext(() => {}, { get }, registry));

    await expect(program.parseAsync([
      'content',
      'filter',
      '@s1',
      'source',
    ], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownCommand' });
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['--select', '--from', '--to', '--exact'])('rejects retired %s content search grammar', async (retiredFlag) => {
    const program = new Command();
    program.exitOverride();
    refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    const get = vi.fn<DocumentModule['get']>();

    registerContentCommands(program, commandContext(() => {}, { get }, registry));

    await expect(program.parseAsync([
      'content',
      'search',
      'US CPI',
      retiredFlag,
      'value',
    ], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
    expect(get).not.toHaveBeenCalled();
  });
});
