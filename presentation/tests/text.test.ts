import { describe, expect, it } from 'vitest';
import { renderText } from '../text.js';

describe('renderText', () => {
  it('renders ADR 0070 layout: fields, titled body, titled tables with a title-line count, and hint', () => {
    expect(renderText([
      { type: 'field', key: 'title', value: 'How does carry compare?' },
      { type: 'field', key: 'ref', value: '@w1' },
      { type: 'body', title: 'Description', text: 'Line one.\r\nLine two.\nLine three.' },
      {
        type: 'table',
        title: 'Params',
        noun: 'params',
        headers: ['name', 'label', 'value', 'type', 'options'],
        rows: [['universe', 'universe', 'G10', 'Enum', ['G10', 'CEEMEA']]],
      },
      {
        type: 'table',
        title: 'Data',
        noun: 'rows',
        count: { shown: 2, total: 260 },
        headers: ['date', '1m Implied Vol', '1m Realized Vol'],
        rows: [['03 Jul 2026', undefined, '7.79'], ['04 Jul 2026', '8.1', null]],
      },
      {
        type: 'hints',
        hints: [{ action: 'get all rows as raw numbers', command: 'marquee marketview widget view @w1 --json data' }],
      },
    ])).toBe([
      'title:\tHow does carry compare?',
      'ref:\t@w1',
      '',
      'Description',
      'Line one.',
      'Line two.',
      'Line three.',
      '',
      'Params',
      'name\tlabel\tvalue\ttype\toptions',
      'universe\tuniverse\tG10\tEnum\tG10, CEEMEA',
      '',
      'Data (2 of 260 rows)',
      'date\t1m Implied Vol\t1m Realized Vol',
      '03 Jul 2026\t\t7.79',
      '04 Jul 2026\t8.1\t',
      '',
      'To get all rows as raw numbers, try: marquee marketview widget view @w1 --json data',
      '',
    ].join('\n'));
  });

  it('prints table refs as fields beneath counted titles and empty titles', () => {
    expect(renderText([
      { type: 'table', title: 'Same', ref: '@d1.s1', noun: 'widgets', count: { shown: 1, total: 2 }, headers: ['ref'], rows: [['@d1.w1']] },
      { type: 'table', title: 'Same', ref: '@d1.s2', noun: 'widgets', headers: ['ref'], rows: [] },
    ])).toBe('Same (1 of 2 widgets)\nref:\t@d1.s1\nref\n@d1.w1\n\nSame\nref:\t@d1.s2\n  There are no widgets\n');
  });

  it('renders nothing for an empty list', () => {
    expect(renderText([])).toBe('');
  });

  it('prints an empty table as its title and an indented no-rows sentence, as gh issue status does', () => {
    expect(renderText([
      { type: 'table', title: 'Params', noun: 'params', headers: ['name', 'value'], rows: [] },
      { type: 'table', title: 'Data', noun: 'rows', headers: [], rows: [] },
    ])).toBe('Params\n  There are no params\n\nData\n  There are no rows\n');
  });

  it('folds multi-line and tabbed cells into one line without truncating', () => {
    const long = 'x'.repeat(500);
    expect(renderText([
      { type: 'field', key: 'title', value: 'Gold\n  price\tand\r\npositioning' },
      { type: 'table', noun: 'rows', headers: ['a\nb'], rows: [[`first\nsecond ${long}`]] },
    ])).toBe(`title:\tGold price and positioning\n\na b\nfirst second ${long}\n`);
  });

  it('joins lists with `, ` by default and `; ` when items can contain commas', () => {
    expect(renderText([
      { type: 'field', key: 'tags', value: ['Carry', 'FX'] },
      {
        type: 'field',
        key: 'authors',
        value: { items: ['Alex Example, CFA', 'Jane Doe'], separator: '; ' },
      },
    ])).toBe('tags:\tCarry, FX\nauthors:\tAlex Example, CFA; Jane Doe\n');
  });

  it('prints missing and empty field values as empty fields, never a placeholder or 0', () => {
    expect(renderText([
      { type: 'field', key: 'author', value: undefined },
      { type: 'field', key: 'tags', value: [] },
      { type: 'field', key: 'count', value: 0 },
    ])).toBe('author:\t\ntags:\t\ncount:\t0\n');
  });

  it('shows no count on a complete table', () => {
    expect(renderText([
      { type: 'table', title: 'Widgets', noun: 'widgets', count: { shown: 2, total: 2 }, headers: ['ref'], rows: [['@w1'], ['@w2']] },
    ])).toBe('Widgets\nref\n@w1\n@w2\n');
  });

  it('shows `(<shown> shown)` on a cut table whose total is unknown', () => {
    expect(renderText([
      { type: 'table', title: 'Widgets', noun: 'widgets', count: { shown: 2 }, headers: ['ref'], rows: [['@w1'], ['@w2']] },
    ])).toBe('Widgets (2 shown)\nref\n@w1\n@w2\n');
  });

  it('places hints last, after a blank line, or right under a closing sentence', () => {
    const hints = {
      type: 'hints',
      hints: [
        { action: 'sort by relevance', command: 'marquee content search "US CPI" --sort relevance' },
        { action: 'narrow results', command: 'marquee content search "US CPI" --source Research' },
      ],
    } as const;
    expect(renderText([
      hints,
      { type: 'field', key: 'status', value: 'expired' },
      { type: 'field', key: 'host', value: 'marquee.gs.com' },
    ])).toBe([
      'status:\texpired',
      'host:\tmarquee.gs.com',
      '',
      'To sort by relevance, try: marquee content search "US CPI" --sort relevance',
      'To narrow results, try: marquee content search "US CPI" --source Research',
      '',
    ].join('\n'));
    expect(renderText([
      { type: 'table', title: 'Filters', noun: 'filters', headers: ['flag'], rows: [['--source']] },
      { type: 'sentence', text: 'Sorted by time.' },
      hints,
    ])).toBe([
      'Filters',
      'flag',
      '--source',
      '',
      'Sorted by time.',
      'To sort by relevance, try: marquee content search "US CPI" --sort relevance',
      'To narrow results, try: marquee content search "US CPI" --source Research',
      '',
    ].join('\n'));
  });
});
