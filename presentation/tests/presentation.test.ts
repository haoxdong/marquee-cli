import { describe, expect, it } from 'vitest';
import {
  CLI_EXIT_CODES,
  formatJsonFields,
  jsonFieldsError,
} from '../index.js';

const FIELDS = ['id', 'ref', 'title'] as const;

describe('presentation primitives', () => {
  it('uses only the gh-compatible public exit codes', () => {
    expect(CLI_EXIT_CODES).toEqual({ success: 0, failure: 1, cancelled: 2, authRequired: 4 });
  });

  it('lists the fields for bare --json, as gh does', () => {
    const listing = 'Specify one or more comma-separated fields for `--json`:\n  id\n  ref\n  title';
    expect(jsonFieldsError({ json: true }, FIELDS)).toBe(listing);
    expect(jsonFieldsError({ json: ' , ' }, FIELDS)).toBe(listing);
  });

  it('names an unknown field and lists the available ones', () => {
    expect(jsonFieldsError({ json: 'ref,nope' }, FIELDS)).toBe(
      'Unknown JSON field: "nope"\nAvailable fields:\n  id\n  ref\n  title',
    );
  });

  it('requires --json for --jq', () => {
    expect(jsonFieldsError({ jq: '.' }, FIELDS)).toBe('cannot use `--jq` without specifying `--json`');
    expect(jsonFieldsError({}, FIELDS)).toBeUndefined();
    expect(jsonFieldsError({ json: 'title,ref', jq: '.' }, FIELDS)).toBeUndefined();
  });

  const records = [
    { title: 'Carry', ref: '@w1', id: 'MW1', nested: { b: 1, a: 2 } },
    { title: 'Vol', ref: '@w2', id: 'MW2', nested: { b: 3, a: 4 } },
  ];

  it('projects the named fields with keys sorted, compact', async () => {
    await expect(formatJsonFields(records, { json: 'title,ref' })).resolves.toEqual({
      ok: true,
      output: '[{"ref":"@w1","title":"Carry"},{"ref":"@w2","title":"Vol"}]',
    });
    await expect(formatJsonFields(records[0], { json: 'nested,id' })).resolves.toEqual({
      ok: true,
      output: '{"id":"MW1","nested":{"b":1,"a":2}}',
    });
    await expect(formatJsonFields([], { json: 'ref' })).resolves.toEqual({ ok: true, output: '[]' });
  });

  it('prints jq strings bare and other values compact, one per line', async () => {
    await expect(formatJsonFields(records, { json: 'ref', jq: '.[].ref' })).resolves.toEqual({
      ok: true,
      output: '@w1\n@w2',
    });
    await expect(formatJsonFields(records, { json: 'ref,id', jq: '.[0]' })).resolves.toEqual({
      ok: true,
      output: '{"id":"MW1","ref":"@w1"}',
    });
  });

  it('explains a jq error with a translation example', async () => {
    const jq = await formatJsonFields(records, { json: 'ref', jq: 'widgets.at(-1)' });
    if (jq.ok) throw new Error('expected jq failure');
    expect(jq.error).toContain('data.at(-1).value → .data[-1].value');
  });
});
