// The shared text layer (ADR 0070): the only code that writes tabs, header
// rows, empty fields, folded cells, list joins, title-line counts and hints. A
// surface builds blocks; missing values stay missing and print empty.

type TextValue = string | number | boolean | null | undefined;

/** A list joined with `, `, or with `; ` when an item can contain `, `. */
type TextList = readonly string[] | Readonly<{ items: readonly string[]; separator: '; ' }>;

export type TextCell = TextValue | TextList;

/** Rows shown out of the total; a cut table whose provider reports no total omits `total`. */
type TextCount = Readonly<{ shown: number; total?: number }>;

export type TextHint = Readonly<{ action: string; command: string }>;

export type TextTable = Readonly<{
  title?: string;
  ref?: string;
  /** What the rows are, plural: `rows`. */
  noun: string;
  count?: TextCount;
  headers: readonly string[];
  rows: readonly (readonly TextCell[])[];
}>;

export type TextBlock =
  | Readonly<{ type: 'field'; key: string; value: TextCell }>
  | Readonly<{ type: 'body'; title: string; text: string }>
  | (Readonly<{ type: 'table' }> & TextTable)
  | Readonly<{ type: 'sentence'; text: string }>
  | Readonly<{ type: 'hints'; hints: readonly TextHint[] }>;

/**
 * Renders blocks as ADR 0070 text; no blocks render nothing. Hints always go last.
 * A cut table's count goes on its title line. A table with no rows prints its
 * title and one indented sentence instead, as `gh issue status` does.
 */
export function renderText(blocks: readonly TextBlock[]): string {
  const ordered = [
    ...blocks.filter((block) => block.type !== 'hints'),
    ...blocks.filter((block) => block.type === 'hints' && block.hints.length > 0),
  ];
  const lines: string[] = [];
  ordered.forEach((block, index) => {
    const previous = ordered[index - 1];
    if (previous !== undefined && !joinsPrevious(previous, block)) lines.push('');
    lines.push(...blockLines(block));
  });
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function joinsPrevious(previous: TextBlock, block: TextBlock): boolean {
  if (previous.type === 'field') {
    return block.type === 'field' || block.type === 'sentence';
  }
  return previous.type === 'sentence' && block.type === 'hints';
}

function blockLines(block: TextBlock): readonly string[] {
  switch (block.type) {
    case 'field':
      return [`${fold(block.key)}:\t${cellText(block.value)}`];
    case 'body':
      return [fold(block.title), block.text.replaceAll('\r\n', '\n')];
    case 'sentence':
      return [fold(block.text)];
    case 'hints':
      return block.hints.map(({ action, command }) => `To ${fold(action)}, try: ${fold(command)}`);
    case 'table': {
      const title = block.title === undefined ? [] : [fold(titleWithCount(block.title, block))];
      const ref = block.ref === undefined ? [] : blockLines({ type: 'field', key: 'ref', value: block.ref });
      if (block.rows.length === 0) return [...title, ...ref, `  There are no ${block.noun}`];
      return [
        ...title,
        ...ref,
        block.headers.map(cellText).join('\t'),
        ...block.rows.map((row) => row.map(cellText).join('\t')),
      ];
    }
  }
}

/** A hint command argument, double-quoted unless it is one plain shell word. */
export function shellArgument(value: string): string {
  return /^[\w./:@-]+$/.test(value) ? value : JSON.stringify(value);
}

/** `Data (30 of 260 rows)` when rows are cut, `Widgets (10 shown)` when the total is unknown. */
function titleWithCount(title: string, { count, noun }: TextTable): string {
  if (count === undefined) return title;
  if (count.total === undefined) return `${title} (${count.shown} shown)`;
  return count.shown < count.total ? `${title} (${count.shown} of ${count.total} ${noun})` : title;
}

function cellText(value: TextCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return fold(String(value));
  return 'items' in value ? fold(value.items.join(value.separator)) : fold(value.join(', '));
}

/** Every cell is one line: line breaks and tabs fold into one space, never truncated. */
function fold(value: string): string {
  return value.replace(/[ ]*[\t\r\n]+[ ]*/g, ' ');
}
